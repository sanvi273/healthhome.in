const express = require("express");

const router = express.Router();

const {
  createVerification,
  uploadVerificationDocument,
  getMyVerification,
  getAllVerifications,
  getPendingVerifications,
  getVerificationById,
  markUnderReview,
  approveVerification,
  rejectVerification,
} = require("../controllers/verificationController");

const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const verificationDocumentUpload = require("../middleware/verificationDocumentUpload");

// =====================================================
// PROFESSIONAL USER ROUTES
// =====================================================

// Submit verification application
router.post(
  "/submit",
  authMiddleware,
  createVerification
);

router.post(
  "/documents",
  authMiddleware,
  verificationDocumentUpload,
  uploadVerificationDocument
);

// Get my verification application
router.get(
  "/my",
  authMiddleware,
  getMyVerification
);


// =====================================================
// ADMIN ROUTES
// =====================================================

// Get all verification applications
router.get(
  "/admin/all",
  authMiddleware,
  adminMiddleware,
  getAllVerifications
);

// Get pending verification applications
router.get(
  "/admin/pending",
  authMiddleware,
  adminMiddleware,
  getPendingVerifications
);

// Get one verification application
router.get(
  "/admin/:id",
  authMiddleware,
  adminMiddleware,
  getVerificationById
);

// Mark application as UNDER_REVIEW
router.put(
  "/admin/:id/review",
  authMiddleware,
  adminMiddleware,
  markUnderReview
);

// Approve application
router.put(
  "/admin/:id/approve",
  authMiddleware,
  adminMiddleware,
  approveVerification
);

// Reject application
router.put(
  "/admin/:id/reject",
  authMiddleware,
  adminMiddleware,
  rejectVerification
);


module.exports = router;
