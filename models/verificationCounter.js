const mongoose = require("mongoose");

// Atomic per-role/year counters prevent simultaneous registrations from
// receiving the same human-readable verification ID.
const verificationCounterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false }
);

module.exports = mongoose.model("VerificationCounter", verificationCounterSchema);
