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

    if (finalBookingType === "PRESCRIPTION") {
      if (!String(prescriptionImage || "").trim()) {
        return res.status(400).json({
          success: false,
          message: "Prescription image is required.",
        });
      }
    }

    const requestedTests = Array.isArray(tests)
      ? tests
          .map((test) => String(test || "").trim())
          .filter(Boolean)
      : [];

    const uniqueTestNames = [
      ...new Set(
        requestedTests.map((name) => name.toLowerCase())
      ),
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
        ? lab.tests.filter(
            (test) => test.isActive !== false
          )
        : [];

      const matchedTests = [];

      for (const requestedLower of uniqueTestNames) {
        const found = activeTests.find(
          (test) =>
            String(test.testName || "")
              .trim()
              .toLowerCase() === requestedLower
        );

        if (!found) {
          return res.status(400).json({
            success: false,
            message:
              `The selected test "${requestedLower}" is not available at this laboratory.`,
          });
        }

        const price = Number(found.price);

        if (!Number.isFinite(price) || price < 0) {
          return res.status(400).json({
            success: false,
            message:
              `Invalid price configured for lab test "${found.testName}".`,
          });
        }

        matchedTests.push(found);
        totalAmount += price;
      }

      finalTests = matchedTests.map(
        (test) => String(test.testName).trim()
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
      labName: String(lab.name || ""),
      address: String(address || "").trim(),
      notes: String(notes || "").trim(),
      totalAmount: totalAmount,
      paymentStatus: "Pending",
      razorpayOrderId: "",
      razorpayPaymentId: "",
      razorpaySignature: "",
      paymentRecordId: "",
      prescriptionImage:
        String(prescriptionImage || "").trim(),
      collectionMode: finalCollectionMode,
      collectorId: "",
      collectorName: "",
      collectorPhone: "",
      collectorStatus: "Not Assigned",
      status: "Pending",
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
    console.error(
      "ADD LAB ORDER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Unable to create lab booking.",
    });
  }
};

// ============================================================
// GET ALL LAB ORDERS
// ============================================================

const getLabOrders = async (req, res) => {
  try {
    const orders =
      await LabOrder
        .find()
        .sort({
          createdAt: -1,
        });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error(
      "GET LAB ORDERS ERROR:",
      error
    );

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
    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error(
      "GET SINGLE LAB ORDER ERROR:",
      error
    );

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
    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found",
      });
    }

    if (order.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message:
          `Order is already ${order.status}`,
      });
    }

    order.status = "Accepted";

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Lab booking accepted",
      order,
    });
  } catch (error) {
    console.error(
      "ACCEPT LAB ORDER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// REJECT LAB BOOKING
// ============================================================

const rejectLabOrder = async (req, res) => {
  try {
    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Lab order not found",
      });
    }

    order.status = "Rejected";

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Lab booking rejected",
      order,
    });
  } catch (error) {
    console.error(
      "REJECT LAB ORDER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// ASSIGN SAMPLE COLLECTOR
// ============================================================

const assignSampleCollector = async (
  req,
  res
) => {
  try {
    const {
      collectorId,
    } = req.body;

    if (!collectorId) {
      return res.status(400).json({
        success: false,
        message:
          "Collector ID is required",
      });
    }

    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      order.collectionMode !==
      "Home Collection"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Sample collector is required only for Home Collection",
      });
    }

    if (order.status !== "Accepted") {
      return res.status(400).json({
        success: false,
        message:
          "Booking must be accepted before assigning collector",
      });
    }

    const collector =
      await SampleCollector.findById(
        collectorId
      );

    if (!collector) {
      return res.status(404).json({
        success: false,
        message:
          "Sample collector not found",
      });
    }

    if (
      collector.status !==
      "Active"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This collector is inactive",
      });
    }

    if (
      collector.availability !==
      "Available"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This collector is currently busy",
      });
    }

    order.collectorId =
      collector._id.toString();

    order.collectorName =
      collector.name;

    order.collectorPhone =
      collector.phone;

    order.collectorStatus =
      "Assigned";

    order.status =
      "Collector Assigned";

    await order.save();

    collector.availability =
      "Busy";

    await collector.save();

    return res.status(200).json({
      success: true,
      message:
        "Sample collector assigned successfully",
      order,
      collector,
    });
  } catch (error) {
    console.error(
      "ASSIGN COLLECTOR ERROR:",
      error
    );

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
        message: "Lab order not found",
      });
    }

    if (order.status !== "Collector Assigned") {
      return res.status(400).json({
        success: false,
        message: "Collector must be assigned first",
      });
    }

    // ========================================================
    // CHANGE ORDER STATUS
    // ========================================================

    order.status = "On The Way";
    order.collectorStatus = "On The Way";

    // ========================================================
    // GENERATE OTP FOR HOME COLLECTION
    // ========================================================

    if (order.collectionMode === "Home Collection") {
      const otp = generateLabOtp();

      const otpHash = hashLabOtp(otp);

      const expiresAt = new Date(
        Date.now() + 10 * 60 * 1000
      );

      saveCollectionOtpForDemo(
        id,
        otp,
        expiresAt
      );

      order.collectionOtpHash = otpHash;
      order.collectionOtpExpiresAt = expiresAt;
      order.collectionOtpAttempts = 0;
      order.collectionOtpVerified = false;
      order.collectionOtpSentAt = new Date();

      console.log(
        "=========================================="
      );

      console.log(
        "NEW LAB COLLECTION OTP GENERATED"
      );

      console.log(
        "ORDER ID:",
        id
      );

      console.log(
        "OTP:",
        otp
      );

      console.log(
        "EXPIRES AT:",
        expiresAt.toISOString()
      );

      console.log(
        "=========================================="
      );
    }

    // ========================================================
    // SAVE EVERYTHING
    // ========================================================

    await order.save();

    console.log(
      "=========================================="
    );

    console.log(
      "COLLECTOR ON THE WAY SUCCESS"
    );

    console.log(
      "ORDER ID:",
      id
    );

    console.log(
      "STATUS:",
      order.status
    );

    console.log(
      "COLLECTOR STATUS:",
      order.collectorStatus
    );

    console.log(
      "=========================================="
    );

    return res.status(200).json({
      success: true,
      message: "Collector is on the way",
      order,
    });

  } catch (error) {
    console.error(
      "COLLECTOR ON WAY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// SAMPLE COLLECTED
// ============================================================

const markSampleCollected = async (
  req,
  res
) => {
  try {
    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      order.status !==
      "On The Way"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Collector must be on the way before sample collection",
      });
    }

    if (
      order.collectionMode ===
        "Home Collection" &&
      order.collectionOtpVerified !== true
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP verification is required before marking sample as collected.",
      });
    }

    order.status =
      "Sample Collected";

    order.collectorStatus =
      "Sample Collected";

    await order.save();

    if (order.collectorId) {
      await SampleCollector.findByIdAndUpdate(
        order.collectorId,
        {
          availability:
            "Available",
        }
      );
    }

    return res.status(200).json({
      success: true,
      message:
        "Sample collected successfully",
      order,
    });
  } catch (error) {
    console.error(
      "SAMPLE COLLECTED ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// SAMPLE RECEIVED AT LAB
// ============================================================

const markSampleReceived = async (
  req,
  res
) => {
  try {
    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      order.collectionMode ===
      "Home Collection"
    ) {
      if (
        order.status !==
        "Sample Collected"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Sample must be collected before receiving it at the laboratory",
        });
      }
    }

    if (
      order.collectionMode ===
      "Visit Laboratory"
    ) {
      if (
        order.status !==
        "Accepted"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Booking must be accepted before receiving the sample",
        });
      }
    }

    order.status =
      "Sample Received";

    await order.save();

    return res.status(200).json({
      success: true,
      message:
        "Sample received at laboratory",
      order,
    });
  } catch (error) {
    console.error(
      "SAMPLE RECEIVED ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// START TESTING
// ============================================================

const startTesting = async (
  req,
  res
) => {
  try {
    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      order.status !==
      "Sample Received"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Sample must be received before testing",
      });
    }

    order.status =
      "In Progress";

    await order.save();

    return res.status(200).json({
      success: true,
      message:
        "Testing started",
      order,
    });
  } catch (error) {
    console.error(
      "START TESTING ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// GENERAL STATUS UPDATE
// ============================================================

const updateLabOrderStatus = async (
  req,
  res
) => {
  try {
    const {
      status,
    } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message:
          "Status is required",
      });
    }

    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      status ===
        "Sample Collected" &&
      order.collectionMode ===
        "Home Collection" &&
      order.collectionOtpVerified !== true
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP verification is required before sample collection.",
      });
    }

    order.status =
      status;

    if (
      status ===
      "Collector Assigned"
    ) {
      order.collectorStatus =
        "Assigned";
    }

    if (
      status ===
      "On The Way"
    ) {
      order.collectorStatus =
        "On The Way";
    }

    if (
      status ===
      "Sample Collected"
    ) {
      order.collectorStatus =
        "Sample Collected";
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message:
        "Lab order status updated",
      order,
    });
  } catch (error) {
    console.error(
      "UPDATE STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// UPLOAD LAB REPORT
// ============================================================

const uploadReport = async (
  req,
  res
) => {
  try {
    const {
      reports,
    } = req.body;

    if (!reports) {
      return res.status(400).json({
        success: false,
        message:
          "Reports are required",
      });
    }

    let reportList =
      reports;

    if (
      typeof reports ===
      "string"
    ) {
      try {
        reportList =
          JSON.parse(
            reports
          );
      } catch (error) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid reports format",
        });
      }
    }

    if (
      !Array.isArray(reportList) ||
      reportList.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "At least one report file is required",
      });
    }

    const order =
      await LabOrder.findById(
        req.params.id
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      order.status !==
      "In Progress"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Testing must be in progress before uploading report",
      });
    }

    const cleanedReports =
      reportList.map(
        (report, index) => {
          if (
            !report ||
            !report.fileUrl
          ) {
            throw new Error(
              `Report file URL is missing for page ${index + 1}`
            );
          }

          const reportName =
            String(
              report.reportName ||
              ""
            ).trim();

          if (!reportName) {
            throw new Error(
              `Report name is missing for page ${index + 1}`
            );
          }

          return {
            reportName:
              reportName,
            fileName:
              report.fileName ||
              `Report_Page_${index + 1}`,
            fileUrl:
              report.fileUrl,
            fileType:
              report.fileType ||
              "unknown",
            pageNumber:
              Number(
                report.pageNumber
              ) ||
              index + 1,
          };
        }
      );

    const updatedOrder =
      await LabOrder.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            reports:
              cleanedReports,
            reportUploadedAt:
              new Date(),
            status:
              "Completed",
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!updatedOrder) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found while saving report",
      });
    }

    console.log(
      "================================"
    );

    console.log(
      "LAB REPORT UPLOADED"
    );

    console.log(
      "ORDER ID =",
      updatedOrder._id
    );

    console.log(
      "TOTAL REPORT FILES =",
      updatedOrder.reports.length
    );

    updatedOrder.reports.forEach(
      (report) => {
        console.log(
          `PAGE ${report.pageNumber}:`,
          report.reportName,
          "| FILE:",
          report.fileName
        );
      }
    );

    console.log(
      "STATUS =",
      updatedOrder.status
    );

    console.log(
      "================================"
    );

    return res.status(200).json({
      success: true,
      message:
        "Lab report uploaded successfully",
      order:
        updatedOrder,
    });
  } catch (error) {
    console.error(
      "UPLOAD REPORT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message,
    });
  }
};

// ==========================================================
// LAB COLLECTION OTP HELPERS
// ==========================================================

const generateLabOtp = () => {
  return crypto
    .randomInt(
      100000,
      1000000
    )
    .toString();
};

const hashLabOtp = (otp) => {
  return crypto
    .createHash("sha256")
    .update(otp)
    .digest("hex");
};

// ==========================================================
// DEMO OTP STORE
// ==========================================================

const collectionOtpStore =
  new Map();

const saveCollectionOtpForDemo = (
  orderId,
  otp,
  expiresAt
) => {
  collectionOtpStore.set(
    String(orderId),
    {
      otp: String(otp),
      expiresAt:
        new Date(
          expiresAt
        ).getTime(),
    }
  );
};

const getCollectionOtpFromDemoStore = (
  orderId
) => {
  const entry =
    collectionOtpStore.get(
      String(orderId)
    );

  if (!entry) {
    return null;
  }

  if (
    Date.now() >
    entry.expiresAt
  ) {
    collectionOtpStore.delete(
      String(orderId)
    );

    return null;
  }

  return entry.otp;
};

const deleteCollectionOtpFromDemoStore = (
  orderId
) => {
  collectionOtpStore.delete(
    String(orderId)
  );
};

// ==========================================================
// GENERATE LAB COLLECTION OTP
// ==========================================================

const generateCollectionOtp = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    console.log(
      "=========================================="
    );

    console.log(
      "LAB COLLECTION OTP REQUEST"
    );

    console.log(
      "ORDER ID:",
      id
    );

    console.log(
      "SERVER TIME:",
      new Date().toISOString()
    );

    console.log(
      "=========================================="
    );

    const labOrder =
      await LabOrder.findById(
        id
      );

    if (!labOrder) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      labOrder.collectionMode !==
      "Home Collection"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP is required only for Home Collection",
      });
    }

    if (
      labOrder.status !==
      "On The Way"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP can be generated only when the collector is On The Way",
      });
    }

    const now =
      new Date();

    // ========================================================
    // CLEAR EXPIRED OTP
    // ========================================================

    if (
      labOrder.collectionOtpExpiresAt &&
      labOrder.collectionOtpExpiresAt <=
        now
    ) {
      labOrder.collectionOtpHash =
        "";

      labOrder.collectionOtpExpiresAt =
        null;

      labOrder.collectionOtpAttempts =
        0;

      labOrder.collectionOtpVerified =
        false;

      labOrder.collectionOtpSentAt =
        null;

      deleteCollectionOtpFromDemoStore(
        id
      );

      await labOrder.save();
    }

    // ========================================================
    // ACTIVE OTP CHECK
    // ========================================================

    if (
      labOrder.collectionOtpHash &&
      labOrder.collectionOtpExpiresAt &&
      labOrder.collectionOtpExpiresAt >
        new Date() &&
      labOrder.collectionOtpVerified !==
        true
    ) {
      console.log(
        "ACTIVE OTP ALREADY EXISTS"
      );

      const existingOtp =
        getCollectionOtpFromDemoStore(
          id
        );

      if (!existingOtp) {
        return res.status(400).json({
          success: false,
          message:
            "OTP is active but is no longer available in server memory. Please generate a new OTP.",
          expiresAt:
            labOrder.collectionOtpExpiresAt,
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Existing OTP is still active",
        collectionOtp:
          existingOtp,
        expiresAt:
          labOrder.collectionOtpExpiresAt,
        alreadyActive:
          true,
        testingOnly:
          true,
      });
    }

    // ========================================================
    // GENERATE NEW OTP
    // ========================================================

    const otp =
      generateLabOtp();

    const otpHash =
      hashLabOtp(
        otp
      );

    const expiresAt =
      new Date(
        Date.now() +
          10 * 60 * 1000
      );

    // Save plaintext OTP temporarily
    saveCollectionOtpForDemo(
      id,
      otp,
      expiresAt
    );

    // Save secure OTP data
    labOrder.collectionOtpHash =
      otpHash;

    labOrder.collectionOtpExpiresAt =
      expiresAt;

    labOrder.collectionOtpAttempts =
      0;

    labOrder.collectionOtpVerified =
      false;

    labOrder.collectionOtpSentAt =
      new Date();

    await labOrder.save();

    console.log(
      "=========================================="
    );

    console.log(
      "NEW LAB COLLECTION OTP GENERATED"
    );

    console.log(
      "ORDER ID:",
      id
    );

    console.log(
      "OTP:",
      otp
    );

    console.log(
      "EXPIRES AT:",
      expiresAt.toISOString()
    );

    console.log(
      "=========================================="
    );

    return res.status(200).json({
      success: true,
      message:
        "OTP generated successfully",
      expiresAt,
      otpForTesting:
        otp,
      collectionOtp:
        otp,
      testingOnly:
        true,
    });

  } catch (error) {
    console.error(
      "GENERATE COLLECTION OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to generate collection OTP",
      error:
        error.message,
    });
  }
};

// ==========================================================
// GET LAB COLLECTION OTP
// ==========================================================

const getCollectionOtp = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    const labOrder =
      await LabOrder.findById(
        id
      );

    if (!labOrder) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      labOrder.collectionMode !==
      "Home Collection"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Collection OTP is available only for Home Collection",
      });
    }

    if (
      labOrder.status !==
      "On The Way"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Collection OTP is available only when collector is On The Way",
      });
    }

    if (
      labOrder.collectionOtpVerified ===
      true
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Collection OTP has already been verified",
      });
    }

    if (
      !labOrder.collectionOtpHash ||
      !labOrder.collectionOtpExpiresAt
    ) {
      return res.status(404).json({
        success: false,
        message:
          "No active collection OTP found. Please generate the OTP first.",
      });
    }

    if (
      new Date() >
      new Date(
        labOrder.collectionOtpExpiresAt
      )
    ) {
      deleteCollectionOtpFromDemoStore(
        id
      );

      return res.status(400).json({
        success: false,
        message:
          "Collection OTP has expired. Please generate a new OTP.",
        expired:
          true,
      });
    }

    const collectionOtp =
      getCollectionOtpFromDemoStore(
        id
      );

    if (!collectionOtp) {
      return res.status(404).json({
        success: false,
        message:
          "Collection OTP is no longer available in server memory. Please generate a new OTP.",
        testingOnly:
          true,
      });
    }

    return res.status(200).json({
      success: true,
      collectionOtp,
      collectionOtpExpiresAt:
        labOrder.collectionOtpExpiresAt,
      testingOnly:
        true,
    });

  } catch (error) {
    console.error(
      "GET COLLECTION OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to get collection OTP",
      error:
        error.message,
    });
  }
};

// ==========================================================
// VERIFY LAB COLLECTION OTP
// ==========================================================

const verifyCollectionOtp = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    const { otp } =
      req.body;

    console.log(
      "=========================================="
    );

    console.log(
      "LAB COLLECTION OTP VERIFY REQUEST"
    );

    console.log(
      "ORDER ID:",
      id
    );

    console.log(
      "=========================================="
    );

    if (!otp) {
      return res.status(400).json({
        success: false,
        message:
          "OTP is required",
      });
    }

    const enteredOtp =
      String(otp).trim();

    if (
      !/^\d{6}$/.test(
        enteredOtp
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP must contain exactly 6 digits",
      });
    }

    const labOrder =
      await LabOrder.findById(
        id
      );

    if (!labOrder) {
      return res.status(404).json({
        success: false,
        message:
          "Lab order not found",
      });
    }

    if (
      labOrder.collectionMode !==
      "Home Collection"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP verification is required only for Home Collection",
      });
    }

    if (
      labOrder.status !==
      "On The Way"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP can only be verified when collector is On The Way",
      });
    }

    if (
      labOrder.collectionOtpVerified ===
      true
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP has already been verified",
      });
    }

    if (
      !labOrder.collectionOtpHash
    ) {
      return res.status(400).json({
        success: false,
        message:
          "No active OTP found. Please generate a new OTP.",
      });
    }

    // ========================================================
    // EXPIRY CHECK
    // ========================================================

    if (
      !labOrder.collectionOtpExpiresAt ||
      labOrder.collectionOtpExpiresAt <=
        new Date()
    ) {
      labOrder.collectionOtpHash =
        "";

      labOrder.collectionOtpExpiresAt =
        null;

      labOrder.collectionOtpAttempts =
        0;

      labOrder.collectionOtpSentAt =
        null;

      deleteCollectionOtpFromDemoStore(
        id
      );

      await labOrder.save();

      return res.status(400).json({
        success: false,
        message:
          "OTP has expired. Please generate a new OTP.",
      });
    }

    // ========================================================
    // MAXIMUM ATTEMPTS
    // ========================================================

    const MAX_ATTEMPTS =
      5;

    if (
      labOrder.collectionOtpAttempts >=
      MAX_ATTEMPTS
    ) {
      return res.status(429).json({
        success: false,
        message:
          "Maximum OTP attempts exceeded. Please generate a new OTP.",
      });
    }

    labOrder.collectionOtpAttempts +=
      1;

    // ========================================================
    // HASH ENTERED OTP
    // ========================================================

    const enteredOtpHash =
      hashLabOtp(
        enteredOtp
      );

    // ========================================================
    // WRONG OTP
    // ========================================================

    if (
      enteredOtpHash !==
      labOrder.collectionOtpHash
    ) {
      await labOrder.save();

      const remainingAttempts =
        MAX_ATTEMPTS -
        labOrder.collectionOtpAttempts;

      return res.status(400).json({
        success: false,
        message:
          "Incorrect OTP",
        remainingAttempts,
      });
    }

    // ========================================================
    // OTP CORRECT
    // ========================================================

    labOrder.collectionOtpVerified =
      true;

    labOrder.status =
      "Sample Collected";

    labOrder.collectorStatus =
      "Sample Collected";

    // ========================================================
    // CLEAR OTP DATA
    // ========================================================

    labOrder.collectionOtpHash =
      "";

    labOrder.collectionOtpExpiresAt =
      null;

    labOrder.collectionOtpAttempts =
      0;

    labOrder.collectionOtpSentAt =
      null;

    // Remove plaintext OTP from memory
    deleteCollectionOtpFromDemoStore(
      id
    );

    // ========================================================
    // FREE COLLECTOR
    // ========================================================

    if (
      labOrder.collectorId
    ) {
      await SampleCollector.findByIdAndUpdate(
        labOrder.collectorId,
        {
          availability:
            "Available",
        }
      );
    }

    // ========================================================
    // SAVE ORDER
    // ========================================================

    await labOrder.save();

    console.log(
      "=========================================="
    );

    console.log(
      "LAB OTP VERIFIED - SAMPLE COLLECTED"
    );

    console.log(
      "ORDER ID:",
      id
    );

    console.log(
      "STATUS:",
      labOrder.status
    );

    console.log(
      "COLLECTOR STATUS:",
      labOrder.collectorStatus
    );

    console.log(
      "=========================================="
    );

    return res.status(200).json({
      success: true,
      message:
        "Patient verified successfully. Sample collected.",
      status:
        labOrder.status,
      collectorStatus:
        labOrder.collectorStatus,
    });

  } catch (error) {
    console.error(
      "VERIFY COLLECTION OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to verify collection OTP",
      error:
        error.message,
    });
  }
};


/**
 * Cancellation is allowed only before collection starts.
 * Rescheduling requires laboratory approval.
 */

const canChangeLabBooking = (order) => {
  return ["Pending", "Accepted"].includes(order.status);
};

// CANCEL LAB BOOKING
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
        message: "This booking can no longer be cancelled.",
      });
    }

    order.status = "Cancelled";
    order.cancelledBy = cancelledBy;
    order.cancelledAt = new Date();
    order.cancellationReason = String(reason || "").trim();
    order.rescheduleStatus = "None";
    order.rescheduleRequestedAt = null;
    order.requestedScheduledAt = null;

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
    });
  }
};

// PATIENT REQUESTS RESCHEDULE
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

    const requestedDate = new Date(scheduledAt);

    if (
      Number.isNaN(requestedDate.getTime()) ||
      requestedDate <= new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid future date and time.",
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

    if (order.rescheduleStatus === "Pending") {
      return res.status(400).json({
        success: false,
        message: "A reschedule request is already pending.",
      });
    }

    order.previousScheduledAt = order.scheduledAt;
    order.requestedScheduledAt = requestedDate;
    order.rescheduleRequestedAt = new Date();
    order.rescheduleReason = String(reason || "").trim();
    order.rescheduleStatus = "Pending";

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
    });
  }
};

// LAB APPROVES OR REJECTS RESCHEDULE REQUEST
const decideLabReschedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { labId, decision } = req.body;

    if (!["Approved", "Rejected"].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "Decision must be Approved or Rejected.",
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

    if (
      order.rescheduleStatus !== "Pending" ||
      !canChangeLabBooking(order)
    ) {
      return res.status(400).json({
        success: false,
        message: "No eligible reschedule request is pending.",
      });
    }

    if (decision === "Approved") {
      if (
        !order.requestedScheduledAt ||
        new Date(order.requestedScheduledAt) <= new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: "The requested date/time is no longer valid.",
        });
      }

      order.scheduledAt = order.requestedScheduledAt;
    }

    order.rescheduleStatus = decision;
    order.requestedScheduledAt = null;

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Reschedule request ${decision.toLowerCase()}.`,
      order,
    });
  } catch (error) {
    console.error("RESCHEDULE DECISION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to process reschedule request.",
    });
  }
};


// ============================================================
// EXPORTS
// ============================================================

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
};