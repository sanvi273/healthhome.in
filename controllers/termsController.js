const crypto = require("crypto");
const TermsAcceptance = require("../models/termsAcceptance");
const {
  normalizeRole,
  getCurrentTerms,
  acceptanceTokenHash,
  findAcceptanceToken,
} = require("../services/termsAcceptanceService");

const ipBuckets = new Map();
const DOCUMENT_TYPES = new Set([
  "patient_individual",
  "doctor_partner",
  "laboratory_partner",
  "pharmacy_partner",
]);

function limited(ip) {
  const now = Date.now();
  const key = String(ip || "unknown").slice(0, 64);
  const bucket = ipBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start >= 60 * 60 * 1000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  ipBuckets.set(key, bucket);
  return bucket.count > 100;
}

exports.current = async (req, res) => {
  const terms = getCurrentTerms(req.params.role);
  if (!terms) return res.status(404).json({ success: false, message: "Terms are not available for this role." });
  return res.json({
    success: true,
    role: terms.role,
    documentType: terms.documentType,
    title: terms.title,
    version: terms.version,
    content: terms.content,
    contentHash: terms.contentHash,
    policyVersion: terms.policyVersion,
    businessDetails: terms.businessDetails,
  });
};

exports.accept = async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).json({ success: false, message: "Too many acceptance requests. Please try later." });
    if (req.body?.accepted !== true || req.body?.readToEnd !== true) {
      return res.status(400).json({ success: false, message: "Read the complete document and explicitly agree before continuing." });
    }
    const role = normalizeRole(req.body?.selectedRole);
    const terms = getCurrentTerms(role);
    if (!terms || !DOCUMENT_TYPES.has(String(req.body?.termsDocumentType || "")) || req.body.termsDocumentType !== terms.documentType || req.body.termsVersion !== terms.version || req.body.termsContentHash !== terms.contentHash) {
      return res.status(409).json({ success: false, code: "TERMS_VERSION_MISMATCH", message: "These terms have changed. Reload and review the current document." });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const acceptedAt = new Date();
    await TermsAcceptance.create({
      selectedRole: role,
      termsDocumentType: terms.documentType,
      termsVersion: terms.version,
      termsContentHash: terms.contentHash,
      policyVersion: terms.policyVersion,
      acceptedAt,
      acceptanceStatus: "ACCEPTED",
      acceptanceTokenHash: acceptanceTokenHash(token),
      expiresAt: new Date(acceptedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    return res.status(201).json({ success: true, acceptanceToken: token, acceptedAt: acceptedAt.toISOString(), role, termsVersion: terms.version });
  } catch (error) {
    console.error("TERMS ACCEPTANCE RECORD FAILED", { errorType: error.name || "DatabaseError" });
    return res.status(500).json({ success: false, message: "Unable to save acceptance. Please try again." });
  }
};

exports.validate = async (req, res) => {
  try {
    const role = normalizeRole(req.body?.selectedRole);
    const terms = getCurrentTerms(role);
    if (!terms) return res.status(400).json({ success: false, accepted: false, message: "Invalid role." });
    const record = await findAcceptanceToken(req.body?.acceptanceToken, role, terms);
    return res.json({ success: true, accepted: Boolean(record), termsVersion: terms.version });
  } catch (_) {
    return res.status(500).json({ success: false, accepted: false, message: "Unable to check terms acceptance." });
  }
};
