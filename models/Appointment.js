const mongoose = require("mongoose");

// ============================================================
// APPOINTMENT SCHEMA
// ============================================================

const appointmentSchema = new mongoose.Schema(
  {
    // ==========================================================
    // PATIENT
    // ==========================================================

    patientName: {
      type: String,
      required: true,
      trim: true,
    },

    patientPhone: {
      type: String,
      required: true,
      trim: true,
    },

    
    // ==========================================================
    // RESCHEDULING
    // ==========================================================

    originalAppointmentDate: {
      type: String,
      default: "",
      trim: true,
    },

    originalAppointmentTime: {
      type: String,
      default: "",
      trim: true,
    },

    proposedAppointmentDate: {
      type: String,
      default: "",
      trim: true,
    },

    proposedAppointmentTime: {
      type: String,
      default: "",
      trim: true,
    },

    rescheduleRequestedBy: {
      type: String,
      enum: ["Doctor", "Patient", ""],
      default: "",
    },

    rescheduleReason: {
      type: String,
      default: "",
      trim: true,
    },

    patientResponse: {
      type: String,
      enum: [
        "Pending",
        "Accepted",
        "Requested Another Time",
        ""
      ],
      default: "",
    },

    rescheduleHistory: [
      {
        previousDate: {
          type: String,
          default: "",
        },

        previousTime: {
          type: String,
          default: "",
        },

        proposedDate: {
          type: String,
          default: "",
        },

        proposedTime: {
          type: String,
          default: "",
        },

        requestedBy: {
          type: String,
          enum: ["Doctor", "Patient"],
        },

        reason: {
          type: String,
          default: "",
        },

        requestedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // ==========================================================
    // DOCTOR
    // ==========================================================

    doctorId: {
      type: String,
      required: true,
      trim: true,
    },

    doctorName: {
      type: String,
      required: true,
      trim: true,
    },

    specialization: {
      type: String,
      default: "",
      trim: true,
    },

    hospital: {
      type: String,
      default: "",
      trim: true,
    },

    fees: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // CONSULTATION
    // ==========================================================

    consultationType: {
      type: String,

      enum: [
        "Video Consultation",
        "Hospital Visit",
      ],

      default: "Hospital Visit",
    },

    // ==========================================================
    // APPOINTMENT DATE / TIME
    // ==========================================================

    appointmentDate: {
      type: String,
      required: true,
      trim: true,
    },

    appointmentTime: {
      type: String,
      required: true,
      trim: true,
    },

    // ==========================================================
    // REPORTS
    // ==========================================================

    reports: [
      {
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
      },
    ],

    // ==========================================================
    // VIDEO CONSULTATION
    // ==========================================================

    meetingId: {
      type: String,
      default: "",
    },

    consultationStatus: {
      type: String,

      enum: [
        "Pending",
        "Ready",
        "Joined",
        "Completed",
      ],

      default: "Pending",
    },

    // ==========================================================
    // PRESCRIPTION
    // ==========================================================

    prescriptionSent: {
      type: Boolean,
      default: false,
    },

    // ==========================================================
    // PAYMENT
    // ==========================================================

    paymentStatus: {
      type: String,

      enum: [
        "Pending",
        "Paid",
        "Failed",
        "Refunded",
      ],

      default: "Pending",
    },

    razorpayOrderId: {
      type: String,
      default: "",
      trim: true,
    },

    paymentId: {
      type: String,
      default: "",
      trim: true,
    },

    // ==========================================================
    // APPOINTMENT STATUS
    // ==========================================================

    status: {
      type: String,

      enum: [
        "Pending",
        "Upcoming",
        "Accepted",
        "Completed",
        "Cancelled",
        "Rejected",
      ],

      default: "Pending",
    },
  },

  {
    timestamps: true,
  }
);

// ============================================================
// UNIQUE ACTIVE APPOINTMENT SLOT
//
// Same doctor + same date + same time
// cannot have two active appointments.
//
// Cancelled and Rejected appointments
// do NOT block the slot.
// ============================================================

appointmentSchema.index(
  {
    doctorId: 1,
    appointmentDate: 1,
    appointmentTime: 1,
  },

  {
    unique: true,

    partialFilterExpression: {
      doctorId: {
        $exists: true,
        $ne: "",
      },

      status: {
        $in: [
          "Pending",
          "Upcoming",
          "Accepted",
        ],
      },
    },
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports =
  mongoose.model(
    "Appointment",
    appointmentSchema
  );