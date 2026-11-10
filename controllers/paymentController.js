const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");

const Payment = require("../models/Payment");
const PaymentCheckout = require("../models/PaymentCheckout");
const RazorpayWebhookEvent = require("../models/RazorpayWebhookEvent");
const Order = require("../models/orderModel");
const Appointment = require("../models/Appointment");
const User = require("../models/user");

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

const safeEqualHex = (left, right) => {
  if (!/^[a-f0-9]+$/i.test(String(left || "")) || !/^[a-f0-9]+$/i.test(String(right || ""))) {
    return false;
  }
  const leftBuffer = Buffer.from(String(left), "hex");
  const rightBuffer = Buffer.from(String(right), "hex");
  return leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getLabOrderModel = () => require("../models/labOrder");

let paymentCheckoutIndexesReady;
const ensurePaymentCheckoutIndexes = () => {
  if (!paymentCheckoutIndexesReady) {
    paymentCheckoutIndexesReady = PaymentCheckout.init().catch((error) => {
      paymentCheckoutIndexesReady = null;
      throw error;
    });
  }
  return paymentCheckoutIndexesReady;
};

let webhookEventIndexesReady;
const ensureWebhookEventIndexes = () => {
  if (!webhookEventIndexesReady) {
    webhookEventIndexesReady = RazorpayWebhookEvent.init().catch((error) => {
      webhookEventIndexesReady = null;
      throw error;
    });
  }
  return webhookEventIndexesReady;
};

const checkRazorpayConfiguration = () => {
  if (!razorpayKeyId || !razorpayKeySecret) {
    return {
      success: false,
      message: "Razorpay credentials are not configured on the server.",
    };
  }
  return { success: true };
};

const checkoutConflict = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const serviceCheckoutKey = (serviceType, serviceId) =>
  `${normalizeServiceType(serviceType)}:${safeString(serviceId)}`;

// Claim one checkout per service record. A unique, additive collection avoids
// creating a new unique index over legacy Payment data, which may contain
// historical duplicate/pending rows.
const reservePaymentCheckout = async ({
  serviceType,
  serviceId,
  userId,
  amountPaise,
}) => {
  await ensurePaymentCheckoutIndexes();
  const serviceKey = serviceCheckoutKey(serviceType, serviceId);
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
  let checkout = await PaymentCheckout.findOne({ serviceKey });

  if (!checkout) {
    try {
      checkout = await PaymentCheckout.create({
        serviceKey,
        serviceType: normalizeServiceType(serviceType),
        serviceId: safeString(serviceId),
        userId: safeString(userId),
        amountPaise,
        status: "CREATING",
        leaseToken,
        leaseExpiresAt,
      });
      return { checkout, leaseToken, isOwner: true };
    } catch (error) {
      if (error.code !== 11000) throw error;
      checkout = await PaymentCheckout.findOne({ serviceKey });
    }
  }

  if (!checkout) throw checkoutConflict("Payment checkout is being prepared.");
  if (safeString(checkout.userId) !== safeString(userId)) {
    throw checkoutConflict("This checkout belongs to another patient.", 403);
  }
  if (Number(checkout.amountPaise) !== Number(amountPaise)) {
    throw checkoutConflict("The service total has changed. Refresh the checkout before paying.");
  }
  if (checkout.status === "SUCCESS") {
    throw checkoutConflict("This service has already been paid.");
  }
  if (checkout.status === "CANCELLED") {
    throw checkoutConflict("This service checkout has been cancelled.");
  }
  if (
    checkout.status === "PENDING" &&
    (checkout.paymentRecordId || checkout.razorpayOrderId)
  ) {
    return { checkout, isOwner: false };
  }
  if (
    checkout.status === "CREATING" &&
    checkout.leaseExpiresAt &&
    checkout.leaseExpiresAt > new Date()
  ) {
    throw checkoutConflict("Payment order creation is already in progress. Try again shortly.");
  }

  const claimed = await PaymentCheckout.findOneAndUpdate(
    {
      _id: checkout._id,
      status: checkout.status,
      leaseExpiresAt: checkout.leaseExpiresAt,
    },
    {
      $set: {
        status: "CREATING",
        leaseToken,
        leaseExpiresAt,
        amountPaise,
      },
    },
    { new: true }
  );
  if (!claimed) {
    throw checkoutConflict("Payment order creation is already in progress. Try again shortly.");
  }
  return { checkout: claimed, leaseToken, isOwner: true };
};

const paymentOrderResponse = (payment, checkout) => ({
  id: safeString(payment?.razorpayOrderId || payment?.orderId || checkout?.razorpayOrderId),
  amount: Number(payment?.amountPaise || checkout?.amountPaise),
  currency: safeString(payment?.currency || "INR"),
  receipt: safeString(payment?.receipt || ""),
});

const createPaymentRecord = async ({
  checkout,
  user,
  data,
  order,
  serviceType,
  serviceId,
  amountPaise,
}) => {
  let paymentRecord = await Payment.findOne({
    $or: [
      { razorpayOrderId: order.id },
      { orderId: order.id },
      ...(checkout.paymentRecordId ? [{ _id: checkout.paymentRecordId }] : []),
    ],
  });
  if (paymentRecord) return paymentRecord;

  return Payment.create({
    orderReferenceId: safeString(serviceId),
    appointmentId: serviceType === "Doctor" ? safeString(serviceId) : "",
    labOrderId: serviceType === "Lab" ? safeString(serviceId) : "",
    pharmacyOrderId: serviceType === "Medicine" ? safeString(serviceId) : "",
    orderId: order.id,
    razorpayOrderId: order.id,
    userId: String(user._id),
    userName: safeString(user.name) || safeString(data.patientName) || "HealthHome User",
    userPhone: safeString(user.phone) || safeString(data.patientPhone),
    serviceType,
    serviceId: safeString(serviceId),
    amount: amountPaise / 100,
    amountPaise,
    currency: "INR",
    paymentMethod: "ONLINE",
    status: "Pending",
    paymentStatus: "PENDING",
    verificationStatus: "PENDING",
    providerId: safeString(data.providerId),
    providerType: safeString(data.providerType),
    transactionDate: new Date(),
  });
};

const getOrCreatePaymentRecord = async (checkout, user, data) => {
  if (checkout.paymentRecordId) {
    const linked = await Payment.findById(checkout.paymentRecordId);
    if (linked) {
      if (!paymentBelongsToUser(linked, user)) {
        throw checkoutConflict("This payment belongs to another patient.", 403);
      }
      return linked;
    }
  }
  const orderId = safeString(checkout.razorpayOrderId);
  if (!orderId) {
    const priorPayment = await Payment.findOne({
      serviceType: normalizeServiceType(checkout.serviceType),
      serviceId: safeString(checkout.serviceId),
    });
    if (priorPayment) {
      if (!paymentBelongsToUser(priorPayment, user)) {
        throw checkoutConflict("A payment for this service is linked to another patient.", 403);
      }
      const priorStatus = safeString(priorPayment.status).toLowerCase();
      const priorPaymentStatus = safeString(priorPayment.paymentStatus).toLowerCase();
      if (["success", "collected", "paid"].includes(priorStatus) ||
          ["success", "collected", "paid"].includes(priorPaymentStatus)) {
        await PaymentCheckout.updateOne(
          { _id: checkout._id },
          { $set: { status: "SUCCESS", paymentRecordId: String(priorPayment._id) } }
        );
        throw checkoutConflict("This service has already been paid.");
      }
      const priorOrderId = safeString(priorPayment.razorpayOrderId || priorPayment.orderId);
      if (priorOrderId && (priorStatus === "pending" || priorPaymentStatus === "pending")) {
        await PaymentCheckout.updateOne(
          { _id: checkout._id },
          {
            $set: {
              status: "PENDING",
              paymentRecordId: String(priorPayment._id),
              razorpayOrderId: priorOrderId,
            },
          }
        );
        checkout.status = "PENDING";
        checkout.paymentRecordId = String(priorPayment._id);
        checkout.razorpayOrderId = priorOrderId;
        return priorPayment;
      }
    }
    return null;
  }
  let payment = await Payment.findOne({
    $or: [{ razorpayOrderId: orderId }, { orderId }],
  });
  if (!payment) {
    payment = await createPaymentRecord({
      checkout,
      user,
      data,
      order: { id: orderId },
      serviceType: checkout.serviceType,
      serviceId: checkout.serviceId,
      amountPaise: Number(checkout.amountPaise),
    });
  }
  if (!paymentBelongsToUser(payment, user)) {
    throw checkoutConflict("This payment belongs to another patient.", 403);
  }
  await PaymentCheckout.updateOne(
    { _id: checkout._id },
    { $set: { paymentRecordId: String(payment._id), status: "PENDING" } }
  );
  return payment;
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

  // New bookings store the authenticated User ObjectId. Legacy lab bookings
  // stored the patient's phone in patientId; allow only that exact legacy
  // representation when it also matches the authenticated account's phone.
  const matchesLegacyPhoneId =
    bookingPatientId &&
    !isValidObjectId(bookingPatientId) &&
    authPhone &&
    bookingPatientId === authPhone &&
    bookingPatientPhone === authPhone;

  return bookingPatientId
    ? Boolean(matchesId || matchesLegacyPhoneId)
    : Boolean(matchesPhone);
};

const paymentBelongsToUser = (payment, user) => {
  if (!payment || !user) return false;
  const ownerId = safeString(payment.userId);
  const userId = safeString(user._id);
  if (ownerId && ownerId === userId) return true;
  // Legacy payment rows sometimes used the patient's phone as userId.
  const phone = safeString(user.phone);
  return Boolean(
    phone &&
    safeString(payment.userPhone) === phone &&
    (!ownerId || ownerId === phone)
  );
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
  let reservation;
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

    if (serviceType === "Lab" && safeString(data.service?.paymentMethod).toUpperCase() === "COD") {
      return res.status(409).json({
        success: false,
        message: "This lab booking is set for cash collection, not online payment.",
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
    if (["cancelled", "rejected"].includes(data.serviceStatus.toLowerCase())) {
      return res.status(409).json({
        success: false,
        message: "A cancelled or rejected order cannot be paid.",
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
    if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount calculated from database.",
      });
    }

    reservation = await reservePaymentCheckout({
      serviceType,
      serviceId,
      userId: authenticatedUser._id,
      amountPaise: amountInPaise,
    });
    let paymentRecord = await getOrCreatePaymentRecord(
      reservation.checkout,
      authenticatedUser,
      data
    );

    if (!reservation.isOwner && paymentRecord) {
      if (["Success", "Collected"].includes(paymentRecord.status)) {
        await PaymentCheckout.updateOne(
          { _id: reservation.checkout._id },
          { $set: { status: "SUCCESS" } }
        );
        return res.status(409).json({
          success: false,
          message: "This order has already been paid.",
        });
      }
      return res.status(200).json({
        success: true,
        order: paymentOrderResponse(paymentRecord, reservation.checkout),
        key: razorpayKeyId,
        amount: Number(paymentRecord.amountPaise || amountInPaise),
        currency: paymentRecord.currency || "INR",
        paymentRecordId: String(paymentRecord._id),
        reused: true,
      });
    }

    let razorpayOrder;
    if (reservation.checkout.razorpayOrderId) {
      razorpayOrder = paymentOrderResponse(paymentRecord, reservation.checkout);
    } else {
      razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt: `HH_${serviceType.toUpperCase()}_${crypto.randomUUID()}`,
        notes: {
          serviceType,
          serviceId: String(serviceId),
          userId: String(authenticatedUser._id),
          userPhone: safeString(authenticatedUser.phone),
        },
      });
      const savedOrder = await PaymentCheckout.updateOne(
        { _id: reservation.checkout._id, leaseToken: reservation.leaseToken },
        { $set: { razorpayOrderId: razorpayOrder.id } }
      );
      if (!savedOrder.matchedCount) {
        throw checkoutConflict("Payment checkout ownership expired. Retry this payment.");
      }
      reservation.checkout.razorpayOrderId = razorpayOrder.id;
    }

    paymentRecord = await createPaymentRecord({
      checkout: reservation.checkout,
      user: authenticatedUser,
      data,
      order: razorpayOrder,
      serviceType,
      serviceId,
      amountPaise: amountInPaise,
    });
    await PaymentCheckout.updateOne(
      { _id: reservation.checkout._id, leaseToken: reservation.leaseToken },
      {
        $set: {
          status: "PENDING",
          paymentRecordId: String(paymentRecord._id),
          leaseToken: "",
          leaseExpiresAt: null,
          amountPaise: amountInPaise,
        },
      }
    );

    return res.status(200).json({
      success: true,
      order: razorpayOrder,
      key: razorpayKeyId,
      amount: amountInPaise,
      currency: "INR",
      paymentRecordId: String(paymentRecord._id),
      reused: false,
    });
  } catch (error) {
    console.error("CREATE PAYMENT ORDER ERROR:", error);
    if (reservation?.isOwner && !reservation.checkout.razorpayOrderId) {
      await PaymentCheckout.updateOne(
        { _id: reservation.checkout._id, leaseToken: reservation.leaseToken },
        { $set: { status: "FAILED", leaseToken: "", leaseExpiresAt: null } }
      ).catch(() => {});
    }
    return res.status(error.statusCode || 500).json({
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
      authenticatedUser.role !== "patient" ||
      authenticatedUser.accountStatus !== "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
        paid: false,
        message: "Only active patients can verify service payments.",
      });
    }

    // Fetch database order data
    const data = await getServiceData(serviceType, serviceId);

    if (serviceType === "Lab" && safeString(data.service?.paymentMethod).toUpperCase() === "COD") {
      return res.status(409).json({
        success: false,
        paid: false,
        message: "This lab booking is set for cash collection, not online payment.",
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

    const paymentRecord = await Payment.findOne({
      serviceType,
      serviceId,
      $or: [
        { razorpayOrderId: razorpay_order_id },
        { orderId: razorpay_order_id },
      ],
    });
    if (!paymentRecord || !paymentBelongsToUser(paymentRecord, authenticatedUser)) {
      return res.status(404).json({
        success: false,
        paid: false,
        message: "Payment order was not found for this patient and service.",
      });
    }
    const expectedAmountPaise = Number(paymentRecord.amountPaise) > 0
      ? Number(paymentRecord.amountPaise)
      : Math.round(Number(paymentRecord.amount) * 100);
    if (
      !Number.isSafeInteger(expectedAmountPaise) ||
      expectedAmountPaise <= 0 ||
      expectedAmountPaise !== Math.round(Number(data.amount) * 100)
    ) {
      return res.status(409).json({
        success: false,
        paid: false,
        message: "The service amount changed after this payment order was created.",
      });
    }

    // 1. Verify HMAC SHA256 signature
    const generatedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (!safeEqualHex(generatedSignature, razorpay_signature)) {
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

    // The payment callback and webhook may race; only one captured payment ID
    // may win for this Razorpay order. Repeating the same callback is harmless.
    const updatedPayment = await Payment.findOneAndUpdate(
      {
        _id: paymentRecord._id,
        $or: [
          { status: { $nin: ["Success", "Refunded"] } },
          { paymentId: razorpay_payment_id },
          { razorpayPaymentId: razorpay_payment_id },
        ],
      },
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
          amountPaise: expectedAmountPaise,
          transactionDate: new Date(),
          capturedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updatedPayment) {
      return res.status(409).json({
        success: false,
        paid: false,
        message: "A different payment has already been recorded for this order.",
      });
    }

    // 4. Update the order/lab-order in MongoDB
    await markServicePaid(
      data,
      razorpay_payment_id,
      razorpay_order_id,
      updatedPayment._id
    );
    await PaymentCheckout.updateOne(
      { serviceType, serviceId, userId: String(authenticatedUser._id) },
      { $set: { status: "SUCCESS", leaseToken: "", leaseExpiresAt: null } }
    );

    return res.status(200).json({
      success: true,
      paid: true,
      message: "Payment verified successfully.",
      paymentMethod: resolvedMethod,
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);
    return res.status(error.statusCode || 500).json({
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
  let reservation;
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
    let appointment = await Appointment.findOne({
      doctorId: String(doctorId),
      appointmentDate: String(appointmentDate),
      appointmentTime: String(appointmentTime),
      status: { $in: ["Pending", "Upcoming", "Accepted"] },
    });

    if (
      appointment &&
      String(appointment.patientId || "") !== String(authenticatedUser._id)
    ) {
      return res.status(409).json({
        success: false,
        message: "This appointment slot is already booked.",
      });
    }

    // Process any uploaded medical report files
    const reports = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        reports.push({
          fileName: file.originalname || "Medical Report",
          fileUrl: file.path || file.secure_url || "",
          fileType: file.mimetype || "application/pdf",
        });
      }
    }

    if (!appointment) {
      try {
        appointment = await Appointment.create({
          patientId: authenticatedUser._id,
          patientName,
          patientPhone,
          doctorId: String(doctorId),
          doctorName: String(doctor.name || doctorName || "Doctor").trim(),
          specialization: String(doctor.specialization || specialization || "").trim(),
          hospital: String(doctor.hospital || hospital || "").trim(),
          consultationType: normalizedConsultationType,
          appointmentDate: String(appointmentDate).trim(),
          appointmentTime: String(appointmentTime).trim(),
          fees: amount,
          reports,
          status: "Pending",
          paymentStatus: "Pending",
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        appointment = await Appointment.findOne({
          doctorId: String(doctorId),
          appointmentDate: String(appointmentDate),
          appointmentTime: String(appointmentTime),
          status: { $in: ["Pending", "Upcoming", "Accepted"] },
        });
        if (!appointment || String(appointment.patientId) !== String(authenticatedUser._id)) {
          return res.status(409).json({
            success: false,
            message: "This appointment slot is already booked.",
          });
        }
      }
    }

    const appointmentAmount = Number(appointment.fees);
    const amountInPaise = Math.round(appointmentAmount * 100);
    if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid consultation amount configured for this doctor.",
      });
    }

    if (["Paid", "Refunded"].includes(appointment.paymentStatus)) {
      return res.status(409).json({
        success: false,
        message: "This appointment payment is already complete.",
      });
    }

    const serviceId = String(appointment._id);
    const doctorData = {
      serviceType: "Doctor",
      serviceId,
      amount: appointmentAmount,
      patientId: String(authenticatedUser._id),
      patientName,
      patientPhone,
      providerId: String(doctorId),
      providerType: "Doctor",
    };
    reservation = await reservePaymentCheckout({
      serviceType: "Doctor",
      serviceId,
      userId: authenticatedUser._id,
      amountPaise: amountInPaise,
    });

    let paymentRecord = await getOrCreatePaymentRecord(
      reservation.checkout,
      authenticatedUser,
      doctorData
    );
    if (!reservation.isOwner && paymentRecord) {
      if (["Success", "Collected"].includes(paymentRecord.status) ||
          ["SUCCESS", "PAID", "COLLECTED"].includes(safeString(paymentRecord.paymentStatus).toUpperCase())) {
        await PaymentCheckout.updateOne(
          { _id: reservation.checkout._id },
          { $set: { status: "SUCCESS" } }
        );
        return res.status(409).json({
          success: false,
          message: "This appointment has already been paid.",
        });
      }
      return res.status(200).json({
        success: true,
        order: paymentOrderResponse(paymentRecord, reservation.checkout),
        razorpayOrderId: paymentRecord.razorpayOrderId || paymentRecord.orderId,
        key: razorpayKeyId,
        amount: Number(paymentRecord.amountPaise || amountInPaise),
        currency: paymentRecord.currency || "INR",
        paymentRecordId: String(paymentRecord._id),
        appointmentId: serviceId,
        appointment,
        reused: true,
      });
    }

    let razorpayOrder;
    if (reservation.checkout.razorpayOrderId) {
      razorpayOrder = paymentOrderResponse(paymentRecord, reservation.checkout);
    } else if (appointment.razorpayOrderId) {
      razorpayOrder = {
        id: appointment.razorpayOrderId,
        amount: amountInPaise,
        currency: "INR",
      };
      await PaymentCheckout.updateOne(
        { _id: reservation.checkout._id, leaseToken: reservation.leaseToken },
        { $set: { razorpayOrderId: appointment.razorpayOrderId } }
      );
      reservation.checkout.razorpayOrderId = appointment.razorpayOrderId;
    } else {
      razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt: `HH_DOC_${crypto.randomUUID()}`,
        notes: {
          appointmentId: serviceId,
          doctorId: String(doctorId),
          doctorName: String(appointment.doctorName),
          userId: String(authenticatedUser._id),
          userPhone: patientPhone,
        },
      });
      const savedOrder = await PaymentCheckout.updateOne(
        { _id: reservation.checkout._id, leaseToken: reservation.leaseToken },
        { $set: { razorpayOrderId: razorpayOrder.id } }
      );
      if (!savedOrder.matchedCount) {
        throw checkoutConflict("Payment checkout ownership expired. Retry this payment.");
      }
      reservation.checkout.razorpayOrderId = razorpayOrder.id;
    }

    if (!appointment.razorpayOrderId) {
      appointment.razorpayOrderId = razorpayOrder.id;
      await appointment.save();
    }
    paymentRecord = await createPaymentRecord({
      checkout: reservation.checkout,
      user: authenticatedUser,
      data: doctorData,
      order: razorpayOrder,
      serviceType: "Doctor",
      serviceId,
      amountPaise: amountInPaise,
    });
    await PaymentCheckout.updateOne(
      { _id: reservation.checkout._id, leaseToken: reservation.leaseToken },
      {
        $set: {
          status: "PENDING",
          paymentRecordId: String(paymentRecord._id),
          leaseToken: "",
          leaseExpiresAt: null,
        },
      }
    );

    return res.status(200).json({
      success: true,
      order: razorpayOrder,
      razorpayOrderId: razorpayOrder.id,
      key: razorpayKeyId,
      amount: amountInPaise,
      currency: "INR",
      appointmentId: String(appointment._id),
      appointment,
      paymentRecordId: String(paymentRecord._id),
      reused: false,
    });
  } catch (error) {
    console.error("CREATE DOCTOR ORDER ERROR:", error);
    if (reservation?.isOwner && !reservation.checkout.razorpayOrderId) {
      await PaymentCheckout.updateOne(
        { _id: reservation.checkout._id, leaseToken: reservation.leaseToken },
        { $set: { status: "FAILED", leaseToken: "", leaseExpiresAt: null } }
      ).catch(() => {});
    }
    return res.status(error.statusCode || 500).json({
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

    const authenticatedUser = await User.findById(req.user.id);
    if (!authenticatedUser || authenticatedUser.role !== "patient" || authenticatedUser.accountStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        paymentVerified: false,
        message: "Only active patients can verify doctor payments.",
      });
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
    if (appointmentId && !isValidObjectId(appointmentId)) {
      return res.status(400).json({
        success: false,
        paymentVerified: false,
        message: "Invalid appointment ID.",
      });
    }
    if (appointmentId) {
      appointment = await Appointment.findById(appointmentId);
    } else {
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

    const appointmentOwnerId = safeString(appointment.patientId);
    const ownerMatches = appointmentOwnerId
      ? appointmentOwnerId === String(authenticatedUser._id)
      : safeString(appointment.patientPhone) === safeString(authenticatedUser.phone);
    if (!ownerMatches || safeString(appointment.razorpayOrderId) !== razorpay_order_id) {
      return res.status(403).json({
        success: false,
        paymentVerified: false,
        message: "This doctor payment does not belong to your appointment.",
      });
    }

    const paymentRecord = await Payment.findOne({
      serviceType: "Doctor",
      serviceId: String(appointment._id),
      $or: [
        { razorpayOrderId: razorpay_order_id },
        { orderId: razorpay_order_id },
      ],
    });
    if (!paymentRecord || !paymentBelongsToUser(paymentRecord, authenticatedUser)) {
      return res.status(404).json({
        success: false,
        paymentVerified: false,
        message: "Payment order was not found for this patient and appointment.",
      });
    }

    // 1. Verify HMAC SHA256 signature
    const generatedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (!safeEqualHex(generatedSignature, razorpay_signature)) {
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

    const expectedAmountPaise = Number(paymentRecord.amountPaise) > 0
      ? Number(paymentRecord.amountPaise)
      : Math.round(Number(paymentRecord.amount) * 100);
    if (
      !Number.isSafeInteger(expectedAmountPaise) ||
      expectedAmountPaise <= 0 ||
      expectedAmountPaise !== Math.round(Number(appointment.fees) * 100) ||
      Number(razorpayPayment.amount) !== expectedAmountPaise
    ) {
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

    const updatedPayment = await Payment.findOneAndUpdate(
      {
        _id: paymentRecord._id,
        $or: [
          { status: { $nin: ["Success", "Refunded"] } },
          { paymentId: razorpay_payment_id },
          { razorpayPaymentId: razorpay_payment_id },
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
          amountPaise: expectedAmountPaise,
          transactionDate: new Date(),
          capturedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updatedPayment) {
      return res.status(409).json({
        success: false,
        paymentVerified: false,
        message: "A different payment has already been recorded for this appointment.",
      });
    }
    // Payment confirmation does not accept or complete the appointment.
    appointment.paymentStatus = "Paid";
    appointment.paymentId = razorpay_payment_id;
    appointment.razorpayOrderId = razorpay_order_id;
    await appointment.save();
    await PaymentCheckout.updateOne(
      { serviceType: "Doctor", serviceId: String(appointment._id), userId: String(authenticatedUser._id) },
      { $set: { status: "SUCCESS", leaseToken: "", leaseExpiresAt: null } }
    );

    return res.status(200).json({
      success: true,
      paymentVerified: true,
      message: "Doctor appointment payment verified successfully.",
      appointment,
      paymentMethod: resolvedMethod,
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("VERIFY DOCTOR PAYMENT ERROR:", error);
    return res.status(error.statusCode || 500).json({
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

    const authenticatedUser = await User.findById(req.user.id);
    const appointmentOwnerId = safeString(appointment.patientId);
    const ownerMatches = appointmentOwnerId
      ? appointmentOwnerId === safeString(authenticatedUser?._id)
      : safeString(appointment.patientPhone) === safeString(authenticatedUser?.phone);
    if (!authenticatedUser || authenticatedUser.role !== "patient" || !ownerMatches) {
      return res.status(403).json({
        success: false,
        message: "This appointment does not belong to your patient account.",
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
    const paymentFilter = {
      $or: [
        { appointmentId: String(appointment._id) },
        { orderReferenceId: String(appointment._id) },
        ...(appointment.razorpayOrderId
          ? [{ razorpayOrderId: appointment.razorpayOrderId }]
          : []),
      ],
      status: "Pending",
    };
    await Payment.updateMany(
      paymentFilter,
      {
        $set: {
          status: "Cancelled",
          paymentStatus: "CANCELLED",
          failureReason: "Payment cancelled by patient.",
        },
      }
    );
    await PaymentCheckout.updateOne(
      { serviceType: "Doctor", serviceId: String(appointment._id), userId: String(authenticatedUser._id) },
      { $set: { status: "CANCELLED", leaseToken: "", leaseExpiresAt: null } }
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
  let webhookEvent;
  try {
    await ensureWebhookEventIndexes();
    if (!razorpayWebhookSecret) {
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

    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        success: false,
        message: "Webhook raw body is unavailable.",
      });
    }
    const rawBody = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", razorpayWebhookSecret)
      .update(rawBody)
      .digest("hex");

    if (!safeEqualHex(expectedSignature, signature)) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook signature.",
      });
    }

    const event = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString("utf8"))
      : req.body;

    const eventId =
      safeString(req.headers["x-razorpay-event-id"]) ||
      safeString(event.id) ||
      crypto.createHash("sha256").update(rawBody).digest("hex");
    const now = new Date();
    const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

    try {
      webhookEvent = await RazorpayWebhookEvent.create({
        eventId,
        eventType: safeString(event.event) || "unknown",
        payloadHash,
        status: "PROCESSING",
        attempts: 1,
        processingLeaseExpiresAt: leaseExpiresAt,
      });
    } catch (createError) {
      if (createError.code !== 11000) throw createError;
      const existing = await RazorpayWebhookEvent.findOne({ eventId });
      if (!existing) throw createError;
      if (existing.status === "PROCESSED") {
        return res.status(200).json({ status: "already_processed" });
      }
      if (
        existing.status === "PROCESSING" &&
        existing.processingLeaseExpiresAt > now
      ) {
        return res.status(200).json({ status: "already_processing" });
      }
      webhookEvent = await RazorpayWebhookEvent.findOneAndUpdate(
        {
          _id: existing._id,
          $or: [
            { status: "FAILED" },
            { status: "PROCESSING", processingLeaseExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            eventType: safeString(event.event) || "unknown",
            payloadHash,
            processingLeaseExpiresAt: leaseExpiresAt,
            lastError: "",
          },
          $inc: { attempts: 1 },
        },
        { new: true }
      );
      if (!webhookEvent) {
        return res.status(200).json({ status: "already_processing" });
      }
    }

    const isCapturedEvent = ["payment.captured", "order.paid"].includes(event.event);
    if (isCapturedEvent) {
      const paymentEntity = event.payload?.payment?.entity || {};
      const orderEntity = event.payload?.order?.entity || {};
      const paymentId = safeString(paymentEntity.id);
      const orderId = safeString(paymentEntity.order_id || orderEntity.id);
      if (!orderId) throw new Error("Paid webhook is missing its Razorpay order ID.");

      let paymentRecord = await Payment.findOne({
        $or: [
          { razorpayOrderId: orderId },
          { orderId },
          ...(paymentId
            ? [{ razorpayPaymentId: paymentId }, { paymentId }]
            : []),
        ],
      });
      if (!paymentRecord) throw new Error("Payment record for webhook order was not found.");

      const expectedAmountPaise = Number(paymentRecord.amountPaise) > 0
        ? Number(paymentRecord.amountPaise)
        : Math.round(Number(paymentRecord.amount) * 100);
      const actualAmountPaise = event.event === "payment.captured"
        ? Number(paymentEntity.amount)
        : Number(orderEntity.amount_paid || orderEntity.amount);
      const currency = safeString(paymentEntity.currency || orderEntity.currency);
      if (
        !Number.isSafeInteger(expectedAmountPaise) ||
        expectedAmountPaise <= 0 ||
        actualAmountPaise !== expectedAmountPaise ||
        currency !== "INR"
      ) {
        throw new Error("Webhook amount or currency does not match the stored payment.");
      }
      if (
        event.event === "payment.captured" &&
        (!paymentId || safeString(paymentEntity.status) !== "captured")
      ) {
        throw new Error("Captured payment webhook payload is incomplete.");
      }
      if (
        event.event === "order.paid" &&
        safeString(orderEntity.status).toLowerCase() !== "paid"
      ) {
        throw new Error("Paid order webhook has an unexpected order status.");
      }

      const existingPaymentId = safeString(paymentRecord.paymentId || paymentRecord.razorpayPaymentId);
      if (paymentRecord.status === "Refunded") {
        await webhookEvent.updateOne({
          $set: { status: "PROCESSED", processedAt: new Date(), processingLeaseExpiresAt: null },
        });
        return res.status(200).json({ status: "refunded_payment_unchanged" });
      }
      if (
        ["Success", "Refunded"].includes(paymentRecord.status) &&
        paymentRecord.status === "Refunded"
      ) {
        throw new Error("A refunded payment cannot be changed back to success.");
      }
      if (paymentRecord.status === "Success" && existingPaymentId && paymentId && existingPaymentId !== paymentId) {
        // Do not overwrite the first captured payment for an order.
        await webhookEvent.updateOne({
          $set: { status: "PROCESSED", processedAt: new Date(), processingLeaseExpiresAt: null },
        });
        return res.status(200).json({ status: "payment_already_recorded" });
      }

      const paymentSet = {
        status: "Success",
        paymentStatus: "SUCCESS",
        verificationStatus: "VERIFIED",
        razorpayStatus: event.event === "payment.captured" ? "captured" : "paid",
        amountPaise: expectedAmountPaise,
        transactionDate: new Date(),
        capturedAt: new Date(),
        webhookEventId: eventId,
      };
      if (paymentId) {
        paymentSet.paymentId = paymentId;
        paymentSet.razorpayPaymentId = paymentId;
      }
      const method = formatPaymentMethod(paymentEntity.method);
      if (method) paymentSet.paymentMethod = method;

      const updatedPayment = paymentRecord.status === "Success"
        ? paymentRecord
        : await Payment.findOneAndUpdate(
        {
          _id: paymentRecord._id,
          $or: [
            { status: { $nin: ["Success", "Refunded"] } },
            ...(paymentId
              ? [
                  { paymentId },
                  { razorpayPaymentId: paymentId },
                  { paymentId: "" },
                  { razorpayPaymentId: "" },
                ]
              : []),
          ],
        },
        { $set: paymentSet },
        { new: true }
        );
      if (!updatedPayment) throw new Error("Payment was concurrently recorded with a different payment ID.");

      await markServicePaid(
        {
          serviceType: updatedPayment.serviceType,
          serviceId: updatedPayment.serviceId,
        },
        paymentId || updatedPayment.paymentId,
        orderId,
        updatedPayment._id
      );
      await PaymentCheckout.updateOne(
        {
          serviceType: updatedPayment.serviceType,
          serviceId: updatedPayment.serviceId,
          userId: updatedPayment.userId,
        },
        { $set: { status: "SUCCESS", leaseToken: "", leaseExpiresAt: null } }
      );
    } else if (event.event === "payment.failed") {
      const paymentEntity = event.payload?.payment?.entity || {};
      const paymentId = safeString(paymentEntity.id);
      const orderId = safeString(paymentEntity.order_id);
      if (!orderId && !paymentId) throw new Error("Failed payment webhook is missing payment identifiers.");
      const paymentRecord = await Payment.findOne({
        $or: [
          ...(orderId ? [{ razorpayOrderId: orderId }, { orderId }] : []),
          ...(paymentId ? [{ razorpayPaymentId: paymentId }, { paymentId }] : []),
        ],
      });
      if (!paymentRecord) throw new Error("Payment record for failed webhook was not found.");
      const reason = safeString(paymentEntity.error_description || paymentEntity.error_reason || "Payment failed on Razorpay.");
      await Payment.updateOne(
        { _id: paymentRecord._id, status: { $nin: ["Success", "Refunded"] } },
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
    }

    await webhookEvent.updateOne({
      $set: { status: "PROCESSED", processedAt: new Date(), processingLeaseExpiresAt: null },
    });
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    if (webhookEvent) {
      await webhookEvent.updateOne({
        $set: {
          status: "FAILED",
          lastError: safeString(error.message).slice(0, 300),
          processingLeaseExpiresAt: null,
        },
      }).catch(() => {});
    }
    console.error("WEBHOOK PROCESSING ERROR:", safeString(error.message));
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed. Razorpay may retry the event.",
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
    if (authenticatedUser.role !== "patient") {
      return res.status(403).json({
        success: false,
        message: "Patient account required.",
      });
    }

    const userIdStr = String(authenticatedUser._id);
    const userPhoneStr = safeString(authenticatedUser.phone);

    const payments = await Payment.find({
      $or: [
        { userId: userIdStr },
        ...(userPhoneStr ? [{ userId: userPhoneStr }] : []),
        ...(userPhoneStr
          ? [{ userId: { $in: ["", null] }, userPhone: userPhoneStr }]
          : []),
      ],
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
    const authenticatedUser = await User.findById(req.user.id);
    if (!authenticatedUser || authenticatedUser.role !== "patient") {
      return res.status(authenticatedUser ? 403 : 401).json({
        success: false,
        message: authenticatedUser ? "Patient account required." : "Authenticated user not found.",
      });
    }

    const paymentId = safeString(req.params.paymentId);
    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: "paymentId is required.",
      });
    }

    const ownerId = String(authenticatedUser._id);
    const ownerPhone = safeString(authenticatedUser.phone);
    const payment = await Payment.findOne({
      $and: [
        {
          $or: [
            { _id: isValidObjectId(paymentId) ? paymentId : null },
            { paymentId },
            { razorpayPaymentId: paymentId },
            { orderId: paymentId },
            { razorpayOrderId: paymentId },
          ],
        },
        {
          $or: [
            { userId: ownerId },
            ...(ownerPhone ? [{ userId: ownerPhone }] : []),
            ...(ownerPhone
              ? [{ userId: { $in: ["", null] }, userPhone: ownerPhone }]
              : []),
          ],
        },
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
    const authenticatedUser = await User.findById(req.user.id);
    if (!authenticatedUser || authenticatedUser.role !== "patient") {
      return res.status(authenticatedUser ? 403 : 401).json({
        success: false,
        message: authenticatedUser ? "Patient account required." : "Authenticated user not found.",
      });
    }

    const { paymentRecordId } = req.params;
    if (!isValidObjectId(paymentRecordId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment record ID.",
      });
    }

    const ownerId = String(authenticatedUser._id);
    const ownerPhone = safeString(authenticatedUser.phone);
    const payment = await Payment.findOne({
      _id: paymentRecordId,
      $or: [
        { userId: ownerId },
        ...(ownerPhone ? [{ userId: ownerPhone }] : []),
        ...(ownerPhone
          ? [{ userId: { $in: ["", null] }, userPhone: ownerPhone }]
          : []),
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
      status: payment.status,
      paymentStatus: payment.paymentStatus,
      paid:
        safeString(payment.status).toLowerCase() === "success" ||
        ["success", "paid"].includes(safeString(payment.paymentStatus).toLowerCase()),
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
