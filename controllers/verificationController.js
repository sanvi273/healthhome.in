
const User = require("../models/user");
const Verification = require("../models/verification");

// =====================================================
// CREATE / UPDATE VERIFICATION APPLICATION
// Doctor / Laboratory / Pharmacy
// =====================================================
const createVerification = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      professionalName,
      licenseNumber,
      organizationName,
      address,
      documents,
      notes,

      // Backward-compatible Flutter fields
      licenseType,
      documentUrl,
      businessName,
      registrationNumber,
    } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!["doctor", "laboratory", "pharmacy"].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Verification is only required for Doctor, Laboratory or Pharmacy",
      });
    }

    if (user.verificationStatus === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Your account is already verified",
      });
    }

    // Support both the backend's document format and the
    // existing Flutter fields (licenseType + documentUrl).
    let submittedDocuments = Array.isArray(documents)
      ? documents
      : [];

    if (
      submittedDocuments.length === 0 &&
      documentUrl &&
      String(documentUrl).trim()
    ) {
      submittedDocuments = [
        {
          type: licenseType || "Professional Licence",
          url: String(documentUrl).trim(),
        },
      ];
    }

    const submittedOrganization =
      organizationName || businessName || "";

    const submittedNotes = [
      notes || "",
      registrationNumber
        ? `Registration Number: ${registrationNumber}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const submittedAddress =
      address ||
      user.addresses?.[0]?.fullAddress ||
      "";

    let verification = await Verification.findOne({
      userId: user._id,
    }).sort({ createdAt: -1 });

    // Do not overwrite an application currently being reviewed.
    if (verification && verification.status === "UNDER_REVIEW") {
      return res.status(409).json({
        success: false,
        message: "Your application is currently under review",
        verification,
      });
    }

    // Update the application automatically created during registration.
    if (verification && verification.status === "PENDING") {
      verification.professionalName =
        professionalName || user.name;

      verification.licenseNumber =
        licenseNumber || verification.licenseNumber || "";

      verification.organizationName =
        submittedOrganization || verification.organizationName || "";

      verification.address =
        submittedAddress || verification.address || "";

      if (submittedDocuments.length > 0) {
        verification.documents = submittedDocuments;
      }

      verification.notes = submittedNotes || verification.notes || "";
      await verification.save();
    } else if (verification && verification.status === "REJECTED") {
      // Resubmission: reuse the same record instead of creating duplicates.
      verification.professionalName =
        professionalName || user.name;

      verification.licenseNumber = licenseNumber || "";
      verification.organizationName = submittedOrganization;
      verification.address = submittedAddress;
      verification.documents = submittedDocuments;
      verification.notes = submittedNotes;
      verification.status = "PENDING";

      verification.rejectionReason = "";
      verification.reviewedBy = undefined;
      verification.reviewedAt = undefined;
      verification.approvedBy = undefined;
      verification.approvedAt = undefined;

      await verification.save();
    } else {
      // Create only if no application exists.
      verification = await Verification.create({
        userId: user._id,
        verificationId: user.verificationId,
        role: user.role,
        professionalName: professionalName || user.name,
        licenseNumber: licenseNumber || "",
        organizationName: submittedOrganization,
        address: submittedAddress,
        documents: submittedDocuments,
        notes: submittedNotes,
        status: "PENDING",
      });
    }

    user.verificationStatus = "PENDING";
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Verification application submitted successfully",
      verification,
    });
  } catch (error) {
    console.error("CREATE VERIFICATION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// =====================================================
// GET MY VERIFICATION
// =====================================================
const getMyVerification = async (req, res) => {
  try {
    const verification = await Verification.findOne({
      userId: req.user.id,
    }).sort({ createdAt: -1 });

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "No verification application found",
      });
    }

    return res.status(200).json({
      success: true,
      verification,
    });
  } catch (error) {
    console.error("GET MY VERIFICATION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// =====================================================
// ADMIN - GET ALL VERIFICATIONS
// =====================================================
const getAllVerifications = async (req, res) => {
  try {
    const verifications = await Verification.find()
      .populate(
        "userId",
        "name email phone role verificationStatus accountStatus"
      )
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: verifications.length,
      verifications,
    });
  } catch (error) {
    console.error("GET ALL VERIFICATIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// =====================================================
// ADMIN - GET PENDING VERIFICATIONS
// =====================================================
const getPendingVerifications = async (req, res) => {
  try {
    const verifications = await Verification.find({
      status: {
        $in: ["PENDING", "UNDER_REVIEW"],
      },
    })
      .populate(
        "userId",
        "name email phone role verificationStatus accountStatus"
      )
      .sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: verifications.length,
      verifications,
    });
  } catch (error) {
    console.error("GET PENDING VERIFICATIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// =====================================================
// ADMIN - GET SINGLE VERIFICATION
// =====================================================
const getVerificationById = async (req, res) => {
  try {
    const verification = await Verification.findById(req.params.id)
      .populate(
        "userId",
        "name email phone role verificationStatus verificationId accountStatus"
      );

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification application not found",
      });
    }

    return res.status(200).json({
      success: true,
      verification,
    });
  } catch (error) {
    console.error("GET VERIFICATION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// =====================================================
// ADMIN - MARK UNDER REVIEW
// =====================================================
const markUnderReview = async (req, res) => {
  try {
    const verification = await Verification.findById(req.params.id);

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification application not found",
      });
    }

    if (!["PENDING", "UNDER_REVIEW"].includes(verification.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot review an application with status ${verification.status}`,
      });
    }

    const user = await User.findById(verification.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Associated user not found",
      });
    }

    verification.status = "UNDER_REVIEW";
    verification.reviewedBy = req.user.id;
    verification.reviewedAt = new Date();

    user.verificationStatus = "UNDER_REVIEW";

    await verification.save();
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Verification marked as under review",
      verification,
    });
  } catch (error) {
    console.error("UNDER REVIEW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// =====================================================
// ADMIN - APPROVE VERIFICATION
// =====================================================
const approveVerification = async (req, res) => {
  try {
    const verification = await Verification.findById(req.params.id);

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification application not found",
      });
    }

    if (!["PENDING", "UNDER_REVIEW"].includes(verification.status)) {
      return res.status(400).json({
        success: false,
        message: `This application is already ${verification.status.toLowerCase()}`,
      });
    }

    const user = await User.findById(verification.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Associated user not found",
      });
    }

    const now = new Date();

    verification.status = "APPROVED";
    verification.reviewedAt = now;
    verification.approvedAt = now;
    verification.reviewedBy = req.user.id;
    verification.approvedBy = req.user.id;

    user.verificationStatus = "APPROVED";
    user.verificationApprovedAt = now;
    user.verificationApprovedBy = req.user.id;
    user.accountStatus = "ACTIVE";

    await verification.save();
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Verification approved successfully",
      verification,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        verificationStatus: user.verificationStatus,
        verificationId: user.verificationId,
        accountStatus: user.accountStatus,
      },
    });
  } catch (error) {
    console.error("APPROVE VERIFICATION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// =====================================================
// ADMIN - REJECT VERIFICATION
// =====================================================
const rejectVerification = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Please provide a rejection reason",
      });
    }

    const verification = await Verification.findById(req.params.id);

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification application not found",
      });
    }

    if (!["PENDING", "UNDER_REVIEW"].includes(verification.status)) {
      return res.status(400).json({
        success: false,
        message: `This application is already ${verification.status.toLowerCase()}`,
      });
    }

    const user = await User.findById(verification.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Associated user not found",
      });
    }

    verification.status = "REJECTED";
    verification.rejectionReason = reason;
    verification.reviewedAt = new Date();
    verification.reviewedBy = req.user.id;

    user.verificationStatus = "REJECTED";

    await verification.save();
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Verification rejected",
      verification,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        verificationStatus: user.verificationStatus,
      },
    });
  } catch (error) {
    console.error("REJECT VERIFICATION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  createVerification,
  getMyVerification,
  getAllVerifications,
  getPendingVerifications,
  getVerificationById,
  markUnderReview,
  approveVerification,
  rejectVerification,
};
