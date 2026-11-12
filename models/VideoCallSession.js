const mongoose = require("mongoose");

const videoCallSessionSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  callId: { type: String, required: true, unique: true, index: true },
  channelName: { type: String, required: true },
  status: { type: String, enum: ["INITIATED", "RINGING", "ACCEPTED", "DECLINED", "MISSED", "CANCELLED", "CONNECTED", "ENDED", "FAILED"], default: "INITIATED", index: true },
  initiatedAt: { type: Date, default: Date.now },
  ringingAt: Date,
  acceptedAt: Date,
  declinedAt: Date,
  endedAt: Date,
  expiresAt: { type: Date, required: true, index: true },
  pushSentAt: Date,
  activeAppointmentId: { type: mongoose.Schema.Types.ObjectId, unique: true, sparse: true },
}, { timestamps: true });

module.exports = mongoose.model("VideoCallSession", videoCallSessionSchema);
