const { createHash } = require("node:crypto");
const { scanHtml } = require("./astParserService");

function findingKey(finding) {
  return `${finding.ruleId}|${finding.element}`;
}

function calculateSupportedChecksScore(checks) {
  const applicableChecks = checks.filter(
    (check) => check.status !== "NOT_APPLICABLE"
  );
  const passedChecks = applicableChecks.filter(
    (check) => check.status === "PASSED"
  ).length;
  return {
    score: applicableChecks.length === 0
      ? 0
      : Math.round((passedChecks / applicableChecks.length) * 100),
    passed: passedChecks,
    applicable: applicableChecks.length,
  };
}

function verifySupportedChecks(
  originalCode,
  finalCode,
  totalFixes,
  automaticFixes = [],
  aiChanges = [],
  skippedFindings = []
) {
  if (typeof originalCode !== "string" || typeof finalCode !== "string") {
    throw new TypeError("originalCode and finalCode must be strings.");
  }

  if (!originalCode.trim() || !finalCode.trim()) {
    throw new TypeError("originalCode and finalCode must contain HTML.");
  }

  if (!Number.isInteger(totalFixes) || totalFixes < 0) {
    throw new TypeError("totalFixes must be a non-negative integer.");
  }

  const before = scanHtml(originalCode);
  const after = scanHtml(finalCode);
  const remainingByKey = new Map(after.findings.map((finding) => [
    findingKey(finding),
    finding,
  ]));
  const automaticFixKeys = new Set(automaticFixes.map(findingKey));
  const aiChangedRules = new Set(aiChanges.map((change) => change.ruleId));

  const findings = before.findings.map((finding) => {
    const remaining = remainingByKey.get(findingKey(finding));
    if (!remaining) {
      return {
        ...finding,
        status: "FIXED",
        repairType: automaticFixKeys.has(findingKey(finding))
          ? "automatic"
          : aiChangedRules.has(finding.ruleId)
            ? "ai-assisted"
            : "other",
      };
    }

    remainingByKey.delete(findingKey(finding));
    return { ...remaining };
  });

  findings.push(...remainingByKey.values());

  const findingsAfter = after.findings;
  const findingsNeedReview = findingsAfter.filter(
    (finding) => finding.status === "NEEDS_REVIEW"
  ).length;
  const needsReviewCount = findingsNeedReview + aiChanges.length;
  const remainingCount = findingsAfter.length;
  const verificationStatus = needsReviewCount > 0
    ? "NEEDS_REVIEW"
    : remainingCount > 0
      ? "ISSUES_REMAIN"
      : "PASSED_SUPPORTED_CHECKS";

  const checksPerformed = after.checks.map((check) => ({
    ...check,
    status: findingsAfter.find((finding) => finding.ruleId === check.id)?.status ||
      check.status,
  }));

  const scoreBeforeResult = calculateSupportedChecksScore(before.checks);
  const scoreAfterResult = calculateSupportedChecksScore(after.checks);
  const scoreBefore = scoreBeforeResult.score;
  const scoreAfter = scoreAfterResult.score;
  const reportHash = createHash("sha256")
    .update(JSON.stringify({
      originalCode,
      finalCode,
      checksPerformed,
      findings,
    }))
    .digest("hex");

  const verification = {
    schemaVersion: 1,
    scoreMethod: "supported-check-pass-rate-v1",
    scoreBreakdown: {
      before: {
        passed: scoreBeforeResult.passed,
        applicable: scoreBeforeResult.applicable,
      },
      after: {
        passed: scoreAfterResult.passed,
        applicable: scoreAfterResult.applicable,
      },
    },
    verificationStatus,
    scope: "Limited static HTML checks only; not a complete WCAG conformance result.",
    issuedAt: new Date().toISOString(),
    totalAutomaticFixes: totalFixes,
    aiChanges,
    humanReviewRequired: aiChanges.length > 0,
    skippedFindings,
    findingsBefore: before.findings,
    findingsAfter,
    findings,
    issueCounts: {
      found: before.findings.length,
      fixed: findings.filter((finding) => finding.status === "FIXED").length,
      remaining: findingsAfter.length,
      needsReview: needsReviewCount,
      skipped: skippedFindings.length,
    },
    checksPerformed,
    reportHash,
    reportHashPurpose: "SHA-256 identifier for the original/repaired HTML and supported-check results; not a proof of correctness or conformance.",
  };

  return {
    verification,
    scoreBefore,
    scoreAfter,
  };
}

module.exports = {
  verifySupportedChecks,
};
