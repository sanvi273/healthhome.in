const express =
require("express");

const router =
express.Router();

const {

  addMedicine,
  getMedicines,
  deleteMedicine,
  updateMedicine,
  getInventoryStats,

} = require(
  "../controllers/medicineController"
);

const authMiddleware = require("../middleware/authMiddleware");
const pharmacyMedicineAuth = require("../middleware/pharmacyMedicineAuth");
const uploadMedicineImage = require("../middleware/medicineImageUpload");

router.post(
  "/add",
  authMiddleware,
  pharmacyMedicineAuth,
  uploadMedicineImage,
  addMedicine
);

router.get(
  "/all",
  getMedicines
);

router.delete(
  "/:id",
  authMiddleware,
  pharmacyMedicineAuth,
  deleteMedicine
);

router.put(
  "/:id",
  authMiddleware,
  pharmacyMedicineAuth,
  uploadMedicineImage,
  updateMedicine
);

router.get(
  "/stats",
  getInventoryStats
);

module.exports = router;
