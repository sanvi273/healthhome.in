const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const verificationMiddleware = require("../middleware/verificationMiddleware");
const approvedPharmacy = verificationMiddleware(["pharmacy"]);

const router = express.Router();

// ============================================================
// PHARMACY CONTROLLER
// ============================================================

const pharmacyController =
  require("../controllers/pharmacyController");

// ============================================================
// DEBUG CHECK
// ============================================================

console.log("========================================");
console.log("PHARMACY ROUTES LOADED");
console.log("========================================");

console.log(
  "addPharmacy:",
  typeof pharmacyController.addPharmacy
);

console.log(
  "getPharmacies:",
  typeof pharmacyController.getPharmacies
);

console.log(
  "getPharmacyProfile:",
  typeof pharmacyController.getPharmacyProfile
);

console.log(
  "getDeliveryPartners:",
  typeof pharmacyController.getDeliveryPartners
);

console.log(
  "addDeliveryPartner:",
  typeof pharmacyController.addDeliveryPartner
);

console.log(
  "deleteDeliveryPartner:",
  typeof pharmacyController.deleteDeliveryPartner
);

console.log("========================================");

// ============================================================
// BASIC PHARMACY ROUTES
// ============================================================

// ADD PHARMACY

router.post(
  "/add",
  authMiddleware,
  approvedPharmacy,
  (req, res) => {
    return pharmacyController.addPharmacy(req, res);
  }
);

// GET ALL PHARMACIES

router.get(
  "/all",
  (req, res) => {
    return pharmacyController.getPharmacies(req, res);
  }
);

// ============================================================
// DELIVERY PARTNER ROUTES
// ============================================================

// GET DELIVERY PARTNERS

router.get(
  "/:phone/delivery-partners",
  authMiddleware,
  approvedPharmacy,
  (req, res) => {
    return pharmacyController.getDeliveryPartners(
      req,
      res
    );
  }
);

// ADD DELIVERY PARTNER

router.post(
  "/:phone/delivery-partners",
  authMiddleware,
  approvedPharmacy,
  (req, res) => {
    return pharmacyController.addDeliveryPartner(
      req,
      res
    );
  }
);

// DELETE DELIVERY PARTNER

router.delete(
  "/:phone/delivery-partners/:partnerId",
  authMiddleware,
  approvedPharmacy,
  (req, res) => {
    return pharmacyController.deleteDeliveryPartner(
      req,
      res
    );
  }
);


// ============================================================
// GET PHARMACY PROFILE
// ============================================================

router.get(
  "/profile/:phone",
  (req, res) => {
    return pharmacyController.getPharmacyProfile(
      req,
      res
    );
  }
);


// ============================================================
// EXPORT ROUTER
// ============================================================

module.exports = router;
