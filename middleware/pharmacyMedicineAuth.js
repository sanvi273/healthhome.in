const User = require("../models/user");

// Inventory writes must come from the currently approved pharmacy account.
// The JWT identifies the account; the database provides its authoritative role
// and phone number so a client cannot submit another pharmacy's phone.
const pharmacyMedicineAuth = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Please sign in again to manage pharmacy inventory.",
      });
    }

    const user = await User.findById(req.user.id)
      .select("phone role verificationStatus")
      .lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Pharmacy account not found.",
      });
    }

    if (user.role !== "pharmacy") {
      return res.status(403).json({
        success: false,
        message: "Only pharmacies can manage medicine inventory.",
      });
    }

    if (user.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Your pharmacy account must be approved to manage inventory.",
      });
    }

    const phone = String(user.phone || "").trim();
    if (!phone) {
      return res.status(403).json({
        success: false,
        message: "The pharmacy account does not have a registered phone number.",
      });
    }

    req.pharmacy = { id: String(user._id), phone };
    return next();
  } catch (error) {
    console.error("PHARMACY MEDICINE AUTH ERROR:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to verify the pharmacy account.",
    });
  }
};

module.exports = pharmacyMedicineAuth;
