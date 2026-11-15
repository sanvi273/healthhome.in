const express = require("express");
const router = express.Router();

const {
  addDoctor,
  getDoctors,
  getDoctorProfile,
  updateDoctorAvailability,
  updateDoctorSchedule,
} = require("../controllers/doctorController");

const authMiddleware = require("../middleware/authMiddleware");
const verificationMiddleware = require("../middleware/verificationMiddleware");
const approvedDoctor = verificationMiddleware(["doctor"]);

// ================= TEST ROUTE =================

router.get("/test", (req, res) => {
  res.send("Doctor route working");
});

// ================= ADD / UPDATE DOCTOR =================
// Authenticated doctor only. Pending doctors may save their profile,
// but the controller does not grant them approved-only operations.

router.post("/add", authMiddleware, approvedDoctor, addDoctor);

// ================= GET ALL APPROVED DOCTORS =================
// Public patient-facing endpoint; controller filters to approved users.

router.get("/all", getDoctors);

// ================= GET APPROVED DOCTOR PROFILE BY PHONE =================

router.get("/profile/:phone", getDoctorProfile);

// ================= UPDATE DOCTOR AVAILABILITY =================
// Requires authentication and APPROVED verification in the controller.

router.put(
  "/availability/:doctorId",
  authMiddleware,
  approvedDoctor,
  updateDoctorAvailability
);

// ================= UPDATE DOCTOR WORKING SCHEDULE =================
// Requires authentication and APPROVED verification in the controller.

router.put(
  "/schedule/:doctorId",
  authMiddleware,
  approvedDoctor,
  updateDoctorSchedule
);

module.exports = router;
