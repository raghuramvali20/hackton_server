const mongoose = require("mongoose");

const scanReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  originalCode: {
    type: String,
    required: true,
  },
  repairedCode: {
    type: String,
    required: true,
  },
  scoreBefore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  scoreAfter: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  appliedFixes: {
    type: [String],
    default: [],
  },
  formalCertificate: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ScanReport", scanReportSchema);