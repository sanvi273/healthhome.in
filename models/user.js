const mongoose = require("mongoose");

// ============================================================
// ADDRESS SUB-SCHEMA
// ============================================================

const addressSchema = new mongoose.Schema(
  {
    // Home / Work / College / Other
    label: {
      type: String,
      required: true,
      trim: true,
    },

    // Complete readable address
    fullAddress: {
      type: String,
      required: true,
      trim: true,
    },

    // Optional landmark
    landmark: {
      type: String,
      default: "",
      trim: true,
    },

    // City
    city: {
      type: String,
      required: true,
      trim: true,
    },

    // State
    state: {
      type: String,
      required: true,
      trim: true,
    },

    // Pincode
    pincode: {
      type: String,
      required: true,
      trim: true,
    },

    // GPS latitude
    latitude: {
      type: Number,
      default: null,
    },

    // GPS longitude
    longitude: {
      type: Number,
      default: null,
    },

    // Default address
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);


// ============================================================
// USER SCHEMA
// ============================================================

const userSchema = new mongoose.Schema(
  {
    // ==========================================================
    // BASIC USER INFORMATION
    // ==========================================================

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: true,
    },

    passwordChangedAt: {
      type: Date,
      default: null,
    },


    // ==========================================================
    // ROLE
    // ==========================================================

    role: {
      type: String,

      enum: [
  "patient",
  "doctor",
  "laboratory",
  "pharmacy",
  "admin",
],

      required: true,
    },


    // ==========================================================
    // PHONE
    // ==========================================================

    phone: {
      type: String,
      default: "",
      trim: true,
    },


    // ==========================================================
    // PROFILE IMAGE
    // ==========================================================

    profileImage: {
      type: String,
      default: "",
    },


    // ==========================================================
    // ONESIGNAL
    // ==========================================================

    oneSignalId: {
      type: String,
      default: "",
    },


    // ==========================================================
    // SAVED ADDRESSES
    // ==========================================================

    addresses: {
      type: [addressSchema],
      default: [],
    },


    // ==========================================================
    // ACCOUNT STATUS
    //
    // PATIENT:
    //   ACTIVE by default
    //
    // DOCTOR / LABORATORY / PHARMACY:
    //   ACTIVE only after verification approval.
    // ==========================================================

    accountStatus: {
      type: String,

      enum: [
        "ACTIVE",
        "SUSPENDED",
      ],

      default: "ACTIVE",

      index: true,
    },


    // ==========================================================
    // VERIFICATION STATUS
    //
    // PATIENT:
    //   NOT_REQUIRED
    //
    // PROFESSIONAL:
    //   PENDING
    //   UNDER_REVIEW
    //   APPROVED
    //   REJECTED
    //
    // ==========================================================

    verificationStatus: {
      type: String,

      enum: [
        "NOT_REQUIRED",
        "PENDING",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
      ],

      default: "NOT_REQUIRED",

      index: true,
    },


    // ==========================================================
    // VERIFICATION APPLICATION ID
    //
    // Example:
    // HH-DOC-2026-000001
    // HH-LAB-2026-000002
    // HH-PHA-2026-000003
    //
    // This is HealthHome's own verification ID.
    // It is NOT the professional license number.
    // ==========================================================

    verificationId: {
      type: String,

      default: "",

      index: true,

      trim: true,
    },


    // ==========================================================
    // VERIFICATION APPROVAL INFORMATION
    // ==========================================================

    verificationApprovedAt: {
      type: Date,

      default: null,
    },

    verificationApprovedBy: {
      type: String,

      default: "",
    },


    // ==========================================================
    // SUSPENSION INFORMATION
    // ==========================================================

    suspendedAt: {
      type: Date,

      default: null,
    },

    suspensionReason: {
      type: String,

      default: "",
      trim: true,
    },
  },

  {
    timestamps: true,
  }
);


// ============================================================
// INDEXES
// ============================================================

userSchema.index({
  role: 1,
  verificationStatus: 1,
});

userSchema.index({
  role: 1,
  accountStatus: 1,
});


// ============================================================
// EXPORT
// ============================================================

module.exports =
  mongoose.models.User ||
  mongoose.model("User", userSchema);
