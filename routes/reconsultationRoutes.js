const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const controller = require("../controllers/reconsultationController");

const router = express.Router();
router.use(authMiddleware);

router.put(
  "/appointments/:appointmentId/offer",
  controller.createOrUpdateOffer,
);
router.get("/offers/patient", controller.getPatientOffers);
router.post("/offers/:offerId/request", controller.requestOffer);

module.exports = router;
