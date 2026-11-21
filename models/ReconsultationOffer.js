const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, trim: true },
    time: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const reconsultationOfferSchema = new mongoose.Schema(
  {
    originalAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      unique: true,
    },
    doctorId: { type: String, required: true, trim: true, index: true },
    doctorName: { type: String, required: true, trim: true },
    specialization: { type: String, default: "", trim: true },
    hospital: { type: String, default: "", trim: true },
    originalAppointmentDate: { type: String, required: true, trim: true },
    originalAppointmentTime: { type: String, required: true, trim: true },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    patientName: { type: String, required: true, trim: true },
    patientPhone: { type: String, required: true, trim: true },
    consultationType: {
      type: String,
      enum: ["Video Consultation", "Hospital Visit"],
      required: true,
    },
    slots: {
      type: [slotSchema],
      validate: {
        validator: (slots) => Array.isArray(slots) && slots.length > 0 && slots.length <= 6,
        message: "A reconsultation offer must contain between one and six time options.",
      },
    },
    status: {
      type: String,
      enum: ["Offered", "Processing", "Requested", "Expired"],
      default: "Offered",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    selectedSlot: {
      date: { type: String, default: "" },
      time: { type: String, default: "" },
    },
    processingAt: { type: Date, default: null },
    requestedAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },
  },
  { timestamps: true },
);

reconsultationOfferSchema.index({ patientId: 1, status: 1, expiresAt: 1 });

module.exports = mongoose.model("ReconsultationOffer", reconsultationOfferSchema);
