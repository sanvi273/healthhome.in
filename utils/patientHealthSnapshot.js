const Profile = require("../models/Profile");

const profileFields = "gender bloodGroup height weight";

const text = (value) => String(value ?? "").trim();

const calculateBmi = (heightCm, weightKg) => {
  const height = Number(heightCm);
  const weight = Number(weightKg);
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
    return "";
  }
  return (weight / ((height / 100) ** 2)).toFixed(1);
};

const fromProfile = (profile) => {
  const patientHeight = text(profile?.height);
  const patientWeight = text(profile?.weight);
  return {
    patientGender: text(profile?.gender),
    patientBloodGroup: text(profile?.bloodGroup),
    patientHeight,
    patientWeight,
    patientBmi: calculateBmi(patientHeight, patientWeight),
  };
};

const getPatientHealthSnapshot = async (patientPhone) => {
  const phone = text(patientPhone);
  if (!phone) return fromProfile(null);
  const profile = await Profile.findOne({ userId: phone })
    .select(profileFields)
    .lean();
  return fromProfile(profile);
};

const getPatientHealthSnapshots = async (patientPhones) => {
  const phones = [...new Set((patientPhones || []).map(text).filter(Boolean))];
  if (phones.length === 0) return new Map();
  const profiles = await Profile.find({ userId: { $in: phones } })
    .select(`userId ${profileFields}`)
    .lean();
  return new Map(
    profiles.map((profile) => [profile.userId, fromProfile(profile)]),
  );
};

module.exports = {
  calculateBmi,
  fromProfile,
  getPatientHealthSnapshot,
  getPatientHealthSnapshots,
};
