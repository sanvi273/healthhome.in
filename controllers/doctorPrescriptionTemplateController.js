const mongoose = require("mongoose");
const Doctor = require("../models/doctor");
const DoctorPrescriptionTemplate = require("../models/doctorPrescriptionTemplate");

const getOwnedDoctor = async (req) => {
  const user = req.verifiedUser;
  if (!user || user.role !== "doctor") return null;

  const ownerConditions = [{ userId: user._id }];
  if (user.phone) {
    ownerConditions.push(
      { phone: user.phone, userId: null },
      { phone: user.phone, userId: { $exists: false } },
    );
  }

  return Doctor.findOne({ $or: ownerConditions }).select("_id").lean();
};

const cleanText = (value, maxLength) =>
  String(value ?? "").trim().slice(0, maxLength);

const normalizeTemplate = (body = {}) => {
  const medicines = Array.isArray(body.medicines)
    ? body.medicines.slice(0, 40).map((medicine) => ({
        medicine: cleanText(medicine?.medicine, 180),
        dose: cleanText(medicine?.dose, 120),
        duration: cleanText(medicine?.duration, 120),
        food: cleanText(medicine?.food || "After Food", 40),
        instruction: cleanText(medicine?.instruction, 500),
        morning: medicine?.morning === true,
        afternoon: medicine?.afternoon === true,
        night: medicine?.night === true,
      }))
    : [];
  const labTests = Array.isArray(body.labTests)
    ? body.labTests.slice(0, 40).map((test) => ({
        testName: cleanText(test?.testName, 180),
        priority: ["Normal", "High", "Urgent"].includes(test?.priority)
          ? test.priority
          : "Normal",
        note: cleanText(test?.note, 500),
      }))
    : [];

  return {
    name: cleanText(body.name, 80),
    symptoms: cleanText(body.symptoms, 3000),
    diagnosis: cleanText(body.diagnosis, 2000),
    advice: cleanText(body.advice, 3000),
    medicines: medicines.filter((medicine) => medicine.medicine),
    labTests: labTests.filter((test) => test.testName),
  };
};

const validateTemplate = (template) => {
  if (!template.name) return "Enter a name for this prescription template.";
  if (
    !template.diagnosis &&
    !template.symptoms &&
    !template.advice &&
    template.medicines.length === 0 &&
    template.labTests.length === 0
  ) {
    return "Add diagnosis, advice, medicine, or lab test details before saving a template.";
  }
  return "";
};

exports.listDoctorPrescriptionTemplates = async (req, res) => {
  try {
    const doctor = await getOwnedDoctor(req);
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    const templates = await DoctorPrescriptionTemplate.find({ doctorId: doctor._id })
      .sort({ updatedAt: -1 })
      .lean();
    return res.json({ success: true, templates });
  } catch (error) {
    console.error("LIST DOCTOR PRESCRIPTION TEMPLATES ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load prescription templates." });
  }
};

exports.createDoctorPrescriptionTemplate = async (req, res) => {
  try {
    const doctor = await getOwnedDoctor(req);
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    const templateData = normalizeTemplate(req.body);
    const validationMessage = validateTemplate(templateData);
    if (validationMessage) {
      return res.status(400).json({ success: false, message: validationMessage });
    }

    const template = await DoctorPrescriptionTemplate.create({
      ...templateData,
      doctorId: doctor._id,
    });
    return res.status(201).json({ success: true, template });
  } catch (error) {
    console.error("CREATE DOCTOR PRESCRIPTION TEMPLATE ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to save this prescription template." });
  }
};

exports.updateDoctorPrescriptionTemplate = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.templateId)) {
      return res.status(400).json({ success: false, message: "Invalid template ID." });
    }

    const doctor = await getOwnedDoctor(req);
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    const templateData = normalizeTemplate(req.body);
    const validationMessage = validateTemplate(templateData);
    if (validationMessage) {
      return res.status(400).json({ success: false, message: validationMessage });
    }

    const template = await DoctorPrescriptionTemplate.findOneAndUpdate(
      { _id: req.params.templateId, doctorId: doctor._id },
      { $set: templateData },
      { new: true, runValidators: true },
    );
    if (!template) {
      return res.status(404).json({ success: false, message: "Prescription template not found." });
    }

    return res.json({ success: true, template });
  } catch (error) {
    console.error("UPDATE DOCTOR PRESCRIPTION TEMPLATE ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update this prescription template." });
  }
};

exports.deleteDoctorPrescriptionTemplate = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.templateId)) {
      return res.status(400).json({ success: false, message: "Invalid template ID." });
    }

    const doctor = await getOwnedDoctor(req);
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    const deleted = await DoctorPrescriptionTemplate.findOneAndDelete({
      _id: req.params.templateId,
      doctorId: doctor._id,
    });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Prescription template not found." });
    }

    return res.json({ success: true, message: "Prescription template deleted." });
  } catch (error) {
    console.error("DELETE DOCTOR PRESCRIPTION TEMPLATE ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Unable to delete this prescription template." });
  }
};
