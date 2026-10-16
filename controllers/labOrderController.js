
const LabOrder = require("../models/labOrder");
const SampleCollector = require("../models/sampleCollector");
const crypto = require("crypto");

// ============================================================
// ADD LAB ORDER
// ============================================================

const addLabOrder = async (req, res) => {
  try {
    const {
      patientId,
      patientName,
      patientPhone,
      doctorName,
      tests,
      labId,
      labName,
      address,
      notes,
      prescriptionImage,
      collectionMode,
      bookingType,
    } = req.body;

    if (!patientId || !patientName) {
      return res.status(400).json({
        success: false,
        message: "Patient information is required.",
      });
    }

    if (!labId) {
      return res.status(400).json({
        success: false,
        message: "Laboratory ID is required.",
      });
    }

    const Lab = require("../models/lab");
    const lab = await Lab.findById(labId);

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: "Laboratory not found.",
      });
    }

    if (lab.available === false) {
      return res.status(400).json({
        success: false,
        message: "This laboratory is currently unavailable.",
      });
    }

    const finalBookingType =
      String(bookingType || "TEST").toUpperCase() === "PRESCRIPTION"
        ? "PRESCRIPTION"
        : "TEST";

    const finalCollectionMode =
      collectionMode === "Visit Laboratory"
        ? "Visit Laboratory"
        : "Home Collection";

    if (
      finalCollectionMode === "Home Collection" &&
      !String(address || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Home collection address is required.",
      });
    }

    if (
      finalBookingType === "PRESCRIPTION" &&
      !String(prescriptionImage || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Prescription image is required.",
      });
    }

    const requestedTests = Array.isArray(tests)
      ? tests.map((test) => String(test || "").trim()).filter(Boolean)
      : [];

    const uniqueTestNames = [
      ...new Set(requestedTests.map((name) => name.toLowerCase())),
    ];

    let finalTests = [];
    let totalAmount = 0;

    if (finalBookingType === "TEST") {
      if (uniqueTestNames.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Please select at least one lab test.",
        });
      }

      const activeTests = Array.isArray(lab.tests)
        ? lab.tests.filter((test) => test.isActive !== false)
        : [];

      const matchedTests = [];

      for (const requestedLower of uniqueTestNames) {
        const found = activeTests.find(
          (test) =>
            String(test.testName || "").trim().toLowerCase() ===
            requestedLower
        );

        if (!found) {
          return res.status(400).json({
            success: false,
            message: `The selected test "${requestedLower}" is not available at this laboratory.`,
          });
        }

        const price = Number(found.price);

        if (!Number.isFinite(price) || price < 0) {
          return res.status(400).json({
            success: false,
            message: `Invalid price configured for lab test "${found.testName}".`,
          });
        }

        matchedTests.push(found);
        totalAmount += price;
      }

      finalTests = matchedTests.map((test) =>
        String(test.testName).trim()
      );
    } else {
      totalAmount = 0;
      finalTests = [];
    }

    const order = await LabOrder.create({
      patientId: String(patientId).trim(),
      patientName: String(patientName).trim(),
      patientPhone: String(patientPhone || "").trim(),
      doctorName: String(doctorName || "").trim(),
      bookingType: finalBookingType,
      tests: finalTests,
      labId: String(lab._id),
      labName: String(lab.name || labName || ""),
      address: String(address || "").trim(),
      notes: String(notes || "").trim(),
      totalAmount,
      paymentStatus: "Pending",
      razorpayOrderId: "",
      razorpayPaymentId: "",
      razorpaySignature: "",
      paymentRecordId: "",
      prescriptionImage: String(prescriptionImage || "").trim(),
      collectionMode: finalCollectionMode,
      collectorId: "",
      collectorName: "",
      collectorPhone: "",
      collectorStatus: "Not Assigned",
      status: "Pending",
      scheduledAt: null,
      previousScheduledAt: null,
      requestedScheduledAt: null,
      rescheduleRequestedAt: null,
      rescheduleReason: "",
      rescheduleStatus: "None",
      rescheduleProposedBy: null,
      rescheduleRespondedBy: null,
      rescheduleRespondedAt: null,
      rescheduleResponseReason: "",
      rescheduleCount: 0,
      reports: [],
      reportUploadedAt: null,
    });

    console.log("================================");
    console.log("NEW LAB ORDER");
    console.log("ORDER ID =", order._id);
    console.log("PATIENT =", order.patientName);
    console.log("LAB =", order.labName);
    console.log("BOOKING TYPE =", order.bookingType);
    console.log("TESTS =", order.tests);
    console.log("TOTAL AMOUNT =", order.totalAmount);
    console.log("PAYMENT STATUS =", order.paymentStatus);
    console.log("COLLECTION MODE =", order.collectionMode);
    console.log("STATUS =", order.status);
    console.log("================================");

    return res.status(201).json({
      success: true,
      message:
        finalBookingType === "PRESCRIPTION"
          ? "Lab prescription booking created successfully. Payment will be collected when the sample is taken."
          : "Lab booking created successfully.",
      order,
    });
  } catch (error) {
    console.error("ADD LAB ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to create lab booking.",
    });
  }
};

// ============================================================
// GET ALL LAB ORDERS
// ============================================================

const getLabOrders = async (req, res) => {
  try {
    const orders = await LabOrder.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("GET LAB ORDERS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// GET SINGLE LAB ORDER
// ============================================================

const getLabOrderById = async (req, res) => {
  try {
    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("GET SINGLE LAB ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// ACCEPT LAB BOOKING
// ============================================================

const acceptLabOrder = async (req, res) => {
  try {
    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (order.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Order is already ${order.status}.`,
      });
    }

    if (order.rescheduleStatus === "Pending") {
      return res.status(409).json({
        success: false,
        message:
          "A reschedule request is pending. Resolve it before accepting the booking.",
      });
    }

    order.status = "Accepted";
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Lab booking accepted successfully.",
      order,
    });
  } catch (error) {
    console.error("ACCEPT LAB ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// REJECT LAB BOOKING
// Legacy endpoint retained for compatibility.
// The updated Lab Dashboard should use Reschedule instead.
// ============================================================

const rejectLabOrder = async (req, res) => {
  try {
    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (order.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Only pending bookings can be rejected. Current status: ${order.status}.`,
      });
    }

    order.status = "Rejected";
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Lab booking rejected.",
      order,
    });
  } catch (error) {
    console.error("REJECT LAB ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// ASSIGN SAMPLE COLLECTOR
// ============================================================

const assignSampleCollector = async (req, res) => {
  try {
    const { collectorId } = req.body;

    if (!collectorId) {
      return res.status(400).json({
        success: false,
        message: "Collector ID is required.",
      });
    }

    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (order.collectionMode !== "Home Collection") {
      return res.status(400).json({
        success: false,
        message:
          "Sample collector is required only for Home Collection.",
      });
    }

    if (order.status !== "Accepted") {
      return res.status(400).json({
        success: false,
        message: "Booking must be accepted before assigning collector.",
      });
    }

    if (order.rescheduleStatus === "Pending") {
      return res.status(409).json({
        success: false,
        message:
          "Resolve the pending reschedule request before assigning a collector.",
      });
    }

    const collector = await SampleCollector.findById(collectorId);

    if (!collector) {
      return res.status(404).json({
        success: false,
        message: "Sample collector not found.",
      });
    }

    if (collector.status !== "Active") {
      return res.status(400).json({
        success: false,
        message: "This collector is inactive.",
      });
    }

    if (collector.availability !== "Available") {
      return res.status(400).json({
        success: false,
        message: "This collector is currently busy.",
      });
    }

    order.collectorId = collector._id.toString();
    order.collectorName = collector.name;
    order.collectorPhone = collector.phone;
    order.collectorStatus = "Assigned";
    order.status = "Collector Assigned";

    await order.save();

    collector.availability = "Busy";
    await collector.save();

    return res.status(200).json({
      success: true,
      message: "Sample collector assigned successfully.",
      order,
      collector,
    });
  } catch (error) {
    console.error("ASSIGN COLLECTOR ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// COLLECTOR ON THE WAY
// ============================================================

const collectorOnTheWay = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await LabOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (order.status !== "Collector Assigned") {
      return res.status(400).json({
        success: false,
        message: "Collector must be assigned first.",
      });
    }

    order.status = "On The Way";
    order.collectorStatus = "On The Way";

    if (order.collectionMode === "Home Collection") {
      const otp = generateLabOtp();
      const otpHash = hashLabOtp(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      saveCollectionOtpForDemo(id, otp, expiresAt);

      order.collectionOtpHash = otpHash;
      order.collectionOtpExpiresAt = expiresAt;
      order.collectionOtpAttempts = 0;
      order.collectionOtpVerified = false;
      order.collectionOtpSentAt = new Date();

      console.log("==========================================");
      console.log("NEW LAB COLLECTION OTP GENERATED");
      console.log("ORDER ID:", id);
      console.log("OTP:", otp);
      console.log("EXPIRES AT:", expiresAt.toISOString());
      console.log("==========================================");
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Collector is on the way.",
      order,
    });
  } catch (error) {
    console.error("COLLECTOR ON WAY ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// SAMPLE COLLECTED
// ============================================================

const markSampleCollected = async (req, res) => {
  try {
    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (order.status !== "On The Way") {
      return res.status(400).json({
        success: false,
        message:
          "Collector must be on the way before sample collection.",
      });
    }

    if (
      order.collectionMode === "Home Collection" &&
      order.collectionOtpVerified !== true
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP verification is required before marking sample as collected.",
      });
    }

    order.status = "Sample Collected";
    order.collectorStatus = "Sample Collected";

    await order.save();

    if (order.collectorId) {
      await SampleCollector.findByIdAndUpdate(order.collectorId, {
        availability: "Available",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Sample collected successfully.",
      order,
    });
  } catch (error) {
    console.error("SAMPLE COLLECTED ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// SAMPLE RECEIVED AT LAB
// ============================================================

const markSampleReceived = async (req, res) => {
  try {
    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (
      order.collectionMode === "Home Collection" &&
      order.status !== "Sample Collected"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Sample must be collected before receiving it at the laboratory.",
      });
    }

    if (
      order.collectionMode === "Visit Laboratory" &&
      order.status !== "Accepted"
    ) {
      return res.status(400).json({
        success: false,
        message: "Booking must be accepted before receiving the sample.",
      });
    }

    order.status = "Sample Received";
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Sample received at laboratory.",
      order,
    });
  } catch (error) {
    console.error("SAMPLE RECEIVED ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// START TESTING
// ============================================================

const startTesting = async (req, res) => {
  try {
    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (order.status !== "Sample Received") {
      return res.status(400).json({
        success: false,
        message: "Sample must be received before testing.",
      });
    }

    order.status = "In Progress";
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Testing started.",
      order,
    });
  } catch (error) {
    console.error("START TESTING ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// GENERAL STATUS UPDATE
// ============================================================

const updateLabOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required.",
      });
    }

    const allowedStatuses = [
      "Pending",
      "Accepted",
      "Collector Assigned",
      "On The Way",
      "Sample Collected",
      "Sample Received",
      "In Progress",
      "Report Ready",
      "Completed",
      "Rejected",
      "Cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lab order status.",
      });
    }

    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (
      order.rescheduleStatus === "Pending" &&
      ["Accepted", "Collector Assigned", "On The Way"].includes(status)
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Resolve the pending reschedule request before continuing the booking.",
      });
    }

    if (
      status === "Sample Collected" &&
      order.collectionMode === "Home Collection" &&
      order.collectionOtpVerified !== true
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP verification is required before sample collection.",
      });
    }

    order.status = status;

    if (status === "Collector Assigned") {
      order.collectorStatus = "Assigned";
    }

    if (status === "On The Way") {
      order.collectorStatus = "On The Way";
    }

    if (status === "Sample Collected") {
      order.collectorStatus = "Sample Collected";
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Lab order status updated.",
      order,
    });
  } catch (error) {
    console.error("UPDATE STATUS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// UPLOAD LAB REPORT
// ============================================================

const uploadReport = async (req, res) => {
  try {
    const { reports } = req.body;

    if (!reports) {
      return res.status(400).json({
        success: false,
        message: "Reports are required.",
      });
    }

    let reportList = reports;

    if (typeof reports === "string") {
      try {
        reportList = JSON.parse(reports);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid reports format.",
        });
      }
    }

    if (!Array.isArray(reportList) || reportList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one report file is required.",
      });
    }

    const order = await LabOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (order.status !== "In Progress") {
      return res.status(400).json({
        success: false,
        message: "Testing must be in progress before uploading report.",
      });
    }

    const cleanedReports = reportList.map((report, index) => {
      if (!report || !report.fileUrl) {
        throw new Error(
          `Report file URL is missing for page ${index + 1}.`
        );
      }

      const reportName = String(report.reportName || "").trim();

      if (!reportName) {
        throw new Error(
          `Report name is missing for page ${index + 1}.`
        );
      }

      return {
        reportName,
        fileName: report.fileName || `Report_Page_${index + 1}`,
        fileUrl: report.fileUrl,
        fileType: report.fileType || "unknown",
        pageNumber: Number(report.pageNumber) || index + 1,
      };
    });

    order.reports = cleanedReports;
    order.reportUploadedAt = new Date();
    order.status = "Completed";

    await order.save();

    console.log("LAB REPORT UPLOADED");
    console.log("ORDER ID =", order._id);
    console.log("TOTAL REPORT FILES =", order.reports.length);
    console.log("STATUS =", order.status);

    return res.status(200).json({
      success: true,
      message: "Lab report uploaded successfully.",
      order,
    });
  } catch (error) {
    console.error("UPLOAD REPORT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==========================================================
// LAB COLLECTION OTP HELPERS
// ==========================================================

const generateLabOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

const hashLabOtp = (otp) => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

// ==========================================================
// DEMO OTP STORE
// ==========================================================

const collectionOtpStore = new Map();

const saveCollectionOtpForDemo = (orderId, otp, expiresAt) => {
  collectionOtpStore.set(String(orderId), {
    otp: String(otp),
    expiresAt: new Date(expiresAt).getTime(),
  });
};

const getCollectionOtpFromDemoStore = (orderId) => {
  const entry = collectionOtpStore.get(String(orderId));

  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    collectionOtpStore.delete(String(orderId));
    return null;
  }

  return entry.otp;
};

const deleteCollectionOtpFromDemoStore = (orderId) => {
  collectionOtpStore.delete(String(orderId));
};

// ==========================================================
// GENERATE LAB COLLECTION OTP
// ==========================================================

const generateCollectionOtp = async (req, res) => {
  try {
    const { id } = req.params;

    const labOrder = await LabOrder.findById(id).select("+collectionOtpHash");

    if (!labOrder) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (labOrder.collectionMode !== "Home Collection") {
      return res.status(400).json({
        success: false,
        message: "OTP is required only for Home Collection.",
      });
    }

    if (labOrder.status !== "On The Way") {
      return res.status(400).json({
        success: false,
        message:
          "OTP can be generated only when the collector is On The Way.",
      });
    }

    const now = new Date();

    if (
      labOrder.collectionOtpExpiresAt &&
      labOrder.collectionOtpExpiresAt <= now
    ) {
      labOrder.collectionOtpHash = "";
      labOrder.collectionOtpExpiresAt = null;
      labOrder.collectionOtpAttempts = 0;
      labOrder.collectionOtpVerified = false;
      labOrder.collectionOtpSentAt = null;

      deleteCollectionOtpFromDemoStore(id);
    }

    if (
      labOrder.collectionOtpHash &&
      labOrder.collectionOtpExpiresAt &&
      labOrder.collectionOtpExpiresAt > new Date() &&
      labOrder.collectionOtpVerified !== true
    ) {
      const existingOtp = getCollectionOtpFromDemoStore(id);

      if (!existingOtp) {
        return res.status(400).json({
          success: false,
          message:
            "OTP is active but unavailable in server memory. Generate a new OTP.",
          expiresAt: labOrder.collectionOtpExpiresAt,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Existing OTP is still active.",
        collectionOtp: existingOtp,
        expiresAt: labOrder.collectionOtpExpiresAt,
        alreadyActive: true,
        testingOnly: true,
      });
    }

    const otp = generateLabOtp();
    const otpHash = hashLabOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    saveCollectionOtpForDemo(id, otp, expiresAt);

    labOrder.collectionOtpHash = otpHash;
    labOrder.collectionOtpExpiresAt = expiresAt;
    labOrder.collectionOtpAttempts = 0;
    labOrder.collectionOtpVerified = false;
    labOrder.collectionOtpSentAt = new Date();

    await labOrder.save();

    console.log("NEW LAB COLLECTION OTP GENERATED");
    console.log("ORDER ID:", id);
    console.log("EXPIRES AT:", expiresAt.toISOString());

    return res.status(200).json({
      success: true,
      message: "OTP generated successfully.",
      expiresAt,
      otpForTesting: otp,
      collectionOtp: otp,
      testingOnly: true,
    });
  } catch (error) {
    console.error("GENERATE COLLECTION OTP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to generate collection OTP.",
      error: error.message,
    });
  }
};

// ==========================================================
// GET LAB COLLECTION OTP
// Demo/testing endpoint. Do not expose plaintext OTP publicly.
// ==========================================================

const getCollectionOtp = async (req, res) => {
  try {
    const { id } = req.params;
    const labOrder = await LabOrder.findById(id).select("+collectionOtpHash");

    if (!labOrder) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (labOrder.collectionMode !== "Home Collection") {
      return res.status(400).json({
        success: false,
        message: "Collection OTP is available only for Home Collection.",
      });
    }

    if (labOrder.status !== "On The Way") {
      return res.status(400).json({
        success: false,
        message:
          "Collection OTP is available only when collector is On The Way.",
      });
    }

    if (labOrder.collectionOtpVerified === true) {
      return res.status(400).json({
        success: false,
        message: "Collection OTP has already been verified.",
      });
    }

    if (
      !labOrder.collectionOtpHash ||
      !labOrder.collectionOtpExpiresAt
    ) {
      return res.status(404).json({
        success: false,
        message: "No active collection OTP found. Generate the OTP first.",
      });
    }

    if (new Date() > new Date(labOrder.collectionOtpExpiresAt)) {
      deleteCollectionOtpFromDemoStore(id);

      return res.status(400).json({
        success: false,
        message: "Collection OTP has expired. Generate a new OTP.",
        expired: true,
      });
    }

    const collectionOtp = getCollectionOtpFromDemoStore(id);

    if (!collectionOtp) {
      return res.status(404).json({
        success: false,
        message:
          "Collection OTP is no longer available in server memory. Generate a new OTP.",
        testingOnly: true,
      });
    }

    return res.status(200).json({
      success: true,
      collectionOtp,
      collectionOtpExpiresAt: labOrder.collectionOtpExpiresAt,
      testingOnly: true,
    });
  } catch (error) {
    console.error("GET COLLECTION OTP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get collection OTP.",
      error: error.message,
    });
  }
};

// ==========================================================
// VERIFY LAB COLLECTION OTP
// ==========================================================

const verifyCollectionOtp = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "OTP is required.",
      });
    }

    const enteredOtp = String(otp).trim();

    if (!/^\d{6}$/.test(enteredOtp)) {
      return res.status(400).json({
        success: false,
        message: "OTP must contain exactly 6 digits.",
      });
    }

    const labOrder = await LabOrder.findById(id).select("+collectionOtpHash");

    if (!labOrder) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found.",
      });
    }

    if (labOrder.collectionMode !== "Home Collection") {
      return res.status(400).json({
        success: false,
        message: "OTP verification is required only for Home Collection.",
      });
    }

    if (labOrder.status !== "On The Way") {
      return res.status(400).json({
        success: false,
        message: "OTP can only be verified when collector is On The Way.",
      });
    }

    if (labOrder.collectionOtpVerified === true) {
      return res.status(400).json({
        success: false,
        message: "OTP has already been verified.",
      });
    }

    if (!labOrder.collectionOtpHash) {
      return res.status(400).json({
        success: false,
        message: "No active OTP found. Generate a new OTP.",
      });
    }

    if (
      !labOrder.collectionOtpExpiresAt ||
      labOrder.collectionOtpExpiresAt <= new Date()
    ) {
      labOrder.collectionOtpHash = "";
      labOrder.collectionOtpExpiresAt = null;
      labOrder.collectionOtpAttempts = 0;
      labOrder.collectionOtpSentAt = null;

      deleteCollectionOtpFromDemoStore(id);
      await labOrder.save();

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Generate a new OTP.",
      });
    }

    const MAX_ATTEMPTS = 5;

    if (labOrder.collectionOtpAttempts >= MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "Maximum OTP attempts exceeded. Generate a new OTP.",
      });
    }

    labOrder.collectionOtpAttempts += 1;

    const enteredOtpHash = hashLabOtp(enteredOtp);

    if (enteredOtpHash !== labOrder.collectionOtpHash) {
      await labOrder.save();

      return res.status(400).json({
        success: false,
        message: "Incorrect OTP.",
        remainingAttempts:
          MAX_ATTEMPTS - labOrder.collectionOtpAttempts,
      });
    }

    labOrder.collectionOtpVerified = true;
    labOrder.status = "Sample Collected";
    labOrder.collectorStatus = "Sample Collected";
    labOrder.collectionOtpHash = "";
    labOrder.collectionOtpExpiresAt = null;
    labOrder.collectionOtpAttempts = 0;
    labOrder.collectionOtpSentAt = null;

    deleteCollectionOtpFromDemoStore(id);

    if (labOrder.collectorId) {
      await SampleCollector.findByIdAndUpdate(labOrder.collectorId, {
        availability: "Available",
      });
    }

    await labOrder.save();

    return res.status(200).json({
      success: true,
      message: "Patient verified successfully. Sample collected.",
      status: labOrder.status,
      collectorStatus: labOrder.collectorStatus,
    });
  } catch (error) {
    console.error("VERIFY COLLECTION OTP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to verify collection OTP.",
      error: error.message,
    });
  }
};

// ==========================================================
// RESCHEDULING HELPERS
// ==========================================================

const canChangeLabBooking = (order) => {
  if (!order) return false;

  return ["Pending", "Accepted"].includes(order.status);
};

const validateFutureDate = (value) => {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime()) || date <= new Date()) {
    return null;
  }

  return date;
};

const clearRescheduleRequest = (order) => {
  order.requestedScheduledAt = null;
  order.rescheduleRequestedAt = null;
  order.rescheduleReason = "";
  order.rescheduleProposedBy = null;
};

// ==========================================================
// CANCEL LAB BOOKING
// This endpoint cancels the whole booking, not just a request.
// ==========================================================

const cancelLabOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { patientId, labId, cancelledBy, reason } = req.body;

    const order = await LabOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab booking not found.",
      });
    }

    if (!["Patient", "Laboratory"].includes(cancelledBy)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cancellation requester.",
      });
    }

    if (
      cancelledBy === "Patient" &&
      String(order.patientId) !== String(patientId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Patient does not match this booking.",
      });
    }

    if (
      cancelledBy === "Laboratory" &&
      String(order.labId) !== String(labId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Laboratory does not match this booking.",
      });
    }

    if (!canChangeLabBooking(order)) {
      return res.status(400).json({
        success: false,
        message:
          `This booking cannot be cancelled at its current status "${order.status}".`,
      });
    }

    order.status = "Cancelled";
    order.cancelledBy = cancelledBy;
    order.cancelledAt = new Date();
    order.cancellationReason = String(reason || "").trim();

    if (order.rescheduleStatus === "Pending") {
      order.rescheduleStatus = "Cancelled";
      order.rescheduleRespondedBy = cancelledBy;
      order.rescheduleRespondedAt = new Date();
      order.rescheduleResponseReason = "Booking cancelled.";
      clearRescheduleRequest(order);
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Lab booking cancelled successfully.",
      order,
    });
  } catch (error) {
    console.error("CANCEL LAB ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to cancel lab booking.",
      error: error.message,
    });
  }
};

// ==========================================================
// PATIENT REQUESTS A NEW DATE/TIME
// ==========================================================

const requestLabReschedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { patientId, scheduledAt, reason } = req.body;

    if (!patientId || !scheduledAt) {
      return res.status(400).json({
        success: false,
        message: "Patient ID and new date/time are required.",
      });
    }

    const requestedDate = validateFutureDate(scheduledAt);

    if (!requestedDate) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid date and time in the future.",
      });
    }

    const order = await LabOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab booking not found.",
      });
    }

    if (String(order.patientId) !== String(patientId)) {
      return res.status(403).json({
        success: false,
        message: "Patient does not match this booking.",
      });
    }

    if (!canChangeLabBooking(order)) {
      return res.status(400).json({
        success: false,
        message: "This booking can no longer be rescheduled.",
      });
    }

   if (
  order.rescheduleStatus === "Pending" &&
  order.rescheduleProposedBy === "Laboratory"
) {
  return res.status(409).json({
    success: false,
    message:
      "A laboratory proposal is already awaiting the patient's response.",
  });
}

    order.requestedScheduledAt = requestedDate;
    order.rescheduleRequestedAt = new Date();
    order.rescheduleReason = String(reason || "").trim();
    order.rescheduleStatus = "Pending";
    order.rescheduleProposedBy = "Patient";
    order.rescheduleRespondedBy = null;
    order.rescheduleRespondedAt = null;
    order.rescheduleResponseReason = "";
    order.rescheduleCount = Number(order.rescheduleCount || 0) + 1;

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Reschedule request sent to the laboratory.",
      order,
    });
  } catch (error) {
    console.error("RESCHEDULE REQUEST ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to request rescheduling.",
      error: error.message,
    });
  }
};

const decideLabReschedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { labId, decision, reason } = req.body;

    if (!labId) {
      return res.status(400).json({
        success: false,
        message: "Laboratory ID is required.",
      });
    }

    const normalizedDecision = String(decision || "")
      .trim()
      .toLowerCase();

    const isAccept = [
      "accept",
      "accepted",
      "approve",
      "approved",
    ].includes(normalizedDecision);

    const isCancel = [
      "cancel",
      "cancelled",
      "canceled",
      "decline",
      "declined",
      "reject",
      "rejected",
    ].includes(normalizedDecision);

    if (!isAccept && !isCancel) {
      return res.status(400).json({
        success: false,
        message: 'Decision must be "Accepted" or "Cancelled".',
      });
    }

    const order = await LabOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab booking not found.",
      });
    }

    if (String(order.labId) !== String(labId)) {
      return res.status(403).json({
        success: false,
        message: "Laboratory does not match this booking.",
      });
    }

    // Allow pending reschedule requests from either side.
    if (
      order.rescheduleStatus !== "Pending" ||
      !["Patient", "Laboratory"].includes(
        String(order.rescheduleProposedBy || "")
      )
    ) {
      return res.status(409).json({
        success: false,
        message: "No pending reschedule request is available.",
      });
    }

    // ACCEPT: confirm the proposed date and continue the existing booking.
    if (isAccept) {
      if (
        !order.requestedScheduledAt ||
        new Date(order.requestedScheduledAt) <= new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: "The proposed date/time is invalid or has passed.",
        });
      }

      order.previousScheduledAt = order.scheduledAt || null;
      order.scheduledAt = order.requestedScheduledAt;
      order.rescheduleStatus = "Approved";
      order.rescheduleRespondedBy = "Laboratory";
      order.rescheduleRespondedAt = new Date();
      order.rescheduleResponseReason = String(reason || "").trim();

      // Clear only the temporary request fields.
      clearRescheduleRequest(order);

      await order.save();

      return res.status(200).json({
        success: true,
        message: "New time accepted. Booking confirmed.",
        order,
      });
    }

    // CANCEL: remove the pending request, NOT the lab booking.
    order.rescheduleStatus = "Cancelled";
    order.rescheduleRespondedBy = "Laboratory";
    order.rescheduleRespondedAt = new Date();
    order.rescheduleResponseReason = String(
      reason || "Reschedule request cancelled by laboratory."
    ).trim();

    // scheduledAt remains unchanged.
    clearRescheduleRequest(order);

    await order.save();

    return res.status(200).json({
      success: true,
      message:
        "Reschedule request cancelled. Original booking is unchanged.",
      order,
    });
  } catch (error) {
    console.error("DECIDE LAB RESCHEDULE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to process the reschedule request.",
      error: error.message,
    });
  }
};

// ==========================================================
// LAB PROPOSES A NEW DATE/TIME
// Use this when the lab technician is unavailable.
// ==========================================================

const proposeLabReschedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { labId, scheduledAt, reason } = req.body;

    if (!labId || !scheduledAt) {
      return res.status(400).json({
        success: false,
        message: "Laboratory ID and proposed date/time are required.",
      });
    }

    const proposedDate = validateFutureDate(scheduledAt);

    if (!proposedDate) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid date and time in the future.",
      });
    }

    const order = await LabOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab booking not found.",
      });
    }

    if (String(order.labId) !== String(labId)) {
      return res.status(403).json({
        success: false,
        message: "Laboratory does not match this booking.",
      });
    }

    if (!canChangeLabBooking(order)) {
      return res.status(400).json({
        success: false,
        message: "This booking can no longer be rescheduled.",
      });
    }

    if (order.rescheduleStatus === "Pending") {
      return res.status(409).json({
        success: false,
        message: "A reschedule request is already pending.",
      });
    }

    order.requestedScheduledAt = proposedDate;
    order.rescheduleRequestedAt = new Date();
    order.rescheduleReason = String(reason || "").trim();
    order.rescheduleStatus = "Pending";
    order.rescheduleProposedBy = "Laboratory";
    order.rescheduleRespondedBy = null;
    order.rescheduleRespondedAt = null;
    order.rescheduleResponseReason = "";
    order.rescheduleCount = Number(order.rescheduleCount || 0) + 1;

    await order.save();

    return res.status(200).json({
      success: true,
      message: "New date/time proposed. Waiting for patient response.",
      order,
    });
  } catch (error) {
    console.error("LAB PROPOSE RESCHEDULE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to propose a new date/time.",
      error: error.message,
    });
  }
};

// ==========================================================
// PATIENT ACCEPTS OR DECLINES THE LAB'S PROPOSAL
// ==========================================================


const respondToLabReschedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { patientId, decision } = req.body;

    const allowedDecisions = [
      "Accepted",
      "Declined",
      "Requested Another Time",
    ];

    if (!patientId || !allowedDecisions.includes(decision)) {
      return res.status(400).json({
        success: false,
        message:
          'Patient ID and decision "Accepted", "Declined", or "Requested Another Time" are required.',
      });
    }

    const order = await LabOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab booking not found.",
      });
    }

    if (String(order.patientId) !== String(patientId)) {
      return res.status(403).json({
        success: false,
        message: "Patient does not match this booking.",
      });
    }

    if (
      order.rescheduleStatus !== "Pending" ||
      order.rescheduleProposedBy !== "Laboratory" ||
      !order.requestedScheduledAt ||
      !canChangeLabBooking(order)
    ) {
      return res.status(409).json({
        success: false,
        message:
          "No laboratory-proposed date/time is awaiting your response.",
      });
    }

    // PATIENT ASKS FOR ANOTHER TIME.
    // Keep the original booking date/time unchanged.
    if (decision === "Requested Another Time") {
      order.requestedScheduledAt = null;
      order.rescheduleRequestedAt = new Date();
      order.rescheduleProposedBy = "Patient";
      order.rescheduleStatus = "Pending";
      order.rescheduleReason =
        "Patient requested another available date/time.";

      await order.save();

      return res.status(200).json({
        success: true,
        message:
          "Request sent to the laboratory for another date/time.",
        order,
      });
    }

    // PATIENT ACCEPTS THE LAB'S PROPOSED TIME.
    if (decision === "Accepted") {
      const proposedDate = new Date(order.requestedScheduledAt);

      if (
        Number.isNaN(proposedDate.getTime()) ||
        proposedDate <= new Date()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "The proposed date/time is no longer valid. Contact the laboratory.",
        });
      }

      order.previousScheduledAt = order.scheduledAt || null;
      order.scheduledAt = proposedDate;
      order.rescheduleStatus = "Approved";
    }

    // PATIENT DECLINES THE PROPOSAL.
    // Do not cancel the entire lab booking.
    if (decision === "Declined") {
      order.rescheduleStatus = "Rejected";
    }

    order.requestedScheduledAt = null;
    order.rescheduleRequestedAt = null;
    order.rescheduleProposedBy = null;

    await order.save();

    return res.status(200).json({
      success: true,
      message:
        decision === "Accepted"
          ? "New lab booking date/time accepted."
          : "Proposal declined. The original booking remains unchanged.",
      order,
    });
  } catch (error) {
    console.error("PATIENT RESCHEDULE RESPONSE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to process the reschedule response.",
      error: error.message,
    });
  }
};



// ==========================================================
// EXPORTS
// ==========================================================

module.exports = {
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
  generateCollectionOtp,
  getCollectionOtp,
  verifyCollectionOtp,
  cancelLabOrder,
  requestLabReschedule,
  decideLabReschedule,
  proposeLabReschedule,
  respondToLabReschedule,
};
