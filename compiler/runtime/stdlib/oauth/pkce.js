// scrml:oauth/pkce — runtime shim
//
// Hand-written ES module mirroring stdlib/oauth/pkce.scrml. PKCE (RFC 7636)
// helpers — proof key for code exchange. S256 method only ("plain" is unsafe
// and intentionally not implemented).
//
// Surface (must match stdlib/oauth/pkce.scrml exports):
//   - generateVerifier(length?)        → string (43-128 URL-safe chars)
//   - deriveChallenge(verifier)        → Promise<string> (base64url, no padding)
//   - PKCE_METHOD                      → "S256"

const VERIFIER_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function generateVerifier(length) {
  const len = length || 43;
  if (len < 43 || len > 128) {
    throw new Error(`[scrml:oauth/pkce] verifier length must be 43-128, got ${len}`);
  }
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const A = VERIFIER_ALPHABET;
  const alphaLen = A.length;
  let out = "";
  for (let i = 0; i < len; i++) {
    out += A[bytes[i] % alphaLen];
  }
  return out;
}

export async function deriveChallenge(verifier) {
  if (typeof verifier !== "string" || verifier.length < 43) {
    throw new Error(`[scrml:oauth/pkce] verifier must be a string of length >= 43`);
  }
  const enc = new TextEncoder();
  const data = enc.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return _base64UrlEncode(new Uint8Array(digest));
}

function _base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const PKCE_METHOD = "S256";
