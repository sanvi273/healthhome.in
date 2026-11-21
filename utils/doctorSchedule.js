const Appointment = require("../models/Appointment");
const Payment = require("../models/Payment");

const CONSULTATION_TYPES = ["Video Consultation", "Hospital Visit"];

const normalizeConsultationType = (value) =>
  String(value || "").trim().toLowerCase() === "video consultation"
    ? "Video Consultation"
    : "Hospital Visit";

const scheduleKeyForType = (consultationType) =>
  normalizeConsultationType(consultationType) === "Video Consultation"
    ? "videoConsultation"
    : "hospitalVisit";

const parseAppointmentTime = (value) => {
  if (typeof value !== "string") return null;
  const input = value.trim();
  let match = /^(\d{1,2}):(\d{2})$/.exec(input);
  if (match) {
    const h = Number(match[1]);
    const m = Number(match[2]);
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  }
  match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(input);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 1 || h > 12 || m > 59) return null;
  h = h % 12 + (/PM/i.test(match[3]) ? 12 : 0);
  return h * 60 + m;
};

const formatAppointmentTime = (minutes) => {
  const h24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${period}`;
};

const parseCalendarDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day ? date : null;
};

const getDoctorSlotConfig = (doctor, consultationType) => {
  const scheduleKey = scheduleKeyForType(consultationType);
  const schedules = doctor?.consultationSchedules;
  const nestedSchedule = schedules?.[scheduleKey];
  // Doctors with an older profile keep using their existing shared hours
  // until they save the new separate schedules.
  const schedule = nestedSchedule || doctor;
  const start = parseAppointmentTime(schedule?.startTime);
  const end = parseAppointmentTime(schedule?.endTime);
  const breakStart = schedule?.breakStart
    ? parseAppointmentTime(schedule.breakStart)
    : null;
  const breakEnd = schedule?.breakEnd
    ? parseAppointmentTime(schedule.breakEnd)
    : null;
  const duration = Number(schedule?.slotDurationMinutes);
  const workingDays = Array.isArray(schedule?.workingDays)
    ? schedule.workingDays
    : [];

  if (
    start === null || end === null || start >= end ||
    (Boolean(schedule?.breakStart) !== Boolean(schedule?.breakEnd)) ||
    (breakStart !== null && breakEnd !== null && breakStart >= breakEnd) ||
    !Number.isFinite(duration) || duration <= 0 || workingDays.length === 0
  ) return null;

  return { start, end, breakStart, breakEnd, duration, workingDays };
};

const expireStaleVideoReservations = async (doctorId, date) => {
  const filter = {
    doctorId: String(doctorId),
    appointmentDate: String(date),
    consultationType: "Video Consultation",
    status: "Pending",
    paymentStatus: "Pending",
    createdAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) },
  };
  const staleAppointments = await Appointment.find(filter).select("_id").lean();
  if (staleAppointments.length === 0) return;

  const appointmentIds = staleAppointments.map((appointment) => String(appointment._id));
  await Appointment.updateMany(filter, {
    $set: { status: "Cancelled", paymentStatus: "Failed" },
  });
  await Payment.updateMany(
    { appointmentId: { $in: appointmentIds }, status: "Pending" },
    {
      $set: {
        status: "Cancelled",
        paymentStatus: "CANCELLED",
        verificationStatus: "SKIPPED",
        failureReason: "Video consultation checkout expired before payment.",
      },
    },
  );
};

const validateDoctorSlot = async ({
  doctor,
  date,
  time,
  consultationType = "Hospital Visit",
  excludeAppointmentId,
}) => {
  if (!doctor || doctor.isAvailable === false) {
    return "Doctor is not accepting appointments.";
  }

  const parsedDate = parseCalendarDate(date);
  if (!parsedDate) return "Date must be valid and use YYYY-MM-DD format.";
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  if (parsedDate < todayUtc) return "Past appointment dates are not allowed.";

  const config = getDoctorSlotConfig(doctor, consultationType);
  if (!config) return "Doctor's schedule is incomplete or invalid.";
  const dayIndex = parsedDate.getUTCDay();
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
  if (!config.workingDays.some((day) => String(day).trim().toLowerCase() === dayName.toLowerCase())) {
    return "Doctor is not available on the selected day.";
  }

  const requestedMinutes = parseAppointmentTime(time);
  if (requestedMinutes === null) return "Invalid appointment time.";
  if (
    requestedMinutes < config.start || requestedMinutes >= config.end ||
    (requestedMinutes - config.start) % config.duration !== 0 ||
    requestedMinutes + config.duration > config.end
  ) return "Selected time is not a valid appointment slot.";

  if (
    config.breakStart !== null && config.breakEnd !== null &&
    requestedMinutes < config.breakEnd &&
    requestedMinutes + config.duration > config.breakStart
  ) return "Selected time overlaps the doctor's break.";

  // Only unpaid video checkouts are temporary reservations. Hospital visit
  // requests remain reserved until the doctor accepts or rejects them.
  await expireStaleVideoReservations(doctor._id, date);

  const activeAppointments = await Appointment.find({
    doctorId: String(doctor._id),
    appointmentDate: date,
    status: { $in: ["Pending", "Upcoming", "Accepted"] },
    ...(excludeAppointmentId ? { _id: { $ne: excludeAppointmentId } } : {}),
  }).select("appointmentTime consultationType");

  const dailyAppointments = activeAppointments.filter((appointment) =>
    normalizeConsultationType(appointment.consultationType) ===
      normalizeConsultationType(consultationType)
  );
  const dailyLimit = Number(doctor.consultationSchedules?.[scheduleKeyForType(consultationType)]?.maxAppointmentsPerDay || doctor.maxAppointmentsPerDay || 10);
  if (dailyAppointments.length >= dailyLimit) {
    return "Doctor's daily appointment limit has been reached.";
  }

  const requestedEnd = requestedMinutes + config.duration;
  const overlapsExisting = activeAppointments.some((appointment) => {
    const bookedStart = parseAppointmentTime(appointment.appointmentTime);
    if (bookedStart === null) return false;
    const bookedConfig = getDoctorSlotConfig(doctor, appointment.consultationType);
    const bookedDuration = bookedConfig?.duration || config.duration;
    return bookedStart < requestedEnd && bookedStart + bookedDuration > requestedMinutes;
  });
  if (overlapsExisting) return "This appointment slot is already booked.";
  return null;
};

module.exports = {
  CONSULTATION_TYPES,
  normalizeConsultationType,
  scheduleKeyForType,
  parseAppointmentTime,
  formatAppointmentTime,
  parseCalendarDate,
  getDoctorSlotConfig,
  expireStaleVideoReservations,
  validateDoctorSlot,
};
