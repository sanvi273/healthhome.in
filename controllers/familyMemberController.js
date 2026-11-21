const mongoose = require("mongoose");
const FamilyMember = require("../models/FamilyMember");
const User = require("../models/user");

const RELATIONSHIPS = new Set([
  "Mother",
  "Father",
  "Spouse",
  "Son",
  "Daughter",
  "Brother",
  "Sister",
  "Grandparent",
  "Other",
]);
const GENDERS = new Set(["", "Male", "Female", "Other", "Prefer not to say"]);
const TEXT_LIMITS = {
  name: 100,
  relationship: 32,
  gender: 32,
  phone: 20,
  bloodGroup: 10,
  address: 1000,
  allergies: 2000,
  medicalConditions: 2000,
  notes: 2000,
};

class InputValidationError extends Error {}

const patientForRequest = async (req) => {
  const user = await User.findById(req.user?.id).select("_id role");
  return user?.role === "patient" ? user : null;
};

const cleanText = (value, field) => {
  if (value == null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new InputValidationError(`${field} must be text.`);
  }
  const cleaned = String(value).trim();
  if (cleaned.length > TEXT_LIMITS[field]) {
    throw new InputValidationError(`${field} cannot exceed ${TEXT_LIMITS[field]} characters.`);
  }
  return cleaned;
};

const prepareMember = (body = {}, existing = {}) => {
  const merged = { ...existing, ...body };
  const name = cleanText(merged.name, "name");
  const relationship = cleanText(merged.relationship, "relationship");
  if (!name) throw new InputValidationError("Enter the family member's name.");
  if (!RELATIONSHIPS.has(relationship)) {
    throw new InputValidationError("Choose a valid family relationship.");
  }

  const gender = cleanText(merged.gender, "gender");
  if (!GENDERS.has(gender)) throw new InputValidationError("Choose a valid gender.");

  let dateOfBirth = null;
  if (merged.dateOfBirth) {
    dateOfBirth = new Date(merged.dateOfBirth);
    if (!Number.isFinite(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
      throw new InputValidationError("Enter a valid date of birth in the past.");
    }
    const age = new Date().getFullYear() - dateOfBirth.getFullYear();
    if (age > 120) {
      throw new InputValidationError("Date of birth cannot be more than 120 years ago.");
    }
  }

  const measurement = (value, field, maximum) => {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
      throw new InputValidationError(`Enter a valid ${field}.`);
    }
    return parsed;
  };

  return {
    name,
    relationship,
    dateOfBirth,
    gender,
    phone: cleanText(merged.phone, "phone"),
    bloodGroup: cleanText(merged.bloodGroup, "bloodGroup"),
    height: measurement(merged.height, "height", 300),
    weight: measurement(merged.weight, "weight", 500),
    address: cleanText(merged.address, "address"),
    allergies: cleanText(merged.allergies, "allergies"),
    medicalConditions: cleanText(merged.medicalConditions, "medicalConditions"),
    notes: cleanText(merged.notes, "notes"),
  };
};

exports.getMyFamilyMembers = async (req, res) => {
  try {
    const patient = await patientForRequest(req);
    if (!patient) {
      return res.status(403).json({ success: false, message: "Patient account required." });
    }
    const members = await FamilyMember.find({ patientId: patient._id }).sort({
      createdAt: -1,
    });
    return res.status(200).json({ success: true, members });
  } catch (error) {
    console.error("LOAD FAMILY MEMBERS FAILED", error.name || "DatabaseError");
    return res.status(500).json({ success: false, message: "Unable to load family members." });
  }
};

exports.createFamilyMember = async (req, res) => {
  try {
    const patient = await patientForRequest(req);
    if (!patient) {
      return res.status(403).json({ success: false, message: "Patient account required." });
    }
    const memberData = prepareMember(req.body);
    const count = await FamilyMember.countDocuments({ patientId: patient._id });
    if (count >= 30) {
      return res.status(400).json({ success: false, message: "You can save up to 30 family members." });
    }
    const member = await FamilyMember.create({ patientId: patient._id, ...memberData });
    return res.status(201).json({ success: true, message: "Family member added.", member });
  } catch (error) {
    const isValidation = error instanceof InputValidationError;
    return res.status(isValidation ? 400 : 500).json({
      success: false,
      message: isValidation ? error.message : "Unable to add this family member.",
    });
  }
};

exports.updateFamilyMember = async (req, res) => {
  try {
    const patient = await patientForRequest(req);
    if (!patient) {
      return res.status(403).json({ success: false, message: "Patient account required." });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid family member ID." });
    }
    const member = await FamilyMember.findOne({ _id: req.params.id, patientId: patient._id });
    if (!member) {
      return res.status(404).json({ success: false, message: "Family member not found." });
    }
    member.set(prepareMember(req.body, member.toObject()));
    await member.save();
    return res.status(200).json({ success: true, message: "Family member updated.", member });
  } catch (error) {
    const isValidation = error instanceof InputValidationError;
    return res.status(isValidation ? 400 : 500).json({
      success: false,
      message: isValidation ? error.message : "Unable to update this family member.",
    });
  }
};

exports.deleteFamilyMember = async (req, res) => {
  try {
    const patient = await patientForRequest(req);
    if (!patient) {
      return res.status(403).json({ success: false, message: "Patient account required." });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid family member ID." });
    }
    const member = await FamilyMember.findOneAndDelete({
      _id: req.params.id,
      patientId: patient._id,
    });
    if (!member) {
      return res.status(404).json({ success: false, message: "Family member not found." });
    }
    return res.status(200).json({ success: true, message: "Family member removed." });
  } catch (error) {
    console.error("DELETE FAMILY MEMBER FAILED", error.name || "DatabaseError");
    return res.status(500).json({ success: false, message: "Unable to remove this family member." });
  }
};
