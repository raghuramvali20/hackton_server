const test = require("node:test");
const assert = require("node:assert/strict");
const astParserService = require("../services/astParserService");
const formalVerificationService = require("../services/formalVerificationService");
const ScanReport = require("../model/ScanReport");
const { applyCodeRepairs, previewCodeRepair } = require("../controllers/repairController");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("routes JSX preview to the React parser and returns its actual check scope", async () => {
  const originalScanHtml = astParserService.scanHtml;
  astParserService.scanHtml = () => {
    throw new Error("React source must not use the HTML scanner.");
  };
  const res = responseRecorder();

  try {
    await previewCodeRepair({
      body: {
        sourceType: "react-jsx",
        sourceCode: "export const View = () => <button />;",
        sourceFileName: "View.jsx",
      },
    }, res);
  } finally {
    astParserService.scanHtml = originalScanHtml;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.preview.sourceType, "react-jsx");
  assert.equal(res.body.preview.sourceFileName, "View.jsx");
  assert.equal(res.body.preview.findings[0].ruleId, "wcag-jsx-button-name");
  assert.ok(res.body.preview.checksPerformed.some((check) => check.status === "NOT_CHECKED"));
});

test("keeps HTML preview routed through the existing scanner", async () => {
  const res = responseRecorder();
  await previewCodeRepair({ body: { rawCode: "<main>Readable page</main>" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.preview.sourceType, "html");
  assert.equal(res.body.preview.findings.length, 0);
});

test("reports unsupported React syntax with a useful parse error", async () => {
  const res = responseRecorder();
  await previewCodeRepair({
    body: {
      sourceType: "react-jsx",
      sourceCode: "export const View = () => <button>",
      sourceFileName: "View.jsx",
    },
  }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "REACT_SOURCE_PARSE_FAILED");
  assert.match(res.body.message, /line 1/);
});

test("applies and persists React changes without calculating an HTML score", async () => {
  const originalCreate = ScanReport.create;
  const originalVerify = formalVerificationService.verifySupportedChecks;
  ScanReport.create = async (fields) => ({
    ...fields,
    _id: "react-report-id",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  formalVerificationService.verifySupportedChecks = () => {
    throw new Error("React source must not use the HTML score verifier.");
  };
  const res = responseRecorder();
  const sourceCode = "export const View = () => <button />;";
  const findingId = "wcag-jsx-button-name:jsx:0";

  try {
    await applyCodeRepairs({
      user: { _id: "user-id" },
      body: {
        sourceType: "react-jsx",
        sourceFileName: "View.jsx",
        rawCode: sourceCode,
        repairs: [{
          findingId,
          value: "Open menu",
          repairType: "user-approved",
        }],
        skippedFindingIds: [],
      },
    }, res);
  } finally {
    ScanReport.create = originalCreate;
    formalVerificationService.verifySupportedChecks = originalVerify;
  }

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.report.sourceType, "react-jsx");
  assert.equal(res.body.report.scoreBefore, null);
  assert.equal(res.body.report.scoreAfter, null);
  assert.match(res.body.report.repairedCode, /aria-label=\{"Open menu"\}/);
  assert.equal(res.body.report.verification.scoreMethod, null);
});
