const mongoose = require("mongoose");

const authChallengeSchema = new mongoose.Schema({
  challengeId: { type: String, required: true, unique: true, index: true },
  purpose: { type: String, enum: ["login", "register", "reset"], required: true },
  phone: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  role: { type: String, default: "" },
  registrationData: { type: mongoose.Schema.Types.Mixed, default: null },
  msg91RequestId: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  resendCount: { type: Number, default: 0 },
  verificationAttempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  resetTokenHash: { type: String, default: "", index: true },
  ip: { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.models.AuthChallenge || mongoose.model("AuthChallenge", authChallengeSchema);
