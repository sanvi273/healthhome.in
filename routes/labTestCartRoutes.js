const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getLabTestCart,
  addLabTestToCart,
  removeLabTestFromCart,
} = require("../controllers/labTestCartController");

const router = express.Router();

router.get("/", authMiddleware, getLabTestCart);
router.post("/", authMiddleware, addLabTestToCart);
router.delete("/:id", authMiddleware, removeLabTestFromCart);

module.exports = router;
