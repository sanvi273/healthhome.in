const mongoose = require("mongoose");

const familyMemberSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    relationship: {
      type: String,
      required: true,
      enum: [
        "Mother",
        "Father",
        "Spouse",
        "Son",
        "Daughter",
        "Brother",
        "Sister",
        "Grandparent",
        "Other",
      ],
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ["", "Male", "Female", "Other", "Prefer not to say"],
      default: "",
    },
    phone: {
      type: String,
      default: "",
      trim: true,
      maxlength: 20,
    },
    bloodGroup: {
      type: String,
      default: "",
      trim: true,
      maxlength: 10,
    },
    height: {
      type: Number,
      default: null,
      min: 0,
      max: 300,
    },
    weight: {
      type: Number,
      default: null,
      min: 0,
      max: 500,
    },
    address: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    allergies: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    medicalConditions: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true },
);

familyMemberSchema.index({ patientId: 1, createdAt: -1 });

module.exports = mongoose.model("FamilyMember", familyMemberSchema);
