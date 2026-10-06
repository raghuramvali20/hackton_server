const express = require("express");
const {
  processCodeRepair,
  getUserScanHistory,
} = require("../controllers/repairController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/", authMiddleware, processCodeRepair);
router.get("/history", authMiddleware, getUserScanHistory);

module.exports = router;