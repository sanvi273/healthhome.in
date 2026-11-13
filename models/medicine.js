const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema(
  {
    pharmacyPhone: {
      type: String,
      required: true,
    },

    medicineName: {
      type: String,
      required: true,
    },

    category: {
      type: String,
      default: "Tablet",
    },

    manufacturer: {
      type: String,
      default: "",
    },

    description: {
      type: String,
      default: "",
    },

    price: {
      type: Number,
      required: true,
    },

    stock: {
      type: Number,
      required: true,
    },

    image: {
      type: String,
      default: "",
    },

    // Internal idempotency key for retry-safe pharmacy add requests.
    submissionKey: {
      type: String,
      select: false,
    },

    soldCount: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      default: "Available",
    },
  },
  {
    timestamps: true,
  }
);

medicineSchema.index(
  { pharmacyPhone: 1, submissionKey: 1 },
  {
    unique: true,
    partialFilterExpression: { submissionKey: { $type: "string" } },
  },
);

module.exports = mongoose.model(
  "Medicine",
  medicineSchema
);
