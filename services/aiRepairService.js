
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

function extractJsonObject(text) {
  const source = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");

  if (start === -1) {
    throw new Error("Gemini response did not contain a JSON object.");
  }

  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }

    if (character === '"') {
      insideString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }

  throw new Error("Gemini response contained an incomplete JSON object.");
}

async function generateContextualFixes(intermediateCode) {
  if (typeof intermediateCode !== "string") {
    throw new TypeError("intermediateCode must be a string.");
  }

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
      const parsed = extractJsonObject(response.text);

      if (typeof parsed.repairedHtml !== "string") {
        throw new Error("Gemini JSON response is missing a string repairedHtml field.");
      }

      if (!Array.isArray(parsed.aiFixes)) {
        throw new Error("Gemini JSON response is missing an aiFixes array.");
      }

      const aiFixesLog = parsed.aiFixes
        .filter((fix) => fix && typeof fix.desc === "string" && fix.desc.trim())
        .map((fix) => `${fix.rule || "WCAG 1.1.1"}: ${fix.desc.trim()}`);

      return {
        finalRepairedCode: parsed.repairedHtml,
        aiFixesLog
      };
    }

    throw new Error("Gemini returned an empty response.");
  } catch (error) {
    console.error("Gemini AI Repair Error:", error.message);
    throw new Error(`Gemini AI repair failed: ${error.message}`, { cause: error });
  }
}

module.exports = {
  generateContextualFixes
};
