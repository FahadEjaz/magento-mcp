import crypto from "node:crypto";
import OAuth from "oauth-1.0a";
import { config } from "../config.js";

// Must match config.magento.oauthSignatureMethod's algorithm — Magento
// rejects the request outright if the declared signature_method and the
// actual hash used to compute the signature disagree.
const NODE_HASH_ALGORITHM: Record<typeof config.magento.oauthSignatureMethod, "sha1" | "sha256"> = {
  "HMAC-SHA1": "sha1",
  "HMAC-SHA256": "sha256",
};

const oauth = new OAuth({
  consumer: { key: config.magento.consumerKey, secret: config.magento.consumerSecret },
  signature_method: config.magento.oauthSignatureMethod,
  hash_function(baseString, key) {
    return crypto.createHmac(NODE_HASH_ALGORITHM[config.magento.oauthSignatureMethod], key).update(baseString).digest("base64");
  },
});

const token = {
  key: config.magento.accessToken,
  secret: config.magento.accessTokenSecret,
};

/**
 * Builds the OAuth 1.0a Authorization header for a single request. Magento
 * integration tokens (unlike admin-user tokens) don't expire on a schedule —
 * there's no refresh/retry flow needed, just a fresh signature per request
 * since the signature is bound to the exact method+URL+timestamp+nonce.
 */
export function getOAuthHeader(url: string, method: string): Record<string, string> {
  return oauth.toHeader(oauth.authorize({ url, method }, token)) as unknown as Record<string, string>;
}
