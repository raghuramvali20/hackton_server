const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fixDeterministicRules,
  scanHtml,
} = require("../services/astParserService");
const {
  verifySupportedChecks,
} = require("../services/formalVerificationService");
const {
  generateContextualFixes,
  parseSuggestions,
  parseRepairResponse,
} = require("../services/aiRepairService");

test("reports a missing document language for a complete HTML document", () => {
  const result = scanHtml("<!doctype html><html><body><main>Hi</main></body></html>");
  const finding = result.findings.find(
    (item) => item.ruleId === "wcag-document-language"
  );

  assert.ok(finding);
  assert.equal(finding.status, "NEEDS_REVIEW");
  assert.equal(finding.criterion, "WCAG 3.1.1");
});

test("does not guess image alternative text or document language", async () => {
  const input = '<!doctype html><html><body><img src="/chart.png"></body></html>';
  const result = await fixDeterministicRules(input);

  assert.equal(result.intermediateCode, input);
  assert.deepEqual(result.staticFixesLog, []);
  assert.ok(result.findingsBefore.some((item) => item.ruleId === "wcag-image-alt"));
  assert.ok(result.findingsBefore.some((item) => item.ruleId === "wcag-document-language"));
});

test("adds empty alt only when an image is explicitly marked decorative", async () => {
  const result = await fixDeterministicRules(
    '<img src="/ornament.svg" role="presentation">'
  );

  assert.match(result.intermediateCode, /alt=""/);
  assert.equal(result.staticFixesLog.length, 1);
  assert.equal(result.staticFixesLog[0].repairType, "automatic");
  assert.equal(scanHtml(result.intermediateCode).findings.length, 0);
});

test("preserves an explicitly supplied body wrapper when serializing a safe fix", async () => {
  const result = await fixDeterministicRules(
    '<body><img src="/ornament.svg" role="presentation"></body>'
  );

  assert.match(result.intermediateCode, /^<body>/);
  assert.match(result.intermediateCode, /<\/body>$/);
});

test("does not change button submission behavior", async () => {
  const input = "<form><button>Save</button></form>";
  const result = await fixDeterministicRules(input);

  assert.equal(result.intermediateCode, input);
  assert.deepEqual(result.staticFixesLog, []);
});

test("detects unnamed buttons, links, and form controls but accepts associated labels", () => {
  const result = scanHtml(`
    <form>
      <button><svg aria-hidden="true"></svg></button>
      <a href="/next"><svg aria-hidden="true"></svg></a>
      <input id="email">
      <label for="name">Name</label><input id="name">
      <textarea aria-label="Message"></textarea>
    </form>
  `);

  assert.deepEqual(
    result.findings.map((item) => item.ruleId).sort(),
    ["wcag-button-name", "wcag-form-control-name", "wcag-link-name"]
  );
  assert.ok(result.findings.every((item) =>
    ["REMAINS", "NEEDS_REVIEW"].includes(item.status) &&
    item.element &&
    item.severity
  ));
});

test("does not count hidden button text as an accessible name", () => {
  const result = scanHtml(
    '<button><span aria-hidden="true">Save</span></button>'
  );

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].ruleId, "wcag-button-name");
});

test("treats a fragment without an explicit html element as not applicable for document language", () => {
  const result = scanHtml("<main><h1>Example</h1></main>");
  const languageCheck = result.checks.find(
    (item) => item.id === "wcag-document-language"
  );

  assert.equal(languageCheck.status, "NOT_APPLICABLE");
  assert.ok(!result.findings.some((item) => item.ruleId === languageCheck.id));
});

test("handles empty and malformed HTML without crashing", () => {
  assert.deepEqual(scanHtml("").findings, []);
  assert.ok(scanHtml("<button><span>Open").findings.length === 0);
});

test("accessible representative HTML passes the supported static checks", () => {
  const result = scanHtml(`
    <!doctype html>
    <html lang="en">
      <body>
        <img src="/chart.png" alt="Quarterly revenue chart">
        <button aria-label="Open menu"><svg aria-hidden="true"></svg></button>
        <a href="/details">View details</a>
        <label for="email">Email</label><input id="email" type="email">
        <label>Message <textarea></textarea></label>
      </body>
    </html>
  `);

  assert.deepEqual(result.findings, []);
  assert.ok(result.checks.every((check) =>
    ["PASSED", "NOT_APPLICABLE"].includes(check.status)
  ));
});

test("verification reports supported checks and a deterministic data hash, not proofs", () => {
  const input = '<!doctype html><html><body><img src="/chart.png"></body></html>';
  const first = verifySupportedChecks(input, input, 0);
  const second = verifySupportedChecks(input, input, 0);

  assert.equal(first.verification.verificationStatus, "NEEDS_REVIEW");
  assert.equal(first.verification.reportHash, second.verification.reportHash);
  assert.match(first.verification.reportHash, /^[a-f0-9]{64}$/);
  assert.equal(first.verification.issueCounts.needsReview, 2);
  assert.ok(first.verification.checksPerformed.some(
    (item) => item.id === "wcag-image-alt"
  ));
  assert.equal("theoremProofs" in first.verification, false);
  assert.equal("proofHash" in first.verification, false);
});

test("verification refuses empty input instead of issuing a passing status", () => {
  assert.throws(
    () => verifySupportedChecks("", "", 0),
    /must contain HTML/
  );
});

test("verification records an explicitly decorative image repair as fixed", async () => {
  const input = '<img src="/ornament.svg" role="presentation">';
  const repaired = await fixDeterministicRules(input);
  const result = verifySupportedChecks(
    input,
    repaired.intermediateCode,
    repaired.staticFixesLog.length,
    repaired.staticFixesLog
  );

  assert.equal(result.verification.verificationStatus, "PASSED_SUPPORTED_CHECKS");
  assert.equal(result.verification.issueCounts.fixed, 1);
  assert.equal(result.verification.findings[0].status, "FIXED");
});

test("before and after scores are pass rates across applicable supported checks", async () => {
  const input = '<img src="/ornament.svg" role="presentation">';
  const repaired = await fixDeterministicRules(input);
  const result = verifySupportedChecks(
    input,
    repaired.intermediateCode,
    repaired.staticFixesLog.length,
    repaired.staticFixesLog
  );

  assert.equal(result.verification.scoreMethod, "supported-check-pass-rate-v1");
  assert.deepEqual(result.verification.scoreBreakdown, {
    before: { passed: 3, applicable: 4 },
    after: { passed: 4, applicable: 4 },
  });
  assert.equal(result.scoreBefore, 75);
  assert.equal(result.scoreAfter, 100);
});

test("verification marks AI-assisted repairs as requiring human review", () => {
  const input = '<button></button>';
  const output = '<button aria-label="Open navigation"></button>';
  const result = verifySupportedChecks(input, output, 0, [], [{
    ruleId: "wcag-button-name",
    findingIndex: 0,
  }]);

  assert.equal(result.verification.verificationStatus, "NEEDS_REVIEW");
  assert.equal(result.verification.issueCounts.remaining, 0);
  assert.equal(result.verification.issueCounts.needsReview, 1);
  assert.equal(result.verification.humanReviewRequired, true);
  assert.equal(result.verification.findings[0].repairType, "ai-assisted");
});

test("accepts bounded, allowlisted Gemini suggestions", () => {
  const result = parseSuggestions(JSON.stringify({
    suggestions: [{
      ruleId: "wcag-image-alt",
      element: "img:nth-of-type(1)",
      suggestion: "Ask the author for appropriate alternative text.",
      rationale: "The image purpose cannot be inferred safely.",
    }],
  }));

  assert.equal(result.length, 1);
  assert.equal(result[0].status, "NEEDS_REVIEW");
  assert.equal(result[0].repairType, "suggested");
});

test("rejects Gemini suggestions with unsupported rules", () => {
  assert.throws(
    () => parseSuggestions(JSON.stringify({
      suggestions: [{
        ruleId: "invented-rule",
        suggestion: "Make an unsupported change.",
        rationale: "Not in the supported checks.",
      }],
    })),
    /invalid or unsupported shape/
  );
});

test("Gemini returns a validated AI-assisted code change for a supported finding", async () => {
  const input = "<button><svg aria-hidden=\"true\"></svg></button>";
  const findings = scanHtml(input).findings;
  const client = {
    models: {
      async generateContent() {
        return {
          text: JSON.stringify({
            repairs: [{
              findingIndex: 0,
              ruleId: "wcag-button-name",
              attribute: "aria-label",
              value: "Open menu",
            }],
            suggestions: [],
          }),
        };
      },
    },
  };

  const result = await generateContextualFixes(input, findings, client);
  assert.notEqual(result.finalRepairedCode, input);
  assert.match(result.finalRepairedCode, /aria-label="Open menu"/);
  assert.equal(scanHtml(result.finalRepairedCode).findings.length, 0);
  assert.equal(result.aiChanges.length, 1);
  assert.equal(result.aiChanges[0].status, "NEEDS_REVIEW");
  assert.equal(result.aiSuggestions.length, 0);
  assert.equal(result.aiFixesLog.length, 1);
});

test("Gemini image-alt proposals are bound to the scanner finding and require text", () => {
  const finding = scanHtml('<img src="/chart.png">').findings[0];
  const parsed = parseRepairResponse(JSON.stringify({
    repairs: [{
      findingIndex: 0,
      ruleId: "wcag-image-alt",
      attribute: "alt",
      value: "Bar chart of quarterly revenue",
    }],
    suggestions: [],
  }), [finding]);

  assert.equal(parsed.repairs[0].findingId, finding.findingId);
  assert.equal(parsed.repairs[0].attribute, "alt");
  assert.equal(parsed.repairs[0].value, "Bar chart of quarterly revenue");
});

test("Gemini repairs preserve button behavior and support unwrapped HTML fragments", async () => {
  const input = "<form><button> </button></form>";
  const findings = scanHtml(input).findings;
  const client = {
    models: {
      async generateContent() {
        return {
          text: JSON.stringify({
            repairs: [{
              findingIndex: 0,
              ruleId: "wcag-button-name",
              attribute: "aria-label",
              value: "Save changes",
            }],
            suggestions: [],
          }),
        };
      },
    },
  };

  const result = await generateContextualFixes(input, findings, client);
  assert.match(result.finalRepairedCode, /^<form>/);
  assert.match(result.finalRepairedCode, /<button aria-label="Save changes">/);
  assert.match(result.finalRepairedCode, /<\/button><\/form>$/);
  assert.equal(scanHtml(result.finalRepairedCode).findings.length, 0);
});

test("Gemini failures and invalid repair response shapes are surfaced", async () => {
  const failingClient = {
    models: {
      async generateContent() {
        throw new Error("provider unavailable");
      },
    },
  };
  const invalidClient = {
    models: {
      async generateContent() {
        return { text: '{"repairedHtml":"<div>wrong contract</div>"}' };
      },
    },
  };

  const findings = scanHtml("<button></button>").findings;
  await assert.rejects(
    generateContextualFixes("<button></button>", findings, failingClient),
    /Gemini accessibility repair failed: provider unavailable/
  );
  await assert.rejects(
    generateContextualFixes("<button></button>", findings, invalidClient),
    /missing repairs or suggestions arrays/
  );
});

test("Gemini cannot target another finding or inject unsupported attributes", async () => {
  const findings = scanHtml("<button></button>").findings;
  assert.throws(
    () => parseRepairResponse(JSON.stringify({
      repairs: [{
        findingIndex: 0,
        ruleId: "wcag-button-name",
        attribute: "onclick",
        value: "alert(1)",
      }],
      suggestions: [],
    }), findings),
    /unsupported finding or attribute/
  );
});

test("frontend normalizer preserves new reports and marks old certificates unverified", async () => {
  const { normalizeReport } = await import(
    "../../frontend/src/shared/types/api.js"
  );
  const current = normalizeReport({
    _id: "new-report",
    findings: [{ ruleId: "wcag-image-alt" }],
    aiSuggestions: [],
    verification: {
      schemaVersion: 1,
      verificationStatus: "NEEDS_REVIEW",
      issueCounts: { found: 1, fixed: 0, remaining: 1, needsReview: 1 },
    },
  });
  const legacy = normalizeReport({
    _id: "old-report",
    formalCertificate: {
      verificationStatus: "FORMALLY_VERIFIED",
      proofHash: "sha256-wcag-not-a-real-hash",
    },
  });
  const reactSource = normalizeReport({
    _id: "react-source-report",
    sourceType: "react-jsx",
    sourceFileName: "Panel.tsx",
    scoreBefore: null,
    scoreAfter: null,
    verification: {
      schemaVersion: 2,
      sourceType: "react-jsx",
      verificationStatus: "NEEDS_REVIEW",
      issueCounts: { found: 1, fixed: 0, remaining: 1, needsReview: 1 },
    },
  });

  assert.equal(current.id, "new-report");
  assert.equal(current.verification.verificationStatus, "NEEDS_REVIEW");
  assert.equal(current.findings.length, 1);
  assert.deepEqual(current.appliedRepairs, []);
  assert.deepEqual(current.skippedFindings, []);
  assert.equal(legacy.verification.verificationStatus, "LEGACY_UNVERIFIED");
  assert.equal(legacy.verification.reportHash, null);
  assert.equal(reactSource.sourceType, "react-jsx");
  assert.equal(reactSource.sourceFileName, "Panel.tsx");
  assert.equal(reactSource.scoreAfter, null);
});
