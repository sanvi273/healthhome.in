
const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const verificationMiddleware = require("../middleware/verificationMiddleware");
const approvedLaboratory = verificationMiddleware(["laboratory"]);
const router = express.Router();

const {
  addLabOrder,
  collectLabCODPayment,
  getLabOrders,
  getLabOrderById,
  acceptLabOrder,
  rejectLabOrder,
  assignSampleCollector,
  collectorOnTheWay,
  markSampleCollected,
  setPrescriptionLabAmount,
  markSampleReceived,
  startTesting,
  updateLabOrderStatus,
  uploadReport,

  // Collection OTP
  generateCollectionOtp,
  verifyCollectionOtp,
  getCollectionOtp,

  // Cancellation and rescheduling
  cancelLabOrder,
  requestLabReschedule,
  decideLabReschedule,
  proposeLabReschedule,
  respondToLabReschedule,
} = require("../controllers/labOrderController");

// ==========================================================
// HEALTH CHECK
// ==========================================================

router.get("/test", (req, res) => {
  res.status(200).send("Lab order route working");
});

// ==========================================================
// CREATE AND FETCH BOOKINGS
// ==========================================================

router.post("/add", authMiddleware, addLabOrder);

router.post(
  "/cod/collect/:id",
  authMiddleware,
  approvedLaboratory,
  collectLabCODPayment
);

router.get("/all", getLabOrders);

// ==========================================================
// COLLECTION OTP
// Keep these routes before the generic /:id route.
// ==========================================================

router.get("/collection-otp/:id", authMiddleware, approvedLaboratory, getCollectionOtp);

router.post(
  "/generate-collection-otp/:id",
  authMiddleware,
  approvedLaboratory,
  generateCollectionOtp
);

router.post(
  "/verify-collection-otp/:id",
  authMiddleware,
  approvedLaboratory,
  verifyCollectionOtp
);

// ==========================================================
// CANCEL ENTIRE LAB BOOKING
// ==========================================================

router.put("/cancel/:id", cancelLabOrder);

// ==========================================================
// PATIENT REQUESTS A NEW DATE/TIME
// PUT /api/lab-orders/reschedule/:id
// ==========================================================

router.put(
  "/reschedule/:id",
  requestLabReschedule
);

// ==========================================================
// LAB ACCEPTS OR CANCELS PATIENT RESCHEDULE REQUEST
// PUT /api/lab-orders/reschedule/:id/decision
//
// Body examples:
// { "labId": "...", "decision": "Approved" }
// { "labId": "...", "decision": "Cancelled" }
// ==========================================================

router.put(
  "/reschedule/:id/decision",
  authMiddleware,
  approvedLaboratory,
  decideLabReschedule
);

// ==========================================================
// LAB PROPOSES A NEW DATE/TIME
// PUT /api/lab-orders/reschedule/:id/propose
// ==========================================================

router.put(
  "/reschedule/:id/propose",
  authMiddleware,
  approvedLaboratory,
  proposeLabReschedule
);

// ==========================================================
// PATIENT ACCEPTS OR DECLINES LAB PROPOSAL
// PUT /api/lab-orders/reschedule/:id/respond
//
// Body examples:
// { "patientId": "...", "decision": "Accepted" }
// { "patientId": "...", "decision": "Declined" }
// ==========================================================

router.put(
  "/reschedule/:id/respond",
  respondToLabReschedule
);

// ==========================================================
// LABORATORY BOOKING WORKFLOW
// ==========================================================

router.put("/accept/:id", authMiddleware, approvedLaboratory, acceptLabOrder);

// Legacy endpoint retained for compatibility.
// The updated dashboard should use Reschedule instead.
router.put("/reject/:id", authMiddleware, approvedLaboratory, rejectLabOrder);

router.put(
  "/assign-collector/:id",
  authMiddleware,
  approvedLaboratory,
  assignSampleCollector
);

router.put(
  "/collector-on-the-way/:id",
  authMiddleware,
  approvedLaboratory,
  collectorOnTheWay
);

router.put(
  "/sample-collected/:id",
  authMiddleware,
  approvedLaboratory,
  markSampleCollected
);

router.put(
  "/sample-received/:id",
  authMiddleware,
  approvedLaboratory,
  markSampleReceived
);

router.put(
  "/start-testing/:id",
  authMiddleware,
  approvedLaboratory,
  startTesting
);

router.put(
  "/status/:id",
  authMiddleware,
  approvedLaboratory,
  updateLabOrderStatus
);

// ==========================================================
// UPLOAD LAB REPORT
// ==========================================================

router.put("/report/:id", authMiddleware, approvedLaboratory, uploadReport);


// ==========================================================
// SET PRESCRIPTION LAB TEST FINAL AMOUNT
// PUT /api/lab-orders/prescription-payment/amount/:id
// ==========================================================

router.put(
  "/prescription-payment/amount/:id",
  authMiddleware,
  approvedLaboratory,
  setPrescriptionLabAmount
);

// ==========================================================
// GET SINGLE BOOKING
// Keep generic route last.
// ==========================================================

router.get("/:id", getLabOrderById);



module.exports = router;
