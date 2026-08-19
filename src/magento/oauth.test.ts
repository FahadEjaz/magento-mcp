import { describe, expect, it } from "vitest";
import { getOAuthHeader } from "./oauth.js";

describe("getOAuthHeader", () => {
  it("produces a well-formed OAuth1 Authorization header", () => {
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
