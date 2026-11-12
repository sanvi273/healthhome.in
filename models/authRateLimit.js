const mongoose = require("mongoose");

const authRateLimitSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { versionKey: false });

module.exports = mongoose.models.AuthRateLimit || mongoose.model("AuthRateLimit", authRateLimitSchema);
