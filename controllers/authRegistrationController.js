const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/user");
const AuthRateLimit = require("../models/authRateLimit");
const Verification = require("../models/verification");
const { generateVerificationId } = require("./authController");
const {
  getCurrentTerms,
  findAcceptanceToken,
  findAcceptanceById,
  associateAcceptance,
} = require("../services/termsAcceptanceService");

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

async function incrementPhoneRateLimit(phone) {
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const valueHash = crypto.createHash("sha256").update(`phone:${phone}`).digest("hex");
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
  const currentTerms = getCurrentTerms(data.role);
  const acceptance = await findAcceptanceById(
    termsAcceptanceId,
    data.role,
    currentTerms,
    { requireUnassigned: true },
  );
  if (!acceptance) throw new Error("TERMS_ACCEPTANCE_REQUIRED");

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
    if (!allowIp(req.ip)) return res.status(429).json({ success: false, message: "Please try again later." });
    const {
      name, email, password, role, phone, label, fullAddress, landmark,
      city, state, pincode, latitude, longitude, termsAcceptanceToken,
    } = req.body;
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRole = String(role || "").trim().toLowerCase();
    const normalizedName = String(name || "").trim();
    const normalizedLabel = String(label || "").trim();
    const normalizedAddress = String(fullAddress || "").trim();
    const normalizedCity = String(city || "").trim();
    const normalizedState = String(state || "").trim();
    const normalizedPincode = String(pincode || "").trim();

    if (!normalizedName || !normalizedEmail || typeof password !== "string" || !normalizedPhone ||
        !["patient", "doctor", "laboratory", "pharmacy"].includes(normalizedRole) ||
        !normalizedLabel || !normalizedAddress || !normalizedCity || !normalizedState || !/^\d{6}$/.test(normalizedPincode)) {
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
      name: normalizedName,
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      role: normalizedRole,
      phone: String(phone).trim(),
      label: normalizedLabel,
      fullAddress: normalizedAddress,
      landmark: String(landmark || "").trim(),
      city: normalizedCity,
      state: normalizedState,
      pincode: normalizedPincode,
      latitude: latitude == null || latitude === "" ? null : Number(latitude),
      longitude: longitude == null || longitude === "" ? null : Number(longitude),
    };
    await incrementPhoneRateLimit(normalizedPhone);
    const { user, professional } = await createRegisteredAccount(registrationData, termsAcceptance._id);
    const token = professional
      ? jwt.sign({ id: user._id, role: user.role, verificationStatus: user.verificationStatus }, process.env.JWT_SECRET, { expiresIn: "7d" })
      : undefined;

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
      ...(token ? { token } : {}),
    });
  } catch (error) {
    if (error.message === "AUTH_RATE_LIMIT") return res.status(429).json({ success: false, message: "Too many registration requests. Please try later." });
    if (error.message === "TERMS_ACCEPTANCE_REQUIRED") return res.status(428).json({ success: false, code: "TERMS_ACCEPTANCE_REQUIRED", message: "Please review and accept the current terms before registering." });
    if (error.message === "TERMS_ACCEPTANCE_LINK_FAILED") return res.status(409).json({ success: false, message: "Unable to link your terms acceptance. Please accept the current terms and register again." });
    if (error.code === 11000) return res.status(409).json({ success: false, message: "An account already uses that email or mobile number." });
    console.error("REGISTRATION FAILED");
    return res.status(500).json({ success: false, message: "Unable to start registration. Please try again." });
  }
};

module.exports = { registerUser };
