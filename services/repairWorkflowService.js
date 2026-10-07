const cheerio = require("cheerio");
const { scanHtml } = require("./astParserService");

const ALLOWED_ATTRIBUTES = new Map([
  ["wcag-image-alt", { tagName: "img", attribute: "alt" }],
  ["wcag-button-name", { tagName: "button", attribute: "aria-label" }],
  ["wcag-link-name", { tagName: "a", attribute: "aria-label" }],
  ["wcag-form-control-name", {
    tagNames: new Set(["input", "select", "textarea"]),
    attribute: "aria-label",
  }],
  ["wcag-document-language", { tagName: "html", attribute: "lang" }],
]);

function getFindingId(finding) {
  return finding.findingId ||
    `${finding.ruleId}:${(finding.elementPath || []).join(".")}`;
}

function getSafeRepairCandidates(rawCode, findings = scanHtml(rawCode).findings) {
  const $ = cheerio.load(rawCode, { decodeEntities: false });
  return findings
    .filter((finding) => {
      if (finding.ruleId !== "wcag-image-alt") return false;
      const element = getElementAtPath($, finding.elementPath);
      const role = String($(element).attr("role") || "").toLowerCase();
      return role === "presentation" || role === "none";
    })
    .map((finding) => ({
      findingId: getFindingId(finding),
      ruleId: finding.ruleId,
      criterion: finding.criterion,
      element: finding.element,
      attribute: "alt",
      value: "",
      description: "This image is explicitly marked decorative. Add empty alternative text so assistive technology can ignore it.",
      repairType: "safe",
    }));
}

function getElementAtPath($, path) {
  if (!Array.isArray(path) || path.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error("Invalid repair target.");
  }

  let current = $.root().get(0);
  for (const index of path) {
    current = current?.children?.[index];
    if (!current) throw new Error("The repair target could not be found.");
  }
  if (current.type !== "tag") throw new Error("The repair target is not an HTML element.");
  return current;
}

function applyApprovedRepairs(rawCode, requestedRepairs, findings = scanHtml(rawCode).findings) {
  if (!Array.isArray(requestedRepairs)) {
    throw new TypeError("repairs must be an array.");
  }
  if (requestedRepairs.length > 100) {
    throw new Error("Too many repairs were submitted.");
  }
  if (requestedRepairs.length === 0) {
    return { repairedCode: rawCode, appliedRepairs: [] };
  }

  const findingMap = new Map(findings.map((finding) => [getFindingId(finding), finding]));
  const safeFindingIds = new Set(getSafeRepairCandidates(rawCode, findings)
    .map((candidate) => candidate.findingId));
  const seen = new Set();
  const $ = cheerio.load(rawCode, { decodeEntities: false });
  const applied = [];

  for (const requested of requestedRepairs) {
    if (
      !requested ||
      typeof requested.findingId !== "string" ||
      typeof requested.value !== "string" ||
      requested.value.length > 500 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(requested.value) ||
      seen.has(requested.findingId)
    ) {
      throw new Error("An approved repair has an invalid shape or is duplicated.");
    }

    const finding = findingMap.get(requested.findingId);
    if (!finding) throw new Error("An approved repair does not match a current finding.");
    const rule = ALLOWED_ATTRIBUTES.get(finding.ruleId);
    if (!rule) throw new Error("This finding does not support an in-app repair.");

    const element = getElementAtPath($, finding.elementPath);
    const tagName = element.tagName.toLowerCase();
    if (
      (rule.tagName && tagName !== rule.tagName) ||
      (rule.tagNames && !rule.tagNames.has(tagName)) ||
      $(element).attr(rule.attribute) !== undefined
    ) {
      throw new Error("The repair target or attribute is no longer eligible.");
    }
    const role = String($(element).attr("role") || "").toLowerCase();
    if (
      finding.ruleId === "wcag-image-alt" &&
      !requested.value.trim() &&
      role !== "presentation" &&
      role !== "none"
    ) {
      throw new Error("Informative images require a non-empty alternative-text proposal.");
    } else if (!requested.value.trim() && finding.ruleId !== "wcag-image-alt") {
      throw new Error("An approved repair value cannot be empty.");
    }
    if (
      finding.ruleId === "wcag-document-language" &&
      !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(requested.value.trim())
    ) {
      throw new Error("Choose a valid language tag, such as en or en-US.");
    }

    $(element).attr(rule.attribute, requested.value.trim());
    seen.add(requested.findingId);
    applied.push({
      findingId: requested.findingId,
      ruleId: finding.ruleId,
      criterion: finding.criterion,
      element: finding.element,
      attribute: rule.attribute,
      value: requested.value.trim(),
      description: `Added ${rule.attribute} to ${finding.element}.`,
      repairType: safeFindingIds.has(requested.findingId)
        ? "safe"
        : requested.repairType === "ai-assisted"
          ? "ai-assisted"
          : "user-selected",
    });
  }

  return {
    repairedCode: serializeHtml($, rawCode),
    appliedRepairs: applied,
  };
}

function serializeHtml($, rawCode) {
  if (/<(?:!doctype|html|head)(?:\s|>)/i.test(rawCode)) return $.html();
  if (/<body(?:\s|>)/i.test(rawCode)) return $("body").first().prop("outerHTML");
  return $("body").first().html() || "";
}

module.exports = {
  applyApprovedRepairs,
  getFindingId,
  getSafeRepairCandidates,
};
