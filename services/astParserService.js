const cheerio = require("cheerio");

async function fixDeterministicRules(rawCode) {

    if (typeof rawCode !== "string") {
        throw new TypeError("rawCode must be a string.");
    }

    let intermediateCode = rawCode;
    const staticFixesLog = [];

    // Parse HTML with Cheerio
    const $ = cheerio.load(rawCode, {
        decodeEntities: false
    });

    // ==========================================
    // 1. Add missing alt attribute to images
    // ==========================================

    $("img").each((index, element) => {

        if ($(element).attr("alt") === undefined) {

            $(element).attr("alt", "");

            staticFixesLog.push(
                `Added missing alt attribute to image ${index + 1}.`
            );
        }
    });

    // ==========================================
    // 2. Add missing type="button" to buttons
    // ==========================================

    $("button").each((index, element) => {

        if ($(element).attr("type") === undefined) {

            $(element).attr("type", "button");

            staticFixesLog.push(
                `Added type="button" to button ${index + 1}.`
            );
        }
    });

    // ==========================================
    // 3. Add missing lang attribute to <html>
    // ==========================================

    $("html").each((index, element) => {

        if ($(element).attr("lang") === undefined) {

            $(element).attr("lang", "en");

            staticFixesLog.push(
                'Added lang="en" attribute to the html element.'
            );
        }
    });

    // Convert modified HTML back to string
    intermediateCode = $.html();

    return {
        intermediateCode,
        staticFixesLog,
    };
}

module.exports = {
    fixDeterministicRules,
};