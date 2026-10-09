
const mongoose = require("mongoose");
const Doctor = require("../models/doctor");

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const isValidTime = (value) =>
  typeof value === "string" &&
  /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

// ================= ADD / UPDATE DOCTOR =================

const addDoctor = async (req, res) => {
  try {
    const {
      name,
      phone,
      specialization,
      experience,
      fees,
      hospital,
      about,
    } = req.body;

    if (
      !name ||
      !phone ||
      !specialization ||
      !experience ||
      fees === undefined ||
      !hospital
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, phone, specialization, experience, fees and hospital are required",
      });
    }

    let doctor = await Doctor.findOne({ phone });

    const profileFields = {
      name,
      specialization,
      experience,
      fees,
      hospital,
      about: about ?? "",
    };

    if (doctor) {
      Object.assign(doctor, profileFields);
      await doctor.save();

      return res.status(200).json({
        success: true,
        message: "Doctor updated successfully",
        doctor,
      });
    }

    doctor = await Doctor.create({
      ...profileFields,
      phone,
    });

    return res.status(201).json({
      success: true,
      message: "Doctor added successfully",
      doctor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= GET ALL DOCTORS =================

const getDoctors = async (req, res) => {
  try {
    const doctors = await Doctor.find();

    return res.status(200).json({
      success: true,
      doctors,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= GET DOCTOR PROFILE BY PHONE =================

const getDoctorProfile = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({
      phone: req.params.phone,
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      doctor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= TURN AVAILABILITY ON / OFF =================

const updateDoctorAvailability = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { isAvailable } = req.body;

    if (!isValidObjectId(doctorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID",
      });
    }

    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isAvailable must be true or false",
      });
    }

    const doctor = await Doctor.findByIdAndUpdate(
      doctorId,
      { $set: { isAvailable } },
      { new: true, runValidators: true }
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: isAvailable
        ? "Doctor availability turned ON"
        : "Doctor availability turned OFF",
      doctor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= UPDATE WORKING SCHEDULE =================

const updateDoctorSchedule = async (req, res) => {
  try {
    const { doctorId } = req.params;

    if (!isValidObjectId(doctorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID",
      });
    }

    const {
      workingDays,
      startTime,
      endTime,
      breakStart,
      breakEnd,
      slotDurationMinutes,
      maxAppointmentsPerDay,
    } = req.body;

    const updates = {};

    if (workingDays !== undefined) {
      if (
        !Array.isArray(workingDays) ||
        workingDays.length === 0 ||
        workingDays.some((day) => !WEEKDAYS.includes(day)) ||
        new Set(workingDays).size !== workingDays.length
      ) {
        return res.status(400).json({
          success: false,
          message:
            "workingDays must be a non-empty array of unique valid weekdays",
        });
      }

      updates.workingDays = workingDays;
    }

    if (startTime !== undefined) {
      if (!isValidTime(startTime)) {
        return res.status(400).json({
          success: false,
          message: "startTime must use HH:mm format, e.g. 09:00",
        });
      }

      updates.startTime = startTime;
    }

    if (endTime !== undefined) {
      if (!isValidTime(endTime)) {
        return res.status(400).json({
          success: false,
          message: "endTime must use HH:mm format, e.g. 18:00",
        });
      }

      updates.endTime = endTime;
    }

    if (breakStart !== undefined) {
      if (breakStart !== null && !isValidTime(breakStart)) {
        return res.status(400).json({
          success: false,
          message: "breakStart must use HH:mm format or null",
        });
      }

      updates.breakStart = breakStart ?? "";
    }

    if (breakEnd !== undefined) {
      if (breakEnd !== null && !isValidTime(breakEnd)) {
        return res.status(400).json({
          success: false,
          message: "breakEnd must use HH:mm format or null",
        });
      }

      updates.breakEnd = breakEnd ?? "";
    }

    if (slotDurationMinutes !== undefined) {
      const duration = Number(slotDurationMinutes);

      if (
        !Number.isInteger(duration) ||
        duration < 10 ||
        duration > 120
      ) {
        return res.status(400).json({
          success: false,
          message: "slotDurationMinutes must be an integer from 10 to 120",
        });
      }

      updates.slotDurationMinutes = duration;
    }

    if (maxAppointmentsPerDay !== undefined) {
      const limit = Number(maxAppointmentsPerDay);

      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "maxAppointmentsPerDay must be from 1 to 100",
        });
      }

      updates.maxAppointmentsPerDay = limit;
    }

    const doctor = await Doctor.findById(doctorId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    const finalStart = updates.startTime ?? doctor.startTime;
    const finalEnd = updates.endTime ?? doctor.endTime;
    const finalBreakStart =
      updates.breakStart !== undefined
        ? updates.breakStart
        : doctor.breakStart;
    const finalBreakEnd =
      updates.breakEnd !== undefined
        ? updates.breakEnd
        : doctor.breakEnd;

    if (finalStart >= finalEnd) {
      return res.status(400).json({
        success: false,
        message: "startTime must be earlier than endTime",
      });
    }

    // Break times must either both be empty or form a valid interval.
    if (Boolean(finalBreakStart) !== Boolean(finalBreakEnd)) {
      return res.status(400).json({
        success: false,
        message: "Provide both breakStart and breakEnd, or leave both empty",
      });
    }

    if (finalBreakStart && finalBreakEnd) {
      if (
        !isValidTime(finalBreakStart) ||
        !isValidTime(finalBreakEnd) ||
        finalBreakStart >= finalBreakEnd ||
        finalBreakStart < finalStart ||
        finalBreakEnd > finalEnd
      ) {
        return res.status(400).json({
          success: false,
          message: "Break times must fall within working hours",
        });
      }
    }

    Object.assign(doctor, updates);
    await doctor.save();

    return res.status(200).json({
      success: true,
      message: "Doctor schedule updated successfully",
      doctor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= EXPORT =================

module.exports = {
  addDoctor,
  getDoctors,
  getDoctorProfile,
  updateDoctorAvailability,
  updateDoctorSchedule,
};
