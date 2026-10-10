const express = require("express");

const router =
  express.Router();

// ============================================================
// CONTROLLERS
// ============================================================

const {
  bookAppointment,
  getAvailableSlots,
  getAppointments,
  getDoctorAppointments,
  getPatientAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  updatePaymentStatus,
  deleteAppointment,
  startConsultation,
  joinConsultation,
  checkReadyConsultation,
  completeConsultation,
  generateAgoraToken,
  proposeReschedule,
  respondToReschedule,
} = require("../controllers/appointmentController");

// ============================================================
// AGORA VIDEO TOKEN
// ============================================================

router.post(
  "/agora-token",
  generateAgoraToken
);

// ============================================================
// UPLOAD MIDDLEWARE
// ============================================================

const upload =
  require("../middleware/upload");

// ============================================================
// BOOK APPOINTMENT
// POST
// /api/appointments/book
// ============================================================

router.post(
  "/book",

  upload.array("reports"),

  bookAppointment
);

// ============================================================
// GET ALL APPOINTMENTS
// GET
// /api/appointments/all
// ============================================================

router.get(
  "/all",

  getAppointments
);

// ============================================================
// GET AVAILABLE SLOTS
// GET
// /api/appointments/available-slots/:doctorId/:date
//
// IMPORTANT:
// This route MUST come before /:id
// ============================================================

router.get(
  "/available-slots/:doctorId/:date",

  getAvailableSlots
);

// ============================================================
// GET DOCTOR APPOINTMENTS
// GET
// /api/appointments/doctor/:doctorId
// ============================================================

router.get(
  "/doctor/:doctorId",

  getDoctorAppointments
);

// ============================================================
// GET PATIENT APPOINTMENTS
// GET
// /api/appointments/patient/:patientPhone
// ============================================================

router.get(
  "/patient/:patientPhone",

  getPatientAppointments
);

// ============================================================
// CHECK READY VIDEO CONSULTATION
// GET
// /api/appointments/ready/:patientPhone
// ============================================================

router.get(
  "/ready/:patientPhone",

  checkReadyConsultation
);

// ============================================================
// UPDATE APPOINTMENT STATUS
// PUT
// /api/appointments/status/:id
// ============================================================

router.put(
  "/status/:id",

  updateAppointmentStatus
);

// ============================================================
// UPDATE PAYMENT STATUS
// PUT
// /api/appointments/payment/:id
// ============================================================

router.put(
  "/payment/:id",

  updatePaymentStatus
);

// ============================================================
// START VIDEO CONSULTATION
// PUT
// /api/appointments/start-consultation/:id
// ============================================================

router.put(
  "/start-consultation/:id",

  startConsultation
);

// ============================================================
// JOIN VIDEO CONSULTATION
// PUT
// /api/appointments/join/:id
// ============================================================

router.put(
  "/join/:id",

  joinConsultation
);

// ============================================================
// COMPLETE VIDEO CONSULTATION
// PUT
// /api/appointments/complete/:id
// ============================================================

router.put(
  "/complete/:id",

  completeConsultation
);

// ============================================================
// DOCTOR PROPOSES A NEW APPOINTMENT TIME
// PUT /api/appointments/:id/propose-reschedule
// ============================================================

router.put(
  "/:id/propose-reschedule",
  proposeReschedule
);

// ============================================================
// PATIENT RESPONDS TO A RESCHEDULE PROPOSAL
// PUT /api/appointments/:id/respond-reschedule
// ============================================================

router.put(
  "/:id/respond-reschedule",
  respondToReschedule
);
// ============================================================
// DELETE APPOINTMENT
// DELETE
// /api/appointments/:id
// ============================================================

router.delete(
  "/:id",

  deleteAppointment
);

// ============================================================
// GET SINGLE APPOINTMENT
// GET
// /api/appointments/:id
//
// Keep this AFTER all specific routes.
// ============================================================

router.get(
  "/:id",

  getAppointmentById
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;