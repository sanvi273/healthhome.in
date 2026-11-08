const mongoose = require("mongoose");

// ============================================================
// MEDICINE ITEM SCHEMA
// ============================================================

const medicineItemSchema = new mongoose.Schema(
  {
    medicineId: {
      type: String,
      default: "",
    },

    medicineName: {
      type: String,
      default: "",
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: false,
  }
);

// ============================================================
// ORDER SCHEMA
// ============================================================

const orderSchema = new mongoose.Schema(
  {
    // ========================================================
    // PATIENT DETAILS
    // ========================================================

    patientId: {
      type: String,
      default: "",
    },

    patientName: {
      type: String,
      required: true,
    },

    patientPhone: {
      type: String,
      required: true,
    },

    // ========================================================
    // PHARMACY DETAILS
    // ========================================================

    pharmacyId: {
      type: String,
      required: true,
    },

    pharmacyName: {
      type: String,
      default: "",
    },

    pharmacyPhone: {
      type: String,
      default: "",
    },

    // ========================================================
    // ORDER DETAILS
    // ========================================================

    orderType: {
      type: String,
      enum: [
        "MEDICINE",
        "PRESCRIPTION",
      ],
      default: "MEDICINE",
    },

    address: {
      type: String,
      required: true,
    },

    notes: {
      type: String,
      default: "",
    },

    prescriptionImage: {
      type: String,
      default: "",
    },

    medicines: {
      type: [medicineItemSchema],
      default: [],
    },

    // ========================================================
    // AMOUNT DETAILS
    // ========================================================

    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    currency: {
      type: String,
      default: "INR",
    },

    // ========================================================
    // PAYMENT DETAILS
    // ========================================================

    paymentMethod: {
      type: String,
      enum: [
        "ONLINE",
        "COD",
        "Cash on Delivery",
      ],
      default: "COD",
    },

    paymentStatus: {
      type: String,
      default: "Pending",
    },

    razorpayOrderId: {
      type: String,
      default: "",
    },

    razorpayPaymentId: {
      type: String,
      default: "",
    },

    // ========================================================
    // SETTLEMENT DETAILS
    // ========================================================

    settlementStatus: {
      type: String,
      default: "Pending",
    },

    platformFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    providerAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ========================================================
    // ORDER STATUS
    // ========================================================

    status: {
      type: String,
      enum: [
        "Pending",
        "Accepted",
        "Packed",
        "Out for Delivery",
        "Delivered",
        "Rejected",
        "Cancelled",
      ],
      default: "Pending",
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    // ========================================================
    // DELIVERY AGENT DETAILS
    // ========================================================

    deliveryAgentName: {
      type: String,
      default: "",
    },

    deliveryAgentPhone: {
      type: String,
      default: "",
    },

    deliveryAgentAssigned: {
      type: Boolean,
      default: false,
    },

    deliveryAgentAssignedAt: {
      type: Date,
      default: null,
    },

    // ========================================================
    // DELIVERY OTP SECURITY
    // ========================================================
    //
    // IMPORTANT:
    // We store ONLY the SHA-256 HASH of the OTP.
    //
    // OTP is generated when order becomes:
    // "Out for Delivery"
    //
    // OTP validity:
    // 10 minutes
    //
    // Maximum attempts:
    // 5
    //
    // After successful verification:
    // deliveryOtpVerified = true
    // status = "Delivered"
    //
    // ========================================================

    deliveryOtpHash: {
      type: String,
      default: "",
    },

    deliveryOtpExpiresAt: {
      type: Date,
      default: null,
    },

    deliveryOtpAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    deliveryOtpVerified: {
      type: Boolean,
      default: false,
    },

    deliveryOtpSentAt: {
      type: Date,
      default: null,
    },

    // ========================================================
    // COD PAYMENT
    // ========================================================

    cashCollected: {
      type: Boolean,
      default: false,
    },

    cashCollectedAt: {
      type: Date,
      default: null,
    },

    // Additive audit fields: amounts are recorded in integer paise; existing
    // rupee totalAmount and COD flags are retained for current clients.
    cashCollectedAmountPaise: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    cashCollectedBy: {
      type: String,
      default: "",
    },

    // ========================================================
    // CANCELLATION
    // ========================================================

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      default: "",
    },
  },

  // ==========================================================
  // AUTOMATIC CREATED / UPDATED TIMESTAMPS
  // ==========================================================

  {
    timestamps: true,
  }
);

// ============================================================
// INDEXES
// ============================================================

orderSchema.index({
  pharmacyId: 1,
  createdAt: -1,
});

orderSchema.index({
  patientPhone: 1,
  createdAt: -1,
});

orderSchema.index({
  orderType: 1,
  status: 1,
});

orderSchema.index({
  acceptedAt: 1,
});

// ============================================================
// MODEL
// ============================================================

const Order = mongoose.model(
  "Order",
  orderSchema
);

module.exports = Order;
