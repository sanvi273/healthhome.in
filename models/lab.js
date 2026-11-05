
const mongoose = require("mongoose");

// ============================================================
// LAB TEST SCHEMA
// ============================================================

const labTestSchema = new mongoose.Schema(
  {
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

    description: {
      type: String,
      default: "",
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================================
// LAB SCHEMA
// ============================================================

const labSchema = new mongoose.Schema(
  {
    // Link Lab profile to registered User account
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    name: {
      type: String,
      required: true,
    },

    labType: {
      type: String,
      required: true,
    },

    experience: {
      type: String,
      required: true,
    },

    address: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
    },

    rating: {
      type: Number,
      default: 4.5,
    },

    available: {
      type: Boolean,
      default: true,
    },

    image: {
      type: String,
      default: "",
    },

    // ========================================================
    // LAB TESTS
    // ========================================================

    tests: {
      type: [labTestSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Lab", labSchema);
