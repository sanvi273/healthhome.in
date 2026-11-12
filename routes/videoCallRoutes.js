const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const controller = require("../controllers/videoCallController");

const router = express.Router();
router.use(authMiddleware);
router.post("/devices", controller.registerDevice);
router.delete("/devices", controller.removeDevice);
router.post("/start", controller.start);
router.post("/:callId/accept", controller.accept);
router.post("/:callId/decline", controller.decline);
router.post("/:callId/end", controller.end);
router.post("/:callId/cancel", controller.cancel);
router.post("/:callId/join", controller.join);
router.get("/active", controller.active);
router.get("/:callId", controller.get);

module.exports = router;
