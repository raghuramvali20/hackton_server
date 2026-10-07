const ScanReport = require("../model/ScanReport");
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

    let finalRepairedCode = intermediateCode;
    let aiSuggestions = [];
    let aiChanges = [];
    let aiRepairStatus = "NOT_NEEDED";
    let aiRepairMessage = "";

    const findingsBeforeAi = astParserService.scanHtml(intermediateCode).findings;
    if (findingsBeforeAi.length > 0) {
      aiRepairStatus = "COMPLETED";
      try {
        const aiResult = await aiRepairService.generateContextualFixes(
          intermediateCode,
          findingsBeforeAi
        );
        finalRepairedCode = aiResult.finalRepairedCode;
        aiSuggestions = aiResult.aiSuggestions || [];
        aiChanges = aiResult.aiChanges || [];
      } catch (error) {
        console.error("Gemini accessibility suggestions unavailable:", error);
        aiRepairStatus = "UNAVAILABLE";
        aiRepairMessage = "AI repair was unavailable; only deterministic repairs were applied.";
      }
    }

    const appliedFixes = staticFixesLog.map((fix) => fix.description);

    const { verification, scoreBefore, scoreAfter } =
      formalVerificationService.verifySupportedChecks(
        rawCode,
        finalRepairedCode,
        staticFixesLog.length,
        staticFixesLog,
        aiChanges
      );

    const report = await ScanReport.create({
      userId: req.user._id,
      originalCode: rawCode,
      repairedCode: finalRepairedCode,
      scoreBefore,
      scoreAfter,
      appliedFixes,
      aiChanges,
      findings: verification.findings,
      aiSuggestions,
      aiRepairStatus,
      aiRepairMessage,
      verification,
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
        aiChanges: report.aiChanges,
        findings: report.findings,
        aiSuggestions: report.aiSuggestions,
        aiRepairStatus: report.aiRepairStatus,
        aiRepairMessage: report.aiRepairMessage,
        verification: report.verification,
        formalCertificate: report.formalCertificate || null,
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