async function fixDeterministicRules(rawCode) {
  if (typeof rawCode !== "string") {
    throw new TypeError("rawCode must be a string.");
  }

  let intermediateCode = rawCode;
  const staticFixesLog = [];

  // TODO: Parse the HTML with Cheerio and apply deterministic accessibility fixes.
  // TODO: Append a description to staticFixesLog for each applied fix.

  return {
    intermediateCode,
    staticFixesLog,
  };
}

module.exports = {
  fixDeterministicRules,
};