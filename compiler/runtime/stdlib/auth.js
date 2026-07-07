// scrml:auth — runtime shim
//
// Hand-written ES module that mirrors the semantics declared in
// stdlib/auth/index.scrml + ./jwt.scrml + ./password.scrml.
// Used by the compiler's stdlib bundler to make `import { ... } from "scrml:auth"`
// resolvable at runtime.
//
// This shim replaces the would-be compiled output of stdlib/auth/*.scrml
// because those source files contain `server {}` blocks that the standard
// compile pipeline cannot lower at TS time today (separate M16 gap).
//
// Surface (must match stdlib/auth re-exports):
//   - hashPassword(password)                  → Promise<string>          [server-only]
//   - verifyPassword(password, hash)          → Promise<boolean>         [server-only]
//   - generatePassword(length, options)       → string                   [pure]
//   - signJwt(payload, secret, expiresIn)     → Promise<string>          [server/browser]
//   - verifyJwt(token, secret)                → Promise<{valid,payload?,reason?}>
//   - verifyJwtJwks(token, jwksUrl, opts)     → Promise<{valid,payload?,reason?}> [RS256/JWKS]
//   - decodeJwt(token)                        → object|null              [pure]
//   - createRateLimiter(options)              → { check, reset, peek }   [pure in-memory]
//   - generateTotpSecret(options)             → { secret, otpauthUrl }
//   - verifyTotp(code, secret)                → Promise<boolean>
//   - requestMagicLink / verifyMagicLink            (flows.scrml)        [server-only]
//   - requestEmailVerification / verifyEmail        (flows.scrml)        [server-only]
//   - requestPasswordReset / verifyResetToken       (flows.scrml)        [server-only]
//   - resetPassword(token, newPassword, opts)       (flows.scrml)        [server-only]
//
// Functions marked `server-only` use Bun-only APIs (Bun.password.*) and will
// throw when called in a browser context. The dispatch app's existing role
// inference (RI) routes them to server functions only — see SPEC §41.

// ---------------------------------------------------------------------------
// password.scrml — Argon2id hash + verify, random password generation
// ---------------------------------------------------------------------------

// auth.js's arithmetic routes through scrml:math and its wall-clock reads
// through scrml:time — the single sanctioned touches of the host arithmetic
// and clock surfaces (closes the stdlib-ouroboros). Both `max` and `now` are
// ALIASED (mathMax / clockNow) because createRateLimiter has LOCAL `max` and
// `now` variables that would otherwise shadow the imports. The clock routing
// (scrml:time now()) was the deliberate S177-deferred follow-on to the Math
// de-leak; completed S179 across auth.js, oauth.js, and store.js.
import { floor, max as mathMax } from "./math.js";
import { now as clockNow } from "./time.js";
import { get as httpGet } from "./http.js";
import { generateToken } from "./crypto.js";

export async function hashPassword(password) {
  // Argon2id via Bun.password (server-only). Mirrors stdlib/auth/password.scrml
  // line 25-29.
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password, hash) {
  // Constant-time verify. Mirrors stdlib/auth/password.scrml line 44-52.
  try {
    return await Bun.password.verify(password, hash);
  } catch (e) {
    return false;
  }
}

export function generatePassword(length, options) {
  // Mirrors stdlib/auth/password.scrml line 66-86. Pure, browser-safe.
  const len = length || 16;
  const opts = options || {};
  const useUppercase = opts.uppercase !== false;
  const useNumbers = opts.numbers !== false;
  const useSymbols = opts.symbols !== false;

  let chars = "abcdefghijklmnopqrstuvwxyz";
  if (useUppercase) chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (useNumbers) chars += "0123456789";
  if (useSymbols) chars += "!@#$%^&*()-_=+[]{}|;:,.<>?";

  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);

  let result = "";
  for (const b of bytes) {
    result += chars[b % chars.length];
  }
  return result;
}

// ---------------------------------------------------------------------------
// jwt.scrml — HS256 JWT sign + verify + decode
// ---------------------------------------------------------------------------

function _base64urlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function _base64urlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signJwt(payload, secret, expiresIn) {
  const now = floor(clockNow() / 1000);
  const exp = now + (expiresIn !== undefined && expiresIn !== null ? expiresIn : 3600);
  const header = { alg: "HS256", typ: "JWT" };
  const claims = { ...payload, iat: now, exp };
  const headerStr = _base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadStr = _base64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${headerStr}.${payloadStr}`;
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(signingInput)
  );
  const signatureStr = _base64urlEncode(signatureBuffer);
  return `${signingInput}.${signatureStr}`;
}

export async function verifyJwt(token, secret) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed" };
  }
  const [headerStr, payloadStr, signatureStr] = parts;
  const signingInput = `${headerStr}.${payloadStr}`;

  let payload;
  try {
    const bytes = _base64urlDecode(payloadStr);
    const json = new TextDecoder().decode(bytes);
    payload = JSON.parse(json);
  } catch (e) {
    return { valid: false, reason: "malformed" };
  }

  // Check expiry first (before signature) so expired tokens get the right reason
  if (payload.exp && payload.exp < floor(clockNow() / 1000)) {
    return { valid: false, reason: "expired" };
  }

  // Verify HMAC
  try {
    const keyData = new TextEncoder().encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const signature = _base64urlDecode(signatureStr);
    const ok = await crypto.subtle.verify(
      "HMAC", cryptoKey, signature, new TextEncoder().encode(signingInput)
    );
    if (!ok) return { valid: false, reason: "invalid" };
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: "invalid" };
  }
}

export function decodeJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const bytes = _base64urlDecode(parts[1]);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// index.scrml — rate limiter (in-memory) and TOTP (RFC 6238)
// ---------------------------------------------------------------------------

export function createRateLimiter(options) {
  // Mirrors stdlib/auth/index.scrml line 40-87. In-memory, non-persistent.
  const windowMs = (options && options.windowMs) || 15 * 60 * 1000;
  const max = (options && options.max) || 10;
  const store = new Map();

  return {
    check(key) {
      const now = clockNow();
      let entry = store.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        store.set(key, entry);
      }
      entry.count++;
      const allowed = entry.count <= max;
      const remaining = mathMax(0, max - entry.count);
      return { allowed, remaining, resetAt: entry.resetAt };
    },
    reset(key) {
      store.delete(key);
    },
    peek(key) {
      const now = clockNow();
      const entry = store.get(key);
      if (!entry || entry.resetAt <= now) {
        return { count: 0, remaining: max, resetAt: now + windowMs };
      }
      return {
        count: entry.count,
        remaining: mathMax(0, max - entry.count),
        resetAt: entry.resetAt,
      };
    },
  };
}

export function generateTotpSecret(options) {
  // Mirrors stdlib/auth/index.scrml line 106-132.
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);

  const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  let buffer = 0;
  let bitsLeft = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      secret += BASE32[(buffer >> bitsLeft) & 31];
    }
  }
  if (bitsLeft > 0) secret += BASE32[(buffer << (5 - bitsLeft)) & 31];

  const issuer = (options && options.issuer) || "scrml";
  const account = (options && options.account) || "user";
  const otpauthUrl =
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

  return { secret, otpauthUrl };
}

export async function verifyTotp(code, secret) {
  // Mirrors stdlib/auth/index.scrml line 148-161 + 167-210.
  const now = floor(clockNow() / 1000);
  const timeStep = 30;
  const counter = floor(now / timeStep);

  for (const offset of [-1, 0, 1]) {
    const expected = await _hotpGenerate(secret, counter + offset);
    if (expected === code) return true;
  }
  return false;
}

async function _hotpGenerate(base32Secret, counter) {
  const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.toUpperCase()) {
    const idx = BASE32.indexOf(char);
    if (idx >= 0) bits += idx.toString(2).padStart(5, "0");
  }
  const keyBytes = new Uint8Array(floor(bits.length / 8));
  for (let i = 0; i < keyBytes.length; i++) {
    keyBytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }

  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  view.setUint32(0, 0, false);
  view.setUint32(4, counter >>> 0, false);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const hmacBuffer = await crypto.subtle.sign("HMAC", cryptoKey, counterBuffer);
  const hmac = new Uint8Array(hmacBuffer);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;

  return code.toString().padStart(6, "0");
}

// ---------------------------------------------------------------------------
// jwt.scrml — RS256 / JWKS verification (verifyJwtJwks)
// ---------------------------------------------------------------------------
//
// Verify a JWT against a remote JWKS (JSON Web Key Set), pinned to RS256.
// Mirrors stdlib/auth/jwt.scrml verifyJwtJwks.
//
// SECURITY — the algorithm is HARD-PINNED to RS256. We read the token
// header's `alg` and reject anything that is not exactly "RS256" BEFORE any
// key lookup or signature check. This is the single most important defense
// against the JWKS alg-confusion family:
//   - alg:"none"  — an unsigned token; rejected (never trusted).
//   - alg:"HS256" — an attacker re-signs the token with the RSA *public* key
//                   as an HMAC secret; because the public key is public, an
//                   HS256 verify against it would succeed. We NEVER dispatch
//                   verification off the token's own alg, so this can never
//                   reach an HMAC path.
// Allowed-alg is fixed to RS256 for v1 (ES256/PS256 are a follow-on).

// Module-level in-shim JWKS cache: url -> { jwks, expiresAt }. Used when the
// caller does NOT inject opts.cache. Keyed by jwksUrl; TTL-checked on read.
const _jwksCache = new Map();

// Default JWKS fetcher: GET the url and return the parsed key set. Overridable
// via opts.fetchJwks for custom transport (auth headers) or testing.
async function _defaultFetchJwks(url) {
  const resp = await httpGet(url);
  if (!resp || !resp.ok) {
    throw new Error(
      `[scrml:auth] JWKS fetch failed (${resp ? resp.status : "no response"}): ${url}`
    );
  }
  // http.get parses application/json into resp.data; tolerate a string body too.
  return typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
}

// Cache accessor: an injected scrml:store handle (opts.cache) OR the in-shim
// Map. Both read null when absent/expired and refetch is driven by the caller.
function _jwksCacheAccessor(opts) {
  const ttlSec =
    opts.ttl !== undefined && opts.ttl !== null ? opts.ttl : 3600;
  if (opts.cache) {
    // Injected scrml:store handle — get() returns null when absent/expired.
    return {
      read: (url) => opts.cache.get(url) || null,
      write: (url, jwks) => opts.cache.set(url, jwks, ttlSec),
    };
  }
  return {
    read: (url) => {
      const entry = _jwksCache.get(url);
      if (!entry) return null;
      if (entry.expiresAt <= clockNow()) {
        _jwksCache.delete(url);
        return null;
      }
      return entry.jwks;
    },
    write: (url, jwks) => {
      _jwksCache.set(url, { jwks, expiresAt: clockNow() + ttlSec * 1000 });
    },
  };
}

function _isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// A JWKS is only usable (and cacheable) when it actually carries keys — never
// cache an empty / failed keyset, or a transient miss poisons the cache for the
// full TTL (no-kid RS256 verifies then fail for up to an hour).
function _hasKeys(jwks) {
  return !!(jwks && Array.isArray(jwks.keys) && jwks.keys.length > 0);
}

// Decode header + payload + signing input + signature. Returns null on any
// structural / base64 / JSON failure (a malformed token is never "valid").
function _decodeJwtParts(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(
      new TextDecoder().decode(_base64urlDecode(parts[0]))
    );
    const payload = JSON.parse(
      new TextDecoder().decode(_base64urlDecode(parts[1]))
    );
    // JSON.parse("null") / a JSON array or primitive does NOT throw — a header
    // or payload that is not a plain object is malformed. Fail closed here so
    // header.alg / payload.exp field access downstream never dereferences null.
    if (!_isPlainObject(header) || !_isPlainObject(payload)) return null;
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: parts[2],
    };
  } catch (e) {
    return null;
  }
}

// Select the JWK to verify against:
//   - kid present  → exact kid match (a JWKS must not repeat a kid).
//   - no kid + exactly one key → use it.
//   - no kid + zero or many keys → ambiguous → null.
function _selectJwk(jwks, kid) {
  const keys = jwks && Array.isArray(jwks.keys) ? jwks.keys : [];
  if (kid !== undefined && kid !== null && kid !== "") {
    return keys.find((k) => k.kid === kid) || null;
  }
  if (keys.length === 1) return keys[0];
  return null;
}

function _audienceMatches(aud, expected) {
  const audList = Array.isArray(aud) ? aud : [aud];
  const wantList = Array.isArray(expected) ? expected : [expected];
  return wantList.some((w) => audList.includes(w));
}

// Coerce a JWT NumericDate claim (exp/nbf) to a finite number, or NaN if it is
// not a usable number. A numeric string like "1700000000" coerces; "abc" / "" /
// booleans / objects → NaN (the caller fail-closes on NaN). This blocks the
// string-typed-exp bypass where `now > exp + tol` silently becomes NaN → false.
function _numericClaim(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

// Resolve a flow TTL (seconds): the default when absent, else a finite
// non-negative number. A non-numeric ttl (e.g. "15m") would make the stored
// expiresAt (clockNow() + ttl * 1000) NaN — a never-expiring token — so reject
// it loudly at mint time rather than storing a bad expiresAt.
function _resolveTtlSeconds(ttl, defaultTtl) {
  if (ttl === undefined || ttl === null) return defaultTtl;
  const n = _numericClaim(ttl);
  if (!Number.isFinite(n) || n < 0) {
    throw new TypeError(
      `[scrml:auth] ttl must be a non-negative number of seconds, got ${JSON.stringify(ttl)}`
    );
  }
  return n;
}

// Map a JWKS-fetch throw to a graceful reason (verifyJwtJwks never crashes).
// ONLY the DEFAULT http.get path's known client-inline gap (the inliner copies
// http.js's exported `get` but not its private `_request` helper → ReferenceError)
// degrades to "jwks-fetch-unavailable". An error from a caller-INJECTED
// opts.fetchJwks surfaces as "jwks-fetch-failed" so a genuine bug in the injected
// fetch is NOT masked. (The client-inline gap is a GENERAL http.js issue, not
// auth-specific; a real cross-origin JWKS check should inject opts.fetchJwks or
// run server-side.)
function _fetchFailureReason(e, usedDefaultFetch) {
  if (usedDefaultFetch && e instanceof ReferenceError) {
    return "jwks-fetch-unavailable";
  }
  return "jwks-fetch-failed";
}

export async function verifyJwtJwks(token, jwksUrl, options) {
  const opts = options || {};
  const clockTolerance =
    opts.clockToleranceSec !== undefined && opts.clockToleranceSec !== null
      ? opts.clockToleranceSec
      : 60;
  const usedDefaultFetch = typeof opts.fetchJwks !== "function";
  const fetchJwks = opts.fetchJwks || _defaultFetchJwks;

  // 1. Structural decode (header + payload). Malformed → reject.
  const decoded = _decodeJwtParts(token);
  if (!decoded) return { valid: false, reason: "malformed" };
  const { header, payload, signingInput, signature } = decoded;

  // 2. Alg-pin — RS256 ONLY. Blocks alg:none + alg:HS256-with-pubkey. Checked
  //    BEFORE any key lookup or crypto so a confused alg never reaches a
  //    signature path.
  if (header.alg !== "RS256") {
    return { valid: false, reason: "alg-not-allowed" };
  }

  // 3. Resolve the signing JWK (by kid), refetching once on kid-miss to
  //    tolerate key rotation.
  const cache = _jwksCacheAccessor(opts);
  let jwks = cache.read(jwksUrl);
  let freshlyFetched = false;
  if (!jwks) {
    try {
      jwks = await fetchJwks(jwksUrl);
    } catch (e) {
      return { valid: false, reason: _fetchFailureReason(e, usedDefaultFetch) };
    }
    if (_hasKeys(jwks)) cache.write(jwksUrl, jwks);
    freshlyFetched = true;
  }
  let jwk = _selectJwk(jwks, header.kid);
  if (!jwk && header.kid && !freshlyFetched) {
    // kid-miss on a cached set → the signer may have rotated keys. Refetch once.
    try {
      jwks = await fetchJwks(jwksUrl);
    } catch (e) {
      return { valid: false, reason: _fetchFailureReason(e, usedDefaultFetch) };
    }
    if (_hasKeys(jwks)) cache.write(jwksUrl, jwks);
    jwk = _selectJwk(jwks, header.kid);
  }
  if (!jwk) {
    // No kid + multiple keys is the ambiguous case; name it for callers.
    const many = jwks && Array.isArray(jwks.keys) && jwks.keys.length > 1;
    return {
      valid: false,
      reason: header.kid || !many ? "key-not-found" : "kid-ambiguous",
    };
  }

  // 4. Verify the RS256 signature. crypto.subtle throws on a malformed JWK or
  //    a bad signature encoding — a throw is an invalid signature, never valid.
  let ok;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      _base64urlDecode(signature),
      new TextEncoder().encode(signingInput)
    );
  } catch (e) {
    return { valid: false, reason: "invalid" };
  }
  if (!ok) return { valid: false, reason: "invalid" };

  // 5. Claim validation — only AFTER the signature is proven authentic.
  //    exp / nbf are coerced to Number: a string-typed exp otherwise makes
  //    `now > exp + tol` evaluate NaN → false (an expiry bypass). A non-numeric
  //    exp / nbf is REJECTED (fail-closed) rather than trusted.
  const now = floor(clockNow() / 1000);
  if (payload.exp !== undefined && payload.exp !== null) {
    const expN = _numericClaim(payload.exp);
    if (!Number.isFinite(expN)) return { valid: false, reason: "invalid" };
    if (now > expN + clockTolerance) return { valid: false, reason: "expired" };
  }
  if (payload.nbf !== undefined && payload.nbf !== null) {
    const nbfN = _numericClaim(payload.nbf);
    if (!Number.isFinite(nbfN)) return { valid: false, reason: "invalid" };
    if (now < nbfN - clockTolerance) return { valid: false, reason: "not-yet-valid" };
  }
  if (
    opts.issuer !== undefined &&
    opts.issuer !== null &&
    payload.iss !== opts.issuer
  ) {
    return { valid: false, reason: "issuer-mismatch" };
  }
  if (
    opts.audience !== undefined &&
    opts.audience !== null &&
    !_audienceMatches(payload.aud, opts.audience)
  ) {
    return { valid: false, reason: "audience-mismatch" };
  }

  return { valid: true, payload };
}

// ---------------------------------------------------------------------------
// flows.scrml — magic-link / email-verify / password-reset (request/verify)
// ---------------------------------------------------------------------------
//
// Each flow is a request*/verify* pair over: a high-entropy token
// (generateToken(32) = 256 bits), a caller-supplied TTL store (a scrml:store
// handle with get/set/delete), and a caller-INJECTED sendEmail. Mirrors
// stdlib/auth/flows.scrml.
//
// SECURITY properties (each a non-negotiable acceptance criterion):
//   - Single-use: verify* peeks then deletes; a consumed token is gone. A
//     second verify → { valid:false, reason:"used-or-invalid" }.
//   - Purpose-binding (defense-in-depth): the stored record carries a `purpose`
//     and each verify* passes its EXPECTED purpose. A token minted for another
//     flow is rejected on purpose-mismatch EVEN IF the caller (mis)wired one
//     store for several flows — namespaces are the first line, the purpose
//     check is the backstop. A cross-purpose token is rejected WITHOUT being
//     consumed, so it stays usable for its own flow.
//   - Enumeration resistance: request* returns a NEUTRAL result ({ ok:true })
//     regardless of whether the address maps to a real account, NEVER returns
//     the token (it travels only via the injected email), and a sendEmail
//     failure does NOT change the neutral result (else it is an existence
//     oracle).
//   - TTL: the request embeds an authoritative expiresAt; verify* rejects an
//     expired record fail-closed. NOTE: with the default SQLite store (store
//     TTL == logical ttl) an expired row is lazily removed and reads as
//     "used-or-invalid"; the distinct "expired" reason surfaces when the store
//     still returns a logically-expired record (in-memory / longer-TTL store).

const _NEUTRAL_REQUEST = Object.freeze({ ok: true });

const _FLOW_SUBJECTS = Object.freeze({
  "magic-link": "Your sign-in link",
  "email-verify": "Verify your email address",
  pwreset: "Reset your password",
});

async function _requestTokenFlow(email, options, purpose, defaultTtl) {
  const opts = options || {};
  const store = opts.store;
  const sendEmail = opts.sendEmail;
  const baseUrl = opts.baseUrl || "";
  const ttl = _resolveTtlSeconds(opts.ttl, defaultTtl);

  const token = generateToken(32);
  const record = { email, purpose, expiresAt: clockNow() + ttl * 1000 };
  if (store) store.set(token, record, ttl);

  const link = `${baseUrl}?token=${token}`;
  if (typeof sendEmail === "function") {
    // Enumeration resistance: a send failure (e.g. an SMTP 550 for an unknown
    // recipient) MUST NOT change the neutral result, or request* becomes an
    // account-existence oracle. Await for back-pressure but swallow the outcome
    // (a real deployment logs it out-of-band).
    try {
      await sendEmail(email, { subject: _FLOW_SUBJECTS[purpose], link, token });
    } catch (_e) {
      /* swallow — the result is neutral regardless of send success */
    }
  }
  // Neutral — never leak the token or the account's existence to the caller.
  return _NEUTRAL_REQUEST;
}

// _peekTokenFlow — validate a token WITHOUT consuming it: found + right purpose
// + not expired. `expectedPurpose` is the defense-in-depth check ON TOP of the
// per-flow store namespace. A wrong-purpose or not-found token is rejected and
// left intact (a cross-submitted token stays usable for its own flow).
function _peekTokenFlow(token, options, expectedPurpose) {
  const opts = options || {};
  const store = opts.store;
  if (!store || !token) return { valid: false, reason: "used-or-invalid" };

  const record = store.get(token);
  if (!record) return { valid: false, reason: "used-or-invalid" };

  if (expectedPurpose !== undefined && record.purpose !== expectedPurpose) {
    return { valid: false, reason: "used-or-invalid" };
  }

  const exp = _numericClaim(record.expiresAt);
  if (!Number.isFinite(exp) || exp <= clockNow()) {
    // Fail-closed: a missing / non-numeric expiresAt is treated as expired
    // (mirrors the JWKS exp path), never accepted as a never-expiring token.
    return { valid: false, reason: "expired" };
  }
  return { valid: true, email: record.email };
}

// _verifyTokenFlow — single-use verify: peek + consume. The token is deleted
// only when it was FOUND for the right purpose (valid OR expired) — a spent /
// expired attempt burns it; a not-found or wrong-purpose token is left intact.
function _verifyTokenFlow(token, options, expectedPurpose) {
  const result = _peekTokenFlow(token, options, expectedPurpose);
  if (result.valid || result.reason === "expired") {
    const store = (options || {}).store;
    if (store && token) store.delete(token);
  }
  return result;
}

export function requestMagicLink(email, options) {
  return _requestTokenFlow(email, options, "magic-link", 900);
}
export function verifyMagicLink(token, options) {
  return _verifyTokenFlow(token, options, "magic-link");
}

export function requestEmailVerification(email, options) {
  return _requestTokenFlow(email, options, "email-verify", 86400);
}
export function verifyEmail(token, options) {
  return _verifyTokenFlow(token, options, "email-verify");
}

export function requestPasswordReset(email, options) {
  return _requestTokenFlow(email, options, "pwreset", 3600);
}
export function verifyResetToken(token, options) {
  return _verifyTokenFlow(token, options, "pwreset");
}

// resetPassword — compose verify + hashPassword + an injected updateHash. The
// ordering closes BOTH the caller-lockout AND the TOCTOU race:
//   A. validate updateHash presence — SYNC, no token risk (a caller
//      misconfiguration must not burn the token).
//   B. consume the token ATOMICALLY via _verifyTokenFlow (sync get-then-delete,
//      no await between get and delete → race-free single-use: of two concurrent
//      calls the first wins, the second sees not-found).
//   C. hash + persist. The token is already consumed; a transient throw here
//      burns it (acceptable — no reuse; the user re-requests).
export async function resetPassword(token, newPassword, options) {
  const opts = options || {};

  // A — updateHash presence (no token touched yet → retryable on misconfig).
  const updateHash = opts.updateHash;
  if (typeof updateHash !== "function") {
    return { valid: false, reason: "no-update-hash" };
  }

  // B — atomic single-use consume (existence + expiry + purpose + delete).
  const result = _verifyTokenFlow(token, opts, "pwreset");
  if (!result.valid) return result;

  // C — hash + persist (token already consumed; a throw here does not reopen reuse).
  const hash = await hashPassword(newPassword);
  await updateHash(result.email, hash);
  return { valid: true, email: result.email };
}
