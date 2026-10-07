const ScanReport = require("../model/ScanReport");
const astParserService = require("../services/astParserService");
const aiRepairService = require("../services/aiRepairService");
const formalVerificationService = require("../services/formalVerificationService");
const {
  SiteFetchError,
  fetchSiteHtml,
  parseSiteUrl,
} = require("../services/siteFetchService");
const {
  applyApprovedRepairs,
  getSafeRepairCandidates,
} = require("../services/repairWorkflowService");

const MAX_AI_HTML_BYTES = 100 * 1024;

async function readRepairSource(body) {
  const { rawCode, siteUrl } = body || {};
  const hasRawCode = typeof rawCode === "string" && Boolean(rawCode.trim());
  const hasSiteUrl = typeof siteUrl === "string" && Boolean(siteUrl.trim());
  if (hasRawCode === hasSiteUrl) {
    const error = new Error("Provide exactly one source: a non-empty rawCode string or siteUrl.");
    error.statusCode = 400;
    throw error;
  }

  if (hasSiteUrl) {
    const fetchedSite = await fetchSiteHtml(siteUrl);
    return {
      rawCode: fetchedSite.html,
      sourceType: "url",
      sourceUrl: fetchedSite.sourceUrl,
    };
  }
  return { rawCode, sourceType: "html", sourceUrl: "" };
}

async function previewCodeRepair(req, res) {
  try {
    const source = await readRepairSource(req.body);
    if (!source.rawCode.trim()) {
      return res.status(422).json({
        success: false,
        code: "EMPTY_SITE_HTML",
        message: "The selected source returned an empty HTML document.",
      });
    }

    const scan = astParserService.scanHtml(source.rawCode);
    const safeRepairs = getSafeRepairCandidates(source.rawCode, scan.findings);
    let aiRepairs = [];
    let aiRepairStatus = "NOT_NEEDED";
    let aiRepairMessage = "";
    const aiEligibleFindings = scan.findings.filter((finding) =>
      ["wcag-image-alt", "wcag-button-name", "wcag-link-name", "wcag-form-control-name"]
        .includes(finding.ruleId) &&
      !safeRepairs.some((repair) => repair.findingId === finding.findingId)
    );

    if (aiEligibleFindings.length > 0 &&
        Buffer.byteLength(source.rawCode, "utf8") > MAX_AI_HTML_BYTES) {
      aiRepairStatus = "SKIPPED_LIMIT";
      aiRepairMessage = "AI proposals were skipped because the HTML exceeds the 100 KB AI input limit.";
    } else if (aiEligibleFindings.length > 0) {
      try {
        const proposals = await aiRepairService.generateContextualFixes(
          source.rawCode,
          aiEligibleFindings
        );
        aiRepairs = proposals.aiChanges.map((repair) => ({
          ...repair,
          status: "PROPOSED",
          repairType: "ai-assisted",
        }));
        aiRepairStatus = "COMPLETED";
      } catch (error) {
        console.error("Gemini accessibility proposals unavailable:", error);
        aiRepairStatus = "UNAVAILABLE";
        aiRepairMessage = "AI proposals are unavailable. Safe fixes and manual language selection remain available.";
      }
    }

    return res.status(200).json({
      success: true,
      preview: {
        ...source,
        findings: scan.findings,
        checksPerformed: scan.checks,
        safeRepairs,
        aiRepairs,
        aiRepairStatus,
        aiRepairMessage,
      },
    });
  } catch (error) {
    if (error instanceof SiteFetchError) {
      return res.status(error.statusCode).json({
        success: false,
        code: "SITE_FETCH_FAILED",
        message: error.message,
      });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Code repair preview failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to scan this source.",
    });
  }
}

async function applyCodeRepairs(req, res) {
  try {
    const {
      rawCode,
      repairs,
      skippedFindingIds,
      aiRepairStatus,
      aiRepairMessage,
    } = req.body || {};
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "rawCode must contain the original HTML from the preview.",
      });
    }

    const before = astParserService.scanHtml(rawCode);
    const safeCandidates = getSafeRepairCandidates(rawCode, before.findings);
    const safeIds = new Set(safeCandidates.map((candidate) => candidate.findingId));
    const requestedRepairs = Array.isArray(repairs)
      ? repairs.map((repair) => ({
          ...repair,
          repairType: safeIds.has(repair?.findingId)
            ? "safe"
            : repair?.repairType === "ai-assisted"
              ? "ai-assisted"
              : "user-selected",
        }))
      : repairs;
    const { repairedCode, appliedRepairs } =
      applyApprovedRepairs(rawCode, requestedRepairs, before.findings);
    const aiChanges = appliedRepairs.filter(
      (repair) => repair.repairType === "ai-assisted"
    );
    const staticFixes = appliedRepairs.filter(
      (repair) => repair.repairType === "safe"
    );
    const { verification, scoreBefore, scoreAfter } =
      formalVerificationService.verifySupportedChecks(
        rawCode,
        repairedCode,
        staticFixes.length,
        staticFixes,
        aiChanges,
        before.findings.filter((finding) =>
          Array.isArray(skippedFindingIds) &&
          skippedFindingIds.includes(finding.findingId)
        )
      );
    const sourceType = req.body.sourceType === "url" ? "url" : "html";
    const sourceUrl = sourceType === "url"
      ? parseSiteUrl(req.body.sourceUrl).toString()
      : "";

    const report = await ScanReport.create({
      userId: req.user._id,
      sourceType,
      sourceUrl,
      originalCode: rawCode,
      repairedCode,
      scoreBefore,
      scoreAfter,
      appliedFixes: appliedRepairs.map((repair) => repair.description),
      appliedRepairs,
      aiChanges,
      skippedFindings: verification.skippedFindings,
      findings: verification.findings,
      aiSuggestions: [],
      aiRepairStatus: ["COMPLETED", "UNAVAILABLE", "SKIPPED_LIMIT"].includes(aiRepairStatus)
        ? aiRepairStatus
        : appliedRepairs.length
          ? "COMPLETED"
          : "NOT_NEEDED",
      aiRepairMessage: typeof aiRepairMessage === "string"
        ? aiRepairMessage.slice(0, 500)
        : "",
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
        appliedRepairs: report.appliedRepairs,
        aiChanges: report.aiChanges,
        skippedFindings: report.skippedFindings,
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
    if (error instanceof SiteFetchError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (/approved repair|repair target|repair value|language tag|eligible|current finding|Too many repairs/i.test(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Applying approved repairs failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to apply the approved repairs.",
    });
  }
}

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
  applyCodeRepairs,
  processCodeRepair,
  previewCodeRepair,
  getUserScanHistory,
};
