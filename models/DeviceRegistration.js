const mongoose = require("mongoose");

const deviceRegistrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  role: { type: String, enum: ["patient", "doctor", "laboratory", "pharmacy", "admin"], required: true },
  deviceToken: { type: String, required: true, unique: true },
  platform: { type: String, enum: ["android", "ios", "web"], required: true },
  deviceId: { type: String, default: "" },
  lastActiveAt: { type: Date, default: Date.now },
}, { timestamps: true });

deviceRegistrationSchema.index({ userId: 1, deviceId: 1 });

module.exports = mongoose.model("DeviceRegistration", deviceRegistrationSchema);
