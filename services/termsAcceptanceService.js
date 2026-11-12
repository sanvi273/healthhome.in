const crypto = require("crypto");
const roleTerms = require("../data/roleTerms.json");
const TermsAcceptance = require("../models/termsAcceptance");

const roles = new Set(["patient", "doctor", "laboratory", "pharmacy"]);

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "lab") return "laboratory";
  return role;
}

function policyVersions() {
  return {
    privacy: process.env.HEALTHHOME_PRIVACY_POLICY_VERSION || "[TO BE PROVIDED]",
    refundCancellation: process.env.HEALTHHOME_REFUND_POLICY_VERSION || "[TO BE PROVIDED]",
  };
}

function businessDetails() {
  return {
    effectiveDate: process.env.HEALTHHOME_TERMS_EFFECTIVE_DATE || "[TO BE PROVIDED]",
    legalName: process.env.HEALTHHOME_LEGAL_NAME || "[Full legal name of proprietor/operator to be provided]",
    businessAddress: process.env.HEALTHHOME_BUSINESS_ADDRESS || "[Business address to be provided]",
    supportEmail: process.env.HEALTHHOME_SUPPORT_EMAIL || "[Support email to be provided]",
    grievanceOfficerName: process.env.HEALTHHOME_GRIEVANCE_OFFICER_NAME || "[Grievance officer name to be provided]",
    grievanceOfficerContact: process.env.HEALTHHOME_GRIEVANCE_OFFICER_CONTACT || "[Grievance officer contact to be provided]",
  };
}

function getCurrentTerms(roleValue) {
  const role = normalizeRole(roleValue);
  if (!roles.has(role)) return null;
  const document = roleTerms.find((item) => item.role === role);
  if (!document) return null;
  return {
    role,
    documentType: document.documentType,
    title: document.title,
    version: document.version,
    content: document.content,
    contentHash: crypto.createHash("sha256").update(document.content, "utf8").digest("hex"),
    policyVersion: policyVersions(),
    businessDetails: businessDetails(),
  };
}

function acceptanceTokenHash(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) return null;
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function findAcceptanceToken(token, roleValue, currentTerms, userId = null) {
  const tokenHash = acceptanceTokenHash(token);
  const role = normalizeRole(roleValue);
  if (!tokenHash || !currentTerms || !roles.has(role)) return null;
  const now = new Date();
  const query = {
    acceptanceTokenHash: tokenHash,
    selectedRole: role,
    termsDocumentType: currentTerms.documentType,
    termsVersion: currentTerms.version,
    termsContentHash: currentTerms.contentHash,
    acceptanceStatus: "ACCEPTED",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  };
  if (userId) query.$and = [{ $or: [{ userId: null }, { userId }] }];
  return TermsAcceptance.findOne(query).select("+acceptanceTokenHash");
}

async function hasCurrentAcceptance(userId, roleValue, currentTerms) {
  if (!userId || !currentTerms) return false;
  return Boolean(await TermsAcceptance.exists({
    userId,
    selectedRole: normalizeRole(roleValue),
    termsDocumentType: currentTerms.documentType,
    termsVersion: currentTerms.version,
    termsContentHash: currentTerms.contentHash,
    acceptanceStatus: "ACCEPTED",
  }));
}

async function findAcceptanceById(acceptanceId, roleValue, currentTerms, { requireUnassigned = false } = {}) {
  if (!acceptanceId || !currentTerms) return null;
  const query = {
    _id: acceptanceId,
    selectedRole: normalizeRole(roleValue),
    termsDocumentType: currentTerms.documentType,
    termsVersion: currentTerms.version,
    termsContentHash: currentTerms.contentHash,
    acceptanceStatus: "ACCEPTED",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
  if (requireUnassigned) query.userId = null;
  return TermsAcceptance.findOne(query).select("userId");
}

async function associateAcceptance(acceptanceId, userId, roleValue, currentTerms) {
  if (!acceptanceId || !userId || !currentTerms) return false;
  const role = normalizeRole(roleValue);
  const record = await TermsAcceptance.findOne({
    _id: acceptanceId,
    selectedRole: role,
    termsDocumentType: currentTerms.documentType,
    termsVersion: currentTerms.version,
    termsContentHash: currentTerms.contentHash,
    acceptanceStatus: "ACCEPTED",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).select("userId");
  if (!record) return false;
  if (record.userId) return String(record.userId) === String(userId);
  const result = await TermsAcceptance.updateOne(
    { _id: record._id, userId: null },
    { $set: { userId, associatedAt: new Date() }, $unset: { expiresAt: 1 } },
  );
  if (result.modifiedCount === 1) return true;
  const raced = await TermsAcceptance.findById(record._id).select("userId").lean();
  return Boolean(raced && String(raced.userId) === String(userId));
}

module.exports = {
  normalizeRole,
  getCurrentTerms,
  acceptanceTokenHash,
  findAcceptanceToken,
  findAcceptanceById,
  hasCurrentAcceptance,
  associateAcceptance,
  policyVersions,
};
