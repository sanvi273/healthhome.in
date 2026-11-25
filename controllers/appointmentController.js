const Appointment = require("../models/Appointment");
const VideoCallSession = require("../models/VideoCallSession");
const User = require("../models/user");
const Payment = require("../models/Payment");

const {

  RtcTokenBuilder,

  RtcRole,

} = require("agora-token");

const {
  uploadPatientReport,
  getPatientReportBytes,
  isAllowedLegacyCloudinaryUrl,
} = require("../utils/patientReportStorage");
const {
  normalizeConsultationType,
  parseAppointmentTime,
  formatAppointmentTime,
  parseCalendarDate,
  getIndiaCurrentDateTime,
  getDoctorSlotConfig,
  expireStaleVideoReservations,
  validateDoctorSlot,
} = require("../utils/doctorSchedule");

// Shared helpers for consistent appointment slot validation.
const Doctor = require("../models/doctor");
const { getDoctorConsultationFee } = require("../utils/doctorConsultationFees");

const appointmentWithoutReports = (appointment) => {
  const data =
    typeof appointment?.toObject === "function"
      ? appointment.toObject()
      : { ...appointment };
  delete data.reports;
  return data;
};

const appointmentForDoctorSchedule = (appointment) => {
  const data =
    typeof appointment?.toObject === "function"
      ? appointment.toObject()
      : { ...appointment };
  data.reports = (Array.isArray(data.reports) ? data.reports : []).map((raw) => {
    const report =
      raw && typeof raw.toObject === "function"
        ? raw.toObject()
        : raw && typeof raw === "object"
          ? raw
          : {};
    const reportId = String(report._id || "");
    const hasPrivateStorageReference = Boolean(
      report.storagePublicId && report.resourceType && report.fileFormat
    );
    const legacyUrl =
      report.fileUrl ||
      report.secure_url ||
      report.secureUrl ||
      report.reportUrl ||
      report.url ||
      "";

    return {
      _id: reportId,
      fileName: String(report.fileName || "Patient Report"),
      fileType: String(report.fileType || ""),
      uploadedAt: report.uploadedAt || null,
      canView: Boolean(
        reportId &&
          (hasPrivateStorageReference ||
            isAllowedLegacyCloudinaryUrl(legacyUrl))
      ),
    };
  });
  return data;
};

// ============================================================

// BOOK APPOINTMENT

// ============================================================

exports.bookAppointment =

  async (req, res) => {

    try {

      const {

        patientName,

        patientPhone,

        doctorId,

        doctorName,

        specialization,

        hospital,

        consultationType,

        appointmentDate,

        appointmentTime,

        paymentStatus,

        razorpayOrderId,

        paymentId,

      } = req.body;

      // ========================================================

      // NORMALIZE CONSULTATION TYPE

      // ========================================================

      // ========================================================

      // REQUIRED FIELDS

      // ========================================================

      if (

        !patientName ||

        !patientPhone ||

        !doctorId ||

        !doctorName ||

        !appointmentDate ||

        !appointmentTime

      ) {

        return res.status(400).json({

          success: false,

          message:

            "Patient, doctor ID, doctor name, date and time are required",

        });

      }

      // ========================================================

      // VALIDATE CONSULTATION TYPE

      // ========================================================

      const finalConsultationType = normalizeConsultationType(consultationType);

      if (finalConsultationType === "Video Consultation") {
        return res.status(400).json({
          success: false,
          message: "Video consultations must be booked through the online payment flow.",
        });
      }

      // ========================================================

      // FINAL CONSULTATION TYPE

      // ========================================================

      // ========================================================

      // CHECK DUPLICATE SLOT

      // ========================================================

      const doctorForBooking = await Doctor.findById(doctorId.toString());
      if (!doctorForBooking) {
        return res.status(404).json({ success: false, message: "Doctor not found" });
      }
      const consultationFee = getDoctorConsultationFee(
        doctorForBooking,
        finalConsultationType,
      );
      if (consultationFee === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid doctor consultation fee in database.",
        });
      }

      const normalizedAppointmentTimeMinutes = parseAppointmentTime(appointmentTime);
      if (normalizedAppointmentTimeMinutes === null) {
        return res.status(400).json({ success: false, message: "Invalid appointment time" });
      }
      const normalizedAppointmentTime = formatAppointmentTime(normalizedAppointmentTimeMinutes);
      const slotError = await validateDoctorSlot({
        doctor: doctorForBooking,
        date: appointmentDate,
        time: normalizedAppointmentTime,
        consultationType: finalConsultationType,
      });
      if (slotError) {
        return res.status(400).json({ success: false, message: slotError });
      }

      const existingAppointment =

        await Appointment.findOne({

          doctorId:

            doctorId.toString(),

          appointmentDate,

          appointmentTime: normalizedAppointmentTime,

          status: {

            $in: [

              "Pending",

              "Upcoming",

              "Accepted",

            ],

          },

        });

      if (existingAppointment) {

        return res.status(409).json({

          success: false,

          message:

            "This doctor has already been booked for this time slot",

        });

      }

      // ========================================================

      // UPLOAD PATIENT REPORTS

      // ========================================================

      const uploadedReports = [];

      if (

        req.files &&

        req.files.length > 0

      ) {

        for (

          const file of req.files

        ) {

          uploadedReports.push(await uploadPatientReport(file));

        }

      }

      // ========================================================

      // CREATE APPOINTMENT

      // ========================================================

      // ========================================================

      // SAVE APPOINTMENT

      // ========================================================

      const appointment =

        await Appointment.create({

          // ---------------- Patient ----------------

          patientName,

          patientPhone,

          // ---------------- Doctor ----------------

          doctorId:

            doctorId.toString(),

          doctorName,

          specialization:

            specialization || "",

          hospital:

            hospital || "",

          fees: consultationFee,

          // ---------------- Appointment ----------------

          consultationType:

            finalConsultationType,

          appointmentDate,

          appointmentTime: normalizedAppointmentTime,

          // ---------------- Reports ----------------

          reports:

            uploadedReports,

          // ---------------- Payment ----------------

          paymentStatus:

            "Pending",

          paymentMethod: "AT_HOSPITAL",

          razorpayOrderId:

            razorpayOrderId || "",

          paymentId:

            paymentId || "",

          // ---------------- Appointment Status ----------------

          status: "Pending",

          // ---------------- Video Consultation ----------------

          meetingId: "",

          consultationStatus:

            "Pending",

          prescriptionSent:

            false,

        });

      // ========================================================

      // VERIFY SAVED CONSULTATION TYPE

      // ========================================================

      console.log("=================================");

      console.log("SAVED APPOINTMENT");

      console.log(

        "saved _id =",

        appointment._id

      );

      console.log(

        "saved doctorId =",

        appointment.doctorId

      );

      console.log(

        "saved doctorName =",

        appointment.doctorName

      );

      console.log(

        "saved consultationType =",

        appointment.consultationType

      );

      console.log(

        "saved consultationType JSON =",

        JSON.stringify(

          appointment.consultationType

        )

      );

      console.log(

        "saved consultationStatus =",

        appointment.consultationStatus

      );

      console.log(

        "saved status =",

        appointment.status

      );

      console.log("=================================");

      // ========================================================

      // RESPONSE

      // ========================================================

      return res.status(201).json({

        success: true,

        message:

          "Appointment booked successfully",

        appointment: appointmentWithoutReports(appointment),

      });

    } catch (error) {

      console.log(

        "BOOK APPOINTMENT ERROR:",

        error

      );

      // ========================================================

      // DUPLICATE MONGODB INDEX

      // ========================================================

      if (error.code === 11000) {

        return res.status(409).json({

          success: false,

          message:

            "This doctor appointment slot is already booked",

        });

      }

      // ========================================================

      // SERVER ERROR

      // ========================================================

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// GET AVAILABLE APPOINTMENT SLOTS

//

// GET

// /api/appointments/available-slots/:doctorId/:date

//

// Returns all predefined slots with available=true/false.

//

// Active appointments:

// Pending

// Upcoming

// Accepted

//

// Cancelled and Rejected do not block the slot.

// ============================================================

// ============================================================

// GET AVAILABLE APPOINTMENT SLOTS

// GET /api/appointments/available-slots/:doctorId/:date

// ============================================================

exports.getAvailableSlots = async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || "").trim();
    const appointmentDate = String(req.params.date || "").trim();
    const consultationType = normalizeConsultationType(req.query.consultationType);
    if (!doctorId || !appointmentDate) {
      return res.status(400).json({ success: false, message: "Doctor ID and appointment date are required" });
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }

    const config = getDoctorSlotConfig(doctor, consultationType, appointmentDate);
    if (!config) {
      return res.status(400).json({ success: false, message: "Invalid doctor's schedule for this consultation type" });
    }
    const requestedDate = parseCalendarDate(appointmentDate);
    if (!requestedDate) {
      return res.status(400).json({ success: false, message: "Date must be valid and use YYYY-MM-DD format" });
    }

    const indiaNow = getIndiaCurrentDateTime();
    if (appointmentDate < indiaNow.date) {
      return res.status(200).json({ success: true, doctorId, date: appointmentDate, consultationType, slots: [] });
    }

    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][requestedDate.getUTCDay()];
    const isWorkingDay = config.workingDays.some((day) => String(day).trim().toLowerCase() === dayName.toLowerCase());
    if (!isWorkingDay || doctor.isAvailable === false) {
      return res.status(200).json({
        success: true,
        doctorId,
        date: appointmentDate,
        consultationType,
        slots: [],
        message: "Doctor is unavailable on this date",
      });
    }

    await expireStaleVideoReservations(doctorId, appointmentDate);

    const bookedAppointments = await Appointment.find({
      doctorId,
      appointmentDate,
      status: { $in: ["Pending", "Upcoming", "Accepted"] },
    }).select("appointmentTime consultationType paymentStatus status");

    const appointmentsForType = bookedAppointments.filter((appointment) =>
      normalizeConsultationType(appointment.consultationType) === consultationType &&
      (consultationType !== "Video Consultation" || appointment.paymentStatus === "Paid")
    );
    const scheduleKey = consultationType === "Video Consultation" ? "videoConsultation" : "hospitalVisit";
    const dailyLimit = Number(
      doctor.consultationSchedules?.[scheduleKey]?.maxAppointmentsPerDay ||
      doctor.maxAppointmentsPerDay ||
      10
    );
    const dailyLimitReached = appointmentsForType.length >= dailyLimit;

    const bookedRanges = bookedAppointments
      .map((appointment) => {
        const bookedStart = parseAppointmentTime(appointment.appointmentTime);
        const bookedConfig = getDoctorSlotConfig(doctor, appointment.consultationType, appointmentDate);
        const bookedDuration = bookedConfig?.duration || config.duration;
        if (bookedStart === null) return null;
        const isAwaitingPayment =
          normalizeConsultationType(appointment.consultationType) === "Video Consultation" &&
          appointment.paymentStatus !== "Paid" &&
          appointment.status === "Pending";
        return {
          start: bookedStart,
          end: bookedStart + bookedDuration,
          reason: isAwaitingPayment ? "payment_pending" : "booked",
        };
      })
      .filter(Boolean);

    const slots = [];
    for (let time = config.start; time + config.duration <= config.end; time += config.duration) {
      // The app stores appointment dates and times in the doctor's local
      // calendar (India). Hide slots that have already started today.
      if (appointmentDate === indiaNow.date && time <= indiaNow.minutes) continue;
      const slotEnd = time + config.duration;
      const overlapsBreak = config.breakStart !== null && config.breakEnd !== null &&
        time < config.breakEnd && slotEnd > config.breakStart;
      if (overlapsBreak) continue;

      const overlappingReservation = bookedRanges.find(({ start, end }) =>
        start < slotEnd && end > time
      );
      const isBooked = Boolean(overlappingReservation);
      slots.push({
        time: formatAppointmentTime(time),
        available: !dailyLimitReached && !isBooked,
        unavailableReason: overlappingReservation?.reason ||
          (dailyLimitReached ? "daily_limit" : null),
      });
    }

    return res.status(200).json({
      success: true,
      doctorId,
      date: appointmentDate,
      consultationType,
      slots,
      ...(dailyLimitReached ? { message: "Doctor's daily appointment limit has been reached" } : {}),
    });
  } catch (error) {
    console.error("GET AVAILABLE SLOTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load available slots",
      error: error.message,
    });
  }
};
// GET ALL APPOINTMENTS

// ============================================================

exports.getAppointments =

  async (req, res) => {

    try {

      const appointments =

        await Appointment.find()

          .select("-reports")

          .sort({

            createdAt: -1,

          });

      return res.json({

        success: true,

        appointments,

      });

    } catch (error) {

      console.log(

        "GET ALL APPOINTMENTS ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// GET APPOINTMENTS BY DOCTOR ID

// ============================================================

exports.getDoctorAppointments =

  async (req, res) => {

    try {

      const doctorId =

        req.params.doctorId

          ?.toString()

          .trim();

      if (!doctorId) {

        return res.status(400).json({

          success: false,

          message:

            "Doctor ID is required",

        });

      }

      if (!/^[a-f\d]{24}$/i.test(doctorId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid doctor ID",
        });
      }

      const authenticatedUser = await User.findById(req.user?.id);
      if (!authenticatedUser || authenticatedUser.role !== "doctor") {
        return res.status(403).json({
          success: false,
          message: "Doctor account required",
        });
      }

      if (authenticatedUser.verificationStatus !== "APPROVED") {
        return res.status(403).json({
          success: false,
          message: "Doctor verification must be approved to view appointments",
        });
      }

      // --------------------------------------------------------

      // FIND DOCTOR

      // --------------------------------------------------------

      const Doctor =

        require("../models/doctor");

      const doctor = await Doctor.findOne({
        _id: doctorId,
        $or: [
          { userId: authenticatedUser._id },
          { userId: null, phone: authenticatedUser.phone },
          {
            userId: { $exists: false },
            phone: authenticatedUser.phone,
          },
        ],
      });

      if (!doctor) {

        return res.status(404).json({

          success: false,

          message:

            "Doctor not found",

        });

      }

      const doctorName =

        doctor.name

          ?.toString()

          .trim();

      const doctorNameIsUnique =
        (await Doctor.countDocuments({ name: doctorName })) === 1;

      const appointmentConditions = [{ doctorId }];
      if (doctorNameIsUnique) {
        appointmentConditions.push({
          $and: [
            {
              $or: [
                { doctorId: { $exists: false } },
                { doctorId: "" },
                { doctorId: null },
              ],
            },
            { doctorName },
          ],
        });
      }

      // --------------------------------------------------------

      // FIND APPOINTMENTS

      //

      // 1. New appointments using doctorId

      //

      // OR

      //

      // 2. Old appointments without doctorId

      //    but matching doctorName

      // --------------------------------------------------------

      const appointments =

        await Appointment.find({
          $and: [
            { $or: appointmentConditions },
            // A video appointment is not a doctor-facing booking until
            // Razorpay confirms payment. Unpaid checkout records remain
            // internal short-lived holds and are not actionable by doctors.
            {
              $or: [
                { consultationType: { $ne: "Video Consultation" } },
                { paymentStatus: "Paid" },
              ],
            },
          ],
        }).sort({

          createdAt: -1,

        });

      // Patient profile photos are owned by the User account. Resolve them
      // for this doctor's appointments so doctors see the current saved photo
      // without copying image URLs into appointment records.
      const patientIds = appointments
        .map((appointment) => appointment.patientId)
        .filter(Boolean);
      const patientPhones = [
        ...new Set(
          appointments
            .map((appointment) =>
              appointment.patientPhone?.toString().trim(),
            )
            .filter(Boolean),
        ),
      ];
      const patientIdentityFilters = [];
      if (patientIds.length) {
        patientIdentityFilters.push({ _id: { $in: patientIds } });
      }
      if (patientPhones.length) {
        patientIdentityFilters.push({ phone: { $in: patientPhones } });
      }

      const patients = patientIdentityFilters.length
        ? await User.find({
            role: "patient",
            $or: patientIdentityFilters,
          })
            .select("_id phone profileImage")
            .lean()
        : [];
      const patientsById = new Map(
        patients.map((patient) => [String(patient._id), patient]),
      );
      const patientsByPhone = new Map(
        patients
          .filter((patient) => patient.phone)
          .map((patient) => [patient.phone.toString().trim(), patient]),
      );
      const appointmentsWithPatientImages = appointments.map((appointment) => {
        const serialized = appointmentForDoctorSchedule(appointment);
        const patient =
          patientsById.get(String(serialized.patientId || "")) ||
          patientsByPhone.get(
            serialized.patientPhone?.toString().trim() || "",
          );
        serialized.patientProfileImageUrl = patient?.profileImage || "";
        return serialized;
      });


      return res.json({

        success: true,

        appointments: appointmentsWithPatientImages,

      });

    } catch (error) {

      console.error("GET DOCTOR APPOINTMENTS ERROR:", error.message);

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// Stream a specific report only after checking the signed-in doctor owns
// the appointment. The Cloudinary API secret and time-limited download URL
// stay on the backend.
exports.getDoctorAppointmentReportFile = async (req, res) => {
  try {
    const { appointmentId, reportId } = req.params;
    if (
      !/^[a-f\d]{24}$/i.test(String(appointmentId || "")) ||
      !/^[a-f\d]{24}$/i.test(String(reportId || ""))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment or report ID",
      });
    }

    const appointment = await Appointment.findById(appointmentId).select(
      "doctorId doctorName reports",
    );
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const authenticatedUser = await User.findById(req.user?.id);
    if (
      !authenticatedUser ||
      authenticatedUser.role !== "doctor" ||
      authenticatedUser.verificationStatus !== "APPROVED"
    ) {
      return res.status(403).json({
        success: false,
        message: "An approved doctor account is required",
      });
    }

    const ownershipQuery = {
      $or: [
        { userId: authenticatedUser._id },
        { userId: null, phone: authenticatedUser.phone },
        {
          userId: { $exists: false },
          phone: authenticatedUser.phone,
        },
      ],
    };

    let doctor = null;
    const appointmentDoctorId = String(appointment.doctorId || "");
    if (/^[a-f\d]{24}$/i.test(appointmentDoctorId)) {
      doctor = await Doctor.findOne({
        _id: appointmentDoctorId,
        ...ownershipQuery,
      });
    } else if (
      appointment.doctorName &&
      (await Doctor.countDocuments({ name: appointment.doctorName })) === 1
    ) {
      doctor = await Doctor.findOne({
        name: appointment.doctorName,
        ...ownershipQuery,
      });
    }

    if (!doctor) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to access this appointment report",
      });
    }

    const report = Array.isArray(appointment.reports)
      ? appointment.reports.find((item) => String(item?._id || "") === reportId)
      : null;
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    const reportData =
      typeof report.toObject === "function" ? report.toObject() : { ...report };
    reportData.fileUrl =
      reportData.fileUrl ||
      reportData.secure_url ||
      reportData.secureUrl ||
      reportData.reportUrl ||
      reportData.url ||
      "";

    const delivered = await getPatientReportBytes(reportData);
    res.status(200);
    res.set("Content-Type", delivered.fileType);
    res.set("Content-Length", String(delivered.bytes.length));
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(reportData.fileName || "patient-report")}`,
    );
    return res.end(delivered.bytes);
  } catch (error) {
    console.error("DOCTOR REPORT DELIVERY FAILED");
    const statusCode = [400, 403, 404, 415].includes(error.statusCode)
      ? error.statusCode
      : 502;
    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 404
          ? "Report file was not found in storage"
          : "Unable to load this report right now",
    });
  }
};

// ============================================================

// GET APPOINTMENTS BY PATIENT

// ============================================================

exports.getPatientAppointments =

  async (req, res) => {

    try {

      const {

        patientPhone,

      } = req.params;

      const authenticatedUser = await User.findById(req.user?.id);
      if (!authenticatedUser || authenticatedUser.role !== "patient") {
        return res.status(403).json({
          success: false,
          message: "Patient account required",
        });
      }

      const requestedPhone = patientPhone?.toString().trim();
      const userPhone = authenticatedUser.phone?.toString().trim();
      if (!requestedPhone || !userPhone) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own appointments",
        });
      }

      const phoneDigits = userPhone.replace(/\D/g, "");
      const phoneVariants = [...new Set([userPhone, `+${phoneDigits}`])];
      if (/^91[6-9]\d{9}$/.test(phoneDigits)) {
        phoneVariants.push(phoneDigits.slice(2));
      }
      const requestedDigits = requestedPhone.replace(/\D/g, "");
      const requestedVariants = [requestedPhone, requestedDigits];
      if (/^91[6-9]\d{9}$/.test(requestedDigits)) {
        requestedVariants.push(requestedDigits.slice(2));
      }
      if (!requestedVariants.some((phone) => phoneVariants.includes(phone))) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own appointments",
        });
      }
      const appointments = await Appointment.find({
        patientPhone: { $in: phoneVariants },
      }).sort({

          createdAt: -1,

        });

      return res.json({

        success: true,

        appointments,

      });

    } catch (error) {

      console.log(

        "GET PATIENT APPOINTMENTS ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// GET SINGLE APPOINTMENT

// ============================================================

exports.getAppointmentById =

  async (req, res) => {

    try {

      const appointment =

        await Appointment.findById(

          req.params.id

        );

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      const appointmentData = appointmentWithoutReports(appointment);

      return res.json({
        success: true,
        appointment: appointmentData,
      });

    } catch (error) {

      console.log(

        "GET APPOINTMENT ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// UPDATE APPOINTMENT STATUS

// ============================================================

exports.updateAppointmentStatus =

  async (req, res) => {

    try {

      const {

        id,

      } = req.params;

      const {

        status,

      } = req.body;

      if (!status) {

        return res.status(400).json({

          success: false,

          message:

            "Status is required",

        });

      }

      const allowedStatuses = [

        "Pending",

        "Upcoming",

        "Accepted",

        "Completed",

        "Cancelled",

        "Rejected",

      ];

      if (

        !allowedStatuses.includes(

          status

        )

      ) {

        return res.status(400).json({

          success: false,

          message:

            "Invalid appointment status",

        });

      }

      if (!/^[a-f\d]{24}$/i.test(String(id || ""))) {
        return res.status(400).json({
          success: false,
          message: "Invalid appointment ID",
        });
      }

      const authenticatedUser = await User.findById(req.user?.id);
      if (
        !authenticatedUser ||
        authenticatedUser.role !== "doctor" ||
        authenticatedUser.verificationStatus !== "APPROVED"
      ) {
        return res.status(403).json({
          success: false,
          message: "An approved doctor account is required",
        });
      }

      const existingAppointment = await Appointment.findById(id);
      if (!existingAppointment) {
        return res.status(404).json({
          success: false,
          message: "Appointment not found",
        });
      }

      const doctorOwnership = {
        $or: [
          { userId: authenticatedUser._id },
          { userId: null, phone: authenticatedUser.phone },
          {
            userId: { $exists: false },
            phone: authenticatedUser.phone,
          },
        ],
      };
      let ownedDoctor = null;
      const appointmentDoctorId = String(existingAppointment.doctorId || "");
      if (/^[a-f\d]{24}$/i.test(appointmentDoctorId)) {
        ownedDoctor = await Doctor.findOne({
          _id: appointmentDoctorId,
          ...doctorOwnership,
        });
      } else if (
        existingAppointment.doctorName &&
        (await Doctor.countDocuments({
          name: existingAppointment.doctorName,
        })) === 1
      ) {
        ownedDoctor = await Doctor.findOne({
          name: existingAppointment.doctorName,
          ...doctorOwnership,
        });
      }

      if (!ownedDoctor) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to update this appointment",
        });
      }

      if (
        existingAppointment.consultationType === "Video Consultation" &&
        ["Accepted", "Upcoming", "Completed"].includes(status) &&
        existingAppointment.paymentStatus !== "Paid"
      ) {
        return res.status(409).json({
          success: false,
          message: "Video consultation payment must be completed before confirming the appointment.",
        });
      }

      const appointment =

        await Appointment.findByIdAndUpdate(

          id,

          {

            status,

          },

          {

            new: true,

          }

        );

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      return res.json({

        success: true,

        message:

          "Appointment status updated successfully",

        appointment: appointmentWithoutReports(appointment),

      });

    } catch (error) {

      console.log(

        "UPDATE APPOINTMENT STATUS ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// UPDATE PAYMENT STATUS

// ============================================================

exports.updatePaymentStatus =

  async (req, res) => {

    try {

      const {

        id,

      } = req.params;

      const {

        paymentStatus,

        paymentId,

        razorpayOrderId,

      } = req.body;

      const existingAppointment =

        await Appointment.findById(id);

      if (!existingAppointment) {

        return res.status(404).json({

          success: false,

          message: "Appointment not found",

        });

      }

      // Doctor appointment payment can only be marked Paid by

      // the server-side Razorpay verification endpoint.

      if (

        existingAppointment.doctorId &&

        paymentStatus === "Paid"

      ) {

        return res.status(403).json({

          success: false,

          message:

            "Doctor appointment payments must be verified through Razorpay.",

        });

      }

      const updateData = {};

      if (paymentStatus) {

        updateData.paymentStatus =

          paymentStatus;

      }

      if (paymentId) {

        updateData.paymentId =

          paymentId;

      }

      if (razorpayOrderId) {

        updateData.razorpayOrderId =

          razorpayOrderId;

      }

      const appointment =

        await Appointment.findByIdAndUpdate(

          id,

          updateData,

          {

            new: true,

          }

        );

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      return res.json({

        success: true,

        message:

          "Payment status updated",

        appointment: appointmentWithoutReports(appointment),

      });

    } catch (error) {

      console.log(

        "UPDATE PAYMENT STATUS ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// DELETE APPOINTMENT

// ============================================================

exports.deleteAppointment =

  async (req, res) => {

    try {

      const appointment =

        await Appointment.findByIdAndDelete(

          req.params.id

        );

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      return res.json({

        success: true,

        message:

          "Appointment deleted successfully",

      });

    } catch (error) {

      console.log(

        "DELETE APPOINTMENT ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// START VIDEO CONSULTATION

// ============================================================

exports.startConsultation =

  async (req, res) => {

    try {

      const appointment =

        await Appointment.findById(

          req.params.id

        );

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      // ========================================================

      // ONLY VIDEO CONSULTATION

      // ========================================================

      if (

        appointment.consultationType !==

        "Video Consultation"

      ) {

        return res.status(400).json({

          success: false,

          message:

            "This appointment is not a video consultation",

        });

      }

      // ========================================================

      if (appointment.paymentStatus !== "Paid") {
        return res.status(403).json({
          success: false,
          message: "Complete online payment before starting the video consultation.",
        });
      }

      // CREATE / REUSE MEETING ID

      // ========================================================

      const meetingId =

        appointment.meetingId ||

        `healthhome-${appointment._id}`;

      appointment.meetingId =

        meetingId;

      // ========================================================

      // MARK CONSULTATION READY

      // ========================================================

      appointment.consultationStatus =

        "Ready";

      appointment.status =

        "Upcoming";

      await appointment.save();

      return res.json({

        success: true,

        message:

          "Video consultation started",

        appointment: appointmentWithoutReports(appointment),

      });

    } catch (error) {

      console.log(

        "START CONSULTATION ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// JOIN VIDEO CONSULTATION

// ============================================================

exports.joinConsultation =

  async (req, res) => {

    try {

      const existingAppointment = await Appointment.findById(req.params.id);
      if (!existingAppointment) {
        return res.status(404).json({ success: false, message: "Appointment not found" });
      }
      if (existingAppointment.consultationType !== "Video Consultation") {
        return res.status(400).json({ success: false, message: "This appointment is not a video consultation" });
      }
      if (existingAppointment.paymentStatus !== "Paid") {
        return res.status(403).json({
          success: false,
          message: "Complete online payment before joining the video consultation",
        });
      }

      const appointment =

        await Appointment.findByIdAndUpdate(

          req.params.id,

          {

            consultationStatus:

              "Joined",

          },

          {

            new: true,

          }

        );

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      return res.json({

        success: true,

        message:

          "Joined consultation",

        appointment: appointmentWithoutReports(appointment),

      });

    } catch (error) {

      console.log(

        "JOIN CONSULTATION ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// CHECK READY VIDEO CONSULTATION

// ============================================================

exports.checkReadyConsultation =

  async (req, res) => {

    try {

      const appointment =

        await Appointment.findOne({

          patientPhone:

            req.params.patientPhone,

          consultationStatus: { $in: ["Ready", "Joined"] },

          consultationType:

            "Video Consultation",

          paymentStatus: "Paid",

          status: {

            $nin: [

              "Completed",

              "Cancelled",

            ],

          },

        }).sort({

          createdAt: -1,

        });

      if (!appointment) return res.json({ success: true, appointment: null });
      const patient = await User.findOne({ phone: req.params.patientPhone, role: "patient" }).select("_id").lean();
      const activeCall = patient ? await VideoCallSession.findOne({
        appointmentId: appointment._id,
        patientId: patient._id,
        status: { $in: ["RINGING", "ACCEPTED", "CONNECTED"] },
        expiresAt: { $gt: new Date() },
      }).select("callId channelName status expiresAt").lean() : null;
      if (!activeCall) return res.json({ success: true, appointment: null });
      const readyAppointment = appointment.toObject();
      delete readyAppointment.reports;
      readyAppointment.callId = activeCall.callId;
      readyAppointment.meetingId = activeCall.channelName;
      readyAppointment.callStatus = activeCall.status;
      readyAppointment.callExpiresAt = activeCall.expiresAt;
      return res.json({ success: true, appointment: readyAppointment });

    } catch (error) {

      console.log(

        "CHECK READY CONSULTATION ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// COMPLETE CONSULTATION

// ============================================================

exports.completeConsultation =

  async (req, res) => {

    try {

      const appointmentId = String(req.params.id || "");
      if (!/^[a-f\d]{24}$/i.test(appointmentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid appointment ID",
        });
      }

      const authenticatedDoctor = await User.findById(req.user?.id);
      if (
        !authenticatedDoctor ||
        authenticatedDoctor.role !== "doctor" ||
        authenticatedDoctor.verificationStatus !== "APPROVED"
      ) {
        return res.status(403).json({
          success: false,
          message: "An approved doctor account is required",
        });
      }

      const appointment = await Appointment.findById(appointmentId);

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      const doctorOwnership = {
        $or: [
          { userId: authenticatedDoctor._id },
          { userId: null, phone: authenticatedDoctor.phone },
          {
            userId: { $exists: false },
            phone: authenticatedDoctor.phone,
          },
        ],
      };
      const appointmentDoctorId = String(appointment.doctorId || "");
      const ownedDoctor = /^[a-f\d]{24}$/i.test(appointmentDoctorId)
        ? await Doctor.findOne({
            _id: appointmentDoctorId,
            ...doctorOwnership,
          })
        : null;
      const directUserIdMatches =
        appointmentDoctorId === String(authenticatedDoctor._id);

      if (!ownedDoctor && !directUserIdMatches) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to complete this appointment",
        });
      }

      if (appointment.consultationType !== "Video Consultation") {
        return res.status(400).json({
          success: false,
          message: "This appointment is not a video consultation",
        });
      }

      if (
        !["Accepted", "Upcoming"].includes(appointment.status) ||
        !["Ready", "Joined"].includes(appointment.consultationStatus)
      ) {
        return res.status(409).json({
          success: false,
          message: "Start the video consultation before completing this appointment",
        });
      }

      if (appointment.paymentStatus !== "Paid") {
        return res.status(403).json({
          success: false,
          message: "Complete online payment before completing the video consultation",
        });
      }

      appointment.status = "Completed";
      appointment.consultationStatus = "Completed";
      await appointment.save();

      return res.json({

        success: true,

        message:

          "Consultation completed successfully",

        appointment: appointmentWithoutReports(appointment),

      });

    } catch (error) {

      console.log(

        "COMPLETE CONSULTATION ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          error.message,

      });

    }

  };

// ============================================================

// GENERATE AGORA VIDEO CONSULTATION TOKEN

// ============================================================

exports.generateAgoraToken =

  async (req, res) => {

    try {

      const {

        appointmentId,

        uid,

      } = req.body;

      console.log(

        "================================="

      );

      console.log(

        "GENERATE AGORA TOKEN"

      );

      console.log(

        "APPOINTMENT ID =",

        appointmentId

      );

      console.log(

        "UID =",

        uid

      );

      console.log(

        "================================="

      );

      // ========================================================

      // VALIDATION

      // ========================================================

      if (!appointmentId) {

        return res.status(400).json({

          success: false,

          message:

            "Appointment ID is required",

        });

      }

      if (

        uid === undefined ||

        uid === null

      ) {

        return res.status(400).json({

          success: false,

          message:

            "UID is required",

        });

      }

      const numericUid =

        Number(uid);

      if (

        !Number.isInteger(

          numericUid

        ) ||

        numericUid < 0

      ) {

        return res.status(400).json({

          success: false,

          message:

            "UID must be a valid number",

        });

      }

      // ========================================================

      // FIND APPOINTMENT

      // ========================================================

      const appointment =

        await Appointment.findById(

          appointmentId

        );

      if (!appointment) {

        return res.status(404).json({

          success: false,

          message:

            "Appointment not found",

        });

      }

      // ========================================================

      // ONLY VIDEO CONSULTATIONS

      // ========================================================

      if (

        appointment.consultationType !==

        "Video Consultation"

      ) {

        return res.status(400).json({

          success: false,

          message:

            "This appointment is not a video consultation",

        });

      }

      // ========================================================

      if (appointment.paymentStatus !== "Paid") {
        return res.status(403).json({
          success: false,
          message: "Complete online payment before joining the video consultation.",
        });
      }

      // CONSULTATION MUST BE READY OR JOINED

      // ========================================================

      if (

        appointment.consultationStatus !==

          "Ready" &&

        appointment.consultationStatus !==

          "Joined"

      ) {

        return res.status(400).json({

          success: false,

          message:

            "Video consultation has not been started yet",

        });

      }

      // ========================================================

      // CHECK AGORA CREDENTIALS

      // ========================================================

      const activeCall = await VideoCallSession.findOne({
        appointmentId: appointment._id,
        status: { $in: ["RINGING", "ACCEPTED", "CONNECTED"] },
        expiresAt: { $gt: new Date() },
      });
      if (!activeCall) {
        return res.status(409).json({ success: false, message: "There is no active video call for this appointment." });
      }
      const requestUserId = String(req.user.id);
      const isDoctorParticipant = req.user.role === "doctor" && requestUserId === String(activeCall.doctorId);
      let isPatientParticipant = req.user.role === "patient" && requestUserId === String(activeCall.patientId);
      if (!isPatientParticipant && req.user.role === "patient" && !appointment.patientId) {
        const participant = await User.findById(req.user.id).select("phone").lean();
        isPatientParticipant = Boolean(participant?.phone && participant.phone === appointment.patientPhone);
      }
      if (!isDoctorParticipant && !isPatientParticipant) {
        return res.status(403).json({ success: false, message: "You are not a participant in this consultation." });
      }
      if (isPatientParticipant && activeCall.status === "RINGING") {
        return res.status(409).json({ success: false, message: "Accept the incoming call before joining." });
      }

      const appId =

        process.env.AGORA_APP_ID;

      const appCertificate =

        process.env.AGORA_APP_CERTIFICATE;

      if (

        !appId ||

        !appCertificate

      ) {

        console.error(

          "AGORA_APP_ID or AGORA_APP_CERTIFICATE missing"

        );

        return res.status(500).json({

          success: false,

          message:

            "Agora server configuration is missing",

        });

      }

      // ========================================================

      // CHANNEL NAME

      // ========================================================

      const channelName = activeCall.channelName;

      // ========================================================

      // TOKEN EXPIRATION

      // 1 HOUR

      // ========================================================

      const tokenExpirationInSeconds =

        60 * 60;

      const currentTimestamp =

        Math.floor(

          Date.now() / 1000

        );

      const privilegeExpiredTs =

        currentTimestamp +

        tokenExpirationInSeconds;

      // ========================================================

      // GENERATE RTC TOKEN

      // ========================================================

      const token =

        RtcTokenBuilder.buildTokenWithUid(

          appId,

          appCertificate,

          channelName,

          numericUid,

          RtcRole.PUBLISHER,

          privilegeExpiredTs,

          privilegeExpiredTs

        );

      console.log(

        "Agora token generated successfully"

      );

      console.log(

        "CHANNEL =",

        channelName

      );

      console.log(

        "UID =",

        numericUid

      );

      console.log(

        "================================="

      );

      // ========================================================

      // RESPONSE

      // ========================================================

      return res.status(200).json({

        success: true,

        appId:

          appId,

        channelName:

          channelName,

        uid:

          numericUid,

        token:

          token,

        expiresAt:

          privilegeExpiredTs,

      });

    } catch (error) {

      console.error(

        "GENERATE AGORA TOKEN ERROR:",

        error

      );

      return res.status(500).json({

        success: false,

        message:

          "Failed to generate Agora token",

        error:

          error.message,

      });

    }

  };

/**

 * DOCTOR PROPOSES A NEW APPOINTMENT DATE/TIME

 *

 * PUT /api/appointments/:id/propose-reschedule

 *

 * Body:

 * {

 *   "proposedAppointmentDate": "2026-10-15",

 *   "proposedAppointmentTime": "11:00 AM",

 *   "rescheduleReason": "Doctor is unavailable at the original time"

 * }

 */

exports.proposeReschedule = async (req, res) => {

  try {

    const {

      proposedAppointmentDate,

      proposedAppointmentTime,

      rescheduleReason,

    } = req.body;

    if (

      !proposedAppointmentDate ||

      !proposedAppointmentTime

    ) {

      return res.status(400).json({

        success: false,

        message: "Proposed date and time are required",

      });

    }

    // Validate date format.

    const dateMatch =

      /^(\d{4})-(\d{2})-(\d{2})$/.exec(

        proposedAppointmentDate

      );

    if (!dateMatch) {

      return res.status(400).json({

        success: false,

        message: "Date must use YYYY-MM-DD format",

      });

    }

    const year = Number(dateMatch[1]);

    const month = Number(dateMatch[2]);

    const day = Number(dateMatch[3]);

    const parsedDate = new Date(

      Date.UTC(year, month - 1, day)

    );

    if (

      parsedDate.getUTCFullYear() !== year ||

      parsedDate.getUTCMonth() !== month - 1 ||

      parsedDate.getUTCDate() !== day

    ) {

      return res.status(400).json({

        success: false,

        message: "Invalid proposed date",

      });

    }

    const Appointment = require("../models/Appointment");

    const appointment = await Appointment.findById(

      req.params.id

    );

    if (!appointment) {

      return res.status(404).json({

        success: false,

        message: "Appointment not found",

      });

    }

    const doctorForReschedule = await Doctor.findById(appointment.doctorId);
    const proposedMinutes = parseAppointmentTime(proposedAppointmentTime);
    if (proposedMinutes === null) {
      return res.status(400).json({ success: false, message: "Invalid proposed time." });
    }
    const proposedTimeNormalized = formatAppointmentTime(proposedMinutes);
    const proposedSlotError = await validateDoctorSlot({
      doctor: doctorForReschedule,
      date: proposedAppointmentDate,
      time: proposedTimeNormalized,
      consultationType: appointment.consultationType,
      excludeAppointmentId: appointment._id,
    });
    if (proposedSlotError) {
      return res.status(400).json({ success: false, message: proposedSlotError });
    }

    if (

      !["Pending", "Upcoming", "Accepted"].includes(

        appointment.status

      )

    ) {

      return res.status(400).json({

        success: false,

        message:

          "This appointment cannot be rescheduled",

      });

    }

    if (

      appointment.patientResponse === "Pending" &&

      appointment.proposedAppointmentDate

    ) {

      return res.status(409).json({

        success: false,

        message:

          "A reschedule proposal is already awaiting the patient's response",

      });

    }

    if (

      proposedAppointmentDate === appointment.appointmentDate &&

      proposedTimeNormalized ===

        appointment.appointmentTime.trim()

    ) {

      return res.status(400).json({

        success: false,

        message:

          "The proposed time must differ from the current appointment",

      });

    }

    // Do not propose a slot already occupied by another

    // active appointment for this doctor.

    const conflictingAppointment =

      await Appointment.findOne({

        _id: { $ne: appointment._id },

        doctorId: appointment.doctorId,

        appointmentDate: proposedAppointmentDate,

        appointmentTime: proposedTimeNormalized,

        status: {

          $in: ["Pending", "Upcoming", "Accepted"],

        },

      });

    if (conflictingAppointment) {

      return res.status(409).json({

        success: false,

        message:

          "The proposed time is already booked. Please select another slot.",

      });

    }

    // Preserve the original appointment details.

    appointment.originalAppointmentDate =

      appointment.originalAppointmentDate ||

      appointment.appointmentDate;

    appointment.originalAppointmentTime =

      appointment.originalAppointmentTime ||

      appointment.appointmentTime;

    appointment.proposedAppointmentDate =

      proposedAppointmentDate;

    appointment.proposedAppointmentTime =

      proposedTimeNormalized;

    appointment.rescheduleRequestedBy = "Doctor";

    appointment.rescheduleReason =

      (rescheduleReason || "").trim();

    appointment.patientResponse = "Pending";

    appointment.rescheduleHistory.push({

      previousDate: appointment.appointmentDate,

      previousTime: appointment.appointmentTime,

      proposedDate: proposedAppointmentDate,

      proposedTime: proposedTimeNormalized,

      requestedBy: "Doctor",

      reason: (rescheduleReason || "").trim(),

      requestedAt: new Date(),

    });

    await appointment.save();

    return res.status(200).json({

      success: true,

      message: "Reschedule proposal sent to the patient",

      appointment: appointmentWithoutReports(appointment),

    });

  } catch (error) {

    console.error("PROPOSE RESCHEDULE ERROR:", error);

    if (error.code === 11000) {

      return res.status(409).json({

        success: false,

        message:

          "That appointment slot has just been booked. Choose another slot.",

      });

    }

    return res.status(500).json({

      success: false,

      message: "Failed to propose reschedule",

      error: error.message,

    });

  }

};

/**

 * PATIENT ACCEPTS OR DECLINES A PROPOSAL

 *

 * PUT /api/appointments/:id/respond-reschedule

 *

 * Body to accept:

 * { "response": "Accepted" }

 *

 * Body to decline:

 * { "response": "Declined" }

 */

exports.respondToReschedule = async (req, res) => {

  try {

    const { response } = req.body;

    if (!["Accepted", "Requested Another Time"].includes(response)) {

      return res.status(400).json({

        success: false,

        message:

          'Response must be "Accepted" or "Requested Another Time"',

      });

    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {

      return res.status(404).json({

        success: false,

        message: "Appointment not found",

      });

    }

    if (

      appointment.rescheduleRequestedBy !== "Doctor" ||

      appointment.patientResponse !== "Pending" ||

      !appointment.proposedAppointmentDate ||

      !appointment.proposedAppointmentTime

    ) {

      return res.status(409).json({

        success: false,

        message: "There is no pending doctor reschedule proposal",

      });

    }

    // Patient requests a different time.

    if (response === "Requested Another Time") {

      appointment.patientResponse = "Requested Another Time";

      appointment.proposedAppointmentDate = "";

      appointment.proposedAppointmentTime = "";

      appointment.rescheduleRequestedBy = "Patient";

      if (!Array.isArray(appointment.rescheduleHistory)) {

        appointment.rescheduleHistory = [];

      }

      appointment.rescheduleHistory.push({

        requestedBy: "Patient",

        date: new Date(),

        reason: "Patient requested another appointment time",

        status: "Requested Another Time",

      });

      await appointment.save();

      return res.status(200).json({

        success: true,

        message: "Request sent to the doctor for another time",

        appointment: appointmentWithoutReports(appointment),

      });

    }

    // Patient accepts the doctor's proposed time.

    const proposedDate = appointment.proposedAppointmentDate;
    const proposedTimeMinutes = parseAppointmentTime(appointment.proposedAppointmentTime);
    if (proposedTimeMinutes === null) {
      return res.status(400).json({ success: false, message: "Invalid proposed time." });
    }
    const proposedTime = formatAppointmentTime(proposedTimeMinutes);
    const doctorForAcceptance = await Doctor.findById(appointment.doctorId);
    const acceptanceSlotError = await validateDoctorSlot({
      doctor: doctorForAcceptance,
      date: proposedDate,
      time: proposedTime,
      consultationType: appointment.consultationType,
      excludeAppointmentId: appointment._id,
    });
    if (acceptanceSlotError) {
      return res.status(409).json({
        success: false,
        message: `The proposed slot is no longer valid: ${acceptanceSlotError}`,
      });
    }

    // Check whether another appointment has taken this slot.

    const conflict = await Appointment.findOne({

      _id: { $ne: appointment._id },

      doctorId: appointment.doctorId,

      appointmentDate: proposedDate,

      appointmentTime: proposedTime,

      status: {

        $in: ["Pending", "Upcoming", "Accepted"],

      },

    });

    if (conflict) {

      return res.status(409).json({

        success: false,

        message:

          "The proposed slot is no longer available. Please ask the doctor for another time.",

      });

    }

    // Preserve payment status; only change appointment timing.

    appointment.appointmentDate = proposedDate;

    appointment.appointmentTime = proposedTime;

    appointment.patientResponse = "Accepted";

    appointment.proposedAppointmentDate = "";

    appointment.proposedAppointmentTime = "";

    if (!Array.isArray(appointment.rescheduleHistory)) {

      appointment.rescheduleHistory = [];

    }

    appointment.rescheduleHistory.push({

      requestedBy: "Doctor",

      date: new Date(),

      reason: appointment.rescheduleReason || "Doctor proposed a new time",

      status: "Accepted",

    });

    await appointment.save();

    return res.status(200).json({

      success: true,

      message: "Reschedule accepted successfully",

      appointment: appointmentWithoutReports(appointment),

    });

  } catch (error) {

    console.error("RESPOND TO RESCHEDULE ERROR:", error);

    if (error.code === 11000) {

      return res.status(409).json({

        success: false,

        message:

          "That slot has just been booked. Please ask the doctor for another time.",

      });

    }

    return res.status(500).json({

      success: false,

      message: "Failed to respond to reschedule proposal",

      error: error.message,

    });

  }

};

exports.collectHospitalVisitPayment = async (req, res) => {
  try {
    const authenticatedUser = await User.findById(req.user?.id);
    if (
      !authenticatedUser ||
      authenticatedUser.role !== "doctor" ||
      authenticatedUser.verificationStatus !== "APPROVED"
    ) {
      return res.status(403).json({
        success: false,
        message: "An approved doctor account is required",
      });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }
    if (
      appointment.consultationType !== "Hospital Visit" ||
      appointment.paymentMethod !== "AT_HOSPITAL"
    ) {
      return res.status(400).json({
        success: false,
        message: "Only hospital visit payments can be recorded here",
      });
    }
    if (!["Accepted", "Upcoming", "Completed"].includes(appointment.status)) {
      return res.status(409).json({
        success: false,
        message: "Accept the appointment before recording payment at the visit",
      });
    }

    const doctor = await Doctor.findOne({
      _id: appointment.doctorId,
      $or: [
        { userId: authenticatedUser._id },
        { userId: null, phone: authenticatedUser.phone },
        { userId: { $exists: false }, phone: authenticatedUser.phone },
      ],
    });
    if (!doctor) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to record this payment",
      });
    }

    if (appointment.paymentStatus === "Paid") {
      return res.status(200).json({
        success: true,
        message: "Hospital visit payment is already recorded",
        appointment: appointmentWithoutReports(appointment),
      });
    }

    appointment.paymentStatus = "Paid";
    appointment.paymentMethod = "AT_HOSPITAL";
    await appointment.save();

    const payment = await Payment.findOne({ appointmentId: String(appointment._id) });
    if (payment) {
      payment.status = "Collected";
      payment.paymentStatus = "SUCCESS";
      payment.verificationStatus = "SKIPPED";
      payment.paymentMethod = "AT_HOSPITAL";
      payment.transactionDate = new Date();
      await payment.save();
    }

    return res.status(200).json({
      success: true,
      message: "Hospital visit payment recorded",
      appointment: appointmentWithoutReports(appointment),
    });
  } catch (error) {
    console.error("COLLECT HOSPITAL VISIT PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to record hospital visit payment",
      error: error.message,
    });
  }
};
