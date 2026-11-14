const express = require("express");

console.log("✅ authRoutes.js loaded");

const { updateOneSignalId, loginUser } = require("../controllers/authController");

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

router.post(
    "/login",
    loginUser
);

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
