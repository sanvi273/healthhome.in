const mongoose = require("mongoose");

const labTestCartSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    patientPhone: {
      type: String,
      default: "",
      trim: true,
    },
    labId: {
      type: String,
      required: true,
      trim: true,
    },
    labName: {
      type: String,
      required: true,
      trim: true,
    },
    testId: {
      type: String,
      required: true,
      trim: true,
    },
    testName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: "General",
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    sampleType: {
      type: String,
      default: "Blood",
      trim: true,
    },
    reportTime: {
      type: String,
      default: "24 Hours",
      trim: true,
    },
  },
  { timestamps: true },
);

labTestCartSchema.index(
  { patientId: 1, labId: 1, testId: 1 },
  { unique: true },
);

module.exports = mongoose.models.LabTestCart ||
  mongoose.model("LabTestCart", labTestCartSchema);
