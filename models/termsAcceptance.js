const mongoose = require("mongoose");

const termsAcceptanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  selectedRole: { type: String, enum: ["patient", "doctor", "laboratory", "pharmacy"], required: true, index: true },
  termsDocumentType: { type: String, required: true },
  termsVersion: { type: String, required: true },
  termsContentHash: { type: String, required: true },
  documentMetadata: [{ label: String, value: String }],
  policyVersion: {
    privacy: { type: String, required: true },
    refundCancellation: { type: String, required: true },
  },
  businessDetails: {
    effectiveDate: String,
    legalName: String,
    businessAddress: String,
    supportEmail: String,
    grievanceOfficerName: String,
    grievanceOfficerContact: String,
  },
  acceptedAt: { type: Date, required: true },
  acceptanceStatus: { type: String, enum: ["ACCEPTED"], required: true, default: "ACCEPTED" },
  acceptanceTokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, default: null, index: { expires: 0 } },
  associatedAt: { type: Date, default: null },
}, { timestamps: true });

termsAcceptanceSchema.index({ userId: 1, selectedRole: 1, termsVersion: 1, acceptedAt: -1 });

module.exports = mongoose.models.TermsAcceptance || mongoose.model("TermsAcceptance", termsAcceptanceSchema);
