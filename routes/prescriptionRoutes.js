console.log("✅ prescriptionRoutes.js loaded");

const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const verificationMiddleware = require("../middleware/verificationMiddleware");
const {
  listDoctorPrescriptionTemplates,
  createDoctorPrescriptionTemplate,
  deleteDoctorPrescriptionTemplate,
} = require("../controllers/doctorPrescriptionTemplateController");

const {
  savePrescription,
  getPatientPrescriptions,
  downloadPrescription,
  sendPrescription,
} = require("../controllers/prescriptionController");

const router = express.Router();
const approvedDoctor = verificationMiddleware(["doctor"]);

router.get("/", (req, res) => {
  res.send("Prescription Root Working");
});

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Prescription Test Working",
  });
});

router.get(
  "/templates",
  authMiddleware,
  approvedDoctor,
  listDoctorPrescriptionTemplates,
);

router.post(
  "/templates",
  authMiddleware,
  approvedDoctor,
  createDoctorPrescriptionTemplate,
);

router.delete(
  "/templates/:templateId",
  authMiddleware,
  approvedDoctor,
  deleteDoctorPrescriptionTemplate,
);

router.post("/save", savePrescription);

router.get(
  "/patient/:patientId",
  getPatientPrescriptions
);

router.get(
  "/pdf/:id",
  downloadPrescription
);

router.put(
  "/send/:id",
  sendPrescription
);

module.exports = router;
