const Razorpay = require("razorpay");



const crypto = require("crypto");



const mongoose = require("mongoose");



const Payment = require("../models/Payment");



const Order = require("../models/orderModel");





// ============================================================

// RAZORPAY CONFIGURATION

// ============================================================



const razorpayKeyId = process.env.RAZORPAY_KEY_ID;



const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;



const razorpayWebhookSecret =

  process.env.RAZORPAY_WEBHOOK_SECRET;





if (!razorpayKeyId) {

  console.error("❌ RAZORPAY_KEY_ID is missing.");

}



if (!razorpayKeySecret) {

  console.error("❌ RAZORPAY_KEY_SECRET is missing.");

}



if (!razorpayWebhookSecret) {

  console.warn(

    "⚠️ RAZORPAY_WEBHOOK_SECRET is missing."

  );

}





const razorpay = new Razorpay({

  key_id: razorpayKeyId,

  key_secret: razorpayKeySecret,

});





// ============================================================

// HELPERS

// ============================================================



const safeString = (value) =>

  String(value ?? "").trim();





const isValidObjectId = (id) =>

  mongoose.Types.ObjectId.isValid(

    String(id)

  );





const getLabOrderModel = () =>

  require("../models/labOrder");





const checkRazorpayConfiguration = () => {

  if (!razorpayKeyId || !razorpayKeySecret) {

    return {

      success: false,

      message:

        "Razorpay credentials are not configured on the server.",

    };

  }



  return {

    success: true,

  };

};





const getRazorpayErrorDetails = (error) => ({

  message: error?.message || "",



  description:

    error?.error?.description || "",



  code:

    error?.error?.code || "",



  field:

    error?.error?.field || "",



  source:

    error?.error?.source || "",



  step:

    error?.error?.step || "",



  reason:

    error?.error?.reason || "",



  statusCode:

    error?.statusCode || "",

});





// ============================================================

// GET SERVICE DATA

// ============================================================



const getServiceData = async (

  serviceType,

  serviceId

) => {



  if (!serviceType || !serviceId) {

    throw new Error(

      "serviceType and serviceId are required."

    );

  }





  // ==========================================================

  // DOCTOR

  // ==========================================================



  if (serviceType === "Doctor") {



    if (!isValidObjectId(serviceId)) {

      throw new Error(

        "Invalid doctor ID."

      );

    }





    const doctor =

      await mongoose.connection

        .collection("doctors")

        .findOne({

          _id:

            new mongoose.Types.ObjectId(

              serviceId

            ),

        });





    if (!doctor) {

      throw new Error(

        "Doctor not found."

      );

    }





    const amount =

      Number(doctor.fees);





    if (

      !Number.isFinite(amount) ||

      amount <= 0

    ) {

      throw new Error(

        "Invalid doctor consultation fee."

      );

    }





    return {



      service: doctor,



      amount,



      patientId: "",



      patientName: "",



      patientPhone: "",



      providerId:

        String(doctor._id),



      providerType: "Doctor",



      serviceType: "Doctor",



      serviceId:

        String(doctor._id),



      alreadyPaid: false,



      serviceStatus: "",

    };

  }





  // ==========================================================

  // MEDICINE

  // ==========================================================



  if (serviceType === "Medicine") {



    if (!isValidObjectId(serviceId)) {

      throw new Error(

        "Invalid medicine order ID."

      );

    }





    const order =

      await Order.findById(

        serviceId

      );





    if (!order) {

      throw new Error(

        "Medicine order not found."

      );

    }





    const amount =

      Number(order.totalAmount);





    if (

      !Number.isFinite(amount) ||

      amount <= 0

    ) {

      throw new Error(

        "Invalid medicine order amount."

      );

    }





    return {



      service: order,



      amount,



      patientId:

        safeString(order.patientId),



      patientName:

        safeString(order.patientName),



      patientPhone:

        safeString(order.patientPhone),



      providerId:

        safeString(order.pharmacyId),



      providerType: "Pharmacy",



      serviceType: "Medicine",



      serviceId:

        String(order._id),



      alreadyPaid:

        safeString(

          order.paymentStatus

        ) === "Paid",



      serviceStatus:

        safeString(order.status),

    };

  }





  // ==========================================================

  // LAB

  // ==========================================================



  if (serviceType === "Lab") {



    if (!isValidObjectId(serviceId)) {

      throw new Error(

        "Invalid lab booking ID."

      );

    }





    const LabOrder =

      getLabOrderModel();





    const labOrder =

      await LabOrder.findById(

        serviceId

      );





    if (!labOrder) {

      throw new Error(

        "Lab booking not found."

      );

    }





    const amount =

      Number(labOrder.totalAmount);





    if (

      !Number.isFinite(amount) ||

      amount <= 0

    ) {

      throw new Error(

        "Invalid lab booking amount."

      );

    }





    return {



      service: labOrder,



      amount,



      patientId:

        safeString(

          labOrder.patientId

        ),



      patientName:

        safeString(

          labOrder.patientName

        ),



      patientPhone:

        safeString(

          labOrder.patientPhone

        ),



      providerId:

        safeString(

          labOrder.labId

        ),



      providerType: "Lab",



      serviceType: "Lab",



      serviceId:

        String(labOrder._id),



      alreadyPaid:

        safeString(

          labOrder.paymentStatus

        ) === "Paid",



      serviceStatus:

        safeString(

          labOrder.status

        ),

    };

  }





  throw new Error(

    `Payment for service "${serviceType}" is not enabled.`

  );

};





// ============================================================

// PATIENT VALIDATION

// ============================================================



const validatePatientForService = (

  data,

  userId,

  userPhone

) => {



  // Doctor payment is allowed before

  // appointment creation.



  if (

    data.serviceType === "Doctor"

  ) {

    return true;

  }





  const requestedUserId =

    safeString(userId);





  const requestedPhone =

    safeString(userPhone);





  const matchesId =

    requestedUserId &&

    data.patientId &&

    requestedUserId ===

      data.patientId;





  const matchesPhone =

    requestedPhone &&

    data.patientPhone &&

    requestedPhone ===

      data.patientPhone;





  return Boolean(

    matchesId ||

    matchesPhone

  );

};





// ============================================================

// MARK SERVICE PAID

// ============================================================



const markServicePaid = async (

  data,

  paymentId,

  razorpayOrderId

) => {



  // ==========================================================

  // DOCTOR

  // ==========================================================



  if (

    data.serviceType === "Doctor"

  ) {



    // Doctor appointments are handled

    // by verifyDoctorPayment().



    return;

  }





  // ==========================================================

  // MEDICINE

  // ==========================================================



  if (

    data.serviceType === "Medicine"

  ) {



    await Order.findByIdAndUpdate(

      data.serviceId,

      {

        $set: {

          paymentStatus: "Paid",

          paymentId:

            paymentId || "",

          razorpayOrderId:

            razorpayOrderId || "",

        },

      }

    );



    return;

  }





  // ==========================================================

  // LAB

  // ==========================================================



  if (

    data.serviceType === "Lab"

  ) {



    const LabOrder =

      getLabOrderModel();





    await LabOrder.findByIdAndUpdate(

      data.serviceId,

      {

        $set: {

          paymentStatus: "Paid",

          paymentId:

            paymentId || "",

          razorpayOrderId:

            razorpayOrderId || "",

        },

      }

    );



    return;

  }

};



// ============================================================

// CELL 2

// DOCTOR APPOINTMENT RAZORPAY UPI PAYMENT

// ============================================================



const Appointment = require("../models/Appointment");





// ------------------------------------------------------------

// CREATE DOCTOR APPOINTMENT + RAZORPAY ORDER

// POST /api/payment/create-doctor-order

// ------------------------------------------------------------



exports.createDoctorOrder = async (req, res) => {

  try {

    const config = checkRazorpayConfiguration();



    if (!config.success) {

      return res.status(500).json(config);

    }



    const {

      userId,

      patientName,

      patientPhone,

      doctorId,

      doctorName,

      specialization,

      hospital,

      consultationType,

      appointmentDate,

      appointmentTime,

    } = req.body;



    if (

      !patientName ||

      !patientPhone ||

      !doctorId ||

      !appointmentDate ||

      !appointmentTime

    ) {

      return res.status(400).json({

        success: false,

        message:

          "patientName, patientPhone, doctorId, appointmentDate and appointmentTime are required.",

      });

    }



    if (!isValidObjectId(doctorId)) {

      return res.status(400).json({

        success: false,

        message: "Invalid doctor ID.",

      });

    }





    // --------------------------------------------------------

    // GET DOCTOR FROM DATABASE

    // --------------------------------------------------------



    const doctor = await mongoose.connection

      .collection("doctors")

      .findOne({

        _id: new mongoose.Types.ObjectId(doctorId),

      });



    if (!doctor) {

      return res.status(404).json({

        success: false,

        message: "Doctor not found.",

      });

    }





    // --------------------------------------------------------

    // GET FEE FROM DATABASE

    // NEVER TRUST FEE FROM FLUTTER

    // --------------------------------------------------------



    const amount = Number(doctor.fees);



    if (!Number.isFinite(amount) || amount <= 0) {

      return res.status(400).json({

        success: false,

        message: "Invalid doctor consultation fee.",

      });

    }





    // --------------------------------------------------------

    // NORMALIZE CONSULTATION TYPE

    // --------------------------------------------------------



    const normalizedConsultationType =

      safeString(consultationType).toLowerCase() ===

        "hospital visit"

        ? "Hospital Visit"

        : "Video Consultation";





    // --------------------------------------------------------

    // CHECK ACTIVE SLOT

    // --------------------------------------------------------



    const activeSlot = await Appointment.findOne({

      doctorId: String(doctorId),



      appointmentDate:

        String(appointmentDate),



      appointmentTime:

        String(appointmentTime),



      status: {

        $in: [

          "Pending",

          "Upcoming",

          "Accepted",

        ],

      },

    });



    if (activeSlot) {

      return res.status(409).json({

        success: false,

        message:

          "This appointment slot is already booked.",

      });

    }





    // --------------------------------------------------------

    // CREATE APPOINTMENT AS PENDING

    // --------------------------------------------------------



    let appointment;



    try {

      appointment = await Appointment.create({



        patientName:

          String(patientName).trim(),



        patientPhone:

          String(patientPhone).trim(),



        doctorId:

          String(doctorId),



        doctorName:

          String(

            doctor.name ||

            doctorName ||

            "Doctor"

          ).trim(),



        specialization:

          String(

            doctor.specialization ||

            specialization ||

            ""

          ).trim(),



        hospital:

          String(

            doctor.hospital ||

            hospital ||

            ""

          ).trim(),



        fees:

          amount,



        consultationType:

          normalizedConsultationType,



        appointmentDate:

          String(appointmentDate),



        appointmentTime:

          String(appointmentTime),



        reports: Array.isArray(req.files)
          ? req.files.map((file) => ({
              fileName: file.originalname || "",
              fileUrl:
                file.path ||
                file.secure_url ||
                file.url ||
                "",
              fileType: file.mimetype || "",
            }))
          : [],

        meetingId: "",



        consultationStatus:

          "Pending",



        prescriptionSent:

          false,



        paymentStatus:

          "Pending",



        razorpayOrderId:

          "",



        paymentId:

          "",



        status:

          "Pending",

      });



    } catch (error) {



      if (error?.code === 11000) {

        return res.status(409).json({

          success: false,

          message:

            "This appointment slot is already booked.",

        });

      }



      throw error;

    }





    // --------------------------------------------------------

    // CREATE RAZORPAY ORDER

    // --------------------------------------------------------



    const amountInPaise =

      Math.round(amount * 100);



const receipt =
  `HH_${String(appointment._id).slice(-12)}_${Date.now()}`;





    let razorpayOrder;



    try {



      razorpayOrder =

        await razorpay.orders.create({



          amount:

            amountInPaise,



          currency:

            "INR",



          receipt,



          notes: {



            healthhomeServiceType:

              "Doctor",



            healthhomeAppointmentId:

              String(

                appointment._id

              ),



            healthhomeDoctorId:

              String(

                doctor._id

              ),



            healthhomeUserId:

              safeString(userId),



            healthhomeUserPhone:

              safeString(

                patientPhone

              ),



            healthhomePaymentMode:

              "UPI_ONLY",

          },

        });



    } catch (error) {



      // Razorpay order failed.

      // Release the appointment slot.



      await Appointment.findByIdAndDelete(

        appointment._id

      );



      const details =

        getRazorpayErrorDetails(

          error

        );



      console.error(

        "❌ DOCTOR RAZORPAY ORDER CREATE ERROR:",

        details

      );



      return res.status(500).json({

        success: false,



        message:

          details.description ||

          details.message ||

          "Unable to create Razorpay order.",



        code:

          details.code || "",

      });

    }





    if (!razorpayOrder?.id) {



      await Appointment.findByIdAndDelete(

        appointment._id

      );



      return res.status(500).json({

        success: false,

        message:

          "Razorpay returned an invalid order.",

      });

    }





    // --------------------------------------------------------

    // SAVE RAZORPAY ORDER ON EXACT APPOINTMENT

    // --------------------------------------------------------



    appointment.razorpayOrderId =

      razorpayOrder.id;



    await appointment.save();





    // --------------------------------------------------------

    // CREATE CENTRAL PENDING PAYMENT RECORD

    //

    // serviceId = appointmentId

    // providerId = doctorId

    // --------------------------------------------------------



    let paymentRecord =

      await Payment.findOne({

        orderId:

          razorpayOrder.id,

      });





    if (!paymentRecord) {



      paymentRecord =

        await Payment.create({



          orderReferenceId:

            String(

              appointment._id

            ),



          



          orderId:

            razorpayOrder.id,

// Temporary unique value until Razorpay payment succeeds
paymentId:
  `PENDING_${razorpayOrder.id}`,

signature:
  "",

          



          userId: safeString(userId) || safeString(patientPhone),



          userName:

            String(

              patientName

            ).trim(),



          userPhone:

            String(

              patientPhone

            ).trim(),



          serviceType:

            "Doctor",



          serviceId:

            String(

              appointment._id

            ),



          amount:

            amount,



          currency:

            "INR",



          paymentMethod:

            "UPI",



          status:

            "Pending",



          razorpayStatus:

            razorpayOrder.status ||

            "created",



          settlementStatus:

            "Pending",



          providerId:

            String(

              doctor._id

            ),



          providerType:

            "Doctor",



          platformFee:

            0,



          providerAmount:

            amount,



          cashCollected:

            false,



          cashCollectedAt:

            null,

        });

    }





    // --------------------------------------------------------

    // SEND ORDER DETAILS TO FLUTTER

    // --------------------------------------------------------



return res.status(200).json({
  success: true,

  message: "Doctor appointment payment order created.",

  key: razorpayKeyId,

  // IMPORTANT: return appointment ID directly
  appointmentId: String(appointment._id),

  appointment: {
    id: String(appointment._id),

    doctorId: String(doctor._id),

    doctorName: appointment.doctorName,

    appointmentDate: appointment.appointmentDate,

    appointmentTime: appointment.appointmentTime,

    consultationType: appointment.consultationType,

    amount: amount,

    paymentStatus: "Pending",

    status: appointment.status,
  },

  order: {
    id: razorpayOrder.id,

    amount: Number(razorpayOrder.amount),

    currency: razorpayOrder.currency || "INR",

    status: razorpayOrder.status || "created",

    receipt: razorpayOrder.receipt || receipt,
  },

  payment: {
    paymentRecordId: String(paymentRecord._id),

    serviceType: "Doctor",

    serviceId: String(appointment._id),

    amount: amount,

    currency: "INR",

    paymentMethod: "UPI",

    status: "Pending",
  },
});


  } catch (error) {
    console.error("CREATE DOCTOR ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create doctor appointment payment order.",
    });
  }
};







// ------------------------------------------------------------

// VERIFY DOCTOR UPI PAYMENT

// POST /api/payment/verify-doctor-payment

// ------------------------------------------------------------



exports.verifyDoctorPayment = async (

  req,

  res

) => {



  try {



    const config =

      checkRazorpayConfiguration();



    if (!config.success) {

      return res.status(500).json(config);

    }




    const {

      appointmentId,

      userId,

      userPhone,

    } = req.body;

    // Accept both Flutter camelCase and Razorpay snake_case fields.
    const razorpay_order_id =
      safeString(req.body.razorpay_order_id) ||
      safeString(req.body.razorpayOrderId);

    const razorpay_payment_id =
      safeString(req.body.razorpay_payment_id) ||
      safeString(req.body.razorpayPaymentId);

    const razorpay_signature =
      safeString(req.body.razorpay_signature) ||
      safeString(req.body.razorpaySignature);





    // --------------------------------------------------------

    // BASIC VALIDATION

    // --------------------------------------------------------



    if (

      !appointmentId ||

      !razorpay_order_id ||

      !razorpay_payment_id ||

      !razorpay_signature

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "appointmentId, Razorpay order ID, payment ID and signature are required.",

      });

    }





    if (

      !isValidObjectId(

        appointmentId

      )

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "Invalid appointment ID.",

      });

    }





    // --------------------------------------------------------

    // GET EXACT APPOINTMENT

    // --------------------------------------------------------



    const appointment =

      await Appointment.findById(

        appointmentId

      );





    if (!appointment) {



      return res.status(404).json({



        success: false,



        paid: false,



        message:

          "Appointment not found.",

      });

    }





    // --------------------------------------------------------

    // VERIFY EXACT RAZORPAY ORDER

    // BELONGS TO THIS APPOINTMENT

    // --------------------------------------------------------



    if (

      safeString(

        appointment.razorpayOrderId

      ) !==

      safeString(

        razorpay_order_id

      )

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "Razorpay order does not belong to this appointment.",

      });

    }





    // --------------------------------------------------------

    // OPTIONAL PATIENT OWNERSHIP CHECK

    // --------------------------------------------------------



    if (

      safeString(userPhone) &&

      safeString(

        appointment.patientPhone

      ) &&

      safeString(userPhone) !==

        safeString(

          appointment.patientPhone

        )

    ) {



      return res.status(403).json({



        success: false,



        paid: false,



        message:

          "This appointment does not belong to this patient.",

      });

    }





    // --------------------------------------------------------

    // VERIFY RAZORPAY SIGNATURE

    // --------------------------------------------------------



const generatedSignature = crypto
  .createHmac("sha256", razorpayKeySecret)
  .update(
    `${razorpay_order_id}|${razorpay_payment_id}`
  )
  .digest("hex");

const generatedBuffer = Buffer.from(
  generatedSignature,
  "utf8"
);

const receivedBuffer = Buffer.from(
  razorpay_signature,
  "utf8"
);

const signatureMatches =
  generatedBuffer.length === receivedBuffer.length &&
  crypto.timingSafeEqual(
    generatedBuffer,
    receivedBuffer
  );

if (!signatureMatches) {
  return res.status(400).json({
    success: false,
    paid: false,
    message: "Invalid Razorpay payment signature.",
  });
}





    // --------------------------------------------------------

    // FETCH PAYMENT DIRECTLY FROM RAZORPAY

    // SERVER-SIDE VERIFICATION

    // --------------------------------------------------------



    let razorpayPayment;



    try {



      razorpayPayment =

        await razorpay.payments.fetch(

          razorpay_payment_id

        );



    } catch (error) {



      const details =

        getRazorpayErrorDetails(

          error

        );



      console.error(

        "❌ RAZORPAY PAYMENT FETCH ERROR:",

        details

      );



      return res.status(502).json({



        success: false,



        paid: false,



        message:

          details.description ||

          details.message ||

          "Unable to fetch payment from Razorpay.",

      });

    }





    if (!razorpayPayment) {



      return res.status(502).json({



        success: false,



        paid: false,



        message:

          "Razorpay payment was not found.",

      });

    }





    // --------------------------------------------------------

    // ORDER MATCH

    // --------------------------------------------------------



    if (

      safeString(

        razorpayPayment.order_id

      ) !==

      safeString(

        razorpay_order_id

      )

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "Razorpay payment does not belong to this order.",

      });

    }





    // --------------------------------------------------------

    // AMOUNT MATCH

    // --------------------------------------------------------



    const expectedAmountPaise =

      Math.round(

        Number(

          appointment.fees

        ) * 100

      );





    const actualAmountPaise =

      Number(

        razorpayPayment.amount

      );





    if (

      !Number.isFinite(

        expectedAmountPaise

      ) ||

      actualAmountPaise !==

        expectedAmountPaise

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "Payment amount does not match the appointment fee.",

      });

    }





    // --------------------------------------------------------

    // CURRENCY MATCH

    // --------------------------------------------------------



    if (

      (

        safeString(

          razorpayPayment.currency

        ) ||

        "INR"

      ) !== "INR"

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "Unsupported payment currency.",

      });

    }





    // --------------------------------------------------------

    // UPI ONLY

    // SERVER-SIDE ENFORCEMENT

    // --------------------------------------------------------



    if (

      safeString(

        razorpayPayment.method

      ).toLowerCase() !== "upi"

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "Only UPI payments are accepted for doctor appointments.",

      });

    }





    // --------------------------------------------------------

    // PAYMENT MUST BE CAPTURED

    // --------------------------------------------------------



    if (

      razorpayPayment.status !==

      "captured"

    ) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          `Payment is not captured. Current status: ${razorpayPayment.status}`,

      });

    }





    // --------------------------------------------------------

    // DUPLICATE / IDEMPOTENT PAYMENT HANDLING

    // --------------------------------------------------------



    let paymentRecord =

      await Payment.findOne({



        paymentId:

          razorpay_payment_id,

      });





    if (paymentRecord) {



      if (

        paymentRecord.serviceType !==

          "Doctor" ||



        safeString(

          paymentRecord.serviceId

        ) !==

          String(

            appointment._id

          )

      ) {



        return res.status(409).json({



          success: false,



          paid: false,



          message:

            "This Razorpay payment is already linked to another HealthHome record.",

        });

      }





      appointment.paymentStatus =

        "Paid";



      appointment.paymentId =

        razorpay_payment_id;



      appointment.razorpayOrderId =

        razorpay_order_id;



      await appointment.save();





      paymentRecord.status =

        "Success";



      paymentRecord.razorpayStatus =

        razorpayPayment.status;



      paymentRecord.paymentMethod =

        "UPI";



      paymentRecord.signature =

        razorpay_signature;



      await paymentRecord.save();





      return res.status(200).json({



        success: true,



        paid: true,



        message:

          "Doctor appointment payment already verified.",



        appointment: {



          id:

            String(

              appointment._id

            ),



          paymentStatus:

            appointment.paymentStatus,



          status:

            appointment.status,



          doctorId:

            appointment.doctorId,



          appointmentDate:

            appointment.appointmentDate,



          appointmentTime:

            appointment.appointmentTime,

        },



        payment: {



          paymentRecordId:

            String(

              paymentRecord._id

            ),



          paymentId:

            paymentRecord.paymentId,



          orderId:

            paymentRecord.orderId,



          amount:

            paymentRecord.amount,



          currency:

            paymentRecord.currency,



          paymentMethod:

            "UPI",



          status:

            "Success",

        },

      });

    }





    // --------------------------------------------------------

    // FIND PENDING PAYMENT RECORD

    // --------------------------------------------------------



    paymentRecord =

      await Payment.findOne({



        orderId:

          razorpay_order_id,



        serviceType:

          "Doctor",



        serviceId:

          String(

            appointment._id

          ),

      });





    if (!paymentRecord) {



      return res.status(400).json({



        success: false,



        paid: false,



        message:

          "Pending HealthHome payment record was not found for this appointment.",

      });

    }





    // --------------------------------------------------------

    // FINALIZE PAYMENT RECORD

    // --------------------------------------------------------



    paymentRecord.paymentId =

      razorpay_payment_id;



    paymentRecord.signature =

      razorpay_signature;



    paymentRecord.amount =

      actualAmountPaise / 100;



    paymentRecord.currency =

      "INR";



    paymentRecord.paymentMethod =

      "UPI";



    paymentRecord.status =

      "Success";



    paymentRecord.razorpayStatus =

      razorpayPayment.status;



    paymentRecord.settlementStatus =

      "Pending";



    paymentRecord.providerId =

      safeString(

        appointment.doctorId

      );



    paymentRecord.providerType =

      "Doctor";



    paymentRecord.providerAmount =

      actualAmountPaise / 100;



    await paymentRecord.save();





    // --------------------------------------------------------

    // FINALIZE EXACT APPOINTMENT

    // --------------------------------------------------------



    appointment.paymentStatus =

      "Paid";



    appointment.paymentId =

      razorpay_payment_id;



    appointment.razorpayOrderId =

      razorpay_order_id;



    await appointment.save();





    console.log(

      "=============================================="

    );



    console.log(

      "✅ DOCTOR UPI PAYMENT VERIFIED"

    );



    console.log(

      "APPOINTMENT:",

      appointment._id

    );



    console.log(

      "RAZORPAY ORDER:",

      razorpay_order_id

    );



    console.log(

      "RAZORPAY PAYMENT:",

      razorpay_payment_id

    );



    console.log(

      "AMOUNT:",

      actualAmountPaise / 100

    );



    console.log(

      "METHOD:",

      razorpayPayment.method

    );



    console.log(

      "=============================================="

    );





    // --------------------------------------------------------

    // SUCCESS RESPONSE

    // --------------------------------------------------------



    return res.status(200).json({



      success:

        true,



      paid:

        true,



      message:

        "UPI payment verified and appointment confirmed.",



      appointment: {



        id:

          String(

            appointment._id

          ),



        patientName:

          appointment.patientName,



        doctorId:

          appointment.doctorId,



        doctorName:

          appointment.doctorName,



        appointmentDate:

          appointment.appointmentDate,



        appointmentTime:

          appointment.appointmentTime,



        consultationType:

          appointment.consultationType,



        fees:

          appointment.fees,



        paymentStatus:

          appointment.paymentStatus,



        status:

          appointment.status,

      },



      payment: {



        paymentRecordId:

          String(

            paymentRecord._id

          ),



        paymentId:

          paymentRecord.paymentId,



        orderId:

          paymentRecord.orderId,



        amount:

          paymentRecord.amount,



        currency:

          paymentRecord.currency,



        paymentMethod:

          "UPI",



        status:

          paymentRecord.status,

      },

    });



  } catch (error) {



    console.error(

      "❌ VERIFY DOCTOR PAYMENT ERROR:",

      error

    );



    return res.status(500).json({



      success: false,



      paid: false,



      message:

        "Doctor payment verification failed.",

    });

  }

};





// ------------------------------------------------------------

// CANCEL UNPAID DOCTOR APPOINTMENT

// POST /api/payment/cancel-doctor-order

// ------------------------------------------------------------

//

// Call this when the patient closes/cancels Razorpay Checkout

// before successful payment.

//

// This releases the appointment slot.

// ------------------------------------------------------------



exports.cancelDoctorOrder = async (

  req,

  res

) => {



  try {



    const {
      appointmentId,
      razorpayOrderId,
      userPhone,
    } = req.body;

    const requestedOrderId =
      safeString(razorpayOrderId) ||
      safeString(req.body.razorpay_order_id);





    // --------------------------------------------------------

    // VALIDATE APPOINTMENT ID

    // --------------------------------------------------------



    if (

      !appointmentId ||

      !isValidObjectId(

        appointmentId

      )

    ) {



      return res.status(400).json({



        success: false,



        message:

          "Valid appointmentId is required.",

      });

    }





    // --------------------------------------------------------

    // GET APPOINTMENT

    // --------------------------------------------------------



    const appointment =

      await Appointment.findById(

        appointmentId

      );





    if (!appointment) {



      return res.status(404).json({



        success: false,



        message:

          "Appointment not found.",

      });

    }





    // --------------------------------------------------------

    // EXACT RAZORPAY ORDER CHECK
    // --------------------------------------------------------

    if (!requestedOrderId) {
      return res.status(400).json({
        success: false,
        message: "razorpayOrderId is required.",
      });
    }

    if (
      safeString(appointment.razorpayOrderId) !==
      requestedOrderId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Razorpay order does not belong to this appointment.",
      });
    }

    // --------------------------------------------------------

    // PATIENT OWNERSHIP CHECK

    // --------------------------------------------------------



    if (

      safeString(userPhone) &&

      safeString(

        appointment.patientPhone

      ) &&

      safeString(userPhone) !==

        safeString(

          appointment.patientPhone

        )

    ) {



      return res.status(403).json({



        success: false,



        message:

          "This appointment does not belong to this patient.",

      });

    }





    // --------------------------------------------------------

    // DON'T CANCEL ALREADY PAID APPOINTMENT

    // --------------------------------------------------------



    if (

      appointment.paymentStatus ===

      "Paid"

    ) {



      return res.status(400).json({



        success: false,



        message:

          "A paid appointment cannot be cancelled through this endpoint.",

      });

    }





    // --------------------------------------------------------

    // ONLY PENDING APPOINTMENTS

    // --------------------------------------------------------



    if (

      appointment.status !==

      "Pending"

    ) {



      return res.status(400).json({



        success: false,



        message:

          "Only a pending unpaid appointment can be cancelled here.",

      });

    }





    // --------------------------------------------------------

    // CANCEL APPOINTMENT

    // --------------------------------------------------------



    appointment.paymentStatus =

      "Failed";



    appointment.status =

      "Cancelled";



    await appointment.save();





    // --------------------------------------------------------

    // UPDATE PAYMENT RECORD

    // --------------------------------------------------------



    await Payment.updateOne(



      {

        serviceType:

          "Doctor",



        serviceId:

          String(

            appointment._id

          ),



        status:

          "Pending",

      },



      {

        $set: {



          status:

            "Failed",



          razorpayStatus:

            "cancelled_by_user",

        },

      }

    );





    // --------------------------------------------------------

    // SUCCESS

    // --------------------------------------------------------



    return res.status(200).json({



      success:

        true,



      message:

        "Unpaid doctor appointment cancelled and slot released.",



      appointmentId:

        String(

          appointment._id

        ),

    });



  } catch (error) {



    console.error(

      "❌ CANCEL DOCTOR ORDER ERROR:",

      error

    );



    return res.status(500).json({



      success: false,



      message:

        "Unable to cancel doctor appointment.",

    });

  }

};



// ============================================================

// CELL 3

// EXISTING MEDICINE + LAB PAYMENT SYSTEM

// QR COMPATIBILITY

// WEBHOOK

// ============================================================





// ============================================================

// CREATE NORMAL RAZORPAY ORDER

//

// Used by:

// 1. Medicine orders

// 2. Lab orders

//

// DOCTOR PAYMENT MUST USE:

// createDoctorOrder()

// ============================================================



exports.createOrder = async (req, res) => {

  try {



    const {

      serviceType,

      serviceId,

      userId,

      userName,

      userPhone,

    } = req.body;





    // --------------------------------------------------------

    // VALIDATE REQUEST

    // --------------------------------------------------------



    if (

      !serviceType ||

      !serviceId

    ) {

      return res.status(400).json({

        success: false,

        message:

          "serviceType and serviceId are required.",

      });

    }





    // --------------------------------------------------------

    // ONLY EXISTING SERVICES

    // --------------------------------------------------------



    if (

      ![

        "Medicine",

        "Lab",

      ].includes(serviceType)

    ) {

      return res.status(400).json({

        success: false,

        message:

          "Use the doctor payment endpoint for doctor appointments.",

      });

    }





    // --------------------------------------------------------

    // RAZORPAY CONFIG

    // --------------------------------------------------------



    const config =

      checkRazorpayConfiguration();



    if (!config.success) {

      return res.status(500).json(config);

    }





    // --------------------------------------------------------

    // GET SERVICE DATA

    // --------------------------------------------------------



    const data =

      await getServiceData(

        serviceType,

        serviceId

      );





    // --------------------------------------------------------

    // VALIDATE PATIENT

    // --------------------------------------------------------



    const validPatient =

      validatePatientForService(

        data,

        userId,

        userPhone

      );





    if (!validPatient) {

      return res.status(403).json({

        success: false,

        message:

          "This payment does not belong to the requested patient.",

      });

    }





    // --------------------------------------------------------

    // ALREADY PAID

    // --------------------------------------------------------



    if (data.alreadyPaid) {

      return res.status(400).json({

        success: false,

        message:

          "This order has already been paid.",

      });

    }





    // --------------------------------------------------------

    // AMOUNT

    // --------------------------------------------------------



    const amount =

      Number(data.amount);





    if (

      !Number.isFinite(amount) ||

      amount <= 0

    ) {

      return res.status(400).json({

        success: false,

        message:

          "Invalid payment amount.",

      });

    }





    const amountInPaise =

      Math.round(

        amount * 100

      );





    // --------------------------------------------------------

    // RAZORPAY ORDER

    // --------------------------------------------------------



    const razorpayOrder =

      await razorpay.orders.create({



        amount:

          amountInPaise,



        currency:

          "INR",



        receipt:

          `HH_${serviceType}_${Date.now()}`,



        notes: {



          serviceType:

            serviceType,



          serviceId:

            String(serviceId),



          userId: normalizedUserId,



          userPhone:

            safeString(userPhone),

        },

      });





    // --------------------------------------------------------

    // CREATE PAYMENT RECORD

    // --------------------------------------------------------



    const paymentRecord =

      await Payment.create({



        orderReferenceId:

          String(serviceId),



        orderId:

          razorpayOrder.id,



        userId:

          safeString(userId),



        userName:

          safeString(userName) ||

          data.patientName ||

          "HealthHome User",



        userPhone:

          safeString(userPhone) ||

          data.patientPhone,



        serviceType:

          serviceType,



        serviceId:

          String(serviceId),



        amount:

          amount,



        currency:

          "INR",



        paymentMethod:

          "ONLINE",



        status:

          "Pending",



        razorpayStatus:

          razorpayOrder.status ||

          "created",



        providerId:

          data.providerId,



        providerType:

          data.providerType,



        providerAmount:

          amount,

      });





    // --------------------------------------------------------

    // RESPONSE

    // --------------------------------------------------------



    return res.status(200).json({



      success: true,



      key:

        razorpayKeyId,



      order: {



        id:

          razorpayOrder.id,



        amount:

          razorpayOrder.amount,



        currency:

          razorpayOrder.currency,



        status:

          razorpayOrder.status,

      },



      payment: {



        paymentRecordId:

          String(

            paymentRecord._id

          ),



        serviceType:

          serviceType,



        serviceId:

          String(serviceId),



        amount:

          amount,



        currency:

          "INR",



        status:

          "Pending",

      },

    });



  } catch (error) {



    console.error(

      "❌ CREATE ORDER ERROR:",

      error

    );



    const details =

      getRazorpayErrorDetails(

        error

      );



    return res.status(500).json({



      success: false,



      message:

        details.description ||

        details.message ||

        "Unable to create payment order.",

    });

  }

};





// ============================================================

// VERIFY NORMAL MEDICINE / LAB PAYMENT

// ============================================================



exports.verifyPayment = async (

  req,

  res

) => {



  try {



    const {

      razorpay_order_id,

      razorpay_payment_id,

      razorpay_signature,

      serviceType,

      serviceId,

      userId,

      userPhone,

    } = req.body;





    // --------------------------------------------------------

    // VALIDATION

    // --------------------------------------------------------



    if (

      !razorpay_order_id ||

      !razorpay_payment_id ||

      !razorpay_signature ||

      !serviceType ||

      !serviceId

    ) {

      return res.status(400).json({

        success: false,

        paid: false,

        message:

          "Payment verification data is incomplete.",

      });

    }





    // --------------------------------------------------------

    // DOCTOR MUST USE NEW FLOW

    // --------------------------------------------------------



    if (

      serviceType === "Doctor"

    ) {

      return res.status(400).json({

        success: false,

        paid: false,

        message:

          "Doctor payments must use verify-doctor-payment.",

      });

    }





    // --------------------------------------------------------

    // GET SERVICE

    // --------------------------------------------------------



    const data =

      await getServiceData(

        serviceType,

        serviceId

      );





    // --------------------------------------------------------

    // VALIDATE PATIENT

    // --------------------------------------------------------



    const validPatient =

      validatePatientForService(

        data,

        userId,

        userPhone

      );





    if (!validPatient) {

      return res.status(403).json({

        success: false,

        paid: false,

        message:

          "Payment does not belong to this patient.",

      });

    }





    // --------------------------------------------------------

    // SIGNATURE

    // --------------------------------------------------------



    const generatedSignature =

      crypto

        .createHmac(

          "sha256",

          razorpayKeySecret

        )

        .update(

          `${razorpay_order_id}|${razorpay_payment_id}`

        )

        .digest("hex");





    const signatureMatches =

      generatedSignature ===

      razorpay_signature;





    if (!signatureMatches) {

      return res.status(400).json({

        success: false,

        paid: false,

        message:

          "Invalid payment signature.",

      });

    }





    // --------------------------------------------------------

    // FETCH RAZORPAY PAYMENT

    // --------------------------------------------------------



    const razorpayPayment =

      await razorpay.payments.fetch(

        razorpay_payment_id

      );





    // --------------------------------------------------------

    // ORDER MATCH

    // --------------------------------------------------------



    if (

      safeString(

        razorpayPayment.order_id

      ) !==

      safeString(

        razorpay_order_id

      )

    ) {

      return res.status(400).json({

        success: false,

        paid: false,

        message:

          "Payment does not belong to this order.",

      });

    }





    // --------------------------------------------------------

    // AMOUNT MATCH

    // --------------------------------------------------------



    const expectedAmount =

      Math.round(

        Number(data.amount) * 100

      );





    if (

      Number(

        razorpayPayment.amount

      ) !==

      expectedAmount

    ) {

      return res.status(400).json({

        success: false,

        paid: false,

        message:

          "Payment amount does not match.",

      });

    }





    // --------------------------------------------------------

    // CURRENCY

    // --------------------------------------------------------



    if (

      safeString(

        razorpayPayment.currency

      ) !== "INR"

    ) {

      return res.status(400).json({

        success: false,

        paid: false,

        message:

          "Invalid payment currency.",

      });

    }





    // --------------------------------------------------------

    // CAPTURED

    // --------------------------------------------------------



    if (

      razorpayPayment.status !==

      "captured"

    ) {

      return res.status(400).json({

        success: false,

        paid: false,

        message:

          "Payment has not been captured.",

      });

    }





    // --------------------------------------------------------

    // FIND PAYMENT RECORD

    // --------------------------------------------------------



    let paymentRecord =

      await Payment.findOne({

        orderId:

          razorpay_order_id,

        serviceType:

          serviceType,

        serviceId:

          String(serviceId),

      });





    if (!paymentRecord) {



      paymentRecord =

        await Payment.create({



          orderId:

            razorpay_order_id,



          paymentId:

            razorpay_payment_id,



          signature:

            razorpay_signature,



          userId:

            safeString(userId),



          userName:

            data.patientName ||

            "HealthHome User",



          userPhone:

            data.patientPhone ||

            safeString(userPhone),



          serviceType:

            serviceType,



          serviceId:

            String(serviceId),



          amount:

            Number(data.amount),



          currency:

            "INR",



          paymentMethod:

            safeString(

              razorpayPayment.method

            ).toUpperCase(),



          status:

            "Success",



          razorpayStatus:

            razorpayPayment.status,



          providerId:

            data.providerId,



          providerType:

            data.providerType,



          providerAmount:

            Number(data.amount),

        });



    } else {



      paymentRecord.paymentId =

        razorpay_payment_id;



      paymentRecord.signature =

        razorpay_signature;



      paymentRecord.status =

        "Success";



      paymentRecord.razorpayStatus =

        razorpayPayment.status;



      paymentRecord.paymentMethod =

        safeString(

          razorpayPayment.method

        ).toUpperCase();



      await paymentRecord.save();

    }





    // --------------------------------------------------------

    // MARK MEDICINE / LAB SERVICE PAID

    // --------------------------------------------------------



    await markServicePaid(

      data,

      razorpay_payment_id,

      razorpay_order_id

    );





    // --------------------------------------------------------

    // SUCCESS

    // --------------------------------------------------------



    return res.status(200).json({



      success: true,



      paid: true,



      message:

        "Payment verified successfully.",



      payment: {



        paymentId:

          razorpay_payment_id,



        orderId:

          razorpay_order_id,



        amount:

          Number(data.amount),



        currency:

          "INR",



        status:

          "Success",

      },

    });



  } catch (error) {



    console.error(

      "❌ VERIFY PAYMENT ERROR:",

      error

    );



    return res.status(500).json({



      success: false,



      paid: false,



      message:

        "Payment verification failed.",

    });

  }

};





// ============================================================

// OLD QR STATUS — COMPATIBILITY ONLY

// ============================================================



exports.getQrPaymentStatus =

  async (req, res) => {



    return res.status(410).json({



      success: false,



      paid: false,



      message:

        "QR payments are no longer used. Please use Razorpay Checkout.",

    });

  };





// ============================================================

// OLD QR CLOSE — COMPATIBILITY ONLY

// ============================================================



exports.closeQr =

  async (req, res) => {



    return res.status(410).json({



      success: false,



      message:

        "QR payments are no longer used. Please use Razorpay Checkout.",

    });

  };





// ============================================================

// RAZORPAY WEBHOOK

// ============================================================



exports.webhook =

  async (req, res) => {



    try {



      if (!razorpayWebhookSecret) {



        return res.status(500).json({

          success: false,

          message:

            "Webhook secret is not configured.",

        });

      }





      const signature =

        req.headers[

          "x-razorpay-signature"

        ];





      if (!signature) {



        return res.status(400).json({

          success: false,

          message:

            "Webhook signature missing.",

        });

      }





      const rawBody =

        Buffer.isBuffer(req.body)

          ? req.body

          : Buffer.from(

              JSON.stringify(req.body)

            );





      const expectedSignature =

        crypto

          .createHmac(

            "sha256",

            razorpayWebhookSecret

          )

          .update(rawBody)

          .digest("hex");





      if (

        expectedSignature !==

        signature

      ) {



        return res.status(400).json({

          success: false,

          message:

            "Invalid webhook signature.",

        });

      }





      const event =

        Buffer.isBuffer(req.body)

          ? JSON.parse(

              req.body.toString()

            )

          : req.body;





      // ------------------------------------------------------

      // PAYMENT CAPTURED

      // ------------------------------------------------------



      if (

        event.event ===

        "payment.captured"

      ) {



        const payment =

          event.payload?.payment?.entity;





        if (payment) {



          await Payment.findOneAndUpdate(



            {

              $or: [

                {

                  paymentId:

                    payment.id,

                },



                {

                  orderId:

                    payment.order_id,

                },

              ],

            },



            {

              $set: {



                paymentId:

                  payment.id,



                razorpayStatus:

                  payment.status,



                paymentMethod:

                  safeString(

                    payment.method

                  ).toUpperCase(),



                status:

                  "Success",

              },

            }

          );

        }

      }





      // ------------------------------------------------------

      // PAYMENT FAILED

      // ------------------------------------------------------



      if (

        event.event ===

        "payment.failed"

      ) {



        const payment =

          event.payload?.payment?.entity;





        if (payment) {



          await Payment.findOneAndUpdate(



            {

              orderId:

                payment.order_id,

            },



            {

              $set: {



                paymentId:

                  payment.id || "",



                razorpayStatus:

                  payment.status ||

                  "failed",



                status:

                  "Failed",

              },

            }

          );

        }

      }





      return res.status(200).json({

        success: true,

      });



    } catch (error) {



      console.error(

        "❌ RAZORPAY WEBHOOK ERROR:",

        error

      );



      return res.status(500).json({

        success: false,

        message:

          "Webhook processing failed.",

      });

    }

  };