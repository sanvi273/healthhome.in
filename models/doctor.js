
const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    specialization: {
      type: String,
      required: true,
    },

    experience: {
      type: String,
      required: true,
    },

    fees: {
      type: String,
      required: true,
    },

    hospital: {
      type: String,
      required: true,
    },

    about: {
      type: String,
      default: "",
    },

    // Doctor can turn appointment booking ON or OFF.
    isAvailable: {
      type: Boolean,
      default: true,
    },

    // Regular working days.
    workingDays: {
      type: [
        {
          type: String,
          enum: [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ],
        },
      ],
      default: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ],
    },

    // Working hours use 24-hour format: HH:mm.
    startTime: {
      type: String,
      default: "10:00",
    },

    endTime: {
      type: String,
      default: "19:30",
    },

    // Optional daily break.
    breakStart: {
      type: String,
      default: "13:00",
    },

    breakEnd: {
      type: String,
      default: "14:00",
    },

    // Appointment duration in minutes.
    slotDurationMinutes: {
      type: Number,
      default: 30,
      min: 10,
      max: 120,
    },

    // Each doctor can choose their own daily appointment limit.
    maxAppointmentsPerDay: {
      type: Number,
      default: 10,
      min: 1,
      max: 100,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Doctor", doctorSchema);
