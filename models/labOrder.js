
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
      trim: true,
    },

    fileUrl: {
      type: String,
      default: "",
      trim: true,
    },

    fileType: {
      type: String,
      default: "",
      trim: true,
    },

    pageNumber: {
      type: Number,
      default: 1,
      min: 1,
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
      trim: true,
    },

    collectorName: {
      type: String,
      default: "",
      trim: true,
    },

    collectorPhone: {
      type: String,
      default: "",
      trim: true,
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
      select: false,
    },

    collectionOtpExpiresAt: {
      type: Date,
      default: null,
    },

    collectionOtpAttempts: {
      type: Number,
      default: 0,
      min: 0,
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
    // CONFIRMED SCHEDULE
    // ======================================================

    // The currently confirmed booking date/time.
    // This is changed only when the reschedule is accepted
    // by the appropriate party.
    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },

    // The date/time confirmed before the latest reschedule.
    previousScheduledAt: {
      type: Date,
      default: null,
    },

    // ======================================================
    // RESCHEDULE REQUEST
    // ======================================================

    // Proposed date/time awaiting a decision.
    requestedScheduledAt: {
      type: Date,
      default: null,
    },

    // When the current request was created.
    rescheduleRequestedAt: {
      type: Date,
      default: null,
    },

    // Reason for requesting a new date/time.
    rescheduleReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    // Who initiated the current request.
    rescheduleProposedBy: {
      type: String,
      enum: ["Patient", "Laboratory", null],
      default: null,
    },

    // Current reschedule request state.
    rescheduleStatus: {
      type: String,
      enum: [
        "None",
        "Pending",
        "Approved",
        "Rejected",
        "Cancelled",
      ],
      default: "None",
      index: true,
    },

    // Who responded to the current reschedule request.
    rescheduleRespondedBy: {
      type: String,
      enum: ["Patient", "Laboratory", null],
      default: null,
    },

    // When the request was accepted, rejected, or cancelled.
    rescheduleRespondedAt: {
      type: Date,
      default: null,
    },

    // Explanation for rejection or cancellation.
    rescheduleResponseReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    // Number of reschedule requests made for this booking.
    rescheduleCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ======================================================
    // CANCELLATION
    // ======================================================

    cancellationReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
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

// Find active reschedule requests for a laboratory.
labOrderSchema.index({
  labId: 1,
  rescheduleStatus: 1,
  rescheduleRequestedAt: -1,
});

// Find pending reschedule requests for a patient.
labOrderSchema.index({
  patientId: 1,
  rescheduleStatus: 1,
  rescheduleRequestedAt: -1,
});

// ==========================================================
// MODEL
// ==========================================================

module.exports = mongoose.model("LabOrder", labOrderSchema);
