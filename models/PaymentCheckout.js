const mongoose = require("mongoose");

// One checkout/order per service record. Keeping this reservation separate
// avoids adding a unique index over legacy Payment records that may duplicate.
const paymentCheckoutSchema = new mongoose.Schema(
  {
    serviceKey: { type: String, required: true, unique: true },
    serviceType: {
      type: String,
      enum: ["Doctor", "Medicine", "Lab"],
      required: true,
    },
    serviceId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    paymentRecordId: { type: String, default: "" },
    razorpayOrderId: { type: String, default: "", index: true },
    amountPaise: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["CREATING", "PENDING", "SUCCESS", "CANCELLED", "FAILED"],
      default: "CREATING",
      index: true,
    },
    leaseToken: { type: String, default: "" },
    leaseExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentCheckout", paymentCheckoutSchema);
