import { afterEach, describe, expect, it, vi } from "vitest";
import { getOAuthHeader } from "./oauth.js";

describe("getOAuthHeader", () => {
  it("produces a well-formed OAuth1 Authorization header, defaulting to HMAC-SHA1", () => {
    const header = getOAuthHeader("https://example.test/rest/V1/products/ABC", "GET");

    expect(Object.keys(header)).toEqual(["Authorization"]);
    expect(header.Authorization).toMatch(/^OAuth /);
    expect(header.Authorization).toContain('oauth_consumer_key="');
    expect(header.Authorization).toContain('oauth_token="');
    expect(header.Authorization).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header.Authorization).toContain('oauth_signature="');
  });

  it("produces a different signature per call (nonce/timestamp vary)", () => {
    const first = getOAuthHeader("https://example.test/rest/V1/products/ABC", "GET");
    const second = getOAuthHeader("https://example.test/rest/V1/products/ABC", "GET");
    expect(first.Authorization).not.toBe(second.Authorization);
  });

  it("signs different methods/URLs differently", () => {
    const get = getOAuthHeader("https://example.test/rest/V1/products/ABC", "GET");
    const post = getOAuthHeader("https://example.test/rest/V1/products/ABC", "POST");
    expect(get.Authorization).not.toBe(post.Authorization);
  });
});

describe("getOAuthHeader with MAGENTO_OAUTH_SIGNATURE_METHOD=HMAC-SHA256 (isolated module state)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("declares HMAC-SHA256 AND actually signs with it (not just relabeled SHA1)", async () => {
    vi.resetModules();
    process.env.MAGENTO_OAUTH_SIGNATURE_METHOD = "HMAC-SHA256";

    const crypto = await import("node:crypto");
    const createHmacSpy = vi.spyOn(crypto.default, "createHmac");

    const { getOAuthHeader: freshGetOAuthHeader } = await import("./oauth.js");
    const header = freshGetOAuthHeader("https://example.test/rest/V1/store/websites", "GET");

    expect(header.Authorization).toContain('oauth_signature_method="HMAC-SHA256"');
    // The declared method and the actual signing algorithm must agree, or
    // Magento accepts the header shape but rejects the signature itself.
    expect(createHmacSpy).toHaveBeenCalledWith("sha256", expect.any(String));
    expect(createHmacSpy).not.toHaveBeenCalledWith("sha1", expect.any(String));

    createHmacSpy.mockRestore();
  });

  it("rejects an invalid MAGENTO_OAUTH_SIGNATURE_METHOD value at config load time", async () => {
    vi.resetModules();
    process.env.MAGENTO_OAUTH_SIGNATURE_METHOD = "HMAC-MD5";

    await expect(import("../config.js")).rejects.toThrow(/Invalid MAGENTO_OAUTH_SIGNATURE_METHOD/);
  });
});
