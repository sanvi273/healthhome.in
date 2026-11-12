const express = require("express");

console.log("✅ authRoutes.js loaded");

const { updateOneSignalId } = require("../controllers/authController");

const { initiateLogin, loginWithPassword, verifyLogin, resendLogin, initiateRegistration, verifyRegistration, initiateForgotPassword, verifyResetOtp, resetPassword } = require("../controllers/authOtpController");

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
    initiateLogin
);

router.post("/login/initiate", initiateLogin);
router.post("/login/password", loginWithPassword);
router.post("/login/verify", verifyLogin);
router.post("/otp/resend", resendLogin);
router.post("/login/resend", resendLogin);
router.post("/forgot-password", initiateForgotPassword);
router.post("/forgot-password/verify", verifyResetOtp);
router.post("/reset-password", resetPassword);

// ============================================================
// UPDATE ONESIGNAL ID
// ============================================================

router.put(
    "/update-onesignal",
    updateOneSignalId
);

module.exports = router;
