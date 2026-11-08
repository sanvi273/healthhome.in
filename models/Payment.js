const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    // HEALTHHOME / SERVICE REFERENCES
    orderReferenceId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    appointmentId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    labOrderId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    pharmacyOrderId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    // RAZORPAY IDENTIFIERS
    paymentId: {
      type: String,
      default: undefined,
      trim: true,
    },

    razorpayPaymentId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    orderId: {
      type: String,
      default: undefined,
      trim: true,
    },

    razorpayOrderId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    signature: {
      type: String,
      default: "",
      trim: true,
    },

    razorpaySignature: {
      type: String,
      default: "",
      trim: true,
    },

    // LEGACY QR COMPATIBILITY
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

    // USER INFORMATION
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    userName: {
      type: String,
      required: true,
      trim: true,
    },

    userPhone: {
      type: String,
      required: true,
      trim: true,
    },

    // SERVICE DETAILS
    serviceType: {
      type: String,
      enum: ["Doctor", "Medicine", "Lab"],
      required: true,
    },

    serviceId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    // AMOUNT & CURRENCY
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Canonical integer representation for new records. `amount` remains in
    // rupees for compatibility with existing Flutter/payment-history clients.
    amountPaise: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    currency: {
      type: String,
      default: "INR",
      trim: true,
    },

    // PAYMENT METHOD (UPI, Net Banking, Card, COD, etc.)
    paymentMethod: {
      type: String,
      default: "",
      trim: true,
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

    paymentStatus: {
      type: String,
      enum: [
        "CREATED",
        "PENDING",
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "REFUNDED",
        "Pending",
        "Success",
        "Failed",
        "Cancelled",
        "Refunded",
      ],
      default: "PENDING",
      index: true,
    },

    verificationStatus: {
      type: String,
      enum: ["PENDING", "VERIFIED", "FAILED", "SKIPPED"],
      default: "PENDING",
      index: true,
    },

    transactionDate: {
      type: Date,
      default: Date.now,
    },

    capturedAt: {
      type: Date,
      default: null,
    },

    failureReason: {
      type: String,
      default: "",
    },

    webhookEventId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    // RAZORPAY RAW STATUS
    razorpayStatus: {
      type: String,
      default: "",
    },

    // SETTLEMENT
    settlementStatus: {
      type: String,
      enum: ["Pending", "Processing", "Settled", "Failed"],
      default: "Pending",
    },

    settlementId: {
      type: String,
      default: "",
    },

    // PROVIDER (Doctor, Lab, Pharmacy)
    providerId: {
      type: String,
      default: "",
      trim: true,
    },

    providerType: {
      type: String,
      enum: ["Doctor", "Lab", "Laboratory", "Pharmacy", ""],
      default: "",
    },

    // COMMISSION & SPLIT
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

    cashCollectedBy: {
      type: String,
      default: "",
      trim: true,
    },

    cashCollectedAmountPaise: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
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

// Synchronize legacy and new field names on save
paymentSchema.pre("save", function (next) {
  if (this.orderId && !this.razorpayOrderId) {
    this.razorpayOrderId = this.orderId;
  } else if (this.razorpayOrderId && !this.orderId) {
    this.orderId = this.razorpayOrderId;
  }

  if (this.paymentId && !this.razorpayPaymentId) {
    this.razorpayPaymentId = this.paymentId;
  } else if (this.razorpayPaymentId && !this.paymentId) {
    this.paymentId = this.razorpayPaymentId;
  }

  if (this.signature && !this.razorpaySignature) {
    this.razorpaySignature = this.signature;
  } else if (this.razorpaySignature && !this.signature) {
    this.signature = this.razorpaySignature;
  }

  if (this.status === "Success" && this.paymentStatus !== "SUCCESS") {
    this.paymentStatus = "SUCCESS";
    this.verificationStatus = "VERIFIED";
  }

  next();
});

// Partial unique index for non-empty payment IDs
paymentSchema.index(
  { paymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentId: { $type: "string", $gt: "" },
    },
  }
);

paymentSchema.index(
  { razorpayPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      razorpayPaymentId: { $type: "string", $gt: "" },
    },
  }
);

// Partial unique index for non-empty order IDs
paymentSchema.index(
  { orderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderId: { $type: "string", $gt: "" },
    },
  }
);

paymentSchema.index(
  { razorpayOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      razorpayOrderId: { $type: "string", $gt: "" },
    },
  }
);

// Lookup index for user payment history
paymentSchema.index({ userId: 1, createdAt: -1 });

// Lookup index for service payment history
paymentSchema.index({
  serviceType: 1,
  serviceId: 1,
  userId: 1,
});

module.exports = mongoose.model("Payment", paymentSchema);
