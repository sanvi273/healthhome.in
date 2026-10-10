const Appointment = require("../models/Appointment");



const {

  RtcTokenBuilder,

  RtcRole,

} = require("agora-token");



const uploadToCloudinary =

  require("../utils/cloudinaryUpload");



// ============================================================

// BOOK APPOINTMENT

// ============================================================



exports.bookAppointment =

  async (req, res) => {

    try {

      console.log("=================================");

      console.log("BOOK APPOINTMENT");

      console.log("BODY =", req.body);

      console.log("FILES =", req.files);

      console.log("=================================");



      const {

        patientName,

        patientPhone,



        doctorId,

        doctorName,

        specialization,

        hospital,

        fees,



        consultationType,



        appointmentDate,

        appointmentTime,



        paymentStatus,

        razorpayOrderId,

        paymentId,

      } = req.body;



      // ========================================================

      // DEBUG CONSULTATION TYPE

      // ========================================================



      console.log("=================================");

      console.log(

        "RECEIVED CONSULTATION TYPE =",

        consultationType

      );



      console.log(

        "RECEIVED CONSULTATION TYPE JSON =",

        JSON.stringify(consultationType)

      );



      console.log(

        "RECEIVED CONSULTATION TYPE TYPE =",

        typeof consultationType

      );



      console.log("=================================");



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



      const finalConsultationType =

        consultationType ===

        "Video Consultation"

          ? "Video Consultation"

          : "Hospital Visit";



      // ========================================================

      // DEBUG FINAL CONSULTATION TYPE

      // ========================================================



      console.log("=================================");

      console.log(

        "FINAL CONSULTATION TYPE =",

        finalConsultationType

      );



      console.log(

        "FINAL CONSULTATION TYPE JSON =",

        JSON.stringify(finalConsultationType)

      );



      console.log("=================================");



      // ========================================================

      // CHECK DUPLICATE SLOT

      // ========================================================



      const existingAppointment =

        await Appointment.findOne({

          doctorId:

            doctorId.toString(),



          appointmentDate,



          appointmentTime,



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

          const result =

            await uploadToCloudinary(

              file,

              "appointment_reports"

            );



          uploadedReports.push({

            fileName:

              file.originalname || "",



            fileUrl:

              result.secure_url || "",



            fileType:

              file.mimetype || "",

          });

        }

      }



      // ========================================================

      // CREATE APPOINTMENT

      // ========================================================



      console.log("=================================");

      console.log("FINAL APPOINTMENT DATA");



      console.log(

        "doctorId =",

        doctorId

      );



      console.log(

        "doctorId type =",

        typeof doctorId

      );



      console.log(

        "doctorName =",

        doctorName

      );



      console.log(

        "appointmentDate =",

        appointmentDate

      );



      console.log(

        "appointmentTime =",

        appointmentTime

      );



      console.log(

        "consultationType =",

        finalConsultationType

      );



      console.log("=================================");



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



          fees:

            Number(fees || 0),



          // ---------------- Appointment ----------------



          consultationType:

            finalConsultationType,



          appointmentDate,



          appointmentTime,



          // ---------------- Reports ----------------



          reports:

            uploadedReports,



          // ---------------- Payment ----------------



          paymentStatus:

            paymentStatus || "Pending",



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



        appointment,

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
    const doctorId = req.params.doctorId?.toString().trim();
    const appointmentDate = req.params.date?.toString().trim();

    if (!doctorId || !appointmentDate) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID and appointment date are required",
      });
    }

    const Doctor = require("../models/doctor");

    const doctor = await Doctor.findById(doctorId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    const schedule = doctor.schedule || {};

    // Support common schedule field formats.
    const workingDays = schedule.workingDays || [];
    const startTime = schedule.startTime || "10:00";
    const endTime = schedule.endTime || "19:30";
    const breakStart = schedule.breakStart || "13:00";
    const breakEnd = schedule.breakEnd || "14:00";
    const slotDuration = Number(schedule.slotDurationMinutes || 30);
    const dailyLimit = Number(schedule.maxAppointmentsPerDay || 10);

    if (slotDuration <= 0 || !Number.isFinite(slotDuration)) {
      return res.status(400).json({
        success: false,
        message: "Invalid slot duration in doctor's schedule",
      });
    }

    // Parse HH:mm into minutes after midnight.
    const toMinutes = (time) => {
      if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
        return null;
      }

      const [hours, minutes] = time.split(":").map(Number);

      if (
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
      ) {
        return null;
      }

      return hours * 60 + minutes;
    };

    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    const breakFrom = toMinutes(breakStart);
    const breakTo = toMinutes(breakEnd);

    if (
      start === null ||
      end === null ||
      start >= end ||
      breakFrom === null ||
      breakTo === null
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor's working schedule",
      });
    }

    // Parse date as a calendar date, avoiding loose date matching.
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      appointmentDate
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
    const requestedDate = new Date(Date.UTC(year, month - 1, day));

    if (
      requestedDate.getUTCFullYear() !== year ||
      requestedDate.getUTCMonth() !== month - 1 ||
      requestedDate.getUTCDate() !== day
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment date",
      });
    }

    // Monday = 1 ... Sunday = 7.
    const weekday = requestedDate.getUTCDay();
    const dayNumber = weekday === 0 ? 7 : weekday;

    const dayNames = [
      "",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];

    const requestedDay = dayNames[dayNumber];

    const normalizeDay = (value) =>
      String(value).trim().toLowerCase();

    const isWorkingDay =
      workingDays.length === 0 ||
      workingDays.some(
        (day) => normalizeDay(day) === normalizeDay(requestedDay)
      );

    if (!isWorkingDay || doctor.isAvailable === false) {
      return res.status(200).json({
        success: true,
        doctorId,
        date: appointmentDate,
        slots: [],
        message: "Doctor is unavailable on this date",
      });
    }

    // Find appointments that occupy slots.
    const bookedAppointments = await Appointment.find({
      doctorId,
      appointmentDate,
      status: {
        $in: ["Pending", "Upcoming", "Accepted"],
      },
    }).select("appointmentTime");

    if (bookedAppointments.length >= dailyLimit) {
      return res.status(200).json({
        success: true,
        doctorId,
        date: appointmentDate,
        slots: [],
        message: "Doctor's daily appointment limit has been reached",
      });
    }

    const bookedSlots = new Set(
      bookedAppointments.map((appointment) =>
        String(appointment.appointmentTime || "").trim()
      )
    );

    const formatTime = (minutes) => {
      const hours24 = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const period = hours24 >= 12 ? "PM" : "AM";
      const hours12 = hours24 % 12 || 12;

      return `${String(hours12).padStart(2, "0")}:${String(
        mins
      ).padStart(2, "0")} ${period}`;
    };

    const slots = [];

    for (
      let time = start;
      time + slotDuration <= end;
      time += slotDuration
    ) {
      const slotEnd = time + slotDuration;

      // Exclude slots that overlap the doctor's break.
      const overlapsBreak =
        time < breakTo && slotEnd > breakFrom;

      if (overlapsBreak) {
        continue;
      }

      const formattedTime = formatTime(time);

      slots.push({
        time: formattedTime,
        available: !bookedSlots.has(formattedTime),
      });
    }

    return res.status(200).json({
      success: true,
      doctorId,
      date: appointmentDate,
      slots,
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





// ============================================================

// GET ALL APPOINTMENTS

// ============================================================



exports.getAppointments =

  async (req, res) => {

    try {



      const appointments =

        await Appointment.find()

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



      console.log("=================================");

      console.log(

        "GET DOCTOR APPOINTMENTS"

      );



      console.log(

        "DOCTOR ID =",

        doctorId

      );



      console.log("=================================");



      if (!doctorId) {

        return res.status(400).json({

          success: false,



          message:

            "Doctor ID is required",

        });

      }



      // --------------------------------------------------------

      // FIND DOCTOR

      // --------------------------------------------------------



      const Doctor =

        require("../models/doctor");



      const doctor =

        await Doctor.findById(

          doctorId

        );



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



      console.log(

        "DOCTOR NAME =",

        doctorName

      );



      // --------------------------------------------------------

      // FIND APPOINTMENTS

      //

      // 1. New appointments using doctorId

      //

      // OR

      //

      // 2. Old appointments without doctorId

      //    but matching doctorName

      // --------------------------------------------------------



      const appointments =

        await Appointment.find({

          $or: [



            {

              doctorId:

                doctorId,

            },



            {

              $and: [



                {

                  $or: [



                    {

                      doctorId: {

                        $exists:

                          false,

                      },

                    },



                    {

                      doctorId:

                        "",

                    },



                    {

                      doctorId:

                        null,

                    },



                  ],

                },



                {

                  doctorName:

                    doctorName,

                },



              ],

            },



          ],

        }).sort({

          createdAt: -1,

        });



      console.log(

        "DOCTOR APPOINTMENTS COUNT =",

        appointments.length

      );



      appointments.forEach(

        (

          appointment,

          index

        ) => {



          console.log(

            `APPOINTMENT ${

              index + 1

            }:`

          );



          console.log(

            "ID =",

            appointment._id.toString()

          );



          console.log(

            "PATIENT =",

            appointment.patientName

          );



          console.log(

            "DOCTOR ID =",

            appointment.doctorId

          );



          console.log(

            "DOCTOR NAME =",

            appointment.doctorName

          );



          console.log(

            "CONSULTATION TYPE =",

            appointment.consultationType

          );



          console.log(

            "CONSULTATION STATUS =",

            appointment.consultationStatus

          );



          console.log(

            "STATUS =",

            appointment.status

          );

        }

      );



      console.log("=================================");



      return res.json({

        success: true,



        appointments,

      });



    } catch (error) {



      console.log(

        "GET DOCTOR APPOINTMENTS ERROR:",

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

// GET APPOINTMENTS BY PATIENT

// ============================================================



exports.getPatientAppointments =

  async (req, res) => {

    try {



      const {

        patientPhone,

      } = req.params;



      const appointments =

        await Appointment.find({

          patientPhone,

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



      return res.json({

        success: true,



        appointment,

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



        appointment,

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



        appointment,

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



        appointment,

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



        appointment,

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



          status: {

            $nin: [

              "Completed",

              "Cancelled",

            ],

          },



        }).sort({

          createdAt: -1,

        });



      return res.json({

        success: true,



        appointment,

      });



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



      const appointment =

        await Appointment.findByIdAndUpdate(

          req.params.id,



          {

            status:

              "Completed",



            consultationStatus:

              "Completed",

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

          "Consultation completed successfully",



        appointment,

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



      const channelName =

        appointment.meetingId ||

        `healthhome-${appointment._id}`;



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