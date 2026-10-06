
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

async function generateContextualFixes(intermediateCode) {
  if (typeof intermediateCode !== "string") {
    throw new TypeError("intermediateCode must be a string.");
  }

  let finalRepairedCode = intermediateCode;
  const aiFixesLog = [];

  try {
    const prompt = `
    You are an automated WCAG 2.1 AA accessibility repair engine.
    Analyze this HTML/JSX snippet and fix remaining accessibility issues:

    ${intermediateCode}

    Instructions:
    1. Fill any missing or empty 'alt' attributes on <img> tags with concise context-aware descriptions.
    2. Add necessary aria-label or aria-describedby attributes where context is missing.
    3. Return ONLY a JSON object with this exact key structure:
    {
      "repairedHtml": "fully repaired html string",
      "aiFixes": [
        { "rule": "WCAG code", "desc": "description of fix" }
      ]
    }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    if (response && response.text) {
      const parsed = JSON.parse(response.text);

      if (
        typeof parsed.repairedHtml === "string" &&
        parsed.repairedHtml.trim().length > 0
      ) {
        finalRepairedCode = parsed.repairedHtml;
      }

      if (Array.isArray(parsed.aiFixes)) {
        parsed.aiFixes.forEach((fix) => {
          if (fix && fix.desc) {
            aiFixesLog.push(
              `${fix.rule || "WCAG 1.1.1"}: ${fix.desc}`
            );
          }
        });
      }
    }
  } catch (error) {
    console.error("Gemini AI Repair Error:", error.message);

    aiFixesLog.push(
      "AI repair skipped because the Gemini response could not be used."
    );
  }

  return {
    finalRepairedCode,
    aiFixesLog
  };
}

module.exports = {
  generateContextualFixes
};
