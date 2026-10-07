const express = require("express");
const {
  applyCodeRepairs,
  processCodeRepair,
  previewCodeRepair,
  getUserScanHistory,
} = require("../controllers/repairController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/", authMiddleware, processCodeRepair);
router.post("/preview", authMiddleware, previewCodeRepair);
router.post("/apply", authMiddleware, applyCodeRepairs);
router.get("/history", authMiddleware, getUserScanHistory);

module.exports = router;