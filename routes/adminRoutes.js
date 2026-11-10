const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { getAdminAnalytics } = require("../controllers/adminAnalyticsController");

const router = express.Router();

router.get("/analytics", authMiddleware, adminMiddleware, getAdminAnalytics);

module.exports = router;
