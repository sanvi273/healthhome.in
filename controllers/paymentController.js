const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");

const Payment = require("../models/Payment");
const Order = require("../models/orderModel");
const Appointment = require("../models/Appointment");
const User = require("../models/user");
const uploadToCloudinary = require("../utils/cloudinaryUpload");
const { uploadPatientReport } = require("../utils/patientReportStorage");

const appointmentWithoutReports = (appointment) => {
  const data =
    typeof appointment?.toObject === "function"
      ? appointment.toObject()
      : { ...appointment };
  delete data.reports;
  return data;
};

// ============================================================
// RAZORPAY CONFIGURATION
// ============================================================

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!razorpayKeyId) {
  console.error("❌ RAZORPAY_KEY_ID is missing from environment variables.");
}

if (!razorpayKeySecret) {
  console.error("❌ RAZORPAY_KEY_SECRET is missing from environment variables.");
}

if (!razorpayWebhookSecret) {
  console.warn("⚠️ RAZORPAY_WEBHOOK_SECRET is not configured on the server.");
}

const razorpay = new Razorpay({
  key_id: razorpayKeyId || "placeholder",
  key_secret: razorpayKeySecret || "placeholder",
});

// ============================================================
// HELPERS
// ============================================================

const safeString = (value) => String(value ?? "").trim();

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(String(id));

const getLabOrderModel = () => require("../models/labOrder");

const checkRazorpayConfiguration = () => {
  if (!razorpayKeyId || !razorpayKeySecret) {
    return {
      success: false,
      message: "Razorpay credentials are not configured on the server.",
    };
  }
  return { success: true };
};

// Normalize service type string
const normalizeServiceType = (type) => {
  const s = safeString(type).toLowerCase();
  if (s === "doctor") return "Doctor";
  if (s === "lab" || s === "laboratory") return "Lab";
  if (s === "medicine" || s === "pharmacy") return "Medicine";
  return safeString(type);
};

// Helper: Expire stale pending doctor appointments (> 15 minutes old)
// to automatically release blocked slots when users abandon checkout.
const expireStalePendingAppointments = async (doctorId, date, time) => {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const filter = {
      doctorId: String(doctorId),
      appointmentDate: String(date),
      appointmentTime: String(time),
      status: "Pending",
      paymentStatus: "Pending",
      createdAt: { $lt: fifteenMinutesAgo },
    };

    const staleAppointments = await Appointment.find(filter);
    if (staleAppointments.length > 0) {
      await Appointment.updateMany(filter, {
        $set: {
          status: "Cancelled",
          paymentStatus: "Failed",
        },
      });

      for (const stale of staleAppointments) {
        await Payment.updateMany(
          {
            $or: [
              { appointmentId: String(stale._id) },
              { orderReferenceId: String(stale._id) },
              { razorpayOrderId: stale.razorpayOrderId },
            ],
            status: "Pending",
          },
          {
            $set: {
              status: "Cancelled",
              paymentStatus: "CANCELLED",
              failureReason: "Payment reservation expired.",
            },
          }
        );
      }
      console.log(
        `[Payment] Auto-expired ${staleAppointments.length} abandoned appointment(s) for doctor ${doctorId} at ${date} ${time}`
      );
    }
  } catch (err) {
    console.error("[Payment] Error expiring stale appointments:", err.message);
  }
};

// Helper: Normalize payment method from Razorpay entity
const formatPaymentMethod = (method) => {
  const m = safeString(method).toLowerCase();
  if (m === "upi") return "UPI";
  if (m === "netbanking") return "Net Banking";
  if (m === "card") return "Card";
  if (m === "wallet") return "Wallet";
  if (m === "cod") return "COD";
  if (!m) return "ONLINE";
  return m.toUpperCase();
};

// ============================================================
// SERVICE DATA FETCHING & VALIDATION
// ============================================================

const getServiceData = async (serviceTypeInput, serviceId) => {
  const serviceType = normalizeServiceType(serviceTypeInput);

  if (!serviceType || !serviceId) {
    throw new Error("serviceType and serviceId are required.");
  }

  // 1. DOCTOR
  if (serviceType === "Doctor") {
    if (!isValidObjectId(serviceId)) {
      throw new Error("Invalid doctor ID.");
    }

    const doctor = await mongoose.connection
      .collection("doctors")
      .findOne({ _id: new mongoose.Types.ObjectId(serviceId) });

    if (!doctor) {
      throw new Error("Doctor not found.");
    }

    const amount = Number(doctor.fees);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid doctor consultation fee.");
    }

    return {
      service: doctor,
      amount,
      patientId: "",
      patientName: "",
      patientPhone: "",
      providerId: String(doctor._id),
      providerType: "Doctor",
      serviceType: "Doctor",
      serviceId: String(doctor._id),
      alreadyPaid: false,
      serviceStatus: "",
    };
  }

  // 2. MEDICINE (Pharmacy Order)
  if (serviceType === "Medicine") {
    if (!isValidObjectId(serviceId)) {
      throw new Error("Invalid medicine order ID.");
    }

    const order = await Order.findById(serviceId);
    if (!order) {
      throw new Error("Medicine order not found.");
    }

    const amount = Number(order.totalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid medicine order amount.");
    }

    return {
      service: order,
      amount,
      patientId: safeString(order.patientId),
      patientName: safeString(order.patientName),
      patientPhone: safeString(order.patientPhone),
      providerId: safeString(order.pharmacyId),
      providerType: "Pharmacy",
      serviceType: "Medicine",
      serviceId: String(order._id),
      alreadyPaid: safeString(order.paymentStatus).toLowerCase() === "paid",
      serviceStatus: safeString(order.status),
    };
  }

  // 3. LAB (Lab Order)
  if (serviceType === "Lab") {
    if (!isValidObjectId(serviceId)) {
      throw new Error("Invalid lab booking ID.");
    }

    const LabOrder = getLabOrderModel();
    const labOrder = await LabOrder.findById(serviceId);
    if (!labOrder) {
      throw new Error("Lab booking not found.");
    }

    const amount = Number(labOrder.totalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid lab booking amount.");
    }

    return {
      service: labOrder,
      amount,
      patientId: safeString(labOrder.patientId),
      patientName: safeString(labOrder.patientName),
      patientPhone: safeString(labOrder.patientPhone),
      providerId: safeString(labOrder.labId),
      providerType: "Lab",
      serviceType: "Lab",
      serviceId: String(labOrder._id),
      alreadyPaid: safeString(labOrder.paymentStatus).toLowerCase() === "paid",
      serviceStatus: safeString(labOrder.status),
    };
  }

  throw new Error(`Payment for service "${serviceType}" is not supported.`);
};

// Validate that the authenticated patient owns the order/booking
const validatePatientForService = (data, user) => {
  if (!data || !user) return false;
  if (data.serviceType === "Doctor") return true;

  const authUserId = safeString(user._id);
  const authPhone = safeString(user.phone);

  const bookingPatientId = safeString(data.patientId);
  const bookingPatientPhone = safeString(data.patientPhone);

  const matchesId = authUserId && bookingPatientId && authUserId === bookingPatientId;
  const matchesPhone = authPhone && bookingPatientPhone && authPhone === bookingPatientPhone;

  return Boolean(matchesId || matchesPhone);
};

// ============================================================
// MARK SERVICE PAID HELPER
// ============================================================

const markServicePaid = async (data, paymentId, razorpayOrderId, paymentRecordId) => {
  if (!data) return;

  const serviceType = normalizeServiceType(data.serviceType);

  if (serviceType === "Doctor") {
    await Appointment.findByIdAndUpdate(data.serviceId, {
      $set: {
        paymentStatus: "Paid",
        status: "Accepted",
        paymentId: safeString(paymentId),
        razorpayOrderId: safeString(razorpayOrderId),
      },
    });
    return;
  }

  if (serviceType === "Medicine") {
    await Order.findByIdAndUpdate(data.serviceId, {
      $set: {
        paymentStatus: "Paid",
        paymentMethod: "ONLINE",
        razorpayPaymentId: safeString(paymentId),
        razorpayOrderId: safeString(razorpayOrderId),
      },
    });
    return;
  }

  if (serviceType === "Lab") {
    const LabOrder = getLabOrderModel();
    await LabOrder.findByIdAndUpdate(data.serviceId, {
      $set: {
        paymentStatus: "Paid",
        razorpayPaymentId: safeString(paymentId),
        razorpayOrderId: safeString(razorpayOrderId),
        paymentRecordId: safeString(paymentRecordId),
      },
    });
    return;
  }
};

// ============================================================
// 1. CREATE PAYMENT ORDER (Medicine & Lab)
// ============================================================

exports.createOrder = async (req, res) => {
  try {
    const serviceType = normalizeServiceType(req.body.serviceType);
    const serviceId = safeString(req.body.serviceId);

    if (!serviceType || !serviceId) {
      return res.status(400).json({
        success: false,
        message: "serviceType and serviceId are required.",
      });
    }

    if (!["Medicine", "Lab"].includes(serviceType)) {
      return res.status(400).json({
        success: false,
        message: "Use the doctor payment endpoint for doctor appointments.",
      });
    }

    const config = checkRazorpayConfiguration();
    if (!config.success) {
      return res.status(500).json(config);
    }

    // Authenticated user verification
    const authenticatedUser = await User.findById(req.user.id);
    if (!authenticatedUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found.",
      });
    }

    if (authenticatedUser.role !== "patient") {
      return res.status(403).json({
        success: false,
        message: "Only patients can make payments.",
      });
    }

    if (authenticatedUser.accountStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Your account is not active.",
      });
    }

    // Get order details from database
    const data = await getServiceData(serviceType, serviceId);

    if (
      serviceType === "Lab" &&
      safeString(data.service?.paymentMethod).toUpperCase() === "COD"
    ) {
      return res.status(409).json({
        success: false,
        message: "This lab booking is set for cash collection, not online payment.",
      });
    }

    if (
      serviceType === "Medicine" &&
      ["COD", "CASH ON DELIVERY"].includes(
        safeString(data.service?.paymentMethod).toUpperCase()
      )
    ) {
      return res.status(409).json({
        success: false,
        message: "This pharmacy order is set for Cash on Delivery, not online payment.",
      });
    }

    // Ownership check
    if (!validatePatientForService(data, authenticatedUser)) {
      return res.status(403).json({
        success: false,
        message: "This payment does not belong to your patient account.",
      });
    }

    if (data.alreadyPaid) {
      return res.status(400).json({
        success: false,
        message: "This order has already been paid.",
      });
    }

    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount calculated from database.",
      });
    }

    const amountInPaise = Math.round(amount * 100);

    if (["Lab", "Medicine"].includes(serviceType)) {
      const pendingPayment = await Payment.findOne({
        serviceType,
        serviceId: String(serviceId),
        userId: String(authenticatedUser._id),
        status: "Pending",
      });
      const existingOrderId = safeString(
        pendingPayment?.razorpayOrderId || pendingPayment?.orderId
      );
      if (pendingPayment && existingOrderId) {
        const existingAmountPaise = Math.round(
          Number(pendingPayment.amount) * 100
        );
        if (existingAmountPaise !== amountInPaise) {
          return res.status(409).json({
            success: false,
            message: `The ${serviceType === "Lab" ? "lab booking" : "pharmacy order"} amount changed. Start a fresh checkout.`,
          });
        }
        return res.status(200).json({
          success: true,
          order: {
            id: existingOrderId,
            amount: amountInPaise,
            currency: pendingPayment.currency || "INR",
          },
          key: razorpayKeyId,
          amount: amountInPaise,
          currency: pendingPayment.currency || "INR",
          paymentRecordId: String(pendingPayment._id),
          reused: true,
        });
      }
    }

    // Create official Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `HH_${serviceType.toUpperCase()}_${Date.now()}`,
      notes: {
        serviceType,
        serviceId: String(serviceId),
        userId: String(authenticatedUser._id),
        userPhone: safeString(authenticatedUser.phone),
      },
    });

    const patientDisplayName =
      safeString(authenticatedUser.name) ||
      safeString(data.patientName) ||
      "HealthHome User";
    const patientDisplayPhone =
      safeString(authenticatedUser.phone) || safeString(data.patientPhone);

    // Create Payment record
    const paymentRecord = await Payment.create({
      orderReferenceId: String(serviceId),
      orderId: razorpayOrder.id,
      razorpayOrderId: razorpayOrder.id,
      appointmentId: "",
      labOrderId: serviceType === "Lab" ? String(serviceId) : "",
      pharmacyOrderId: serviceType === "Medicine" ? String(serviceId) : "",
      userId: String(authenticatedUser._id),
      userName: patientDisplayName,
      userPhone: patientDisplayPhone,
      serviceType,
      serviceId: String(serviceId),
      amount,
      currency: "INR",
      paymentMethod: "ONLINE",
      status: "Pending",
      paymentStatus: "PENDING",
      verificationStatus: "PENDING",
      providerId: data.providerId,
      providerType: data.providerType,
      transactionDate: new Date(),
    });

    return res.status(200).json({
      success: true,
      order: razorpayOrder,
      key: razorpayKeyId,
      amount: amountInPaise,
      currency: "INR",
      paymentRecordId: String(paymentRecord._id),
    });
  } catch (error) {
    console.error("CREATE PAYMENT ORDER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create payment order.",
    });
  }
};

// ============================================================
// 2. VERIFY PAYMENT (Medicine & Lab)
// ============================================================

exports.verifyPayment = async (req, res) => {
  try {
    const razorpay_order_id =
      safeString(req.body.razorpay_order_id) ||
      safeString(req.body.razorpayOrderId);
    const razorpay_payment_id =
      safeString(req.body.razorpay_payment_id) ||
      safeString(req.body.razorpayPaymentId);
    const razorpay_signature =
      safeString(req.body.razorpay_signature) ||
      safeString(req.body.razorpaySignature);
    const serviceType = normalizeServiceType(req.body.serviceType);
    const serviceId = safeString(req.body.serviceId);

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
        message: "Payment verification data is incomplete.",
      });
    }

    if (serviceType === "Doctor") {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "Doctor payments must use /api/payment/verify-doctor-payment.",
      });
    }

    const config = checkRazorpayConfiguration();
    if (!config.success) {
      return res.status(500).json(config);
    }

    const authenticatedUser = await User.findById(req.user.id);
    if (!authenticatedUser) {
      return res.status(401).json({
        success: false,
        paid: false,
        message: "Authenticated user not found.",
      });
    }

    if (
      serviceType === "Medicine" &&
      (authenticatedUser.role !== "patient" ||
        authenticatedUser.accountStatus !== "ACTIVE")
    ) {
      return res.status(403).json({
        success: false,
        paid: false,
        message: "Only active patients can pay for pharmacy orders.",
      });
    }

    // Fetch database order data
    const data = await getServiceData(serviceType, serviceId);

    if (
      serviceType === "Lab" &&
      safeString(data.service?.paymentMethod).toUpperCase() === "COD"
    ) {
      return res.status(409).json({
        success: false,
        paid: false,
        message: "This lab booking is set for cash collection, not online payment.",
      });
    }

    if (
      serviceType === "Medicine" &&
      ["COD", "CASH ON DELIVERY"].includes(
        safeString(data.service?.paymentMethod).toUpperCase()
      )
    ) {
      return res.status(409).json({
        success: false,
        paid: false,
        message: "This pharmacy order is set for Cash on Delivery, not online payment.",
      });
    }

    // Ownership check
    if (!validatePatientForService(data, authenticatedUser)) {
      return res.status(403).json({
        success: false,
        paid: false,
        message: "Payment does not belong to this patient.",
      });
    }

    // 1. Verify HMAC SHA256 signature
    const generatedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      await Payment.findOneAndUpdate(
        {
          $or: [
            { razorpayOrderId: razorpay_order_id },
            { orderId: razorpay_order_id },
          ],
        },
        {
          $set: {
            status: "Failed",
            paymentStatus: "FAILED",
            verificationStatus: "FAILED",
            failureReason: "Invalid HMAC SHA256 payment signature.",
          },
        }
      );

      return res.status(400).json({
        success: false,
        paid: false,
        message: "Invalid payment signature.",
      });
    }

    // 2. Fetch payment details from Razorpay official SDK
    const razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);

    if (!razorpayPayment) {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "Payment details could not be retrieved from Razorpay.",
      });
    }

    // Order ID match
    if (safeString(razorpayPayment.order_id) !== safeString(razorpay_order_id)) {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "Payment does not belong to this Razorpay order.",
      });
    }

    // Amount match
    const expectedAmountPaise = Math.round(Number(data.amount) * 100);
    if (Number(razorpayPayment.amount) !== expectedAmountPaise) {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "Payment amount does not match order amount.",
      });
    }

    // Currency check
    if (safeString(razorpayPayment.currency) !== "INR") {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "Invalid payment currency.",
      });
    }

    // Status check
    if (razorpayPayment.status !== "captured") {
      return res.status(400).json({
        success: false,
        paid: false,
        message: `Payment is in ${razorpayPayment.status} state, not captured.`,
      });
    }

    const resolvedMethod = formatPaymentMethod(razorpayPayment.method);

    // 3. Update Payment record in MongoDB
    // Pharmacy verification must be tied to the exact pending payment record
    // created for this patient, order, and Razorpay order. Never upsert from
    // client supplied service IDs or match only the order reference.
    const paymentFilter = serviceType === "Medicine"
      ? {
          serviceType: "Medicine",
          serviceId: String(serviceId),
          userId: String(authenticatedUser._id),
          status: { $in: ["Pending", "Success"] },
          $or: [
            { razorpayOrderId: razorpay_order_id },
            { orderId: razorpay_order_id },
          ],
        }
      : {
          $or: [
            { razorpayOrderId: razorpay_order_id },
            { orderId: razorpay_order_id },
            { orderReferenceId: serviceId },
          ],
        };

    const paymentRecord = await Payment.findOneAndUpdate(
      paymentFilter,
      {
        $set: {
          paymentId: razorpay_payment_id,
          razorpayPaymentId: razorpay_payment_id,
          orderId: razorpay_order_id,
          razorpayOrderId: razorpay_order_id,
          signature: razorpay_signature,
          razorpaySignature: razorpay_signature,
          paymentMethod: resolvedMethod,
          status: "Success",
          paymentStatus: "SUCCESS",
          verificationStatus: "VERIFIED",
          razorpayStatus: razorpayPayment.status,
          transactionDate: new Date(),
        },
      },
      { new: true, upsert: serviceType !== "Medicine" }
    );

    if (!paymentRecord) {
      return res.status(409).json({
        success: false,
        paid: false,
        message: "No matching pending pharmacy payment was found for this order.",
      });
    }

    // 4. Update the order/lab-order in MongoDB
    await markServicePaid(
      data,
      razorpay_payment_id,
      razorpay_order_id,
      paymentRecord._id
    );

    return res.status(200).json({
      success: true,
      paid: true,
      message: "Payment verified successfully.",
      paymentMethod: resolvedMethod,
      payment: paymentRecord,
    });
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      paid: false,
      message: error.message || "Payment verification failed.",
    });
  }
};

// ============================================================
// 3. CREATE DOCTOR APPOINTMENT ORDER
// ============================================================

exports.createDoctorOrder = async (req, res) => {
  try {
    const config = checkRazorpayConfiguration();
    if (!config.success) {
      return res.status(500).json(config);
    }

    const authenticatedUser = await User.findById(req.user.id);
    if (!authenticatedUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found.",
      });
    }

    if (
      authenticatedUser.role !== "patient" ||
      authenticatedUser.accountStatus !== "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only active patients can book doctor appointments.",
      });
    }

    const {
      doctorId,
      doctorName,
      specialization,
      hospital,
      consultationType,
      appointmentDate,
      appointmentTime,
    } = req.body;

    const patientName = safeString(authenticatedUser.name);
    const patientPhone = safeString(authenticatedUser.phone);

    if (!doctorId || !appointmentDate || !appointmentTime) {
      return res.status(400).json({
        success: false,
        message: "doctorId, appointmentDate and appointmentTime are required.",
      });
    }

    if (!isValidObjectId(doctorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID.",
      });
    }

    // Auto-expire any stale pending appointments (>15 mins old) for this slot
    await expireStalePendingAppointments(
      doctorId,
      appointmentDate,
      appointmentTime
    );

    // Get doctor fee from MongoDB
    const doctor = await mongoose.connection
      .collection("doctors")
      .findOne({ _id: new mongoose.Types.ObjectId(doctorId) });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found.",
      });
    }

    const amount = Number(doctor.fees);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor consultation fee in database.",
      });
    }

    const normalizedConsultationType =
      safeString(consultationType).toLowerCase() === "hospital visit"
        ? "Hospital Visit"
        : "Video Consultation";

    // Check for active slot collision
    const activeSlot = await Appointment.findOne({
      doctorId: String(doctorId),
      appointmentDate: String(appointmentDate),
      appointmentTime: String(appointmentTime),
      status: { $in: ["Pending", "Upcoming", "Accepted"] },
    }).lean();

    if (activeSlot) {
      return res.status(409).json({
        success: false,
        message: "This appointment slot is already booked.",
      });
    }

    // Multer keeps uploaded files in memory. Store bytes as authenticated
    // Cloudinary assets and keep only the storage reference in MongoDB.
    const reports = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        reports.push(await uploadPatientReport(file));
      }
    }

    // Create pending appointment
    const appointment = await Appointment.create({
      patientId: authenticatedUser._id,
      patientName,
      patientPhone,
      doctorId: String(doctorId),
      doctorName: String(doctor.name || doctorName || "Doctor").trim(),
      specialization: String(
        doctor.specialization || specialization || ""
      ).trim(),
      hospital: String(doctor.hospital || hospital || "").trim(),
      consultationType: normalizedConsultationType,
      appointmentDate: String(appointmentDate).trim(),
      appointmentTime: String(appointmentTime).trim(),
      fees: amount,
      reports,
      status: "Pending",
      paymentStatus: "Pending",
    });

    const amountInPaise = Math.round(amount * 100);

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `HH_DOC_${Date.now()}`,
      notes: {
        appointmentId: String(appointment._id),
        doctorId: String(doctorId),
        doctorName: String(appointment.doctorName),
        userId: String(authenticatedUser._id),
        userPhone: patientPhone,
      },
    });

    // Update appointment with Razorpay Order ID
    appointment.razorpayOrderId = razorpayOrder.id;
    await appointment.save();

    // Create Payment record
    await Payment.create({
      orderReferenceId: String(appointment._id),
      appointmentId: String(appointment._id),
      orderId: razorpayOrder.id,
      razorpayOrderId: razorpayOrder.id,
      userId: String(authenticatedUser._id),
      userName: patientName,
      userPhone: patientPhone,
      serviceType: "Doctor",
      serviceId: String(appointment._id),
      amount,
      currency: "INR",
      paymentMethod: "ONLINE",
      status: "Pending",
      paymentStatus: "PENDING",
      verificationStatus: "PENDING",
      providerId: String(doctorId),
      providerType: "Doctor",
      transactionDate: new Date(),
    });

    return res.status(200).json({
      success: true,
      order: razorpayOrder,
      razorpayOrderId: razorpayOrder.id,
      key: razorpayKeyId,
      amount: amountInPaise,
      currency: "INR",
      appointmentId: String(appointment._id),
      appointment: appointmentWithoutReports(appointment),
    });
  } catch (error) {
    console.error("CREATE DOCTOR ORDER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create doctor appointment order.",
    });
  }
};

// ============================================================
// 4. VERIFY DOCTOR APPOINTMENT PAYMENT
// ============================================================

exports.verifyDoctorPayment = async (req, res) => {
  try {
    const config = checkRazorpayConfiguration();
    if (!config.success) {
      return res.status(500).json(config);
    }

    const appointmentId = safeString(req.body.appointmentId);
    const razorpay_order_id =
      safeString(req.body.razorpay_order_id) ||
      safeString(req.body.razorpayOrderId);
    const razorpay_payment_id =
      safeString(req.body.razorpay_payment_id) ||
      safeString(req.body.razorpayPaymentId);
    const razorpay_signature =
      safeString(req.body.razorpay_signature) ||
      safeString(req.body.razorpaySignature);

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: "Razorpay order ID, payment ID and signature are required.",
      });
    }

    // Locate appointment by ID if valid, or by Razorpay Order ID
    let appointment = null;
    if (appointmentId && isValidObjectId(appointmentId)) {
      appointment = await Appointment.findById(appointmentId);
    }

    if (!appointment) {
      appointment = await Appointment.findOne({
        razorpayOrderId: razorpay_order_id,
      });
    }

    if (!appointment) {
      return res.status(404).json({
        success: false,
        paymentVerified: false,
        message: "Appointment not found.",
      });
    }

    // 1. Verify HMAC SHA256 signature
    const generatedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      await Payment.findOneAndUpdate(
        {
          $or: [
            { razorpayOrderId: razorpay_order_id },
            { orderId: razorpay_order_id },
            { appointmentId: String(appointment._id) },
          ],
        },
        {
          $set: {
            status: "Failed",
            paymentStatus: "FAILED",
            verificationStatus: "FAILED",
            failureReason: "Invalid HMAC SHA256 doctor payment signature.",
          },
        }
      );

      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: "Invalid payment signature.",
      });
    }

    // 2. Fetch payment from Razorpay
    const razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);
    if (!razorpayPayment) {
      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: "Payment details could not be retrieved from Razorpay.",
      });
    }

    if (safeString(razorpayPayment.order_id) !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: "Payment does not belong to this Razorpay order.",
      });
    }

    const expectedAmountPaise = Math.round(Number(appointment.fees) * 100);
    if (Number(razorpayPayment.amount) !== expectedAmountPaise) {
      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: "Payment amount does not match consultation fees.",
      });
    }

    if (safeString(razorpayPayment.currency) !== "INR") {
      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: "Invalid currency.",
      });
    }

    if (razorpayPayment.status !== "captured") {
      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: `Payment status is ${razorpayPayment.status}, not captured.`,
      });
    }

    const resolvedMethod = formatPaymentMethod(razorpayPayment.method);

    // Payment completion must not accept the appointment. The doctor accepts
    // it through the appointment status endpoint after reviewing the request.
    appointment.paymentStatus = "Paid";
    appointment.paymentId = razorpay_payment_id;
    appointment.razorpayOrderId = razorpay_order_id;
    await appointment.save();

    // 4. Update Payment record
    const paymentRecord = await Payment.findOneAndUpdate(
      {
        $or: [
          { razorpayOrderId: razorpay_order_id },
          { orderId: razorpay_order_id },
          { appointmentId: String(appointment._id) },
        ],
      },
      {
        $set: {
          appointmentId: String(appointment._id),
          orderReferenceId: String(appointment._id),
          paymentId: razorpay_payment_id,
          razorpayPaymentId: razorpay_payment_id,
          orderId: razorpay_order_id,
          razorpayOrderId: razorpay_order_id,
          signature: razorpay_signature,
          razorpaySignature: razorpay_signature,
          paymentMethod: resolvedMethod,
          status: "Success",
          paymentStatus: "SUCCESS",
          verificationStatus: "VERIFIED",
          razorpayStatus: razorpayPayment.status,
          transactionDate: new Date(),
        },
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      paymentVerified: true,
      message: "Doctor appointment payment verified successfully.",
      appointment,
      paymentMethod: resolvedMethod,
      payment: paymentRecord,
    });
  } catch (error) {
    console.error("VERIFY DOCTOR PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      paymentVerified: false,
      message: error.message || "Doctor payment verification failed.",
    });
  }
};

// ============================================================
// 5. CANCEL DOCTOR APPOINTMENT ORDER (Release Slot)
// ============================================================

exports.cancelDoctorOrder = async (req, res) => {
  try {
    const appointmentId = safeString(req.body.appointmentId);
    const requestedOrderId =
      safeString(req.body.razorpayOrderId) ||
      safeString(req.body.razorpay_order_id);

    let appointment = null;

    if (appointmentId && isValidObjectId(appointmentId)) {
      appointment = await Appointment.findById(appointmentId);
    }

    if (!appointment && requestedOrderId) {
      appointment = await Appointment.findOne({
        razorpayOrderId: requestedOrderId,
      });
    }

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found.",
      });
    }

    // Do not cancel if already paid
    if (appointment.paymentStatus === "Paid") {
      return res.status(400).json({
        success: false,
        message: "A paid appointment cannot be cancelled through this endpoint.",
      });
    }

    // Cancel appointment to free the slot immediately
    appointment.status = "Cancelled";
    appointment.paymentStatus = "Failed";
    await appointment.save();

    // Update payment record
    await Payment.updateMany(
      {
        $or: [
          { appointmentId: String(appointment._id) },
          { orderReferenceId: String(appointment._id) },
          { razorpayOrderId: appointment.razorpayOrderId },
        ],
        status: "Pending",
      },
      {
        $set: {
          status: "Cancelled",
          paymentStatus: "CANCELLED",
          failureReason: "Payment cancelled by patient.",
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Appointment order cancelled and slot released.",
    });
  } catch (error) {
    console.error("CANCEL DOCTOR ORDER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to cancel doctor appointment order.",
    });
  }
};

// ============================================================
// 6. RAZORPAY WEBHOOK HANDLER
// ============================================================

exports.webhook = async (req, res) => {
  try {
    if (!razorpayWebhookSecret) {
      console.warn("[Webhook] RAZORPAY_WEBHOOK_SECRET is not configured.");
      return res.status(500).json({
        success: false,
        message: "Webhook secret is not configured.",
      });
    }

    const signature = req.headers["x-razorpay-signature"];
    if (!signature) {
      return res.status(400).json({
        success: false,
        message: "Webhook signature header missing.",
      });
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body));

    const expectedSignature = crypto
      .createHmac("sha256", razorpayWebhookSecret)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.error("[Webhook] Invalid signature verification.");
      return res.status(400).json({
        success: false,
        message: "Invalid webhook signature.",
      });
    }

    const event = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString("utf8"))
      : req.body;

    const eventId =
      safeString(req.headers["x-razorpay-event-id"]) || safeString(event.id);

    console.log(`[Webhook] Received event: ${event.event} [ID: ${eventId}]`);

    // Idempotency: Check if this webhook event was already processed
    if (eventId) {
      const existingProcessedEvent = await Payment.findOne({
        webhookEventId: eventId,
      });
      if (existingProcessedEvent) {
        console.log(
          `[Webhook] Event ${eventId} was already processed. Skipping duplicate.`
        );
        return res.status(200).json({ status: "already_processed" });
      }
    }

    // A. PAYMENT CAPTURED
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const paymentEntity = event.payload?.payment?.entity;
      const orderEntity = event.payload?.order?.entity;

      const pId = safeString(paymentEntity?.id);
      const oId =
        safeString(paymentEntity?.order_id) || safeString(orderEntity?.id);
      const method = formatPaymentMethod(paymentEntity?.method);

      if (oId || pId) {
        // Find existing payment
        const paymentRecord = await Payment.findOne({
          $or: [
            { razorpayOrderId: oId },
            { orderId: oId },
            { razorpayPaymentId: pId },
            { paymentId: pId },
          ],
        });

        if (paymentRecord) {
          paymentRecord.status = "Success";
          paymentRecord.paymentStatus = "SUCCESS";
          paymentRecord.verificationStatus = "VERIFIED";
          if (pId) {
            paymentRecord.paymentId = pId;
            paymentRecord.razorpayPaymentId = pId;
          }
          if (method) {
            paymentRecord.paymentMethod = method;
          }
          if (eventId) {
            paymentRecord.webhookEventId = eventId;
          }
          await paymentRecord.save();

          // Sync underlying service booking
          if (paymentRecord.serviceType === "Doctor") {
            await Appointment.findByIdAndUpdate(paymentRecord.serviceId, {
              $set: {
                paymentStatus: "Paid",
                paymentId: pId || paymentRecord.paymentId,
              },
            });
          } else if (paymentRecord.serviceType === "Medicine") {
            await Order.findByIdAndUpdate(paymentRecord.serviceId, {
              $set: {
                paymentStatus: "Paid",
                paymentMethod: "ONLINE",
                razorpayPaymentId: pId || paymentRecord.paymentId,
              },
            });
          } else if (paymentRecord.serviceType === "Lab") {
            const LabOrder = getLabOrderModel();
            await LabOrder.findByIdAndUpdate(paymentRecord.serviceId, {
              $set: {
                paymentStatus: "Paid",
                razorpayPaymentId: pId || paymentRecord.paymentId,
                paymentRecordId: String(paymentRecord._id),
              },
            });
          }
          console.log(
            `[Webhook] Successfully synced payment & booking for ${paymentRecord.serviceType} #${paymentRecord.serviceId}`
          );
        }
      }
    }

    // B. PAYMENT FAILED
    if (event.event === "payment.failed") {
      const paymentEntity = event.payload?.payment?.entity;
      const pId = safeString(paymentEntity?.id);
      const oId = safeString(paymentEntity?.order_id);
      const reason =
        safeString(paymentEntity?.error_description) ||
        safeString(paymentEntity?.error_reason) ||
        "Payment failed on Razorpay.";

      if (oId || pId) {
        await Payment.updateMany(
          {
            $or: [
              { razorpayOrderId: oId },
              { orderId: oId },
              { razorpayPaymentId: pId },
              { paymentId: pId },
            ],
            status: { $ne: "Success" },
          },
          {
            $set: {
              status: "Failed",
              paymentStatus: "FAILED",
              verificationStatus: "FAILED",
              failureReason: reason,
              webhookEventId: eventId,
            },
          }
        );
        console.log(`[Webhook] Marked payment failed for order ${oId}: ${reason}`);
      }
    }

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("WEBHOOK PROCESSING ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Webhook error.",
    });
  }
};

// ============================================================
// 7. GET PAYMENT HISTORY (Patient Module)
// ============================================================

exports.getPaymentHistory = async (req, res) => {
  try {
    const authenticatedUser = await User.findById(req.user.id);
    if (!authenticatedUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found.",
      });
    }

    const userIdStr = String(authenticatedUser._id);
    const userPhoneStr = safeString(authenticatedUser.phone);

    const payments = await Payment.find({
      $or: [{ userId: userIdStr }, { userPhone: userPhoneStr }],
    })
      .sort({ createdAt: -1 })
      .lean();

    const formattedPayments = payments.map((p) => ({
      id: String(p._id),
      transactionId: p.paymentId || p.razorpayPaymentId || "N/A",
      orderId: p.orderId || p.razorpayOrderId || "N/A",
      referenceId: p.orderReferenceId || p.serviceId || "",
      serviceType: p.serviceType,
      serviceId: p.serviceId,
      amount: p.amount,
      currency: p.currency || "INR",
      paymentMethod: p.paymentMethod || "ONLINE",
      paymentStatus: p.paymentStatus || p.status || "PENDING",
      status: p.status || "Pending",
      verificationStatus: p.verificationStatus || "PENDING",
      createdAt: p.createdAt || p.transactionDate,
      failureReason: p.failureReason || "",
    }));

    return res.status(200).json({
      success: true,
      payments: formattedPayments,
      count: formattedPayments.length,
    });
  } catch (error) {
    console.error("GET PAYMENT HISTORY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch payment history.",
    });
  }
};

// ============================================================
// 8. GET PAYMENT DETAILS BY ID
// ============================================================

exports.getPaymentDetails = async (req, res) => {
  try {
    const paymentId = safeString(req.params.paymentId);
    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: "paymentId is required.",
      });
    }

    const payment = await Payment.findOne({
      $or: [
        { _id: isValidObjectId(paymentId) ? paymentId : null },
        { paymentId },
        { razorpayPaymentId: paymentId },
        { orderId: paymentId },
        { razorpayOrderId: paymentId },
      ],
    }).lean();

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found.",
      });
    }

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("GET PAYMENT DETAILS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch payment details.",
    });
  }
};

// ============================================================
// 9. LEGACY QR COMPATIBILITY
// ============================================================

exports.getQrPaymentStatus = async (req, res) => {
  try {
    const { paymentRecordId } = req.params;
    if (!isValidObjectId(paymentRecordId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment record ID.",
      });
    }

    const payment = await Payment.findById(paymentRecordId).lean();
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found.",
      });
    }

    return res.status(200).json({
      success: true,
      status: payment.status,
      paymentStatus: payment.paymentStatus,
      paid: payment.status === "Success" || payment.paymentStatus === "SUCCESS",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check QR status.",
    });
  }
};

exports.closeQr = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "QR closed.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
