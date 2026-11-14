const mongoose = require("mongoose");
const Doctor = require("../models/doctor");
const User = require("../models/user");

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

const getAuthenticatedDoctorUser = async (req) => {
  if (!req.user || !req.user.id) {
    return { error: { status: 401, message: "Authentication required" } };
  }

  const user = await User.findById(req.user.id);

  if (!user) {
    return { error: { status: 401, message: "User account not found" } };
  }

  if (user.role !== "doctor") {
    return { error: { status: 403, message: "Doctor account required" } };
  }

  return { user };
};

const requireApprovedDoctor = async (req) => {
  const result = await getAuthenticatedDoctorUser(req);
  if (result.error) return result;

  if (result.user.verificationStatus !== "APPROVED") {
    return {
      error: {
        status: 403,
        message: "Your professional verification must be approved before using this feature.",
        verificationStatus: result.user.verificationStatus,
      },
    };
  }

  return result;
};

const findOwnedDoctorProfile = async (doctorId, user) => {
  // New records use userId. Phone is retained as a compatibility path for
  // existing Doctor records created before userId was added.
  return Doctor.findOne({
    _id: doctorId,
    $or: [
      { userId: user._id },
      { userId: null, phone: user.phone },
      { userId: { $exists: false }, phone: user.phone },
    ],
  });
};

// ================= ADD / UPDATE DOCTOR =================
// Profile details may be saved while verification is pending.
// This endpoint does not grant dashboard or appointment-management access.

const addDoctor = async (req, res) => {
  try {
    const auth = await getAuthenticatedDoctorUser(req);
    if (auth.error) {
      return res.status(auth.error.status).json({
        success: false,
        message: auth.error.message,
      });
    }

    const user = auth.user;
    const {
      name,
      specialization,
      experience,
      fees,
      hospital,
      about,
    } = req.body;

    if (
      !name ||
      !specialization ||
      !experience ||
      fees === undefined ||
      fees === null ||
      String(fees).trim() === "" ||
      !hospital
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, specialization, experience, fees and hospital are required",
      });
    }

    if (!user.phone) {
      return res.status(400).json({
        success: false,
        message: "A phone number is missing from your user account",
      });
    }

    const profileFields = {
      userId: user._id,
      name: String(name).trim(),
      phone: user.phone,
      profileImageUrl: user.profileImage || "",
      profileImagePublicId: user.profileImagePublicId || "",
      specialization: String(specialization).trim(),
      experience: String(experience).trim(),
      fees: String(fees).trim(),
      hospital: String(hospital).trim(),
      about: about == null ? "" : String(about).trim(),
    };

    let doctor = await Doctor.findOne({
      $or: [
        { userId: user._id },
        { phone: user.phone },
      ],
    });

    if (doctor) {
      Object.assign(doctor, profileFields);
      await doctor.save();

      return res.status(200).json({
        success: true,
        message: "Doctor profile updated successfully",
        doctor,
        verificationStatus: user.verificationStatus,
      });
    }

    doctor = await Doctor.create(profileFields);

    return res.status(201).json({
      success: true,
      message: "Doctor profile saved successfully",
      doctor,
      verificationStatus: user.verificationStatus,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A doctor profile already exists for this phone number. Please contact support if it is not your profile.",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= GET APPROVED DOCTORS =================
// Public endpoint for patients. Only users with approved verification are listed.

const getDoctors = async (req, res) => {
  try {
    const approvedUsers = await User.find({
      role: "doctor",
      verificationStatus: "APPROVED",
      accountStatus: "ACTIVE",
    }).select("_id phone profileImage profileImagePublicId");

    if (approvedUsers.length === 0) {
      return res.status(200).json({ success: true, doctors: [] });
    }

    const approvedUserIds = approvedUsers.map((user) => user._id);
    const approvedPhones = approvedUsers
      .map((user) => user.phone)
      .filter(Boolean);

    const doctors = await Doctor.find({
      $or: [
        { userId: { $in: approvedUserIds } },
        { phone: { $in: approvedPhones } },
      ],
    }).sort({ createdAt: -1 });

    const usersById = new Map(
      approvedUsers.map((user) => [String(user._id), user]),
    );
    const usersByPhone = new Map(
      approvedUsers.filter((user) => user.phone).map((user) => [user.phone, user]),
    );
    const doctorsWithImages = doctors.map((doctor) => {
      const serialized = doctor.toObject();
      const owner =
        usersById.get(String(doctor.userId || "")) ||
        usersByPhone.get(doctor.phone);
      serialized.profileImageUrl =
        owner?.profileImage || serialized.profileImageUrl || "";
      serialized.profileImagePublicId =
        owner?.profileImagePublicId || serialized.profileImagePublicId || "";
      return serialized;
    });

    return res.status(200).json({
      success: true,
      doctors: doctorsWithImages,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= GET APPROVED DOCTOR PROFILE BY PHONE =================

const getDoctorProfile = async (req, res) => {
  try {
    const phone = String(req.params.phone || "").trim();

    const user = await User.findOne({
      phone,
      role: "doctor",
      verificationStatus: "APPROVED",
      accountStatus: "ACTIVE",
    }).select("_id profileImage profileImagePublicId");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Approved doctor profile not found",
      });
    }

    const doctor = await Doctor.findOne({
      phone,
      $or: [
        { userId: user._id },
        { userId: null },
        { userId: { $exists: false } },
      ],
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      doctor: {
        ...doctor.toObject(),
        profileImageUrl:
          user.profileImage || doctor.profileImageUrl || "",
        profileImagePublicId:
          user.profileImagePublicId || doctor.profileImagePublicId || "",
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= TURN AVAILABILITY ON / OFF =================
// Only the owning, approved doctor can change availability.

const updateDoctorAvailability = async (req, res) => {
  try {
    const auth = await requireApprovedDoctor(req);
    if (auth.error) {
      return res.status(auth.error.status).json({
        success: false,
        message: auth.error.message,
        verificationStatus: auth.error.verificationStatus,
      });
    }

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

    const doctor = await findOwnedDoctorProfile(doctorId, auth.user);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found for this account",
      });
    }

    doctor.isAvailable = isAvailable;
    await doctor.save();

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
// Only the owning, approved doctor can change their schedule.

const updateDoctorSchedule = async (req, res) => {
  try {
    const auth = await requireApprovedDoctor(req);
    if (auth.error) {
      return res.status(auth.error.status).json({
        success: false,
        message: auth.error.message,
        verificationStatus: auth.error.verificationStatus,
      });
    }

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

      if (!Number.isInteger(duration) || duration < 10 || duration > 120) {
        return res.status(400).json({
          success: false,
          message: "slotDurationMinutes must be an integer from 10 to 120",
        });
      }
      updates.slotDurationMinutes = duration;
    }

    if (maxAppointmentsPerDay !== undefined) {
      const limit = Number(maxAppointmentsPerDay);

      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({
          success: false,
          message: "maxAppointmentsPerDay must be from 1 to 100",
        });
      }
      updates.maxAppointmentsPerDay = limit;
    }

    const doctor = await findOwnedDoctorProfile(doctorId, auth.user);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found for this account",
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

module.exports = {
  addDoctor,
  getDoctors,
  getDoctorProfile,
  updateDoctorAvailability,
  updateDoctorSchedule,
};
