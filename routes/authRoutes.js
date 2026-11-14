const express = require("express");

console.log("✅ authRoutes.js loaded");

const { updateOneSignalId, loginUser, changePassword } = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

const { initiateLogin, verifyLogin, resendLogin, initiateRegistration, verifyRegistration } = require("../controllers/authOtpController");
const {
  requestPasswordReset,
  completePasswordReset,
  openPasswordResetPage,
} = require("../controllers/passwordResetController");
const router = express.Router();

// ============================================================
// REGISTER
// ============================================================

router.post(
    "/register",
    initiateRegistration
);
router.post("/register/verify", verifyRegistration);

// ============================================================
// LOGIN
// ============================================================

router.post(
    "/login",
    loginUser
);

router.post("/login/initiate", initiateLogin);
router.post("/login/verify", verifyLogin);
router.post("/otp/resend", resendLogin);
router.post("/login/resend", resendLogin);
router.post("/forgot-password", requestPasswordReset);
router.get("/forgot-password/open", openPasswordResetPage);
router.post("/reset-password", completePasswordReset);
router.post("/change-password", authMiddleware, changePassword);

// ============================================================
// UPDATE ONESIGNAL ID
// ============================================================

router.put(
    "/update-onesignal",
    updateOneSignalId
);

module.exports = router;
