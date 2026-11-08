const mongoose = require("mongoose");

const razorpayWebhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true, default: "unknown" },
    payloadHash: { type: String, default: "" },
    status: {
      type: String,
      enum: ["PROCESSING", "PROCESSED", "FAILED"],
      default: "PROCESSING",
      index: true,
    },
    attempts: { type: Number, default: 1, min: 1 },
    processingLeaseExpiresAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "RazorpayWebhookEvent",
  razorpayWebhookEventSchema
);
