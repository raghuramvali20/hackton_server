function countMatches(code, expression) {
  const matches = code.match(expression);
  return matches ? matches.length : 0;
}

function countKnownAccessibilityIssues(code) {
  const imagesMissingAlt = countMatches(
    code,
    /<img\b(?![^>]*\balt\s*=)[^>]*>/gi
  );

  const buttons = code.match(/<button\b[^>]*>[\s\S]*?<\/button\s*>/gi) || [];
  const buttonsWithoutNames = buttons.filter((button) => {
    const openingTag = button.match(/^<button\b[^>]*>/i)?.[0] || "";
    const content = button
      .replace(/^<button\b[^>]*>/i, "")
      .replace(/<\/button\s*>$/i, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();

    const hasAriaLabel = /\baria-label\s*=\s*(["']).+?\1/i.test(openingTag);
    const hasTitle = /\btitle\s*=\s*(["']).+?\1/i.test(openingTag);

    return !content && !hasAriaLabel && !hasTitle;
  }).length;

  return imagesMissingAlt + buttonsWithoutNames;
}

function scoreCode(code) {
  return Math.max(0, 100 - countKnownAccessibilityIssues(code) * 10);
}

function verifyAndIssueCertificate(originalCode, finalCode, totalFixes) {
  if (typeof originalCode !== "string" || typeof finalCode !== "string") {
    throw new TypeError("originalCode and finalCode must be strings.");
  }

  if (!Number.isInteger(totalFixes) || totalFixes < 0) {
    throw new TypeError("totalFixes must be a non-negative integer.");
  }

  const scoreBefore = scoreCode(originalCode);
  const scoreAfter = scoreCode(finalCode);

  const certificate = {
    verificationStatus: "STUB",
    issuedAt: new Date().toISOString(),
    totalFixes,
    checksPerformed: [
      "Images missing an alt attribute",
      "Buttons without detectable accessible names",
    ],
    theoremProofs: [
      {
        theorem: "Accessibility score is within the range 0 to 100",
        status: "STUB_NOT_PROVEN",
        proof: "Formal theorem proving is not implemented.",
      },
      {
        theorem: "Applied repairs preserve required application behavior",
        status: "STUB_NOT_PROVEN",
        proof: "Behavioral equivalence verification is not implemented.",
      },
    ],
  };

  return {
    certificate,
    scoreBefore,
    scoreAfter,
  };
}

module.exports = {
  verifyAndIssueCertificate,
};