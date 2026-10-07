const cheerio = require("cheerio");

const CHECKS = [
  {
    id: "wcag-document-language",
    criterion: "WCAG 3.1.1",
    title: "Document language",
  },
  {
    id: "wcag-image-alt",
    criterion: "WCAG 1.1.1",
    title: "Image alternative text",
  },
  {
    id: "wcag-button-name",
    criterion: "WCAG 4.1.2",
    title: "Button accessible name",
  },
  {
    id: "wcag-link-name",
    criterion: "WCAG 2.4.4",
    title: "Link accessible name",
  },
  {
    id: "wcag-form-control-name",
    criterion: "WCAG 1.3.1 / 4.1.2",
    title: "Form control label",
  },
];

function loadHtml(rawCode) {
  if (typeof rawCode !== "string") {
    throw new TypeError("HTML input must be a string.");
  }

  return cheerio.load(rawCode, { decodeEntities: false });
}

function hasAttributeValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHidden($, element) {
  return $(element).attr("aria-hidden")?.toLowerCase() === "true" ||
    $(element).attr("hidden") !== undefined;
}

function textOfReferencedIds($, value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => {
      let text = "";
      $("[id]").each((_index, element) => {
        if ($(element).attr("id") === id) {
          text = $(element).text().trim();
        }
      });
      return text;
    })
    .filter(Boolean)
    .join(" ");
}

function hasAccessibleName($, element) {
  const node = $(element);
  const ariaLabel = node.attr("aria-label");
  if (hasAttributeValue(ariaLabel)) return true;

  const labelledBy = textOfReferencedIds($, node.attr("aria-labelledby"));
  if (hasAttributeValue(labelledBy)) return true;

  const tagName = element.tagName.toLowerCase();
  if (tagName === "input") {
    const type = (node.attr("type") || "text").toLowerCase();
    if (["button", "submit", "reset"].includes(type) &&
        hasAttributeValue(node.attr("value"))) {
      return true;
    }
  }

  if (["button", "a"].includes(tagName)) {
    const visibleNode = node.clone();
    visibleNode.find('[aria-hidden="true"], [hidden], script, style').remove();
    const visibleText = visibleNode.text().trim();
    if (hasAttributeValue(visibleText)) return true;
  }

  if (tagName === "button" || tagName === "a") {
    let namedImage = false;
    node.find("img[alt]:not([aria-hidden='true'])").each((_index, image) => {
      if (hasAttributeValue($(image).attr("alt"))) namedImage = true;
    });
    if (namedImage) return true;
  }

  return false;
}

function hasAssociatedLabel($, element) {
  const node = $(element);
  const id = node.attr("id");
  let associated = false;

  if (id) {
    $("label[for]").each((_index, label) => {
      if ($(label).attr("for") === id && hasAttributeValue($(label).text())) {
        associated = true;
      }
    });
  }

  if (node.parents("label").toArray().some((label) =>
    hasAttributeValue($(label).text()))) {
    associated = true;
  }

  return associated || hasAccessibleName($, element);
}

function describeElement($, element) {
  const node = $(element);
  const id = node.attr("id");
  if (id) return `${element.tagName.toLowerCase()}#${id}`;

  const segments = [];
  let current = element;

  while (current && current.type === "tag" && current.tagName !== "html") {
    const tagName = current.tagName.toLowerCase();
    const parent = $(current).parent();
    const siblings = parent.children(tagName).toArray();
    const position = siblings.indexOf(current) + 1;
    segments.unshift(`${tagName}:nth-of-type(${position || 1})`);
    current = parent.get(0);
  }

  return segments.join(" > ");
}

function getElementPath($, element) {
  const path = [];
  let current = element;

  while (current && current.type !== "root") {
    const parent = current.parent;
    if (!parent) break;
    path.unshift(parent.children.indexOf(current));
    current = parent;
  }

  return path;
}

function createFinding($, element, ruleId, criterion, severity, message) {
  return {
    ruleId,
    criterion,
    severity,
    message,
    element: describeElement($, element),
    elementPath: getElementPath($, element),
    status: ["wcag-document-language", "wcag-image-alt"].includes(ruleId)
      ? "NEEDS_REVIEW"
      : "REMAINS",
    repairType: "suggested",
  };
}

function inspectHtml(rawCode) {
  const $ = loadHtml(rawCode);
  const findings = [];
  const checks = CHECKS.map((check) => ({ ...check, status: "PASSED" }));
  const checkMap = new Map(checks.map((check) => [check.id, check]));
  const explicitDocument = /<html(?:\s|>)/i.test(rawCode);

  if (explicitDocument) {
    const html = $("html").first();
    if (!hasAttributeValue(html.attr("lang"))) {
      findings.push(createFinding(
        $,
        html.get(0),
        "wcag-document-language",
        "WCAG 3.1.1",
        "moderate",
        "The document language is missing or empty; the correct language must be supplied by the author."
      ));
    }
  } else {
    checkMap.get("wcag-document-language").status = "NOT_APPLICABLE";
  }

  $("img").each((_index, element) => {
    const node = $(element);
    if (isHidden($, element) || node.attr("alt") !== undefined) return;

    findings.push(createFinding(
      $,
      element,
      "wcag-image-alt",
      "WCAG 1.1.1",
      "serious",
      "Alternative text is missing. The author must decide whether this image is informative or decorative."
    ));
  });

  $("button").each((_index, element) => {
    if (isHidden($, element) || hasAccessibleName($, element)) return;

    findings.push(createFinding(
      $,
      element,
      "wcag-button-name",
      "WCAG 4.1.2",
      "serious",
      "This button has no detectable accessible name; provide text or an appropriate accessible label."
    ));
  });

  $('a[href]').each((_index, element) => {
    if (isHidden($, element) || hasAccessibleName($, element)) return;

    findings.push(createFinding(
      $,
      element,
      "wcag-link-name",
      "WCAG 2.4.4",
      "serious",
      "This link has no detectable accessible name; provide descriptive link text or an appropriate accessible label."
    ));
  });

  $("input, select, textarea").each((_index, element) => {
    const node = $(element);
    const type = (node.attr("type") || "text").toLowerCase();
    if (
      type === "hidden" ||
      isHidden($, element) ||
      hasAssociatedLabel($, element)
    ) return;

    findings.push(createFinding(
      $,
      element,
      "wcag-form-control-name",
      "WCAG 1.3.1 / 4.1.2",
      "serious",
      "No associated label or detectable accessible name was found for this form control."
    ));
  });

  findings.forEach((finding) => {
    const check = checkMap.get(finding.ruleId);
    if (check) check.status = finding.status;
  });

  return { findings, checks };
}

function scanHtml(rawCode) {
  return inspectHtml(rawCode);
}

async function fixDeterministicRules(rawCode) {
  if (typeof rawCode !== "string") {
    throw new TypeError("rawCode must be a string.");
  }

  const $ = loadHtml(rawCode);
  const staticFixesLog = [];

  $("img").each((_index, element) => {
    const node = $(element);
    const role = (node.attr("role") || "").toLowerCase();
    const explicitlyDecorative =
      role === "presentation" ||
      role === "none";

    if (explicitlyDecorative && node.attr("alt") === undefined) {
      node.attr("alt", "");
      staticFixesLog.push({
        ruleId: "wcag-image-alt",
        criterion: "WCAG 1.1.1",
        element: describeElement($, element),
        description: "Added empty alternative text to an image explicitly marked decorative.",
        repairType: "automatic",
      });
    }
  });

  const isCompleteDocument = /<html(?:\s|>)/i.test(rawCode);
  const intermediateCode = staticFixesLog.length > 0
    ? isCompleteDocument
      ? $.html()
      : /<body(?:\s|>)/i.test(rawCode)
        ? $.html($("body").first())
        : $.html($("body").contents())
    : rawCode;

  return {
    intermediateCode,
    staticFixesLog,
    findingsBefore: scanHtml(rawCode).findings,
  };
}

module.exports = {
  CHECKS,
  fixDeterministicRules,
  scanHtml,
};
