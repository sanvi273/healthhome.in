console.log("🔥 PRESCRIPTION MODEL LOADED");

const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    // =====================================================
    // APPOINTMENT DETAILS
    // =====================================================

    appointmentId: {
      type: String,
      default: "",
    },

    // =====================================================
    // PATIENT DETAILS
    // =====================================================

    patientId: {
      type: String,
      default: "",
    },

    patientName: {
      type: String,
      default: "",
    },

    patientPhone: {
      type: String,
      default: "",
    },

    patientGender: { type: String, default: "", trim: true },
    patientBloodGroup: { type: String, default: "", trim: true },
    patientHeight: { type: String, default: "", trim: true },
    patientWeight: { type: String, default: "", trim: true },
    patientBmi: { type: String, default: "", trim: true },

    // =====================================================
    // DOCTOR DETAILS
    // =====================================================

    doctorId: {
      type: String,
      default: "",
    },

    doctorName: {
      type: String,
      default: "",
    },

    doctorEmergencyNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 32,
    },

    // =====================================================
    // CLINICAL DETAILS
    // =====================================================

    diagnosis: {
      type: String,
      default: "",
    },

    symptoms: {
      type: [String],
      default: [],
    },

    advice: {
      type: String,
      default: "",
    },

    followUpDate: {
      type: String,
      default: "",
    },

    // =====================================================
    // MEDICINES
    // =====================================================

    medicines: [
      {
        medicineId: {
          type: String,
          default: "",
        },

        medicine: {
          type: String,
          required: true,
        },

        price: {
          type: String,
          default: "",
        },

        dose: {
          type: String,
          default: "",
        },

        duration: {
          type: String,
          default: "",
        },

        food: {
          type: String,
          default: "",
        },

        instruction: {
          type: String,
          default: "",
        },

        morning: {
          type: Boolean,
          default: false,
        },

        afternoon: {
          type: Boolean,
          default: false,
        },

        night: {
          type: Boolean,
          default: false,
        },
      },
    ],

    // =====================================================
    // LAB TESTS
    // =====================================================

    labTests: [
      {
        testName: {
          type: String,
          required: true,
        },

        priority: {
          type: String,
          enum: [
            "Normal",
            "High",
            "Urgent",
          ],
          default: "Normal",
        },

        note: {
          type: String,
          default: "",
        },
      },
    ],

    // =====================================================
    // PDF
    // =====================================================

    pdfUrl: {
      type: String,
      default: "",
    },

    // =====================================================
    // STATUS
    // =====================================================

    status: {
      type: String,
      default: "SAVED",
    },
  },

  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "Prescription",
  prescriptionSchema
);
