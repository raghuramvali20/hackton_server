const { parse } = require("@babel/parser");

const MAX_SOURCE_BYTES = 100 * 1024;

const CHECK_CATALOG = [
  {
    id: "wcag-jsx-image-alt",
    criterion: "WCAG 1.1.1",
    title: "Image alternative text",
    detectionMethod: "Static JSX AST inspection",
    category: "static-source-check",
    repairPolicy: "User-approved alt attribute only",
    limitations: "Presence is checked; whether the text conveys the image's purpose requires human review.",
  },
  {
    id: "wcag-jsx-button-name",
    criterion: "WCAG 4.1.2",
    title: "Button accessible name",
    detectionMethod: "Static JSX AST inspection",
    category: "static-source-check",
    repairPolicy: "User-approved aria-label only",
    limitations: "Runtime children, props, and custom button components cannot be resolved.",
  },
  {
    id: "wcag-jsx-link-name",
    criterion: "WCAG 2.4.4",
    title: "Link accessible name",
    detectionMethod: "Static JSX AST inspection",
    category: "static-source-check",
    repairPolicy: "User-approved aria-label only",
    limitations: "Link purpose in surrounding context requires human review.",
  },
  {
    id: "wcag-jsx-form-control-name",
    criterion: "WCAG 1.3.1 / 4.1.2",
    title: "Form control label",
    detectionMethod: "Static JSX AST inspection of one source file",
    category: "partial-static-source-check",
    repairPolicy: "User-approved aria-label only",
    limitations: "Cross-file labels, dynamic ids, wrappers, and runtime associations cannot be resolved.",
  },
  {
    id: "wcag-document-language",
    criterion: "WCAG 3.1.1",
    title: "Document language",
    detectionMethod: "Not checked in component source",
    category: "not-implemented-for-jsx",
    repairPolicy: "No JSX repair",
    limitations: "Usually belongs in the HTML document shell, not an individual React component.",
  },
  {
    id: "wcag-color-contrast-review",
    criterion: "WCAG 1.4.3 / 1.4.11",
    title: "Text and non-text contrast",
    detectionMethod: "Requires rendered styles, states, and color measurement",
    category: "rendered-page/runtime-check",
    repairPolicy: "Not checked or repaired from one source file",
    limitations: "CSS, inherited styles, images, themes, and interactive states affect the result.",
  },
  {
    id: "wcag-keyboard-operability-review",
    criterion: "WCAG 2.1.1 / 2.4.7",
    title: "Keyboard operation and focus visibility",
    detectionMethod: "Requires running the application and keyboard interaction",
    category: "rendered-page/runtime-check",
    repairPolicy: "Not checked or repaired from one source file",
    limitations: "Runtime behavior, focus order, overlays, and styles are not available to this scanner.",
  },
  {
    id: "wcag-content-purpose-review",
    criterion: "WCAG 1.1.1 / 2.4.4",
    title: "Content and link purpose",
    detectionMethod: "Human review of content in its context",
    category: "human-review-required",
    repairPolicy: "Never guessed by the static source scanner",
    limitations: "Whether text accurately describes the visual or destination depends on author intent and context.",
  },
].map((check) => ({ wcagVersion: "2.2", ...check }));

const RULES = {
  img: {
    ruleId: "wcag-jsx-image-alt",
    criterion: "WCAG 1.1.1",
    attribute: "alt",
    message: "This native image has no statically verifiable alt text. Decide whether it is decorative or informative.",
  },
  button: {
    ruleId: "wcag-jsx-button-name",
    criterion: "WCAG 4.1.2",
    attribute: "aria-label",
    message: "This native button has no statically verifiable accessible name.",
  },
  a: {
    ruleId: "wcag-jsx-link-name",
    criterion: "WCAG 2.4.4",
    attribute: "aria-label",
    message: "This native link has no statically verifiable accessible name.",
  },
  input: {
    ruleId: "wcag-jsx-form-control-name",
    criterion: "WCAG 1.3.1 / 4.1.2",
    attribute: "aria-label",
    message: "No statically verifiable label or accessible name was found for this native form control.",
  },
  select: {
    ruleId: "wcag-jsx-form-control-name",
    criterion: "WCAG 1.3.1 / 4.1.2",
    attribute: "aria-label",
    message: "No statically verifiable label or accessible name was found for this native form control.",
  },
  textarea: {
    ruleId: "wcag-jsx-form-control-name",
    criterion: "WCAG 1.3.1 / 4.1.2",
    attribute: "aria-label",
    message: "No statically verifiable label or accessible name was found for this native form control.",
  },
};

function parseReactSource(sourceCode, fileName = "Component.jsx") {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) {
    throw new TypeError("React source must be a non-empty string.");
  }
  if (Buffer.byteLength(sourceCode, "utf8") > MAX_SOURCE_BYTES) {
    throw new RangeError("React source exceeds the 100 KB limit.");
  }
  if (!/\.(jsx|tsx)$/i.test(fileName)) {
    throw new TypeError("React source file name must end in .jsx or .tsx.");
  }

  try {
    return parse(sourceCode, {
      sourceType: "unambiguous",
      sourceFilename: fileName,
      plugins: ["jsx", ...(fileName.toLowerCase().endsWith(".tsx") ? ["typescript"] : [])],
      errorRecovery: false,
    });
  } catch (error) {
    const location = error.loc
      ? ` at line ${error.loc.line}, column ${error.loc.column + 1}`
      : "";
    const parseError = new SyntaxError(`Unable to parse ${fileName}${location}: ${error.message}`);
    parseError.statusCode = 422;
    parseError.code = "REACT_SOURCE_PARSE_FAILED";
    parseError.loc = error.loc || null;
    throw parseError;
  }
}

function scanReactSource(sourceCode, fileName = "Component.jsx") {
  const ast = parseReactSource(sourceCode, fileName);
  const elements = [];
  collectJsxElements(ast, [], elements);
  const labelsById = new Set();
  const labelIdsUnknown = new Set();

  for (const entry of elements) {
    const { node, ancestors } = entry;
    if (getTagName(node) !== "label") continue;
    const htmlFor = getAttribute(node, "htmlFor");
    const text = getStaticText(node.children || []);
    if (htmlFor?.kind === "string" && htmlFor.value.trim()) {
      if (text.kind === "dynamic") labelIdsUnknown.add(htmlFor.value);
      else if (text.value.trim()) labelsById.add(htmlFor.value);
    }
    if (htmlFor?.kind === "dynamic") labelIdsUnknown.add("*");
  }

  const findings = [];
  const uncertainChecks = new Set();
  let customComponentCount = 0;

  elements.forEach(({ node, ancestors, elementIndex }) => {
    const tagName = getTagName(node);
    if (!tagName) return;
    if (!isIntrinsicTag(tagName)) {
      if (isCustomTag(tagName)) customComponentCount += 1;
      return;
    }

    const rule = RULES[tagName];
    if (!rule) return;

    const verdict = evaluateElement({
      node,
      ancestors,
      tagName,
      rule,
      labelsById,
      labelIdsUnknown,
    });
    if (verdict === "pass") return;

    const status = "NEEDS_REVIEW";
    uncertainChecks.add(rule.ruleId);
    findings.push(makeFinding(
      node,
      elementIndex,
      tagName,
      rule,
      status,
      verdict,
      verdict !== "review"
    ));
  });

  if (customComponentCount > 0) {
    const firstCustom = elements.find(({ node }) => {
      const tag = getTagName(node);
      return tag && isCustomTag(tag);
    });
    findings.push(makeFinding(
      firstCustom.node,
      firstCustom.elementIndex,
      getTagName(firstCustom.node),
      {
        ruleId: "jsx-custom-component-review",
        criterion: "",
        attribute: "",
        message: `${customComponentCount} custom component${customComponentCount === 1 ? " was" : "s were"} not inspected; accessibility behavior may be defined elsewhere.`,
      },
      "NEEDS_REVIEW",
      "review",
      false
    ));
  }

  const findingsByRule = new Map();
  findings.forEach((finding) => {
    findingsByRule.set(finding.ruleId, (findingsByRule.get(finding.ruleId) || 0) + 1);
  });
  const checks = CHECK_CATALOG.map((check) => {
    if ([
      "not-implemented-for-jsx",
      "rendered-page/runtime-check",
      "human-review-required",
    ].includes(check.category)) {
      return { ...check, status: "NOT_CHECKED" };
    }
    if ((findingsByRule.get(check.id) || 0) > 0) {
      return {
        ...check,
        status: uncertainChecks.has(check.id) ? "NEEDS_REVIEW" : "FINDINGS",
      };
    }
    if (check.id === "wcag-jsx-form-control-name" && labelIdsUnknown.size > 0) {
      return { ...check, status: "NEEDS_REVIEW" };
    }
    if (customComponentCount > 0) {
      return { ...check, status: "NEEDS_REVIEW" };
    }
    return { ...check, status: "NO_PATTERN_DETECTED" };
  });

  return {
    findings,
    checks,
    sourceType: "react-jsx",
    sourceFileName: fileName,
    scope: "Static inspection of one JSX/TSX source file. No code was executed or rendered.",
    customComponentCount,
  };
}

function evaluateElement({ node, ancestors, tagName, rule, labelsById, labelIdsUnknown }) {
  const attributes = node.openingElement.attributes;
  if (attributes.some((attribute) => attribute.type === "JSXSpreadAttribute")) {
    return "review";
  }
  const hiddenState = getAttribute(node, "aria-hidden");
  if (hiddenState?.kind === "dynamic") return "review";
  if (
    getAttribute(node, "hidden") ||
    hiddenState?.value.toLowerCase() === "true" ||
    ancestors.some((ancestor) =>
      getAttribute(ancestor, "hidden") ||
      getAttribute(ancestor, "aria-hidden")?.value.toLowerCase() === "true"
    )
  ) {
    return "pass";
  }

  if (tagName === "a" && !getAttribute(node, "href")) return "pass";
  if (tagName === "input") {
    const type = getAttribute(node, "type");
    if (type?.kind === "dynamic") return "review";
    if (type?.value?.toLowerCase() === "hidden") return "pass";
  }

  if (tagName === "input" || tagName === "select" || tagName === "textarea") {
    const id = getAttribute(node, "id");
    const ariaLabel = getAttribute(node, "aria-label");
    const labelledBy = getAttribute(node, "aria-labelledby");
    if (ariaLabel?.kind === "string" && ariaLabel.value.trim()) return "pass";
    if (labelledBy || ariaLabel || id?.kind === "dynamic") return "review";
    if (id?.kind === "string" && labelsById.has(id.value)) return "pass";
    if (labelIdsUnknown.has("*") || (id?.kind === "string" && labelIdsUnknown.has(id.value))) {
      return "review";
    }
    for (const ancestor of ancestors) {
      if (getTagName(ancestor) !== "label") continue;
      const labelText = getStaticText(ancestor.children || []);
      if (labelText.kind === "dynamic") return "review";
      if (labelText.value.trim()) return "pass";
    }
    return "finding";
  }

  const attribute = getAttribute(node, rule.attribute);
  if (attribute?.kind === "dynamic") return "review";
  if (tagName === "img") {
    if (!attribute) return "finding";
    return attribute.value.trim() ? "pass" : "review";
  }

  const ariaLabel = getAttribute(node, "aria-label");
  if (ariaLabel?.kind === "dynamic") return "review";
  if (ariaLabel?.kind === "string" && ariaLabel.value.trim()) return "pass";
  if (ariaLabel || getAttribute(node, "aria-labelledby")) return "review";

  const childText = getStaticText(node.children || []);
  if (childText.kind === "dynamic") return "review";
  return childText.value.trim() ? "pass" : "finding";
}

function getStaticText(children) {
  let value = "";
  for (const child of children) {
    if (child.type === "JSXText") {
      value += child.value;
    } else if (child.type === "JSXExpressionContainer") {
      const expression = child.expression;
      if (expression.type === "StringLiteral") value += expression.value;
      else if (expression.type !== "JSXEmptyExpression") return { kind: "dynamic", value };
    } else if (child.type === "JSXElement" || child.type === "JSXFragment") {
      if (child.type === "JSXElement") {
        const hidden = getAttribute(child, "hidden");
        const ariaHidden = getAttribute(child, "aria-hidden");
        if (hidden || ariaHidden?.value.toLowerCase() === "true") continue;
        if (ariaHidden?.kind === "dynamic") return { kind: "dynamic", value };
        if (getTagName(child) === "img") {
          const alt = getAttribute(child, "alt");
          if (alt?.kind === "dynamic") return { kind: "dynamic", value };
          if (alt?.kind === "string") value += alt.value;
          continue;
        }
      }
      const nested = getStaticText(child.children || []);
      if (nested.kind === "dynamic") return nested;
      value += nested.value;
    }
  }
  return { kind: "string", value };
}

function getAttribute(node, name) {
  const attribute = node.openingElement.attributes.find(
    (item) => item.type === "JSXAttribute" &&
      item.name.type === "JSXIdentifier" &&
      item.name.name === name
  );
  if (!attribute) return null;
  if (!attribute.value) return { kind: "string", value: "" };
  if (attribute.value.type === "StringLiteral") {
    return { kind: "string", value: attribute.value.value };
  }
  if (attribute.value.type === "JSXExpressionContainer" &&
      attribute.value.expression.type === "StringLiteral") {
    return { kind: "string", value: attribute.value.expression.value };
  }
  return { kind: "dynamic", value: "" };
}

function makeFinding(node, elementIndex, tagName, rule, status, verdict, repairable = true) {
  const { line, column } = node.loc.start;
  return {
    findingId: `${rule.ruleId}:jsx:${elementIndex}`,
    ruleId: rule.ruleId,
    criterion: rule.criterion,
    severity: "moderate",
    message: rule.message,
    element: `<${tagName}>`,
    status,
    repairType: verdict === "review" ? "needs-review" : "user-approved",
    sourceLocation: {
      line,
      column: column + 1,
      start: node.start,
      end: node.end,
      openingEnd: node.openingElement.end,
      selfClosing: node.openingElement.selfClosing,
    },
    repairAttribute: repairable ? rule.attribute : "",
    repairable,
  };
}

function collectJsxElements(value, ancestors, result) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child) => collectJsxElements(child, ancestors, result));
    return;
  }
  if (value.type === "JSXElement") {
    const elementIndex = result.length;
    result.push({ node: value, ancestors, elementIndex });
    const nextAncestors = [...ancestors, value];
    for (const [key, child] of Object.entries(value)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
      collectJsxElements(child, nextAncestors, result);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
    collectJsxElements(child, ancestors, result);
  }
}

function getTagName(node) {
  const name = node.openingElement.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") {
    return `${getJsxIdentifierName(name.object)}.${getJsxIdentifierName(name.property)}`;
  }
  return "";
}

function getJsxIdentifierName(node) {
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") {
    return `${getJsxIdentifierName(node.object)}.${getJsxIdentifierName(node.property)}`;
  }
  return "";
}

function isIntrinsicTag(tagName) {
  return /^[a-z][a-z0-9]*$/.test(tagName);
}

function isCustomTag(tagName) {
  return /^[A-Z]/.test(tagName) || tagName.includes(".") || tagName.includes("-");
}

function applyApprovedReactRepairs(sourceCode, requestedRepairs, fileName = "Component.jsx") {
  if (!Array.isArray(requestedRepairs) || requestedRepairs.length > 100) {
    throw new TypeError("React repairs must be an array of at most 100 items.");
  }
  const scan = scanReactSource(sourceCode, fileName);
  const findingsById = new Map(scan.findings.map((finding) => [finding.findingId, finding]));
  const seen = new Set();
  const edits = [];

  for (const request of requestedRepairs) {
    if (!request || typeof request.findingId !== "string" ||
        typeof request.value !== "string" || request.value.length > 500 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(request.value) ||
        seen.has(request.findingId)) {
      throw new TypeError("A React repair has an invalid shape or is duplicated.");
    }
    const finding = findingsById.get(request.findingId);
    if (!finding || !finding.repairable || !finding.repairAttribute) {
      throw new Error("The React repair does not match a supported current finding.");
    }
    if (finding.status === "NEEDS_REVIEW" && request.repairType !== "user-approved") {
      throw new Error("A context-dependent React repair requires explicit user approval.");
    }
    if (finding.ruleId === "wcag-jsx-image-alt") {
      if (!request.value.trim() && request.imageIntent !== "decorative") {
        throw new Error("Choose decorative intent before applying empty alt text.");
      }
      if (request.value.trim() && request.imageIntent !== "informative") {
        throw new Error("Choose informative intent before applying image text.");
      }
    } else if (!request.value.trim()) {
      throw new Error("An accessible-name repair cannot be empty.");
    }
    const offset = finding.sourceLocation.selfClosing
      ? finding.sourceLocation.openingEnd - 2
      : finding.sourceLocation.openingEnd - 1;
    edits.push({
      offset,
      finding,
      attribute: finding.repairAttribute,
      value: request.value.trim(),
    });
    seen.add(request.findingId);
  }

  let repairedCode = sourceCode;
  for (const edit of edits.sort((left, right) => right.offset - left.offset)) {
    const separator = /\s$/.test(repairedCode.slice(0, edit.offset)) ? "" : " ";
    const closingSpace = edit.finding.sourceLocation.selfClosing ? " " : "";
    repairedCode = `${repairedCode.slice(0, edit.offset)}${separator}${edit.attribute}={${JSON.stringify(edit.value)}}${closingSpace}${repairedCode.slice(edit.offset)}`;
  }

  const after = scanReactSource(repairedCode, fileName);
  const afterIds = new Set(after.findings.map((finding) => finding.findingId));
  const appliedRepairs = edits.map(({ finding, attribute, value }) => ({
    findingId: finding.findingId,
    ruleId: finding.ruleId,
    criterion: finding.criterion,
    element: finding.element,
    attribute,
    value,
    description: `Added ${attribute} to ${finding.element} in the React source.`,
    repairType: "user-approved",
  }));
  return {
    repairedCode,
    appliedRepairs,
    findings: after.findings,
    checks: after.checks,
    resolvedFindingIds: edits
      .map(({ finding }) => finding.findingId)
      .filter((findingId) => !afterIds.has(findingId)),
  };
}

module.exports = {
  CHECK_CATALOG,
  MAX_SOURCE_BYTES,
  applyApprovedReactRepairs,
  parseReactSource,
  scanReactSource,
};
