const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createRating,
  getEligibleReviews,
  getPublicReviews,
  getProviderReviews,
} = require("../controllers/ratingController");

const router = express.Router();

router.get("/eligible", authMiddleware, getEligibleReviews);
router.get("/mine", authMiddleware, getProviderReviews);
router.get("/public/:entityType/:targetId", getPublicReviews);
router.post("/", authMiddleware, createRating);

module.exports = router;
