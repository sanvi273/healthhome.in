
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
} = require("../controllers/labOrderController");

// HEALTH CHECK
router.get("/test", (req, res) => {
  res.send("Lab order route working");
});

// CREATE BOOKING
router.post("/add", addLabOrder);

// GET ALL BOOKINGS
router.get("/all", getLabOrders);

// COLLECTION OTP
// Keep this route before /:id.
router.get("/collection-otp/:id", getCollectionOtp);

// CANCEL BOOKING
router.put("/cancel/:id", cancelLabOrder);

// PATIENT REQUESTS RESCHEDULE
router.put("/reschedule/:id", requestLabReschedule);

// LAB APPROVES OR REJECTS RESCHEDULE
router.put(
  "/reschedule/:id/decision",
  decideLabReschedule
);

// GET SINGLE BOOKING
router.get("/:id", getLabOrderById);

// LABORATORY WORKFLOW
router.put("/accept/:id", acceptLabOrder);
router.put("/reject/:id", rejectLabOrder);
router.put("/assign-collector/:id", assignSampleCollector);
router.put("/collector-on-the-way/:id", collectorOnTheWay);

// COLLECTION OTP VERIFICATION
router.post("/generate-collection-otp/:id", generateCollectionOtp);
router.post("/verify-collection-otp/:id", verifyCollectionOtp);

// SAMPLE COLLECTION AND PROCESSING
router.put("/sample-collected/:id", markSampleCollected);
router.put("/sample-received/:id", markSampleReceived);
router.put("/start-testing/:id", startTesting);
router.put("/status/:id", updateLabOrderStatus);

// UPLOAD LAB REPORT
router.put("/report/:id", uploadReport);

module.exports = router;
