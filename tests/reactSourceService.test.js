const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHECK_CATALOG,
  applyApprovedReactRepairs,
  parseReactSource,
  scanReactSource,
} = require("../services/reactSourceService");
const mongoose = require("mongoose");
const ScanReport = require("../model/ScanReport");

test("parses JSX and TSX without executing source", () => {
  assert.equal(parseReactSource("export const View = () => <main />;", "View.jsx").type, "File");
  assert.equal(
    parseReactSource("type Props = { title: string }; export function View(p: Props) { return <button>{p.title}</button> }", "View.tsx").type,
    "File"
  );
});

test("reports JSX syntax errors with source location", () => {
  assert.throws(
    () => parseReactSource("export function View() { return <button>oops }", "View.jsx"),
    (error) => error.statusCode === 422 &&
      error.code === "REACT_SOURCE_PARSE_FAILED" &&
      /line 1, column/.test(error.message)
  );
});

test("maps missing native accessibility names to stable source nodes and locations", () => {
  const result = scanReactSource([
    "export function View() {",
    "  return <><img src=\"/chart.png\" /><button /><a href=\"/next\" /><input /></>;",
    "}",
  ].join("\n"), "View.jsx");
  const rules = result.findings.map((finding) => finding.ruleId);

  assert.deepEqual(rules, [
    "wcag-jsx-image-alt",
    "wcag-jsx-button-name",
    "wcag-jsx-link-name",
    "wcag-jsx-form-control-name",
  ]);
  assert.ok(result.findings.every((finding) =>
    finding.sourceLocation.line === 2 &&
    finding.sourceLocation.column > 0 &&
    finding.findingId.includes(":jsx:")
  ));
  assert.equal(result.checks.find((check) => check.id === "wcag-document-language").status, "NOT_CHECKED");
});

test("recognizes static text, explicit labels, and linked labels without claiming untested document language", () => {
  const result = scanReactSource(`
    export function View() {
      return <form>
        <button>Save</button>
        <a href="/next" aria-label="Continue">Go</a>
        <label htmlFor="email">Email</label><input id="email" />
        <textarea aria-label="Message" />
      </form>;
    }
  `);

  assert.equal(result.findings.length, 0);
  assert.ok(result.checks
    .filter((check) => check.category.includes("source-check"))
    .every((check) => check.status === "NO_PATTERN_DETECTED"));
  assert.ok(result.checks
    .filter((check) => check.category === "not-implemented-for-jsx" ||
      check.category === "rendered-page/runtime-check" ||
      check.category === "human-review-required")
    .every((check) => check.status === "NOT_CHECKED"));
});

test("dynamic props, spreads, and custom components remain review items and are not repaired", () => {
  const result = scanReactSource(`
    export function View({ label, props }) {
      return <>
        <button aria-label={label} />
        <input {...props} />
        <FancyButton />
      </>;
    }
  `, "View.jsx");
  const uncertain = result.findings.filter((finding) => finding.status === "NEEDS_REVIEW");

  assert.equal(uncertain.length, 3);
  assert.ok(uncertain.every((finding) => finding.repairable === false));
  assert.ok(result.checks
    .filter((check) => check.id !== "wcag-document-language")
    .some((check) => check.status === "NEEDS_REVIEW"));
  assert.throws(() => applyApprovedReactRepairs(
    "export function View({ label }) { return <button aria-label={label} />; }",
    [{ findingId: "wcag-jsx-button-name:jsx:0", value: "Open", repairType: "user-approved" }],
    "View.jsx"
  ), /does not match|context-dependent/);
});

test("does not duplicate an existing empty accessible-name attribute", () => {
  const input = 'export const View = () => <button aria-label="" />;';
  const finding = scanReactSource(input).findings[0];
  assert.equal(finding.status, "NEEDS_REVIEW");
  assert.equal(finding.repairable, false);
  assert.throws(() => applyApprovedReactRepairs(input, [{
    findingId: finding.findingId,
    value: "Open",
    repairType: "user-approved",
  }]), /does not match a supported current finding/);
});

test("does not count empty image alternative text as a verified intent", () => {
  const result = scanReactSource('export const View = () => <img src="/image.png" alt="" />;');
  const finding = result.findings[0];

  assert.equal(finding.ruleId, "wcag-jsx-image-alt");
  assert.equal(finding.status, "NEEDS_REVIEW");
  assert.equal(finding.repairable, false);
  assert.equal(result.checks.find((check) => check.id === "wcag-jsx-image-alt").status, "NEEDS_REVIEW");
});

test("applies only user-approved allowlisted attributes and preserves unrelated source", () => {
  const input = "export function View(){\n  return <><button onClick={save}></button><img src=\"/chart.png\" /></>;\n}";
  const scan = scanReactSource(input, "View.jsx");
  const buttonFinding = scan.findings.find((finding) => finding.ruleId === "wcag-jsx-button-name");
  const imageFinding = scan.findings.find((finding) => finding.ruleId === "wcag-jsx-image-alt");
  const result = applyApprovedReactRepairs(input, [
    {
      findingId: buttonFinding.findingId,
      value: "Save report",
      repairType: "user-approved",
    },
    {
      findingId: imageFinding.findingId,
      value: "Quarterly chart",
      imageIntent: "informative",
      repairType: "user-approved",
    },
  ], "View.jsx");

  assert.match(result.repairedCode, /<button onClick=\{save\} aria-label=\{"Save report"\}><\/button>/);
  assert.match(result.repairedCode, /<img src="\/chart\.png" alt=\{"Quarterly chart"\} \/>/);
  assert.equal(result.repairedCode.includes("return <><button onClick={save}"), true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.resolvedFindingIds.length, 2);
  assert.equal(result.appliedRepairs.length, 2);
});

test("requires explicit image intent and rejects wrong, duplicate, or unsupported targets", () => {
  const input = "export const View = () => <img src=\"/decorative.png\" />;";
  const finding = scanReactSource(input).findings[0];
  assert.throws(() => applyApprovedReactRepairs(input, [{
    findingId: finding.findingId,
    value: "",
    repairType: "user-approved",
  }]), /Choose decorative intent/);
  assert.throws(() => applyApprovedReactRepairs(input, [{
    findingId: finding.findingId,
    value: "Chart",
    imageIntent: "informative",
    repairType: "user-approved",
  }, {
    findingId: finding.findingId,
    value: "Other",
    imageIntent: "informative",
    repairType: "user-approved",
  }]), /duplicated/);
  assert.throws(() => applyApprovedReactRepairs(input, [{
    findingId: "wcag-jsx-image-alt:jsx:99",
    value: "Chart",
    imageIntent: "informative",
    repairType: "user-approved",
  }]), /does not match/);
});

test("catalog records check limits and does not add JSX checks to an HTML score", () => {
  const documentLanguage = CHECK_CATALOG.find((check) => check.id === "wcag-document-language");
  assert.equal(documentLanguage.category, "not-implemented-for-jsx");
  assert.equal(documentLanguage.status, undefined);
  assert.ok(CHECK_CATALOG.every((check) =>
    check.detectionMethod && check.repairPolicy && check.limitations
  ));
});

test("React source reports allow null scores instead of borrowing the HTML score", async () => {
  const report = new ScanReport({
    userId: new mongoose.Types.ObjectId(),
    sourceType: "react-jsx",
    sourceFileName: "View.tsx",
    originalCode: "export const View = () => <main />;",
    repairedCode: "export const View = () => <main />;",
    scoreBefore: null,
    scoreAfter: null,
  });

  await report.validate();
});

test("HTML report scores remain required", async () => {
  const report = new ScanReport({
    userId: new mongoose.Types.ObjectId(),
    sourceType: "html",
    originalCode: "<main>Page</main>",
    repairedCode: "<main>Page</main>",
  });
  await assert.rejects(report.validate(), /scoreBefore|scoreAfter/);
});
