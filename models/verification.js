const mongoose = require("mongoose");

const verificationSchema = new mongoose.Schema(
  {
    // =====================================================
    // USER REFERENCE
    // =====================================================
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // =====================================================
    // HEALTHHOME INTERNAL VERIFICATION ID
    // Example:
    // HH-DOC-2026-000184
    // HH-LAB-2026-000092
    // HH-PHA-2026-000317
    // =====================================================
    verificationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    // =====================================================
    // PROFESSIONAL ROLE
    // =====================================================
    role: {
      type: String,
      enum: ["doctor", "laboratory", "pharmacy"],
      required: true,
      index: true,
    },

    // =====================================================
    // PROFESSIONAL INFORMATION
    // =====================================================
    professionalName: {
      type: String,
      required: true,
      trim: true,
    },

    licenseNumber: {
      type: String,
      default: "",
      trim: true,
    },

    registrationNumber: {
      type: String,
      default: "",
      trim: true,
    },

    organizationName: {
      type: String,
      default: "",
      trim: true,
    },

    // =====================================================
    // ADDRESS
    // =====================================================
    address: {
      type: String,
      default: "",
      trim: true,
    },

    // =====================================================
    // VERIFICATION DOCUMENTS
    //
    // Example:
    // [
    //   {
    //     type: "Medical License",
    //     url: "https://...."
    //   },
    //   {
    //     type: "ID Proof",
    //     url: "https://...."
    //   }
    // ]
    // =====================================================
    documents: [
      {
        type: {
          type: String,
          required: true,
          trim: true,
        },

        url: {
          type: String,
          required: true,
          trim: true,
        },

        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // =====================================================
    // APPLICANT NOTES
    // =====================================================
    notes: {
      type: String,
      default: "",
      trim: true,
    },

    // =====================================================
    // VERIFICATION STATUS
    // =====================================================
    status: {
      type: String,
      enum: [
        "PENDING",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
      ],
      default: "PENDING",
      index: true,
    },

    // =====================================================
    // ADMIN REVIEW INFORMATION
    // =====================================================
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    // =====================================================
    // APPROVAL INFORMATION
    // =====================================================
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    // =====================================================
    // REJECTION INFORMATION
    // =====================================================
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);


// =====================================================
// INDEXES
// =====================================================

verificationSchema.index({
  role: 1,
  status: 1,
});

verificationSchema.index({
  userId: 1,
  status: 1,
});


// =====================================================
// EXPORT MODEL
// =====================================================

module.exports = mongoose.model(
  "Verification",
  verificationSchema
);
