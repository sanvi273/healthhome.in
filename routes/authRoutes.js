const express = require("express");

console.log("✅ authRoutes.js loaded");

const { updateOneSignalId } = require("../controllers/authController");

const { initiateLogin, verifyLogin, resendLogin, initiateRegistration, verifyRegistration } = require("../controllers/authOtpController");
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

// Keep the legacy URL on the same OTP-required flow so older app builds
// cannot receive a session token from password-only authentication.
router.post("/login", initiateLogin);
router.post("/login/initiate", initiateLogin);
router.post("/login/verify", verifyLogin);
router.post("/otp/resend", resendLogin);
router.post("/login/resend", resendLogin);
// ============================================================
// UPDATE ONESIGNAL ID
// ============================================================

router.put(
    "/update-onesignal",
    updateOneSignalId
);

module.exports = router;
