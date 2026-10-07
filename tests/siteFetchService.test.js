const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SiteFetchError,
  fetchSiteHtml,
  isPublicAddress,
  parseSiteUrl,
  resolvePublicAddress,
} = require("../services/siteFetchService");

test("accepts public HTTP and HTTPS URLs on standard ports", () => {
  assert.equal(parseSiteUrl("https://example.com/path?preview=1").hostname, "example.com");
  assert.equal(parseSiteUrl("http://example.com:80").port, "");
  assert.equal(parseSiteUrl("https://example.com:443").port, "");
});

test("rejects unsupported protocols, credentials, and nonstandard ports", () => {
  for (const input of [
    "file:///etc/passwd",
    "ftp://example.com",
    "https://user:password@example.com",
    "http://example.com:8080",
    "https://example.com:80",
    "http://localhost",
    "http://printer.local",
    "http://[::1]/",
  ]) {
    assert.throws(() => parseSiteUrl(input), SiteFetchError, input);
  }
});

test("blocks private, reserved, and non-global addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.20.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.19.0.1",
    "203.0.113.10",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }

  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("rejects local-network resolution before making an HTTP request", async () => {
  await assert.rejects(
    resolvePublicAddress("127.0.0.1"),
    /private or reserved network address/
  );
  await assert.rejects(
    fetchSiteHtml("http://127.0.0.1/"),
    /Local and private network hostnames/
  );
});
