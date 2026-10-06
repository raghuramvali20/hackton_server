const ScanReport = require("../models/ScanReport");
const astParserService = require("../services/astParserService");
const aiRepairService = require("../services/aiRepairService");
const formalVerificationService = require("../services/formalVerificationService");

async function processCodeRepair(req, res) {
  try {
    const { rawCode } = req.body || {};

    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "rawCode must be a non-empty HTML string.",
      });
    }

    const { intermediateCode, staticFixesLog } =
      await astParserService.fixDeterministicRules(rawCode);

    const { finalRepairedCode, aiFixesLog } =
      await aiRepairService.generateContextualFixes(intermediateCode);

    const appliedFixes = [...staticFixesLog, ...aiFixesLog];

    const { certificate, scoreBefore, scoreAfter } =
      formalVerificationService.verifyAndIssueCertificate(
        rawCode,
        finalRepairedCode,
        appliedFixes.length
      );

    const report = await ScanReport.create({
      userId: req.user._id,
      originalCode: rawCode,
      repairedCode: finalRepairedCode,
      scoreBefore,
      scoreAfter,
      appliedFixes,
      formalCertificate: certificate,
    });

    return res.status(201).json({
      success: true,
      report: {
        id: report._id,
        originalCode: report.originalCode,
        repairedCode: report.repairedCode,
        scoreBefore: report.scoreBefore,
        scoreAfter: report.scoreAfter,
        appliedFixes: report.appliedFixes,
        formalCertificate: report.formalCertificate,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    console.error("Code repair failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to process code repair.",
    });
  }
}

async function getUserScanHistory(req, res) {
  try {
    const reports = await ScanReport.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      reports,
    });
  } catch (error) {
    console.error("Fetching scan history failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch scan history.",
    });
  }
}

module.exports = {
  processCodeRepair,
  getUserScanHistory,
};