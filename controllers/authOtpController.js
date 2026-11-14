const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const AuthChallenge = require("../models/authChallenge");
const AuthRateLimit = require("../models/authRateLimit");
const Verification = require("../models/verification");
const { generateVerificationId } = require("./authController");
const {
  getCurrentTerms,
  findAcceptanceToken,
  findAcceptanceById,
  hasCurrentAcceptance,
  associateAcceptance,
} = require("../services/termsAcceptanceService");

const MSG91 = "https://control.msg91.com/api/v5/widget";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_RESENDS = 2;
const allowedRoles = ["patient", "doctor", "laboratory", "pharmacy", "admin"];
const ipWindows = new Map();

function normalizePhone(input) {
  const value = String(input || "").trim().replace(/[\s()-]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(value)) return null;
  const digits = value.startsWith("+") ? value.slice(1) : value;
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  return digits;
}

function phoneQuery(phone) {
  const variants = [phone, `+${phone}`];
  if (/^91[6-9]\d{9}$/.test(phone)) variants.push(phone.slice(2));
  return { $in: variants };
}

function allowIp(ip) {
  const now = Date.now();
  const entry = ipWindows.get(ip) || { start: now, count: 0 };
  if (now - entry.start > 60 * 60 * 1000) {
    entry.start = now;
    entry.count = 0;
  }
  entry.count += 1;
  ipWindows.set(ip, entry);
  return entry.count <= 30;
}

async function msg91(path, payload, { otpVerification = false } = {}) {
  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  const widgetId = process.env.MSG91_WIDGET_ID?.trim();
  if (!authKey || !widgetId) throw new Error("OTP_PROVIDER_NOT_CONFIGURED");
  try {
    const response = await fetch(`${MSG91}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authkey: authKey },
      body: JSON.stringify({ widgetId, ...payload }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.type !== "success" || data.code === 201) {
      if (otpVerification && response.ok) throw new Error("OTP_TOKEN_INVALID");
      console.error("MSG91 widget request rejected", {
        path,
        status: response.status,
        providerCode: String(data.code || data.type || "unknown").slice(0, 32),
      });
      throw new Error("OTP_PROVIDER_FAILURE");
    }
    return data;
  } catch (error) {
    if (error.message === "OTP_PROVIDER_FAILURE") throw error;
    console.error("MSG91 widget request failed", { path, errorType: error.name || "NetworkError" });
    throw new Error("OTP_PROVIDER_FAILURE");
  }
}

async function verifyChallengeWithMsg91(challenge, { otp, accessToken }) {
  if (typeof accessToken === "string" && accessToken.length > 0) {
    return verifyWidgetAccessToken(accessToken);
  }
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) throw new Error("OTP_TOKEN_INVALID");
  const result = await msg91("verifyOtp", { reqId: challenge.msg91RequestId, otp }, { otpVerification: true });
  const token = result.message || result["access-token"] || result.accessToken;
  if (typeof token !== "string" || token.length === 0) throw new Error("OTP_TOKEN_INVALID");
  return verifyWidgetAccessToken(token);
}

async function verifyWidgetAccessToken(token) {
  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  if (!authKey) throw new Error("OTP_PROVIDER_NOT_CONFIGURED");
  const response = await fetch(`${MSG91}/verifyAccessToken`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authkey: authKey,
    },
    body: new URLSearchParams({ "access-token": token }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.type !== "success" || data.code === 201) {
    throw new Error("OTP_TOKEN_INVALID");
  }
  return data;
}

async function createChallenge({ purpose, phone, user, role, registrationData, termsAcceptanceId, ip, skipPhoneRateLimit = false }) {
  if (!skipPhoneRateLimit) await incrementRateLimit("phone", phone, 5);
  if (ip) await incrementRateLimit("ip", String(ip).slice(0, 64), 30);
  const request = await msg91("sendOtp", { identifier: phone });
  const requestId = request.message || request.reqId || request.request_id;
  if (!requestId || typeof requestId !== "string") throw new Error("OTP_PROVIDER_FAILURE");
  const challengeId = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  await AuthChallenge.create({
    challengeId, purpose, phone,
    userId: user?._id || null,
    role: role || user?.role || "",
    registrationData: registrationData || null,
    termsAcceptanceId: termsAcceptanceId || null,
    msg91RequestId: requestId,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    lastSentAt: now,
    ip: String(ip || "").slice(0, 64),
  });
  return challengeId;
}

async function incrementRateLimit(scope, value, limit) {
  const now = Date.now();
  const bucket = Math.floor(now / (60 * 60 * 1000));
  const valueHash = crypto.createHash("sha256").update(`${scope}:${value}`).digest("hex");
  const id = `${scope}:${valueHash}:${bucket}`;
  const expiresAt = new Date((bucket + 1) * 60 * 60 * 1000 + 60 * 1000);
  const counter = await AuthRateLimit.findOneAndUpdate(
    { _id: id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true },
  );
  if (counter.count > limit) throw new Error("OTP_RATE_LIMIT");
}

async function countVerificationAttempt(challenge) {
  const updated = await AuthChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, verifiedAt: null, expiresAt: { $gt: new Date() }, verificationAttempts: { $lt: 5 } },
    { $inc: { verificationAttempts: 1 } },
    { new: true },
  );
  if (!updated) throw new Error("OTP_ATTEMPTS_EXCEEDED");
}

async function createRegisteredAccount(data, termsAcceptanceId) {
  const currentTerms = getCurrentTerms(data.role);
  const acceptance = await findAcceptanceById(
    termsAcceptanceId,
    data.role,
    currentTerms,
    { requireUnassigned: true },
  );
  if (!acceptance) {
    const error = new Error("TERMS_ACCEPTANCE_REQUIRED");
    error.statusCode = 428;
    throw error;
  }

  const professional = ["doctor", "laboratory", "pharmacy"].includes(data.role);
  const verificationId = professional ? await generateVerificationId(data.role) : "";
  const user = await User.create({
    name: data.name,
    email: data.email,
    password: data.password,
    role: data.role,
    phone: data.phone,
    accountStatus: "ACTIVE",
    verificationStatus: professional ? "PENDING" : "NOT_REQUIRED",
    verificationId,
    // Registration no longer claims that the supplied phone was verified.
    addresses: [{
      label: data.label,
      fullAddress: data.fullAddress,
      landmark: data.landmark,
      city: data.city,
      state: data.state,
      pincode: data.pincode,
      latitude: data.latitude,
      longitude: data.longitude,
      isDefault: true,
    }],
  });

  try {
    if (professional) {
      await Verification.create({
        userId: user._id,
        verificationId,
        role: data.role,
        professionalName: user.name,
        licenseNumber: "",
        organizationName: "",
        address: "",
        documents: [],
        notes: "",
        status: "PENDING",
      });
    }

    const acceptanceLinked = await associateAcceptance(
      termsAcceptanceId,
      user._id,
      data.role,
      currentTerms,
    );
    if (!acceptanceLinked) {
      const error = new Error("TERMS_ACCEPTANCE_LINK_FAILED");
      error.statusCode = 409;
      throw error;
    }
  } catch (error) {
    if (professional) await Verification.deleteOne({ userId: user._id, verificationId });
    await User.findByIdAndDelete(user._id);
    throw error;
  }

  return {
    user,
    professional,
  };
}

function providerFailure(res, reason) {
  console.error("OTP provider unavailable", {
    reason,
    authKeyConfigured: Boolean(process.env.MSG91_AUTH_KEY?.trim()),
    widgetIdConfigured: Boolean(process.env.MSG91_WIDGET_ID?.trim()),
  });
  return res.status(503).json({ success: false, code: "OTP_PROVIDER_UNAVAILABLE", message: "Phone verification is temporarily unavailable. Please try again later." });
}
function rateLimited(res) {
  return res.status(429).json({ success: false, message: "Too many verification requests. Please try later." });
}

const initiateLogin = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return res.status(429).json({ success: false, message: "Please try again later." });
    const phone = normalizePhone(req.body.phone);
    const role = String(req.body.role || "").trim().toLowerCase();
    const password = req.body.password;
    if (!phone || typeof password !== "string" || !allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid phone, role or credentials." });
    }
    const user = await User.findOne({ phone: phoneQuery(phone), role });
    if (!user || !(await bcrypt.compare(password, user.password)) || user.accountStatus === "SUSPENDED") {
      return res.status(401).json({ success: false, message: "Unable to sign in with those details." });
    }
    let termsAcceptanceId = null;
    if (role !== "admin") {
      const terms = getCurrentTerms(role);
      if (!await hasCurrentAcceptance(user._id, role, terms)) {
        const acceptance = await findAcceptanceToken(req.body.termsAcceptanceToken, role, terms, user._id);
        if (!acceptance) return res.status(428).json({ success: false, code: "TERMS_ACCEPTANCE_REQUIRED", message: "Please review and accept the current terms for this role before signing in." });
        termsAcceptanceId = acceptance._id;
      }
    }
    const challengeId = await createChallenge({ purpose: "login", phone, user, termsAcceptanceId, ip: req.ip });
    const challenge = await AuthChallenge.findOne({ challengeId }).select("msg91RequestId").lean();
    return res.status(200).json({ success: true, challengeId, requestId: challenge.msg91RequestId, message: "If the details are valid, a verification code has been sent." });
  } catch (error) {
    if (error.message === "OTP_RATE_LIMIT") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED" || error.message === "OTP_PROVIDER_FAILURE") return providerFailure(res, error.message);
    console.error("LOGIN OTP INITIATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to start sign-in. Please try again." });
  }
};

const verifyLogin = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return rateLimited(res);
    const { challengeId, accessToken, otp } = req.body;
    if (typeof challengeId !== "string" ||
      !(typeof accessToken === "string" && accessToken.length <= 4096) && typeof otp !== "string") {
      return res.status(400).json({ success: false, message: "Invalid verification request." });
    }
    const challenge = await AuthChallenge.findOne({ challengeId, purpose: "login", consumedAt: null, verifiedAt: null });
    if (!challenge || challenge.expiresAt <= new Date()) return res.status(400).json({ success: false, message: "Verification expired. Please sign in again." });
    await countVerificationAttempt(challenge);
    const providerResult = await verifyChallengeWithMsg91(challenge, { otp, accessToken });
    const verifiedPhone = normalizePhone(providerResult.identifier || providerResult.data?.identifier || providerResult.data?.mobile || providerResult.mobile || providerResult.message);
    if (!verifiedPhone || verifiedPhone !== challenge.phone) return res.status(401).json({ success: false, message: "Phone verification could not be confirmed." });
    const user = await User.findById(challenge.userId);
    if (!user || user.accountStatus === "SUSPENDED" || user.role !== challenge.role) return res.status(401).json({ success: false, message: "Unable to sign in with those details." });
    if (user.role !== "admin") {
      const terms = getCurrentTerms(user.role);
      const accepted = challenge.termsAcceptanceId
        ? await associateAcceptance(challenge.termsAcceptanceId, user._id, user.role, terms)
        : await hasCurrentAcceptance(user._id, user.role, terms);
      if (!accepted) return res.status(428).json({ success: false, code: "TERMS_ACCEPTANCE_REQUIRED", message: "Please review and accept the current terms for this role before signing in." });
    }
    const consumed = await AuthChallenge.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, verifiedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { verifiedAt: new Date(), consumedAt: new Date() } },
      { new: true },
    );
    if (!consumed) return res.status(409).json({ success: false, message: "Verification has already been used." });
    const token = jwt.sign({ id: user._id, role: user.role, verificationStatus: user.verificationStatus }, process.env.JWT_SECRET, { expiresIn: "7d" });
    return res.status(200).json({ success: true, token, user: {
      _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone,
      profileImage: user.profileImage, accountStatus: user.accountStatus,
      verificationStatus: user.verificationStatus, verificationId: user.verificationId, addresses: user.addresses,
    } });
  } catch (error) {
    if (error.message === "OTP_ATTEMPTS_EXCEEDED") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED") return providerFailure(res, error.message);
    if (error.message === "OTP_TOKEN_INVALID") return res.status(401).json({ success: false, message: "Invalid or expired verification." });
    console.error("LOGIN OTP VERIFICATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to verify code. Please try again." });
  }
};

const initiateRegistration = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return res.status(429).json({ success: false, message: "Please try again later." });
    const { name, email, password, role, phone, label, fullAddress, landmark, city, state, pincode, latitude, longitude, termsAcceptanceToken } = req.body;
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRole = String(role || "").trim().toLowerCase();
    const normalizedName = String(name || "").trim();
    const normalizedLabel = String(label || "").trim();
    const normalizedAddress = String(fullAddress || "").trim();
    const normalizedCity = String(city || "").trim();
    const normalizedState = String(state || "").trim();
    const normalizedPincode = String(pincode || "").trim();
    if (!normalizedName || !normalizedEmail || typeof password !== "string" || !normalizedPhone || !["patient", "doctor", "laboratory", "pharmacy"].includes(normalizedRole) || !normalizedLabel || !normalizedAddress || !normalizedCity || !normalizedState || !/^\d{6}$/.test(normalizedPincode)) {
      return res.status(400).json({ success: false, message: "Please complete all required registration fields." });
    }
    if (password.length < 6 || password.length > 128) return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ success: false, message: "Enter a valid email address." });
    const currentTerms = getCurrentTerms(normalizedRole);
    const termsAcceptance = await findAcceptanceToken(termsAcceptanceToken, normalizedRole, currentTerms);
    if (!termsAcceptance) return res.status(428).json({ success: false, code: "TERMS_ACCEPTANCE_REQUIRED", message: "Please review and accept the current terms for this role before registering." });
    const exists = await User.findOne({ $or: [{ email: normalizedEmail }, { phone: phoneQuery(normalizedPhone) }] }).select("_id").lean();
    if (exists) return res.status(409).json({ success: false, message: "An account already uses that email or mobile number." });
    const registrationData = {
      name: normalizedName, email: normalizedEmail, password: await bcrypt.hash(password, 10), role: normalizedRole,
      phone: String(phone).trim(), normalizedPhone, label: normalizedLabel, fullAddress: normalizedAddress, landmark: String(landmark || "").trim(),
      city: normalizedCity, state: normalizedState, pincode: normalizedPincode,
      latitude: latitude == null || latitude === "" ? null : Number(latitude), longitude: longitude == null || longitude === "" ? null : Number(longitude),
    };
    await incrementRateLimit("phone", normalizedPhone, 5);
    const { user, professional } = await createRegisteredAccount(registrationData, termsAcceptance._id);
    return res.status(201).json({
      success: true,
      registered: true,
      message: professional
        ? "Registration submitted. Your account is pending verification."
        : "Account created successfully.",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        accountStatus: user.accountStatus,
        verificationStatus: user.verificationStatus,
        verificationId: user.verificationId,
      },
    });
  } catch (error) {
    if (error.message === "OTP_RATE_LIMIT") return rateLimited(res);
    if (error.message === "TERMS_ACCEPTANCE_REQUIRED") return res.status(428).json({ success: false, code: "TERMS_ACCEPTANCE_REQUIRED", message: "Please review and accept the current terms before registering." });
    if (error.message === "TERMS_ACCEPTANCE_LINK_FAILED") return res.status(409).json({ success: false, message: "Unable to link your terms acceptance. Please accept the current terms and register again." });
    if (error.code === 11000) return res.status(409).json({ success: false, message: "An account already uses that email or mobile number." });
    console.error("REGISTRATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to start registration. Please try again." });
  }
};

const verifyRegistration = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return rateLimited(res);
    const { challengeId, accessToken, otp } = req.body;
    if (typeof challengeId !== "string" ||
      !(typeof accessToken === "string" && accessToken.length <= 4096) && typeof otp !== "string") return res.status(400).json({ success: false, message: "Invalid verification request." });
    const challenge = await AuthChallenge.findOne({ challengeId, purpose: "register", consumedAt: null, verifiedAt: null });
    if (!challenge || challenge.expiresAt <= new Date() || !challenge.registrationData) return res.status(400).json({ success: false, message: "Verification expired. Please register again." });
    await countVerificationAttempt(challenge);
    const result = await verifyChallengeWithMsg91(challenge, { otp, accessToken });
    const verifiedPhone = normalizePhone(result.identifier || result.data?.identifier || result.data?.mobile || result.mobile || result.message);
    if (!verifiedPhone || verifiedPhone !== challenge.phone) return res.status(401).json({ success: false, message: "Phone verification could not be confirmed." });
    const data = challenge.registrationData;
    const currentTerms = getCurrentTerms(data.role);
    if (!await findAcceptanceById(challenge.termsAcceptanceId, data.role, currentTerms, { requireUnassigned: true })) {
      return res.status(428).json({ success: false, code: "TERMS_ACCEPTANCE_REQUIRED", message: "The accepted terms have changed or expired. Please review the current terms and register again." });
    }
    const consumed = await AuthChallenge.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, verifiedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { verifiedAt: new Date(), consumedAt: new Date() } },
      { new: true },
    );
    if (!consumed) return res.status(409).json({ success: false, message: "Verification has already been used." });
    const duplicate = await User.findOne({ $or: [{ email: data.email }, { phone: phoneQuery(data.normalizedPhone) }] }).select("_id").lean();
    if (duplicate) return res.status(409).json({ success: false, message: "An account already uses that email or mobile number." });
    const professional = ["doctor", "laboratory", "pharmacy"].includes(data.role);
    const verificationId = professional ? await generateVerificationId(data.role) : "";
    const user = await User.create({
      name: data.name, email: data.email, password: data.password, role: data.role, phone: data.phone,
      accountStatus: "ACTIVE", verificationStatus: professional ? "PENDING" : "NOT_REQUIRED", verificationId,
      addresses: [{ label: data.label, fullAddress: data.fullAddress, landmark: data.landmark, city: data.city, state: data.state, pincode: data.pincode, latitude: data.latitude, longitude: data.longitude, isDefault: true }],
    });
    if (professional) {
      try {
        await Verification.create({ userId: user._id, verificationId, role: data.role, professionalName: user.name, licenseNumber: "", organizationName: "", address: "", documents: [], notes: "", status: "PENDING" });
      } catch (error) {
        await User.findByIdAndDelete(user._id);
        throw error;
      }
    }
    const acceptanceLinked = await associateAcceptance(challenge.termsAcceptanceId, user._id, data.role, currentTerms);
    if (!acceptanceLinked) {
      if (professional) await Verification.deleteOne({ userId: user._id, verificationId });
      await User.findByIdAndDelete(user._id);
      return res.status(409).json({ success: false, message: "Unable to link your terms acceptance. Please accept the current terms and register again." });
    }
    return res.status(201).json({ success: true, message: professional ? "Registration submitted. Your account is pending verification." : "User registered successfully", user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, accountStatus: user.accountStatus, verificationStatus: user.verificationStatus, verificationId: user.verificationId } });
  } catch (error) {
    if (error.message === "OTP_ATTEMPTS_EXCEEDED") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED") return providerFailure(res, error.message);
    if (error.message === "OTP_TOKEN_INVALID") return res.status(401).json({ success: false, message: "Invalid or expired verification." });
    console.error("REGISTRATION OTP VERIFICATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to verify registration. Please try again." });
  }
};

const resendLogin = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return rateLimited(res);
    // Password recovery now uses a one-time reset link. OTP resend remains
    // available only for the existing login and registration flows.
    const purpose = ["login", "register"].includes(req.body.purpose) ? req.body.purpose : "login";
    const challenge = await AuthChallenge.findOne({ challengeId: req.body.challengeId, purpose, consumedAt: null, verifiedAt: null });
    if (!challenge || challenge.expiresAt <= new Date()) return res.status(400).json({ success: false, message: "Verification expired. Please sign in again." });
    const elapsed = Date.now() - challenge.lastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) return res.status(429).json({ success: false, retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000), message: "Please wait before requesting another code." });
    if (challenge.resendCount >= MAX_RESENDS) return res.status(429).json({ success: false, message: "Resend limit reached. Please start again." });
    const data = await msg91("retryOtp", { reqId: challenge.msg91RequestId, retryChannel: 11 });
    if (data.type !== "success") return providerFailure(res, "OTP_PROVIDER_FAILURE");
    challenge.resendCount += 1;
    challenge.lastSentAt = new Date();
    await challenge.save();
    return res.json({ success: true, resendCount: challenge.resendCount });
  } catch (error) {
    if (error.message === "OTP_RATE_LIMIT") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED" || error.message === "OTP_PROVIDER_FAILURE") return providerFailure(res, error.message);
    console.error("OTP RESEND FAILED");
    return res.status(500).json({ success: false, message: "Unable to resend code." });
  }
};

module.exports = { initiateLogin, verifyLogin, resendLogin, initiateRegistration, verifyRegistration, createChallenge, normalizePhone, msg91, verifyWidgetAccessToken };
