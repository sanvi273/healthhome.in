
const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/paymentController");
const upload = require("../middleware/upload");
const authMiddleware = require("../middleware/authMiddleware");

// ==========================================
// MEDICINE & LAB PAYMENT
// ==========================================

// Create Razorpay order
router.post(
  "/create-order",
  authMiddleware,
  paymentController.createOrder
);

// Verify Razorpay payment
router.post(
  "/verify-payment",
  authMiddleware,
  paymentController.verifyPayment
);

// ==========================================
// DOCTOR APPOINTMENT PAYMENT
// ==========================================

// Create doctor appointment payment order
// Authentication runs before report uploads.
router.post(
  "/create-doctor-order",
  authMiddleware,
  upload.array("reports"),
  paymentController.createDoctorOrder
);

// Verify doctor appointment payment
router.post(
  "/verify-doctor-payment",
  authMiddleware,
  paymentController.verifyDoctorPayment
);

// Cancel doctor appointment payment
router.post(
  "/cancel-doctor-order",
  authMiddleware,
  paymentController.cancelDoctorOrder
);

// ==========================================
// RAZORPAY WEBHOOK
// ==========================================

// IMPORTANT:
// Do not add JWT authentication here.
// Razorpay authenticates webhooks using webhook signature.
router.post(
  "/webhook",
  paymentController.webhook
);

// ==========================================
// LEGACY QR COMPATIBILITY ROUTES
// ==========================================

router.get(
  "/qr-status/:paymentRecordId",
  authMiddleware,
  paymentController.getQrPaymentStatus
);

router.post(
  "/close-qr",
  authMiddleware,
  paymentController.closeQr
);

module.exports = router;
