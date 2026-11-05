const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  addLab,
  getLabs,
  getLabProfile,

  // ================= LAB TEST MANAGEMENT =================
  addLabTest,
  getAllLabTests,
  getLabTestsByLab,
  updateLabTest,
  deleteLabTest,
  toggleLabTest,
} = require("../controllers/labController");

// ================= TEST =================

router.get(
  "/test",
  (req, res) => {
    res.send("Lab route working");
  }
);

router.post(
  "/add",
  authMiddleware,
  addLab
);

// ================= GET ALL LABS =================

router.get(
  "/all",
  getLabs
);

// ================= GET LAB PROFILE BY PHONE =================

router.get(
  "/profile/:phone",
  getLabProfile
);

// ============================================================
// LAB TEST MANAGEMENT
// ============================================================

// ADD LAB TEST
// POST /api/labs/tests/add

router.post(
  "/tests/add",
  addLabTest
);

// GET ALL LAB TESTS
// GET /api/labs/tests/all

router.get(
  "/tests/all",
  getAllLabTests
);

// GET LAB TESTS BY LAB
// GET /api/labs/tests/lab/:labId

router.get(
  "/tests/lab/:labId",
  getLabTestsByLab
);

// UPDATE LAB TEST
// PUT /api/labs/tests/:id

router.put(
  "/tests/:id",
  updateLabTest
);

// DELETE LAB TEST
// DELETE /api/labs/tests/:id

router.delete(
  "/tests/:id",
  deleteLabTest
);

// ENABLE / DISABLE LAB TEST
// PUT /api/labs/tests/toggle/:id

router.put(
  "/tests/toggle/:id",
  toggleLabTest
);

module.exports = router;