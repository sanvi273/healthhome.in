const express = require("express");
const controller = require("../controllers/termsController");

const router = express.Router();
router.get("/:role/current", controller.current);
router.post("/accept", controller.accept);
router.post("/acceptance/validate", controller.validate);

module.exports = router;
