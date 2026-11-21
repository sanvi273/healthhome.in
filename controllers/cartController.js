const Cart = require("../models/cartModel");
const Medicine = require("../models/medicine");

// =========================
// Add Medicine To Cart
// =========================
const addToCart = async (req, res) => {
  try {
    console.log("========== ADD TO CART ==========");
    console.log(req.body);

    // Find medicine from medicine collection
    const medicine = await Medicine.findById(req.body.medicineId);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: "Medicine not found",
      });
    }

    const quantity = req.body.quantity || 1;
    const price = medicine.price;
    const subtotal = quantity * price;

    const cart = await Cart.create({
      patientPhone: req.body.patientPhone,
      patientName: req.body.patientName,

      medicineId: medicine._id,
      medicine: medicine.medicineName,
      prescriptionId: String(req.body.prescriptionId || "").trim(),
      prescriptionMedicineId: String(req.body.prescriptionMedicineId || "").trim(),

      dose: req.body.dose,
      duration: req.body.duration,
      food: req.body.food,
      instruction: req.body.instruction,

      quantity: quantity,
      price: price,
      subtotal: subtotal,
    });

    console.log("SAVED CART =", cart);

    res.status(201).json({
      success: true,
      message: "Medicine added to cart successfully",
      cart,
    });

  } catch (e) {
    console.log("ADD CART ERROR =", e);

    res.status(500).json({
      success: false,
      message: e.toString(),
    });
  }
};

// =========================
// Get Patient Cart
// =========================
const getCart = async (req, res) => {
  try {
    const items = await Cart.find({
  patientPhone: req.params.patientPhone,
});

    console.log("TOTAL CART ITEMS =", items.length);
    console.log(items);

    res.status(200).json({
      success: true,
      items,
    });

  } catch (e) {
    console.log("GET CART ERROR =", e);

    res.status(500).json({
      success: false,
      message: e.toString(),
    });
  }
};

// =========================
// Delete Cart Item
// =========================
const deleteItem = async (req, res) => {
  try {
    await Cart.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: "Cart item deleted successfully",
    });

  } catch (e) {
    console.error("DELETE CART ERROR:", e);

    res.status(500).json({
      success: false,
      message: e.toString(),
    });
  }
};

// =========================
// Increase Quantity
// =========================
const increaseQuantity = async (req, res) => {
  try {
    console.log("===== INCREASE =====");
    console.log("ID =", req.params.id);

    const cart = await Cart.findById(req.params.id);

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
      });
    }

    cart.quantity = Number(cart.quantity) + 1;
    cart.subtotal = Number(cart.quantity) * Number(cart.price);

    await cart.save();

    console.log("UPDATED =", cart);

    return res.status(200).json({
      success: true,
      cart,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
// =========================
// Decrease Quantity
// =========================
const decreaseQuantity = async (req, res) => {
  try {
    console.log("===== DECREASE =====");
    console.log("ID =", req.params.id);

    const cart = await Cart.findById(req.params.id);

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
      });
    }

    if (cart.quantity > 1) {
      cart.quantity = Number(cart.quantity) - 1;
      cart.subtotal = Number(cart.quantity) * Number(cart.price);
      await cart.save();
    }

    console.log("UPDATED =", cart);

    return res.status(200).json({
      success: true,
      cart,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// =========================
// Clear Patient Cart
// =========================
const clearCart = async (req, res) => {
  try {
    await Cart.deleteMany({
      patientPhone: req.params.patientPhone,
    });

    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.toString(),
    });
  }
};

module.exports = {
  addToCart,
  getCart,
  deleteItem,
  increaseQuantity,
  decreaseQuantity,
  clearCart,
};
