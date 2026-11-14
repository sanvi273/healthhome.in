const mongoose = require("mongoose");

// ============================================================
// PHARMACY SCHEMA
// ============================================================

const pharmacySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // ============================================================
    // PHARMACY BASIC DETAILS
    // ============================================================

    name: {
      type: String,
      required: true,
      trim: true,
    },

    shopType: {
      type: String,
      required: true,
      trim: true,
    },

    experience: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // ============================================================
    // DELIVERY PARTNERS
    // ============================================================
    //
    // Each pharmacy can have multiple permanent
    // delivery partners.
    //
    // MongoDB/Mongoose automatically creates an _id
    // for every delivery partner.
    //
    // Example:
    //
    // deliveryPartners: [
    //   {
    //     _id: "68xxxxxxxxxxxx",
    //     name: "Rahul",
    //     phone: "9876543210",
    //     createdAt: "2026-10-06T..."
    //   }
    // ]
    //
    // The _id is used when deleting a specific partner.
    //
    // ============================================================

    deliveryPartners: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },

        phone: {
          type: String,
          required: true,
          trim: true,
        },

        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // ============================================================
    // PHARMACY PROFILE
    // ============================================================

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

    profileImageUrl: {
      type: String,
      default: "",
      trim: true,
    },

    profileImagePublicId: {
      type: String,
      default: "",
      trim: true,
    },

    // ============================================================
    // RAZORPAY MARKETPLACE / LINKED ACCOUNT
    // ============================================================

    razorpayLinkedAccountId: {
      type: String,
      default: "",
      index: true,
    },

    razorpayOnboarded: {
      type: Boolean,
      default: false,
    },

    // ============================================================
    // SETTLEMENT
    // ============================================================

    settlementEnabled: {
      type: Boolean,
      default: false,
    },

    // ============================================================
    // PLATFORM FEE / COMMISSION
    // ============================================================

    platformFeePercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
  },

  // ============================================================
  // AUTOMATIC CREATEDAT / UPDATEDAT
  // ============================================================

  {
    timestamps: true,
  }
);

// ============================================================
// EXPORT PHARMACY MODEL
// ============================================================
//
// IMPORTANT:
//
// Using mongoose.models.Pharmacy first prevents:
//
// OverwriteModelError:
// Cannot overwrite `Pharmacy` model once compiled.
//
// If the Pharmacy model already exists, MongoDB/Mongoose
// reuses it.
//
// If it doesn't exist, it creates the model.
//
// ============================================================

module.exports =
  mongoose.models.Pharmacy ||
  mongoose.model("Pharmacy", pharmacySchema);
