
const mongoose = require("mongoose");

// ==========================================================
// REPORT SCHEMA
// ==========================================================

const reportSchema = new mongoose.Schema(
  {
    reportName: {
      type: String,
      default: "",
      trim: true,
    },
    fileName: {
      type: String,
      default: "",
    },
    fileUrl: {
      type: String,
      default: "",
    },
    fileType: {
      type: String,
      default: "",
    },
    pageNumber: {
      type: Number,
      default: 1,
    },
  },
  { _id: false }
);

// ==========================================================
// LAB ORDER SCHEMA
// ==========================================================

const labOrderSchema = new mongoose.Schema(
  {
    // ======================================================
    // PATIENT
    // ======================================================

    patientId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    patientName: {
      type: String,
      required: true,
      trim: true,
    },

    patientPhone: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    doctorName: {
      type: String,
      default: "",
      trim: true,
    },

    // ======================================================
    // BOOKING
    // ======================================================

    bookingType: {
      type: String,
      enum: ["TEST", "PRESCRIPTION"],
      default: "TEST",
      index: true,
    },

    tests: {
      type: [String],
      default: [],
    },

    // ======================================================
    // LABORATORY
    // ======================================================

    labId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    labName: {
      type: String,
      default: "",
      trim: true,
    },

    // ======================================================
    // ADDRESS / COLLECTION
    // ======================================================

    address: {
      type: String,
      default: "",
      trim: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    collectionMode: {
      type: String,
      enum: ["Home Collection", "Visit Laboratory"],
      default: "Home Collection",
    },

    // ======================================================
    // PAYMENT
    // ======================================================

    totalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
      index: true,
    },

    razorpayOrderId: {
      type: String,
      default: "",
      index: true,
    },

    razorpayPaymentId: {
      type: String,
      default: "",
      index: true,
    },

    razorpaySignature: {
      type: String,
      default: "",
    },

    paymentRecordId: {
      type: String,
      default: "",
    },

    // ======================================================
    // PRESCRIPTION
    // ======================================================

    prescriptionImage: {
      type: String,
      default: "",
    },

    // ======================================================
    // SAMPLE COLLECTOR
    // ======================================================

    collectorId: {
      type: String,
      default: "",
    },

    collectorName: {
      type: String,
      default: "",
    },

    collectorPhone: {
      type: String,
      default: "",
    },

    collectorStatus: {
      type: String,
      enum: [
        "Not Assigned",
        "Assigned",
        "On The Way",
        "Sample Collected",
      ],
      default: "Not Assigned",
    },

    // ======================================================
    // SAMPLE COLLECTION OTP
    // ======================================================

    collectionOtpHash: {
      type: String,
      default: "",
    },

    collectionOtpExpiresAt: {
      type: Date,
      default: null,
    },

    collectionOtpAttempts: {
      type: Number,
      default: 0,
    },

    collectionOtpVerified: {
      type: Boolean,
      default: false,
    },

    collectionOtpSentAt: {
      type: Date,
      default: null,
    },

    // ======================================================
    // LAB PROCESS STATUS
    // ======================================================

    status: {
      type: String,
      enum: [
        "Pending",
        "Accepted",
        "Collector Assigned",
        "On The Way",
        "Sample Collected",
        "Sample Received",
        "In Progress",
        "Report Ready",
        "Completed",
        "Rejected",
        "Cancelled",
      ],
      default: "Pending",
      index: true,
    },

    // ======================================================
    // SCHEDULE AND RESCHEDULING
    // ======================================================

    // Currently confirmed booking date/time.
    scheduledAt: {
      type: Date,
      default: null,
    },

    // Previously confirmed date/time.
    previousScheduledAt: {
      type: Date,
      default: null,
    },

    // Proposed date/time awaiting a decision.
    requestedScheduledAt: {
      type: Date,
      default: null,
    },

    // When the rescheduling request was created.
    rescheduleRequestedAt: {
      type: Date,
      default: null,
    },

    // Optional explanation for the proposed date/time.
    rescheduleReason: {
      type: String,
      default: "",
      trim: true,
    },

    // None: no active request.
    // Pending: awaiting a decision.
    // Approved: rescheduling accepted.
    // Rejected: rescheduling declined or rejected.
    rescheduleStatus: {
      type: String,
      enum: ["None", "Pending", "Approved", "Rejected"],
      default: "None",
    },

    // Identifies who initiated the rescheduling.
    // Patient: patient requested a new date/time.
    // Laboratory: laboratory proposed a new date/time.
    rescheduleProposedBy: {
      type: String,
      enum: ["Patient", "Laboratory", null],
      default: null,
    },

    // ======================================================
    // CANCELLATION
    // ======================================================

    cancellationReason: {
      type: String,
      default: "",
      trim: true,
    },



    cancelledBy: {
      type: String,
      enum: ["", "Patient", "Laboratory"],
      default: "",
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    // ======================================================
    // REPORTS
    // ======================================================

    reports: {
      type: [reportSchema],
      default: [],
    },

    reportUploadedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ==========================================================
// INDEXES
// ==========================================================

labOrderSchema.index({
  patientPhone: 1,
  createdAt: -1,
});

labOrderSchema.index({
  labId: 1,
  status: 1,
  createdAt: -1,
});

labOrderSchema.index({
  patientId: 1,
  createdAt: -1,
});

labOrderSchema.index({
  paymentStatus: 1,
  createdAt: -1,
});



// ==========================================================
// MODEL
// ==========================================================

module.exports = mongoose.model("LabOrder", labOrderSchema);
