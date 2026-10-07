const ScanReport = require("../model/ScanReport");
const astParserService = require("../services/astParserService");
const aiRepairService = require("../services/aiRepairService");
const formalVerificationService = require("../services/formalVerificationService");
const { SiteFetchError, fetchSiteHtml } = require("../services/siteFetchService");

const MAX_AI_HTML_BYTES = 100 * 1024;

async function processCodeRepair(req, res) {
  try {
    const { rawCode, siteUrl } = req.body || {};
    const hasRawCode = typeof rawCode === "string" && Boolean(rawCode.trim());
    const hasSiteUrl = typeof siteUrl === "string" && Boolean(siteUrl.trim());

    if (hasRawCode === hasSiteUrl) {
      return res.status(400).json({
        success: false,
        message: "Provide exactly one source: a non-empty rawCode string or siteUrl.",
      });
    }

    let submittedCode = rawCode;
    let sourceType = "html";
    let resolvedSourceUrl = "";
    if (hasSiteUrl) {
      try {
        const fetchedSite = await fetchSiteHtml(siteUrl);
        submittedCode = fetchedSite.html;
        resolvedSourceUrl = fetchedSite.sourceUrl;
        sourceType = "url";
      } catch (error) {
        if (error instanceof SiteFetchError) {
          return res.status(error.statusCode).json({
            success: false,
            code: "SITE_FETCH_FAILED",
            message: error.message,
          });
        }
        throw error;
      }
    }

    if (!submittedCode.trim()) {
      return res.status(422).json({
        success: false,
        code: "EMPTY_SITE_HTML",
        message: "The selected source returned an empty HTML document.",
      });
    }

    const { intermediateCode, staticFixesLog } =
      await astParserService.fixDeterministicRules(submittedCode);

    let finalRepairedCode = intermediateCode;
    let aiSuggestions = [];
    let aiChanges = [];
    let aiRepairStatus = "NOT_NEEDED";
    let aiRepairMessage = "";

    const findingsBeforeAi = astParserService.scanHtml(intermediateCode).findings;
    if (findingsBeforeAi.length > 0 &&
        Buffer.byteLength(intermediateCode, "utf8") > MAX_AI_HTML_BYTES) {
      aiRepairStatus = "SKIPPED_LIMIT";
      aiRepairMessage = "AI repair was skipped because the HTML exceeds the 100 KB AI input limit; deterministic repairs and supported checks were still run.";
    } else if (findingsBeforeAi.length > 0) {
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
        submittedCode,
        finalRepairedCode,
        staticFixesLog.length,
        staticFixesLog,
        aiChanges
      );

    const report = await ScanReport.create({
      userId: req.user._id,
      sourceType,
      sourceUrl: resolvedSourceUrl,
      originalCode: submittedCode,
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
        sourceType: report.sourceType,
        sourceUrl: report.sourceUrl,
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
