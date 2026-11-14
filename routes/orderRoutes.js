const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const {
  placeOrder,
  placePrescriptionOrder,
  confirmPrescriptionOrder,

  getPharmacyOrders,
  getPatientOrders,

  updateOrderStatus,

  assignDeliveryAgent,
  removeDeliveryAgent,

  // Delivery OTP
  verifyDeliveryOtp,
  getDeliveryOtp,

  // COD
  collectCODPayment,

  getAllOrders,
} = require("../controllers/orderController");

// ============================================================
// TEST
// ============================================================

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Order API working",
  });
});

// ============================================================
// NORMAL MEDICINE ORDER
// ============================================================

router.post(
  "/place",
  placeOrder
);

// ============================================================
// PRESCRIPTION IMAGE ORDER
// ============================================================

router.post(
  "/prescription",
  placePrescriptionOrder
);

// ============================================================
// CONFIRM PRESCRIPTION ORDER
// ============================================================

router.put(
  "/prescription/confirm/:id",
  confirmPrescriptionOrder
);

// ============================================================
// GET ALL ORDERS
// ============================================================

router.get(
  "/all",
  getAllOrders
);

// ============================================================
// GET PHARMACY ORDERS
// ============================================================

router.get(
  "/pharmacy/:pharmacyId",
  authMiddleware,
  getPharmacyOrders
);

// ============================================================
// GET PATIENT ORDERS
// ============================================================

router.get(
  "/patient/:phone",
  getPatientOrders
);

// ============================================================
// UPDATE ORDER STATUS
// ============================================================
//
// Pharmacy can move order through:
//
// Pending
//    ↓
// Accepted
//    ↓
// Packed
//    ↓
// Out for Delivery
//
// When status becomes "Out for Delivery",
// the backend generates the Delivery OTP.
//
// "Delivered" cannot be set directly.
// Delivery OTP verification is required.
//

router.put(
  "/status/:id",
  updateOrderStatus
);

// ============================================================
// ASSIGN DELIVERY PARTNER
// ============================================================

router.put(
  "/delivery-agent/:id",
  assignDeliveryAgent
);

// ============================================================
// REMOVE DELIVERY PARTNER
// ============================================================

router.put(
  "/delivery-agent/remove/:id",
  removeDeliveryAgent
);

// ============================================================
// GET DELIVERY OTP - PATIENT
// ============================================================
//
// Patient app calls:
//
// GET /api/orders/delivery-otp/:id
//
// The OTP is generated when the order becomes
// "Out for Delivery".
//
// For demo/testing, the actual OTP is temporarily
// available from the server's memory.
//
// Production version should send OTP through SMS/email
// or another secure channel.
//

router.get(
  "/delivery-otp/:id",
  getDeliveryOtp
);

// ============================================================
// VERIFY DELIVERY OTP - DELIVERY PARTNER
// ============================================================
//
// Delivery flow:
//
// Accepted
//     ↓
// Packed
//     ↓
// Out for Delivery
//     ↓
// Patient receives/shows OTP
//     ↓
// Delivery partner enters OTP
//     ↓
// Backend verifies OTP
//     ↓
// Order becomes Delivered
//
// PUT /api/orders/delivery-otp/:id
//
// Body:
//
// {
//   "otp": "123456"
// }
//

router.put(
  "/delivery-otp/:id",
  verifyDeliveryOtp
);

// ============================================================
// COLLECT COD PAYMENT
// ============================================================
//
// Used after cash is actually collected from the patient.
//
// PUT /api/orders/cod/collect/:id
//

router.put(
  "/cod/collect/:id",
  collectCODPayment
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
