
const express = require("express");

const router = express.Router();

const {
  addLabOrder,
  getLabOrders,
  getLabOrderById,
  acceptLabOrder,
  rejectLabOrder,
  assignSampleCollector,
  collectorOnTheWay,
  markSampleCollected,
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

router.post("/add", addLabOrder);

router.get("/all", getLabOrders);

// ==========================================================
// COLLECTION OTP
// Keep these routes before the generic /:id route.
// ==========================================================

router.get("/collection-otp/:id", getCollectionOtp);

router.post(
  "/generate-collection-otp/:id",
  generateCollectionOtp
);

router.post(
  "/verify-collection-otp/:id",
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
  decideLabReschedule
);

// ==========================================================
// LAB PROPOSES A NEW DATE/TIME
// PUT /api/lab-orders/reschedule/:id/propose
// ==========================================================

router.put(
  "/reschedule/:id/propose",
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

router.put("/accept/:id", acceptLabOrder);

// Legacy endpoint retained for compatibility.
// The updated dashboard should use Reschedule instead.
router.put("/reject/:id", rejectLabOrder);

router.put(
  "/assign-collector/:id",
  assignSampleCollector
);

router.put(
  "/collector-on-the-way/:id",
  collectorOnTheWay
);

router.put(
  "/sample-collected/:id",
  markSampleCollected
);

router.put(
  "/sample-received/:id",
  markSampleReceived
);

router.put(
  "/start-testing/:id",
  startTesting
);

router.put(
  "/status/:id",
  updateLabOrderStatus
);

// ==========================================================
// UPLOAD LAB REPORT
// ==========================================================

router.put("/report/:id", uploadReport);

// ==========================================================
// GET SINGLE BOOKING
// Keep generic route last.
// ==========================================================

router.get("/:id", getLabOrderById);

module.exports = router;
