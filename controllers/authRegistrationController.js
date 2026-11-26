const jwt = require("jsonwebtoken");
const User = require("../models/user");
const AuthRateLimit = require("../models/authRateLimit");
const Verification = require("../models/verification");
const { generateVerificationId } = require("./authController");
const firebaseAdminAuth = require("../services/firebaseAdminAuth");
const termsAcceptanceService = require("../services/termsAcceptanceService");

const ipWindows = new Map();

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role === "lab" ? "laboratory" : role;
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

async function incrementPhoneRateLimit(phone) {
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const valueHash = require("crypto")
    .createHash("sha256")
    .update(`phone:${phone}`)
    .digest("hex");
  const id = `phone:${valueHash}:${bucket}`;
  const expiresAt = new Date((bucket + 1) * 60 * 60 * 1000 + 60 * 1000);
  const counter = await AuthRateLimit.findOneAndUpdate(
    { _id: id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true },
  );
  if (counter.count > 5) throw new Error("AUTH_RATE_LIMIT");
}

async function createRegisteredAccount(data, termsAcceptanceId) {
  const currentTerms = termsAcceptanceService.getCurrentTerms(data.role);
  const acceptance = await termsAcceptanceService.findAcceptanceById(
    termsAcceptanceId,
    data.role,
    currentTerms,
    { requireUnassigned: true },
  );
  if (!acceptance) throw new Error("TERMS_ACCEPTANCE_REQUIRED");

  const professional = ["doctor", "laboratory", "pharmacy"].includes(data.role);
  const verificationId = professional ? await generateVerificationId(data.role) : "";
  // Firebase proves phone ownership. Mongo keeps the HealthHome identity and
  // profile data; there is deliberately no local password for new accounts.
  const user = await User.create({
    name: data.name,
    email: data.email,
    role: data.role,
    phone: data.phone,
    accountStatus: "ACTIVE",
    verificationStatus: professional ? "PENDING" : "NOT_REQUIRED",
    verificationId,
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

    const acceptanceLinked = await termsAcceptanceService.associateAcceptance(
      termsAcceptanceId,
      user._id,
      data.role,
      currentTerms,
    );
    if (!acceptanceLinked) throw new Error("TERMS_ACCEPTANCE_LINK_FAILED");
  } catch (error) {
    if (professional) await Verification.deleteOne({ userId: user._id, verificationId });
    await User.findByIdAndDelete(user._id);
    throw error;
  }

  return { user, professional };
}

const registerUser = async (req, res) => {
  try {
    if (!allowIp(req.ip || "unknown")) {
      return res.status(429).json({ success: false, message: "Please try again later." });
    }

    const {
      idToken,
      name,
      role,
      label,
      fullAddress,
      landmark,
      city,
      state,
      pincode,
      latitude,
      longitude,
      termsAcceptanceToken,
    } = req.body || {};

    const identity = await firebaseAdminAuth.verifyFirebaseIdToken(idToken);
    const normalizedRole = normalizeRole(role);
    const normalizedName = String(name || "").trim();
    const normalizedLabel = String(label || "").trim();
    const normalizedAddress = String(fullAddress || "").trim();
    const normalizedCity = String(city || "").trim();
    const normalizedState = String(state || "").trim();
    const normalizedPincode = String(pincode || "").trim();

    if (!normalizedName ||
        !["patient", "doctor", "laboratory", "pharmacy"].includes(normalizedRole) ||
        !normalizedLabel || !normalizedAddress || !normalizedCity || !normalizedState ||
        !/^\d{6}$/.test(normalizedPincode)) {
      return res.status(400).json({ success: false, message: "Please complete all required registration fields." });
    }

    const currentTerms = termsAcceptanceService.getCurrentTerms(normalizedRole);
    const termsAcceptance = await termsAcceptanceService.findAcceptanceToken(
      termsAcceptanceToken,
      normalizedRole,
      currentTerms,
    );
    if (!termsAcceptance) {
      return res.status(428).json({
        success: false,
        code: "TERMS_ACCEPTANCE_REQUIRED",
        message: "Please review and accept the current terms for this role before registering.",
      });
    }

    const emailDigits = identity.storedPhone.replace(/\D/g, "");
    const email = `${emailDigits}@gmail.com`;
    const exists = await User.findOne({
      $or: [
        { email },
        { phone: firebaseAdminAuth.phoneLookupQuery(identity.normalizedPhone) },
      ],
    }).select("_id").lean();
    if (exists) {
      return res.status(409).json({
        success: false,
        code: "ACCOUNT_ALREADY_EXISTS",
        message: "An account already uses that phone number. Please sign in instead.",
      });
    }

    await incrementPhoneRateLimit(identity.normalizedPhone);
    const registrationData = {
      name: normalizedName,
      email,
      role: normalizedRole,
      phone: identity.storedPhone,
      label: normalizedLabel,
      fullAddress: normalizedAddress,
      landmark: String(landmark || "").trim(),
      city: normalizedCity,
      state: normalizedState,
      pincode: normalizedPincode,
      latitude: latitude == null || latitude === "" ? null : Number(latitude),
      longitude: longitude == null || longitude === "" ? null : Number(longitude),
    };
    const { user, professional } = await createRegisteredAccount(
      registrationData,
      termsAcceptance._id,
    );
    const token = jwt.sign(
      { id: user._id, role: user.role, verificationStatus: user.verificationStatus },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(201).json({
      success: true,
      registered: true,
      message: professional
        ? "Registration submitted. Your account is pending verification."
        : "Account created successfully.",
      token,
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
    if (error.code === "FIREBASE_ADMIN_CONFIG" ||
        error.code === "FIREBASE_ADMIN_UNAVAILABLE" ||
        error.code === "FIREBASE_ADMIN_PROJECT_MISMATCH") {
      console.error("FIREBASE ADMIN AUTH CONFIGURATION ERROR", error.code);
      return res.status(503).json({
        success: false,
        code: "FIREBASE_AUTH_UNAVAILABLE",
        message: "Phone sign-in is temporarily unavailable. Please try again later.",
      });
    }
    if (error.code === "FIREBASE_ID_TOKEN_INVALID" ||
        error.code === "FIREBASE_PHONE_MISSING" ||
        String(error.code || "").startsWith("auth/")) {
      return res.status(401).json({
        success: false,
        code: "FIREBASE_ID_TOKEN_INVALID",
        message: "Phone verification expired. Please request and verify a new OTP.",
      });
    }
    if (error.message === "AUTH_RATE_LIMIT") {
      return res.status(429).json({ success: false, message: "Too many registration requests. Please try later." });
    }
    if (error.message === "TERMS_ACCEPTANCE_REQUIRED") {
      return res.status(428).json({
        success: false,
        code: "TERMS_ACCEPTANCE_REQUIRED",
        message: "Please review and accept the current terms before registering.",
      });
    }
    if (error.message === "TERMS_ACCEPTANCE_LINK_FAILED") {
      return res.status(409).json({
        success: false,
        message: "Unable to link your terms acceptance. Please accept the current terms and register again.",
      });
    }
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "ACCOUNT_ALREADY_EXISTS",
        message: "An account already uses that phone number. Please sign in instead.",
      });
    }
    console.error("REGISTRATION FAILED", error.message);
    return res.status(500).json({ success: false, message: "Unable to complete registration. Please try again." });
  }
};

module.exports = { registerUser };
