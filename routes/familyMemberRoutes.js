const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getMyFamilyMembers,
  getFamilyMemberOverview,
  createFamilyMember,
  updateFamilyMember,
  deleteFamilyMember,
} = require("../controllers/familyMemberController");

const router = express.Router();

router.get("/", authMiddleware, getMyFamilyMembers);
router.get("/:id/overview", authMiddleware, getFamilyMemberOverview);
router.post("/", authMiddleware, createFamilyMember);
router.put("/:id", authMiddleware, updateFamilyMember);
router.delete("/:id", authMiddleware, deleteFamilyMember);

module.exports = router;
