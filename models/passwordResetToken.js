const mongoose = require("mongoose");

const passwordResetTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["patient", "doctor", "laboratory", "pharmacy"],
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    consumedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

// One unconsumed reset link per user prevents concurrent requests from leaving
// multiple valid links active for the same account.
passwordResetTokenSchema.index(
  { userId: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { consumedAt: null },
    name: "one_active_password_reset_per_user_role",
  },
);

module.exports =
  mongoose.models.PasswordResetToken ||
  mongoose.model("PasswordResetToken", passwordResetTokenSchema);
