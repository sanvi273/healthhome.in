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
  res.send("Lab order route working");
});

// ==========================================================
// CREATE AND FETCH BOOKINGS
// ==========================================================
router.post("/add", addLabOrder);
router.get("/all", getLabOrders);

// Keep specific routes before the /:id route.
// ==========================================================
// COLLECTION OTP
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
// CANCELLATION
// ==========================================================
router.put("/cancel/:id", cancelLabOrder);

// ==========================================================
// PATIENT REQUESTS RESCHEDULE
// ==========================================================
router.put(
  "/reschedule/:id",
  requestLabReschedule
);

// ==========================================================
// LAB APPROVES OR REJECTS PATIENT REQUEST
// ==========================================================
router.put(
  "/reschedule/:id/decision",
  decideLabReschedule
);

// ==========================================================
// LAB PROPOSES A NEW DATE/TIME
// ==========================================================
router.put(
  "/reschedule/:id/propose",
  proposeLabReschedule
);

// ==========================================================
// PATIENT RESPONDS TO LAB PROPOSAL
// ==========================================================
router.put(
  "/reschedule/:id/respond",
  respondToLabReschedule
);

// ==========================================================
// LABORATORY WORKFLOW
// ==========================================================
router.put("/accept/:id", acceptLabOrder);
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
// Keep this generic route after all specific routes.
// ==========================================================
router.get("/:id", getLabOrderById);

module.exports = router;