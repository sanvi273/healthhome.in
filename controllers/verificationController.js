const User = require("../models/user");
const Verification = require("../models/verification");

// =====================================================
// CREATE VERIFICATION APPLICATION
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
    } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Only professionals need verification
    if (!["doctor", "laboratory", "pharmacy"].includes(user.role)) {
      return res.status(400).json({
        success: false,
        message: "Verification is only required for Doctor, Laboratory or Pharmacy",
      });
    }

    // Already approved
    if (user.verificationStatus === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Your account is already verified",
      });
    }

    // Check existing application
    const existing = await Verification.findOne({
      userId: user._id,
    });

    if (existing && ["PENDING", "UNDER_REVIEW"].includes(existing.status)) {
      return res.status(400).json({
        success: false,
        message: "Verification application already exists",
        verification: existing,
      });
    }

    const verification = await Verification.create({
      userId: user._id,
      verificationId: user.verificationId,
      role: user.role,
      professionalName: professionalName || user.name,
      licenseNumber: licenseNumber || "",
      organizationName: organizationName || "",
      address: address || "",
      documents: documents || [],
      notes: notes || "",
      status: "PENDING",
    });

    user.verificationStatus = "PENDING";
    await user.save();

    return res.status(201).json({
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
    const userId = req.user.id;

    const verification = await Verification.findOne({
      userId,
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
      .populate("userId", "name email phone role verificationStatus accountStatus")
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
      .populate("userId", "name email phone role verificationStatus accountStatus")
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

    verification.status = "UNDER_REVIEW";

    if (req.user && req.user.id) {
      verification.reviewedBy = req.user.id;
    }

    verification.reviewedAt = new Date();

    await verification.save();

    await User.findByIdAndUpdate(verification.userId, {
      verificationStatus: "UNDER_REVIEW",
    });

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

    verification.status = "APPROVED";
    verification.reviewedAt = new Date();
    verification.approvedAt = new Date();

    if (req.user && req.user.id) {
      verification.reviewedBy = req.user.id;
      verification.approvedBy = req.user.id;
    }

    await verification.save();

    const user = await User.findById(verification.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Associated user not found",
      });
    }

    user.verificationStatus = "APPROVED";
    user.verificationApprovedAt = new Date();
    user.verificationApprovedBy = req.user?.id || "";

    // Make sure approved professional account is active
    user.accountStatus = "ACTIVE";

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
    const { reason } = req.body;

    const verification = await Verification.findById(req.params.id);

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification application not found",
      });
    }

    verification.status = "REJECTED";
    verification.rejectionReason = reason || "Verification requirements were not satisfied";
    verification.reviewedAt = new Date();

    if (req.user && req.user.id) {
      verification.reviewedBy = req.user.id;
    }

    await verification.save();

    await User.findByIdAndUpdate(verification.userId, {
      verificationStatus: "REJECTED",
    });

    return res.status(200).json({
      success: true,
      message: "Verification rejected",
      verification,
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