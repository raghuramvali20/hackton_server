const test = require("node:test");
const assert = require("node:assert/strict");
const { scanHtml } = require("../services/astParserService");
const {
  applyApprovedRepairs,
  getSafeRepairCandidates,
} = require("../services/repairWorkflowService");
const { verifySupportedChecks } = require("../services/formalVerificationService");

test("preview candidate generation leaves submitted HTML unchanged", () => {
  const original = '<img src="/ornament.svg" role="presentation">';
  const findings = scanHtml(original).findings;
  const candidates = getSafeRepairCandidates(original, findings);

  assert.equal(original, '<img src="/ornament.svg" role="presentation">');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].repairType, "safe");
  assert.equal(scanHtml(original).findings.length, 1);
});

test("safe repair is applied only when explicitly included in approvals", () => {
  const original = '<img src="/ornament.svg" role="presentation">';
  const finding = scanHtml(original).findings[0];
  const unchanged = applyApprovedRepairs(original, [], [finding]);

  assert.equal(unchanged.repairedCode, original);
  assert.equal(unchanged.appliedRepairs.length, 0);

  const repaired = applyApprovedRepairs(original, [{
    findingId: finding.findingId,
    value: "",
  }], [finding]);
  assert.match(repaired.repairedCode, /alt=""/);
  assert.equal(scanHtml(repaired.repairedCode).findings.length, 0);
  assert.equal(repaired.appliedRepairs[0].repairType, "safe");
});

test("applies only allowlisted attribute changes to the matching finding", () => {
  const original = '<button><svg aria-hidden="true"></svg></button>';
  const finding = scanHtml(original).findings[0];
  const result = applyApprovedRepairs(original, [{
    findingId: finding.findingId,
    value: "Open menu",
    repairType: "ai-assisted",
  }], [finding]);

  assert.match(result.repairedCode, /<button aria-label="Open menu">/);
  assert.match(result.repairedCode, /<svg aria-hidden="true"><\/svg>/);
  assert.equal(scanHtml(result.repairedCode).findings.length, 0);
  assert.equal(result.appliedRepairs[0].repairType, "ai-assisted");
});

test("rejects invalid targets, duplicates, and empty alt for informative images", () => {
  const input = '<img src="/chart.png">';
  const finding = scanHtml(input).findings[0];
  const request = { findingId: finding.findingId, value: "" };
  assert.throws(
    () => applyApprovedRepairs(input, [request], [finding]),
    /Informative images require/
  );
  assert.throws(
    () => applyApprovedRepairs(input, [
      { findingId: finding.findingId, value: "Revenue by quarter" },
      { findingId: finding.findingId, value: "Another description" },
    ], [finding]),
    /duplicated/
  );
  assert.throws(
    () => applyApprovedRepairs(input, [{
      findingId: "wcag-image-alt:999",
      value: "Description",
    }], [finding]),
    /does not match a current finding/
  );
});

test("language can only be set using a valid selected BCP 47-style language tag", () => {
  const input = "<!doctype html><html><body><main>Hello</main></body></html>";
  const finding = scanHtml(input).findings[0];
  assert.equal(finding.ruleId, "wcag-document-language");

  const result = applyApprovedRepairs(input, [{
    findingId: finding.findingId,
    value: "en-US",
  }], [finding]);
  assert.match(result.repairedCode, /<html lang="en-US">/);
  assert.throws(
    () => applyApprovedRepairs(input, [{
      findingId: finding.findingId,
      value: "not a language",
    }], [finding]),
    /valid language tag/
  );
});

test("informative image text must be non-empty and is recorded as user-approved AI repair", () => {
  const input = '<img src="/chart.png">';
  const finding = scanHtml(input).findings[0];
  const result = applyApprovedRepairs(input, [{
    findingId: finding.findingId,
    value: "Quarterly revenue chart",
    repairType: "ai-assisted",
  }], [finding]);

  assert.match(result.repairedCode, /alt="Quarterly revenue chart"/);
  assert.equal(result.appliedRepairs[0].repairType, "ai-assisted");
  assert.equal(scanHtml(result.repairedCode).findings.length, 0);
});

test("re-scan reports skipped findings separately from detected remaining issues", () => {
  const original = '<img src="/chart.png">';
  const finding = scanHtml(original).findings[0];
  const result = verifySupportedChecks(
    original,
    original,
    0,
    [],
    [],
    [finding]
  );

  assert.equal(result.verification.issueCounts.remaining, 1);
  assert.equal(result.verification.issueCounts.skipped, 1);
  assert.equal(result.verification.skippedFindings[0].findingId, finding.findingId);
  assert.equal(result.verification.findingsAfter[0].status, "NEEDS_REVIEW");
});

test("frontend approve, skip, safe-approve, and repeated actions remain idempotent", async () => {
  const {
    approveRepair,
    approveSafeRepairSet,
    getSelectedRepairs,
    skipRepair,
  } = await import("../../frontend/src/features/auditor/models/repairSession.js");

  const proposal = {
    findingId: "wcag-button-name:0.0",
    value: "Open menu",
    repairType: "ai-assisted",
  };
  let state = approveRepair({}, {}, proposal);
  state = approveRepair(state.approved, state.skipped, proposal);
  assert.equal(getSelectedRepairs(state.approved).length, 1);

  state = skipRepair(state.approved, state.skipped, proposal.findingId);
  assert.equal(getSelectedRepairs(state.approved).length, 0);
  assert.equal(state.skipped[proposal.findingId], true);

  state = approveRepair(state.approved, state.skipped, proposal);
  assert.equal(state.skipped[proposal.findingId], undefined);
  assert.equal(getSelectedRepairs(state.approved).length, 1);

  const safe = { findingId: "wcag-image-alt:0.1", value: "", repairType: "safe" };
  state = approveSafeRepairSet(state.approved, state.skipped, [safe]);
  state = approveSafeRepairSet(state.approved, state.skipped, [safe]);
  assert.equal(getSelectedRepairs(state.approved).length, 2);
  assert.equal(state.approved[safe.findingId].repairType, "safe");
});
