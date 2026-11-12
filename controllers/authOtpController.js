const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const AuthChallenge = require("../models/authChallenge");
const AuthRateLimit = require("../models/authRateLimit");
const Verification = require("../models/verification");
const { generateVerificationId } = require("./authController");

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

function genericResetChallenge() {
  return {
    success: true,
    challengeId: crypto.randomBytes(32).toString("base64url"),
    requestId: crypto.randomBytes(16).toString("hex"),
    message: "If an eligible account exists, a verification code will be sent.",
  };
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

async function msg91(path, payload) {
  const authKey = process.env.MSG91_AUTH_KEY;
  const widgetId = process.env.MSG91_WIDGET_ID;
  const widgetToken = process.env.MSG91_WIDGET_TOKEN;
  if (!authKey || !widgetId || !widgetToken) throw new Error("OTP_PROVIDER_NOT_CONFIGURED");
  const response = await fetch(`${MSG91}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", tokenAuth: widgetToken },
    body: JSON.stringify({ widgetId, ...payload }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.type !== "success" || data.code === 201) {
    throw new Error("OTP_PROVIDER_FAILURE");
  }
  return data;
}

async function verifyWidgetAccessToken(token) {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) throw new Error("OTP_PROVIDER_NOT_CONFIGURED");
  const response = await fetch(`${MSG91}/verifyAccessToken`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ authkey: authKey, "access-token": token }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.type !== "success" || data.code === 201) {
    throw new Error("OTP_TOKEN_INVALID");
  }
  return data;
}

async function createChallenge({ purpose, phone, user, role, registrationData, ip, skipPhoneRateLimit = false }) {
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

function providerFailure(res) {
  return res.status(503).json({ success: false, message: "OTP service is temporarily unavailable. Please try again." });
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
    const challengeId = await createChallenge({ purpose: "login", phone, user, ip: req.ip });
    const challenge = await AuthChallenge.findOne({ challengeId }).select("msg91RequestId").lean();
    return res.status(200).json({ success: true, challengeId, requestId: challenge.msg91RequestId, message: "If the details are valid, a verification code has been sent." });
  } catch (error) {
    if (error.message === "OTP_RATE_LIMIT") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED" || error.message === "OTP_PROVIDER_FAILURE") return providerFailure(res);
    console.error("LOGIN OTP INITIATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to start sign-in. Please try again." });
  }
};

const verifyLogin = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return rateLimited(res);
    const { challengeId, accessToken } = req.body;
    if (typeof challengeId !== "string" || typeof accessToken !== "string" || accessToken.length > 4096) {
      return res.status(400).json({ success: false, message: "Invalid verification request." });
    }
    const challenge = await AuthChallenge.findOne({ challengeId, purpose: "login", consumedAt: null, verifiedAt: null });
    if (!challenge || challenge.expiresAt <= new Date()) return res.status(400).json({ success: false, message: "Verification expired. Please sign in again." });
    await countVerificationAttempt(challenge);
    const providerResult = await verifyWidgetAccessToken(accessToken);
    const verifiedPhone = normalizePhone(providerResult.identifier || providerResult.data?.identifier || providerResult.data?.mobile || providerResult.mobile);
    if (!verifiedPhone || verifiedPhone !== challenge.phone) return res.status(401).json({ success: false, message: "Phone verification could not be confirmed." });
    const user = await User.findById(challenge.userId);
    if (!user || user.accountStatus === "SUSPENDED" || user.role !== challenge.role) return res.status(401).json({ success: false, message: "Unable to sign in with those details." });
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
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED") return providerFailure(res);
    if (error.message === "OTP_TOKEN_INVALID") return res.status(401).json({ success: false, message: "Invalid or expired verification." });
    console.error("LOGIN OTP VERIFICATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to verify code. Please try again." });
  }
};

const initiateRegistration = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return res.status(429).json({ success: false, message: "Please try again later." });
    const { name, email, password, role, phone, label, fullAddress, landmark, city, state, pincode, latitude, longitude } = req.body;
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRole = String(role || "").trim().toLowerCase();
    if (!name || !normalizedEmail || !password || !normalizedPhone || !["patient", "doctor", "laboratory", "pharmacy"].includes(normalizedRole) || !label || !fullAddress || !city || !state || !/^\d{6}$/.test(String(pincode || ""))) {
      return res.status(400).json({ success: false, message: "Please complete all required registration fields." });
    }
    if (String(password).length < 8 || String(password).length > 128) return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ success: false, message: "Enter a valid email address." });
    const exists = await User.findOne({ $or: [{ email: normalizedEmail }, { phone: phoneQuery(normalizedPhone) }] }).select("_id").lean();
    if (exists) return res.status(409).json({ success: false, message: "An account already uses that email or mobile number." });
    const registrationData = {
      name: String(name).trim(), email: normalizedEmail, password: await bcrypt.hash(password, 10), role: normalizedRole,
      phone: String(phone).trim(), normalizedPhone, label: String(label).trim(), fullAddress: String(fullAddress).trim(), landmark: String(landmark || "").trim(),
      city: String(city).trim(), state: String(state).trim(), pincode: String(pincode).trim(),
      latitude: latitude == null || latitude === "" ? null : Number(latitude), longitude: longitude == null || longitude === "" ? null : Number(longitude),
    };
    const challengeId = await createChallenge({ purpose: "register", phone: normalizedPhone, role: normalizedRole, registrationData, ip: req.ip });
    const challenge = await AuthChallenge.findOne({ challengeId }).select("msg91RequestId").lean();
    return res.status(200).json({ success: true, challengeId, requestId: challenge.msg91RequestId, message: "Verification code sent." });
  } catch (error) {
    if (error.message === "OTP_RATE_LIMIT") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED" || error.message === "OTP_PROVIDER_FAILURE") return providerFailure(res);
    console.error("REGISTRATION OTP INITIATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to start registration. Please try again." });
  }
};

const verifyRegistration = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return rateLimited(res);
    const { challengeId, accessToken } = req.body;
    if (typeof challengeId !== "string" || typeof accessToken !== "string" || accessToken.length > 4096) return res.status(400).json({ success: false, message: "Invalid verification request." });
    const challenge = await AuthChallenge.findOne({ challengeId, purpose: "register", consumedAt: null, verifiedAt: null });
    if (!challenge || challenge.expiresAt <= new Date() || !challenge.registrationData) return res.status(400).json({ success: false, message: "Verification expired. Please register again." });
    await countVerificationAttempt(challenge);
    const result = await verifyWidgetAccessToken(accessToken);
    const verifiedPhone = normalizePhone(result.identifier || result.data?.identifier || result.data?.mobile || result.mobile);
    if (!verifiedPhone || verifiedPhone !== challenge.phone) return res.status(401).json({ success: false, message: "Phone verification could not be confirmed." });
    const data = challenge.registrationData;
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
    return res.status(201).json({ success: true, message: professional ? "Registration submitted. Your account is pending verification." : "User registered successfully", user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, accountStatus: user.accountStatus, verificationStatus: user.verificationStatus, verificationId: user.verificationId } });
  } catch (error) {
    if (error.message === "OTP_ATTEMPTS_EXCEEDED") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED") return providerFailure(res);
    if (error.message === "OTP_TOKEN_INVALID") return res.status(401).json({ success: false, message: "Invalid or expired verification." });
    console.error("REGISTRATION OTP VERIFICATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to verify registration. Please try again." });
  }
};

const initiateForgotPassword = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return res.status(429).json({ success: false, message: "Please try again later." });
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(200).json(genericResetChallenge());
    await incrementRateLimit("phone", phone, 5);
    const user = await User.findOne({ phone: phoneQuery(phone) }).select("_id phone role accountStatus");
    if (user && user.accountStatus !== "SUSPENDED") {
      const challengeId = await createChallenge({ purpose: "reset", phone, user, ip: req.ip, skipPhoneRateLimit: true });
      const challenge = await AuthChallenge.findOne({ challengeId }).select("msg91RequestId").lean();
      return res.status(200).json({ success: true, challengeId, requestId: challenge.msg91RequestId, message: "If an eligible account exists, a verification code will be sent." });
    }
    return res.status(200).json(genericResetChallenge());
  } catch (error) {
    if (error.message === "OTP_RATE_LIMIT" || error.message === "OTP_PROVIDER_NOT_CONFIGURED" || error.message === "OTP_PROVIDER_FAILURE") {
      return res.status(200).json(genericResetChallenge());
    }
    console.error("PASSWORD RESET OTP INITIATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to process request. Please try again." });
  }
};

const verifyResetOtp = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return rateLimited(res);
    const { challengeId, accessToken } = req.body;
    if (typeof challengeId !== "string" || typeof accessToken !== "string" || accessToken.length > 4096) return res.status(400).json({ success: false, message: "Invalid verification request." });
    const challenge = await AuthChallenge.findOne({ challengeId, purpose: "reset", consumedAt: null, verifiedAt: null });
    if (!challenge || challenge.expiresAt <= new Date()) return res.status(400).json({ success: false, message: "Verification expired. Please start again." });
    await countVerificationAttempt(challenge);
    const result = await verifyWidgetAccessToken(accessToken);
    const verifiedPhone = normalizePhone(result.identifier || result.data?.identifier || result.data?.mobile || result.mobile);
    if (!verifiedPhone || verifiedPhone !== challenge.phone) return res.status(401).json({ success: false, message: "Phone verification could not be confirmed." });
    const user = await User.findById(challenge.userId);
    if (!user || user.accountStatus === "SUSPENDED") return res.status(400).json({ success: false, message: "Verification could not be completed." });
    const resetToken = crypto.randomBytes(32).toString("base64url");
    const claimed = await AuthChallenge.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, verifiedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { verifiedAt: new Date(), resetTokenHash: crypto.createHash("sha256").update(resetToken).digest("hex"), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } },
      { new: true },
    );
    if (!claimed) return res.status(409).json({ success: false, message: "Verification has already been used." });
    return res.json({ success: true, resetToken });
  } catch (error) {
    if (error.message === "OTP_ATTEMPTS_EXCEEDED") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED") return providerFailure(res);
    if (error.message === "OTP_TOKEN_INVALID") return res.status(401).json({ success: false, message: "Invalid or expired verification." });
    console.error("PASSWORD RESET OTP VERIFICATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to verify code." });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { resetToken, password } = req.body;
    if (typeof resetToken !== "string" || typeof password !== "string" || password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ success: false, message: "Use a password with at least 8 characters, including a letter and a number." });
    }
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    const challenge = await AuthChallenge.findOneAndUpdate(
      { purpose: "reset", resetTokenHash: tokenHash, consumedAt: null, verifiedAt: { $ne: null }, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date(), resetTokenHash: "" } },
      { new: true },
    );
    if (!challenge || !challenge.verifiedAt) return res.status(401).json({ success: false, message: "Password reset authorization is invalid or expired." });
    const user = await User.findById(challenge.userId);
    if (!user) return res.status(401).json({ success: false, message: "Password reset authorization is invalid or expired." });
    user.password = await bcrypt.hash(password, 10);
    user.passwordChangedAt = new Date();
    await user.save();
    return res.json({ success: true, message: "Password reset successfully." });
  } catch (error) {
    console.error("PASSWORD RESET FAILED");
    return res.status(500).json({ success: false, message: "Unable to reset password." });
  }
};

const resendLogin = async (req, res) => {
  try {
    if (!allowIp(req.ip)) return rateLimited(res);
    const purpose = ["login", "register", "reset"].includes(req.body.purpose) ? req.body.purpose : "login";
    const challenge = await AuthChallenge.findOne({ challengeId: req.body.challengeId, purpose, consumedAt: null, verifiedAt: null });
    if (!challenge || challenge.expiresAt <= new Date()) return res.status(400).json({ success: false, message: "Verification expired. Please sign in again." });
    const elapsed = Date.now() - challenge.lastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) return res.status(429).json({ success: false, retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000), message: "Please wait before requesting another code." });
    if (challenge.resendCount >= MAX_RESENDS) return res.status(429).json({ success: false, message: "Resend limit reached. Please start again." });
    const data = await msg91("retryOtp", { reqId: challenge.msg91RequestId, retryChannel: 11 });
    if (data.type !== "success") return providerFailure(res);
    challenge.resendCount += 1;
    challenge.lastSentAt = new Date();
    await challenge.save();
    return res.json({ success: true, resendCount: challenge.resendCount });
  } catch (error) {
    if (error.message === "OTP_RATE_LIMIT") return rateLimited(res);
    if (error.message === "OTP_PROVIDER_NOT_CONFIGURED" || error.message === "OTP_PROVIDER_FAILURE") return providerFailure(res);
    console.error("OTP RESEND FAILED");
    return res.status(500).json({ success: false, message: "Unable to resend code." });
  }
};

module.exports = { initiateLogin, verifyLogin, resendLogin, initiateRegistration, verifyRegistration, initiateForgotPassword, verifyResetOtp, resetPassword, createChallenge, normalizePhone, verifyWidgetAccessToken };
