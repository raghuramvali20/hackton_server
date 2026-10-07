const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 12000;

class SiteFetchError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "SiteFetchError";
    this.statusCode = statusCode;
  }
}

function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [first, second] = octets;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && octets[2] <= 2) ||
      (first === 192 && second === 88 && octets[2] === 99) ||
      (first === 192 && second === 168) ||
      (first === 198 &&
        (second === 18 || second === 19 ||
          (second === 51 && octets[2] === 100))) ||
      (first === 203 && second === 0 && octets[2] === 113)
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      (normalized.startsWith("2") || normalized.startsWith("3")) &&
      !normalized.startsWith("2001:db8:") &&
      !normalized.startsWith("2001:0000:") &&
      !normalized.includes("%")
    );
  }

  return false;
}

function getHostname(url) {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

function parseSiteUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new SiteFetchError("siteUrl must be a non-empty HTTP or HTTPS URL.");
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new SiteFetchError("Enter a valid website URL, including https://.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new SiteFetchError("Only HTTP and HTTPS website URLs are supported.");
  }
  if (url.username || url.password) {
    throw new SiteFetchError("Website URLs must not contain username or password credentials.");
  }
  if (
    url.port &&
    !((url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443"))
  ) {
    throw new SiteFetchError("Only standard HTTP and HTTPS ports are supported.");
  }
  const hostname = getHostname(url).toLowerCase();
  if (
    hostname.endsWith(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (net.isIP(hostname) && !isPublicAddress(hostname))
  ) {
    throw new SiteFetchError("Local and private network hostnames cannot be scanned.");
  }

  url.hash = "";
  return url;
}

async function resolvePublicAddress(hostname) {
  hostname = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SiteFetchError("The website hostname could not be resolved.", 422);
  }

  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new SiteFetchError("The website resolves to a private or reserved network address.");
  }

  return addresses[0];
}

function requestHtml(url, resolvedAddress) {
  const transport = url.protocol === "https:" ? https : http;
  const hostname = getHostname(url);

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "AccessPilot-A11y-Scanner/1.0",
      },
      lookup: createPinnedLookup(resolvedAddress),
      servername: net.isIP(hostname) ? undefined : hostname,
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      response.on("error", reject);
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.location;
        response.resume();
        resolve({ redirect: location || "" });
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new SiteFetchError(
          `The website responded with HTTP ${statusCode}.`,
          422
        ));
        return;
      }

      const contentType = String(response.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!["text/html", "application/xhtml+xml"].includes(contentType)) {
        response.resume();
        reject(new SiteFetchError("The URL did not return an HTML document.", 415));
        return;
      }
      const contentEncoding = String(response.headers["content-encoding"] || "identity")
        .toLowerCase();
      if (contentEncoding !== "identity") {
        response.resume();
        reject(new SiteFetchError("Compressed webpage responses are not supported.", 415));
        return;
      }

      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        response.destroy();
        reject(new SiteFetchError("The webpage is too large to scan (maximum 512 KB).", 413));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new SiteFetchError(
            "The webpage is too large to scan (maximum 512 KB).",
            413
          ));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          html: Buffer.concat(chunks).toString("utf8"),
          contentType,
        });
      });
    });

    const overallTimeout = setTimeout(() => {
      request.destroy(new SiteFetchError("Fetching the webpage timed out.", 504));
    }, REQUEST_TIMEOUT_MS);
    request.on("close", () => clearTimeout(overallTimeout));
    request.on("timeout", () => {
      request.destroy(new SiteFetchError("Fetching the webpage timed out.", 504));
    });
    request.on("error", reject);
    request.end();
  });
}

function createPinnedLookup(resolvedAddress) {
  const family = net.isIP(resolvedAddress.address);

  return (_hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    if (options?.all) {
      callback(null, [{
        address: resolvedAddress.address,
        family,
      }]);
      return;
    }

    callback(null, resolvedAddress.address, family);
  };
}

async function fetchSiteHtml(input) {
  let url = parseSiteUrl(input);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const resolvedAddress = await resolvePublicAddress(getHostname(url));
    const result = await requestHtml(url, resolvedAddress);

    if (!("redirect" in result)) {
      return {
        html: result.html,
        sourceUrl: `${url.origin}${url.pathname}`,
        contentType: result.contentType,
      };
    }

    if (!result.redirect) {
      throw new SiteFetchError("The website returned a redirect without a destination.", 422);
    }
    if (redirectCount === MAX_REDIRECTS) {
      throw new SiteFetchError("The website redirected too many times.", 422);
    }

    try {
      url = parseSiteUrl(new URL(result.redirect, url).toString());
    } catch (error) {
      if (error instanceof SiteFetchError) throw error;
      throw new SiteFetchError("The website returned an invalid redirect destination.", 422);
    }
  }

  throw new SiteFetchError("Unable to fetch the website HTML.", 422);
}

module.exports = {
  SiteFetchError,
  createPinnedLookup,
  fetchSiteHtml,
  getHostname,
  isPublicAddress,
  parseSiteUrl,
  resolvePublicAddress,
};
