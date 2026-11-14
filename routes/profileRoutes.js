const express = require("express");

const router = express.Router();

const {
  saveProfile,
  getProfile,
  getMyProfile,
  uploadMyProfileImage,
} = require("../controllers/profileController");
const authMiddleware = require("../middleware/authMiddleware");
const profileImageUpload = require("../middleware/profileImageUpload");

router.get("/me", authMiddleware, getMyProfile);
router.post(
  "/me/image",
  authMiddleware,
  profileImageUpload,
  uploadMyProfileImage,
);

router.post(
  "/save",
  saveProfile
);
router.get(
  "/:userId",
  getProfile
);
module.exports = router;
