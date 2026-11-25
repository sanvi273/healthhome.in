const mongoose = require("mongoose");

const ratingSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ["doctor", "laboratory", "pharmacy"],
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    transactionId: {
      type: String,
      required: true,
      trim: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    providerName: { type: String, default: "", trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String, default: "", trim: true, maxlength: 600 },
  },
  { timestamps: true },
);

ratingSchema.index(
  { entityType: 1, transactionId: 1 },
  { unique: true },
);
ratingSchema.index({ entityType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.models.Rating || mongoose.model("Rating", ratingSchema);
