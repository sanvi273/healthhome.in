const express = require("express");
const router = express.Router();

console.log("✅ cartRoutes.js loaded");

const {
  addToCart,
  getCart,
  deleteItem,
  increaseQuantity,
  decreaseQuantity,
  clearCart,
} = require("../controllers/cartController");

// ADD THIS
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Cart routes are working",
  });
});

// Add medicine
router.post("/add", addToCart);

// Increase quantity
router.put("/increase/:id", increaseQuantity);

// Decrease quantity
router.put("/decrease/:id", decreaseQuantity);

// Clear patient's cart
router.delete("/clear/:patientPhone", clearCart);

// Delete one cart item
router.delete("/:id", deleteItem);

// Keep this LAST
router.get("/:patientPhone", getCart);

console.log("=== CART ROUTES ===");

router.stack.forEach((layer) => {
  if (layer.route) {
    console.log(
      Object.keys(layer.route.methods).join(",").toUpperCase(),
      layer.route.path
    );
  }
});
module.exports = router;