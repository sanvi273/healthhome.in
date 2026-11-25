const mongoose = require("mongoose");

const templateMedicineSchema = new mongoose.Schema(
  {
    medicine: { type: String, required: true, trim: true, maxlength: 180 },
    dose: { type: String, default: "", trim: true, maxlength: 120 },
    duration: { type: String, default: "", trim: true, maxlength: 120 },
    food: { type: String, default: "After Food", trim: true, maxlength: 40 },
    instruction: { type: String, default: "", trim: true, maxlength: 500 },
    morning: { type: Boolean, default: false },
    afternoon: { type: Boolean, default: false },
    night: { type: Boolean, default: false },
  },
  { _id: false },
);

const templateLabTestSchema = new mongoose.Schema(
  {
    testName: { type: String, required: true, trim: true, maxlength: 180 },
    priority: {
      type: String,
      enum: ["Normal", "High", "Urgent"],
      default: "Normal",
    },
    note: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { _id: false },
);

const doctorPrescriptionTemplateSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    symptoms: { type: String, default: "", trim: true, maxlength: 3000 },
    diagnosis: { type: String, default: "", trim: true, maxlength: 2000 },
    advice: { type: String, default: "", trim: true, maxlength: 3000 },
    medicines: { type: [templateMedicineSchema], default: [] },
    labTests: { type: [templateLabTestSchema], default: [] },
  },
  { timestamps: true },
);

doctorPrescriptionTemplateSchema.index({ doctorId: 1, updatedAt: -1 });

module.exports = mongoose.model(
  "DoctorPrescriptionTemplate",
  doctorPrescriptionTemplateSchema,
);
