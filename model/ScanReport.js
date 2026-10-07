const mongoose = require("mongoose");

const scanReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  sourceType: {
    type: String,
    enum: ["html", "url", "react-jsx"],
    default: "html",
  },
  sourceFileName: {
    type: String,
    default: "",
  },
  sourceUrl: {
    type: String,
    default: "",
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
    default: null,
    required() {
      return this.sourceType !== "react-jsx";
    },
    min: 0,
    max: 100,
  },
  scoreAfter: {
    type: Number,
    default: null,
    required() {
      return this.sourceType !== "react-jsx";
    },
    min: 0,
    max: 100,
  },
  appliedFixes: {
    type: [String],
    default: [],
  },
  appliedRepairs: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  findings: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  aiSuggestions: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  aiChanges: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  skippedFindings: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  aiRepairStatus: {
    type: String,
    enum: ["NOT_NEEDED", "COMPLETED", "UNAVAILABLE", "SKIPPED_LIMIT"],
    default: "NOT_NEEDED",
  },
  aiRepairMessage: {
    type: String,
    default: "",
  },
  verification: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  formalCertificate: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ScanReport", scanReportSchema);