
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    // HEALTHHOME ORDER
    orderReferenceId: {
      type: String,
      default: "",
      index: true,
    },

    // RAZORPAY PAYMENT
    paymentId: {
      type: String,
      default: undefined,
    },

    orderId: {
      type: String,
      default: undefined,
    },

    signature: {
      type: String,
      default: "",
    },

    // RAZORPAY QR - LEGACY COMPATIBILITY
    razorpayQrId: {
      type: String,
      default: "",
      index: true,
    },

    razorpayQrImageUrl: {
      type: String,
      default: "",
    },

    qrStatus: {
      type: String,
      default: "",
    },

    // USER
    userId: {
      type: String,
      required: true,
      index: true,
    },

    userName: {
      type: String,
      required: true,
    },

    userPhone: {
      type: String,
      required: true,
    },

    // SERVICE
    serviceType: {
      type: String,
      enum: ["Doctor", "Medicine", "Lab"],
      required: true,
    },

    serviceId: {
      type: String,
      default: "",
      index: true,
    },

    // PAYMENT AMOUNT - INR
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "INR",
    },

    // PAYMENT METHOD
    paymentMethod: {
      type: String,
      enum: [
        "ONLINE",
        "COD",
        "UPI",
        "Card",
        "Net Banking",
        "Wallet",
        "Other",
        "",
      ],
      default: "",
    },

    // PAYMENT STATUS
    status: {
      type: String,
      enum: [
        "Pending",
        "Success",
        "Failed",
        "Collected",
        "Refunded",
        "Cancelled",
      ],
      default: "Pending",
      index: true,
    },

    // RAZORPAY STATUS
    razorpayStatus: {
      type: String,
      default: "",
    },

    // SETTLEMENT
    settlementStatus: {
      type: String,
      enum: [
        "Pending",
        "Processing",
        "Settled",
        "Failed",
      ],
      default: "Pending",
    },

    settlementId: {
      type: String,
      default: "",
    },

    // PROVIDER
    providerId: {
      type: String,
      default: "",
    },

    providerType: {
      type: String,
      enum: [
        "Doctor",
        "Lab",
        "Laboratory",
        "Pharmacy",
        "",
      ],
      default: "",
    },

    // HEALTHHOME COMMISSION
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

    // COD COLLECTION
    cashCollected: {
      type: Boolean,
      default: false,
    },

    cashCollectedAt: {
      type: Date,
      default: null,
    },

    // REFUND
    refundId: {
      type: String,
      default: "",
    },

    refundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    refundedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Only non-empty Razorpay payment IDs must be unique.
paymentSchema.index(
  { paymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentId: { $type: "string", $gt: "" },
    },
  }
);

// Only non-empty Razorpay order IDs must be unique.
paymentSchema.index(
  { orderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderId: { $type: "string", $gt: "" },
    },
  }
);

// Helpful lookup for service payment history.
paymentSchema.index({
  serviceType: 1,
  serviceId: 1,
  userId: 1,
});

module.exports = mongoose.model("Payment", paymentSchema);
