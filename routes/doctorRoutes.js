
const express = require("express");

const router = express.Router();

const {
  addDoctor,
  getDoctors,
  getDoctorProfile,
  updateDoctorAvailability,
  updateDoctorSchedule,
} = require("../controllers/doctorController");

// ================= TEST ROUTE =================

router.get("/test", (req, res) => {
  res.send("Doctor route working");
});

// ================= ADD / UPDATE DOCTOR =================

router.post("/add", addDoctor);

// ================= GET ALL DOCTORS =================

router.get("/all", getDoctors);

// ================= GET DOCTOR PROFILE BY PHONE =================

router.get("/profile/:phone", getDoctorProfile);

// ================= UPDATE DOCTOR AVAILABILITY =================

router.put("/availability/:doctorId", updateDoctorAvailability);

// ================= UPDATE DOCTOR WORKING SCHEDULE =================

router.put("/schedule/:doctorId", updateDoctorSchedule);

module.exports = router;
