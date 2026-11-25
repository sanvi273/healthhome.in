const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/doctor");
const User = require("../models/user");
const ReconsultationOffer = require("../models/ReconsultationOffer");
const { getPatientHealthSnapshot } = require("../utils/patientHealthSnapshot");
const {
  formatAppointmentTime,
  getIndiaCurrentDateTime,
  normalizeConsultationType,
  parseAppointmentTime,
  parseCalendarDate,
  validateDoctorSlot,
} = require("../utils/doctorSchedule");

const MAX_OFFER_SLOTS = 6;
const PROCESSING_TIMEOUT_MS = 60_000;

function phoneSearchVariants(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const variants = new Set([raw, digits]);
  if (digits) variants.add(`+${digits}`);

  const nationalNumber =
    digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (nationalNumber.length === 10) {
    variants.add(nationalNumber);
    variants.add(`91${nationalNumber}`);
    variants.add(`+91${nationalNumber}`);
  }
  return [...variants].filter(Boolean);
}

function isFutureSlot(slot, indiaNow = getIndiaCurrentDateTime()) {
  const minutes = parseAppointmentTime(slot?.time);
  if (!parseCalendarDate(slot?.date) || minutes === null) return false;
  return (
    slot.date > indiaNow.date ||
    (slot.date === indiaNow.date && minutes > indiaNow.minutes)
  );
}

function offerExpiryForSlots(slots) {
  const lastDate = slots.map((slot) => slot.date).sort().pop();
  const parsed = parseCalendarDate(lastDate);
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
      18,
      30,
      0,
    ),
  );
}

async function getApprovedDoctor(req) {
  const user = await User.findById(req.user?.id);
  if (
    !user ||
    user.role !== "doctor" ||
    user.verificationStatus !== "APPROVED"
  ) {
    return null;
  }
  return user;
}

async function findOwnedDoctorProfile(doctorUser, appointment) {
  const doctorId = String(appointment.doctorId || "");
  const ownership = {
    $or: [
      { userId: doctorUser._id },
      { userId: null, phone: doctorUser.phone },
      { userId: { $exists: false }, phone: doctorUser.phone },
    ],
  };
  let doctor = mongoose.isValidObjectId(doctorId)
    ? await Doctor.findOne({ _id: doctorId, ...ownership })
    : null;

  if (!doctor && doctorId === String(doctorUser._id)) {
    doctor = await Doctor.findOne({ ...ownership });
  }
  return doctor;
}

async function findPatientForAppointment(appointment) {
  let patient = appointment.patientId
    ? await User.findById(appointment.patientId)
    : null;
  if (patient?.role === "patient") return patient;
  return User.findOne({
    role: "patient",
    phone: { $in: phoneSearchVariants(appointment.patientPhone) },
  });
}

function appointmentSummary(appointment) {
  return appointment?.toObject ? appointment.toObject() : appointment;
}

exports.createOrUpdateOffer = async (req, res) => {
  try {
    const doctorUser = await getApprovedDoctor(req);
    if (!doctorUser) {
      return res.status(403).json({
        success: false,
        message: "An approved doctor account is required",
      });
    }

    const appointmentId = String(req.params.appointmentId || "");
    if (!mongoose.isValidObjectId(appointmentId)) {
      return res.status(400).json({
        success: false,
        message: "A valid original appointment ID is required",
      });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }
    if (appointment.status !== "Completed") {
      return res.status(409).json({
        success: false,
        message: "A free reconsultation can be offered after the appointment is completed",
      });
    }

    const doctor = await findOwnedDoctorProfile(doctorUser, appointment);
    if (!doctor) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to offer a reconsultation for this appointment",
      });
    }

    const patient = await findPatientForAppointment(appointment);
    if (!patient) {
      return res.status(409).json({
        success: false,
        message: "The patient must have an account before a reconsultation can be offered",
      });
    }

    const requestedSlots = req.body?.slots;
    if (
      !Array.isArray(requestedSlots) ||
      requestedSlots.length < 1 ||
      requestedSlots.length > MAX_OFFER_SLOTS
    ) {
      return res.status(400).json({
        success: false,
        message: `Choose between one and ${MAX_OFFER_SLOTS} appointment times`,
      });
    }

    const consultationType = normalizeConsultationType(appointment.consultationType);
    const normalizedSlots = [];
    const seenSlots = new Set();
    for (const requestedSlot of requestedSlots) {
      const date = String(requestedSlot?.date || "").trim();
      const requestedMinutes = parseAppointmentTime(
        String(requestedSlot?.time || "").trim(),
      );
      if (!date || requestedMinutes === null) {
        return res.status(400).json({
          success: false,
          message: "Each reconsultation time must have a valid date and time",
        });
      }
      const time = formatAppointmentTime(requestedMinutes);
      const slotKey = `${date}|${time}`;
      if (seenSlots.has(slotKey)) continue;
      seenSlots.add(slotKey);

      const slotError = await validateDoctorSlot({
        doctor,
        date,
        time,
        consultationType,
        excludeAppointmentId: appointment._id,
      });
      if (slotError) {
        return res.status(409).json({
          success: false,
          message: `${date} at ${time}: ${slotError}`,
        });
      }
      normalizedSlots.push({ date, time });
    }

    if (normalizedSlots.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Choose at least one distinct appointment time",
      });
    }

    const existingOffer = await ReconsultationOffer.findOne({
      originalAppointmentId: appointment._id,
    });
    if (["Processing", "Requested"].includes(existingOffer?.status)) {
      return res.status(409).json({
        success: false,
        message: "The patient has already requested this reconsultation",
      });
    }

    const offerData = {
      doctorId: String(doctor._id),
      doctorName: appointment.doctorName || doctor.name,
      specialization: appointment.specialization || doctor.specialization || "",
      hospital: appointment.hospital || doctor.hospital || "",
      originalAppointmentDate: appointment.appointmentDate,
      originalAppointmentTime: appointment.appointmentTime,
      patientId: patient._id,
      patientName: appointment.patientName || patient.name,
      patientPhone: patient.phone || appointment.patientPhone,
      consultationType,
      slots: normalizedSlots,
      status: "Offered",
      expiresAt: offerExpiryForSlots(normalizedSlots),
      selectedSlot: { date: "", time: "" },
      processingAt: null,
      requestedAppointmentId: null,
    };

    let offer;
    if (existingOffer) {
      Object.assign(existingOffer, offerData);
      offer = await existingOffer.save();
    } else {
      offer = await ReconsultationOffer.create({
        ...offerData,
        originalAppointmentId: appointment._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Free reconsultation times sent to the patient",
      offer,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A reconsultation offer already exists for this appointment",
      });
    }
    console.error("CREATE RECONSULTATION OFFER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create the reconsultation offer",
    });
  }
};

exports.getPatientOffers = async (req, res) => {
  try {
    const patient = await User.findById(req.user?.id);
    if (!patient || patient.role !== "patient") {
      return res.status(403).json({
        success: false,
        message: "Patient account required",
      });
    }

    const offers = await ReconsultationOffer.find({
      patientId: patient._id,
      status: "Offered",
    }).sort({ createdAt: -1 });
    const indiaNow = getIndiaCurrentDateTime();
    const visibleOffers = [];

    for (const offer of offers) {
      const futureSlots = offer.slots.filter((slot) => isFutureSlot(slot, indiaNow));
      if (futureSlots.length === 0 || offer.expiresAt <= new Date()) {
        offer.status = "Expired";
        await offer.save();
        continue;
      }
      const data = offer.toObject();
      data.slots = futureSlots;
      visibleOffers.push(data);
    }

    return res.json({ success: true, offers: visibleOffers });
  } catch (error) {
    console.error("LOAD PATIENT RECONSULTATION OFFERS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load reconsultation offers",
    });
  }
};

exports.requestOffer = async (req, res) => {
  try {
    const patient = await User.findById(req.user?.id);
    if (!patient || patient.role !== "patient") {
      return res.status(403).json({
        success: false,
        message: "Patient account required",
      });
    }

    const offerId = String(req.params.offerId || "");
    if (!mongoose.isValidObjectId(offerId)) {
      return res.status(400).json({
        success: false,
        message: "A valid reconsultation offer ID is required",
      });
    }

    const offer = await ReconsultationOffer.findById(offerId);
    if (!offer || String(offer.patientId) !== String(patient._id)) {
      return res.status(404).json({
        success: false,
        message: "Reconsultation offer not found",
      });
    }

    const getExistingRequest = async () =>
      Appointment.findOne({ reconsultationOfferId: offer._id });
    if (offer.status === "Requested") {
      const existingAppointment = await getExistingRequest();
      if (existingAppointment) {
        return res.json({
          success: true,
          message: "Reconsultation request was already sent",
          appointment: appointmentSummary(existingAppointment),
        });
      }
      return res.status(409).json({
        success: false,
        message: "This reconsultation request is already being processed",
      });
    }

    if (offer.status === "Processing") {
      const existingAppointment = await getExistingRequest();
      if (existingAppointment) {
        offer.status = "Requested";
        offer.requestedAppointmentId = existingAppointment._id;
        offer.processingAt = null;
        await offer.save();
        return res.json({
          success: true,
          message: "Reconsultation request was already sent",
          appointment: appointmentSummary(existingAppointment),
        });
      }
      const processingIsStale =
        !offer.processingAt ||
        Date.now() - offer.processingAt.getTime() > PROCESSING_TIMEOUT_MS;
      if (!processingIsStale) {
        return res.status(409).json({
          success: false,
          message: "Your reconsultation request is being processed",
        });
      }
      offer.status = "Offered";
      offer.processingAt = null;
      await offer.save();
    }

    if (offer.status !== "Offered") {
      return res.status(409).json({
        success: false,
        message: "This reconsultation offer is no longer available",
      });
    }

    const selectedDate = String(req.body?.date || "").trim();
    const requestedMinutes = parseAppointmentTime(
      String(req.body?.time || "").trim(),
    );
    const selectedTime =
      requestedMinutes === null ? "" : formatAppointmentTime(requestedMinutes);
    const selectedSlot = offer.slots.find(
      (slot) => slot.date === selectedDate && slot.time === selectedTime,
    );
    if (!selectedSlot || !isFutureSlot(selectedSlot)) {
      return res.status(400).json({
        success: false,
        message: "Choose one of the future times offered by the doctor",
      });
    }

    const doctor = await Doctor.findById(offer.doctorId);
    if (!doctor) {
      return res.status(409).json({
        success: false,
        message: "The doctor's profile is no longer available",
      });
    }
    const slotError = await validateDoctorSlot({
      doctor,
      date: selectedSlot.date,
      time: selectedSlot.time,
      consultationType: offer.consultationType,
      excludeAppointmentId: offer.originalAppointmentId,
    });
    if (slotError) {
      return res.status(409).json({
        success: false,
        message: `That time is no longer available. ${slotError}`,
      });
    }

    const claimedOffer = await ReconsultationOffer.findOneAndUpdate(
      { _id: offer._id, status: "Offered" },
      {
        $set: {
          status: "Processing",
          processingAt: new Date(),
          selectedSlot: { date: selectedSlot.date, time: selectedSlot.time },
        },
      },
      { new: true },
    );
    if (!claimedOffer) {
      return res.status(409).json({
        success: false,
        message: "This reconsultation offer has already been accepted",
      });
    }

    try {
      const existingAppointment = await getExistingRequest();
      const originalAppointment = await Appointment.findById(
        offer.originalAppointmentId,
      ).select(
        "patientGender patientBloodGroup patientHeight patientWeight patientBmi doctorEmergencyNumber",
      ).lean();
      const profileHealth = await getPatientHealthSnapshot(
        patient.phone || offer.patientPhone,
      );
      const patientHealth = { ...profileHealth };
      for (const field of [
        "patientGender",
        "patientBloodGroup",
        "patientHeight",
        "patientWeight",
        "patientBmi",
      ]) {
        patientHealth[field] = originalAppointment?.[field] || patientHealth[field] || "";
      }
      const appointment = existingAppointment || await Appointment.create({
        patientName: patient.name || offer.patientName,
        patientPhone: patient.phone || offer.patientPhone,
        patientId: patient._id,
        doctorId: offer.doctorId,
        doctorName: offer.doctorName,
        doctorEmergencyNumber:
          doctor.emergencyNumber ||
          originalAppointment?.doctorEmergencyNumber ||
          doctor.phone ||
          "",
        ...patientHealth,
        specialization: offer.specialization,
        hospital: offer.hospital,
        fees: 0,
        consultationType: offer.consultationType,
        appointmentDate: selectedSlot.date,
        appointmentTime: selectedSlot.time,
        reports: [],
        meetingId: "",
        consultationStatus: "Pending",
        prescriptionSent: false,
        paymentStatus: "Paid",
        paymentMethod: "FREE_RECONSULTATION",
        status: "Pending",
        isReconsultation: true,
        reconsultationOfferId: offer._id,
        reconsultationForAppointmentId: offer.originalAppointmentId,
      });

      await ReconsultationOffer.updateOne(
        { _id: offer._id, status: "Processing" },
        {
          $set: {
            status: "Requested",
            requestedAppointmentId: appointment._id,
          },
          $unset: { processingAt: 1 },
        },
      );
      return res.status(existingAppointment ? 200 : 201).json({
        success: true,
        message: "Free reconsultation request sent to the doctor",
        appointment: appointmentSummary(appointment),
      });
    } catch (error) {
      const existingAppointment = await getExistingRequest();
      if (existingAppointment) {
        await ReconsultationOffer.updateOne(
          { _id: offer._id },
          {
            $set: {
              status: "Requested",
              requestedAppointmentId: existingAppointment._id,
            },
            $unset: { processingAt: 1 },
          },
        );
        return res.json({
          success: true,
          message: "Free reconsultation request sent to the doctor",
          appointment: appointmentSummary(existingAppointment),
        });
      }

      await ReconsultationOffer.updateOne(
        { _id: offer._id, status: "Processing" },
        {
          $set: { status: "Offered" },
          $unset: { processingAt: 1, selectedSlot: 1 },
        },
      );
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "That appointment time was just booked. Choose another offered time.",
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("REQUEST RECONSULTATION ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to send the reconsultation request",
    });
  }
};
