/**
 * stdlib-auth — unit tests for scrml:auth
 *
 * Tests decodeJwt (pure), createRateLimiter (pure in-memory),
 * generatePassword (pure), and JWT sign/verify via extracted logic.
 *
 * server {} block functions (signJwt, verifyJwt, hashPassword, verifyPassword,
 * generateTotpSecret, verifyTotp) are tested structurally here — the
 * crypto.subtle implementation is tested via the extracted async functions.
 *
 * Coverage:
 *   A1   decodeJwt — decodes valid JWT payload
 *   A2   decodeJwt — returns null for malformed token
 *   A3   decodeJwt — returns null for null input
 *   A4   decodeJwt — returns null for empty string
 *   A5   decodeJwt — returns null for wrong number of parts
 *   A6   createRateLimiter — first request allowed
 *   A7   createRateLimiter — remaining decrements per request
 *   A8   createRateLimiter — request beyond max is blocked
 *   A9   createRateLimiter — remaining is 0 when blocked
 *   A10  createRateLimiter — different keys are independent
 *   A11  createRateLimiter — reset() clears counter
 *   A12  createRateLimiter — peek() does not increment
 *   A13  generatePassword — default length 16
 *   A14  generatePassword — custom length
 *   A15  generatePassword — two calls produce different passwords
 *   A16  signJwt + verifyJwt — valid token verifies correctly
 *   A17  signJwt + verifyJwt — expired token returns valid:false reason:expired
 *   A18  verifyJwt — tampered token returns valid:false reason:invalid
 *   A19  verifyJwt — malformed token returns valid:false reason:malformed
 *   A20  verifyJwt — safeCallAsync catches async crypto reject (Phase 3a, S89)
 *   A21  verifyJwt — safeCallAsync catches sync throw inside crypto thunk (S89)
 */

import { describe, test, expect } from "bun:test";
import { safeCallAsync } from "../../runtime/stdlib/host.js";
import { verifyJwtJwks, signJwt as shimSignJwt, decodeJwt as shimDecodeJwt } from "../../runtime/stdlib/auth.js";

// ---------------------------------------------------------------------------
// Extracted pure implementations
// ---------------------------------------------------------------------------

function base64urlEncode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    let str = ""
    for (const b of bytes) str += String.fromCharCode(b)
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function base64urlDecode(str) {
    let s = str.replace(/-/g, "+").replace(/_/g, "/")
    while (s.length % 4) s += "="
    const binary = atob(s)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function decodeJwt(token) {
    if (!token || typeof token !== "string") return null
    const parts = token.split(".")
    if (parts.length !== 3) return null
    try {
        const bytes = base64urlDecode(parts[1])
        const json = new TextDecoder().decode(bytes)
        return JSON.parse(json)
    } catch(e) {
        return null
    }
}

async function signJwt(payload, secret, expiresIn) {
    const now = Math.floor(Date.now() / 1000)
    const exp = now + (expiresIn !== undefined ? expiresIn : 3600)
    const header = { alg: "HS256", typ: "JWT" }
    const claims = { ...payload, iat: now, exp }
    const headerStr = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)))
    const payloadStr = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims)))
    const signingInput = `${headerStr}.${payloadStr}`
    const keyData = new TextEncoder().encode(secret)
    const cryptoKey = await crypto.subtle.importKey(
        "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    )
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signingInput))
    return `${signingInput}.${base64urlEncode(signatureBuffer)}`
}

// Extracted verifyJwt — mirrors stdlib/auth/jwt.scrml post-S89 Phase 3a async
// migration. Uses safeCallAsync (imported from the same runtime shim the
// scrml compiler bundles) to contain async crypto throws, then unwraps with
// the !{} sentinel-check pattern that the compiler emits.
async function verifyJwt(token, secret) {
    const decoded = decodeJwt(token)
    if (!decoded) return { valid: false, reason: "malformed" }
    const now = Math.floor(Date.now() / 1000)
    if (decoded.exp && decoded.exp < now) return { valid: false, reason: "expired" }
    const parts = token.split(".")
    if (parts.length !== 3) return { valid: false, reason: "malformed" }
    const signingInput = `${parts[0]}.${parts[1]}`
    const expectedSig = parts[2]
    const rawSig = await safeCallAsync(() => {
        const keyData = new TextEncoder().encode(secret)
        return crypto.subtle.importKey(
            "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
        ).then(cryptoKey => crypto.subtle.sign(
            "HMAC", cryptoKey, new TextEncoder().encode(signingInput)
        ))
    })
    // Simulate scrml's !{} sentinel check (what the compiler emits for guarded-expr).
    if (rawSig && rawSig.__scrml_error) {
        return { valid: false, reason: "invalid" }
    }
    if (base64urlEncode(rawSig) !== expectedSig) return { valid: false, reason: "invalid" }
    return { valid: true, payload: decoded }
}

function createRateLimiter(options) {
    const windowMs = (options && options.windowMs) || 15 * 60 * 1000
    const max = (options && options.max) || 10
    const store = new Map()
    return {
        check(key) {
            const now = Date.now()
            let entry = store.get(key)
            if (!entry || entry.resetAt <= now) {
                entry = { count: 0, resetAt: now + windowMs }
                store.set(key, entry)
            }
            entry.count++
            const allowed = entry.count <= max
            const remaining = Math.max(0, max - entry.count)
            return { allowed, remaining, resetAt: entry.resetAt }
        },
        reset(key) { store.delete(key) },
        peek(key) {
            const now = Date.now()
            const entry = store.get(key)
            if (!entry || entry.resetAt <= now) return { count: 0, remaining: max, resetAt: now + windowMs }
            return { count: entry.count, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt }
        }
    }
}

function generatePassword(length, options) {
    const len = length || 16
    const opts = options || {}
    const useUppercase = opts.uppercase !== false
    const useNumbers = opts.numbers !== false
    const useSymbols = opts.symbols !== false
    let chars = "abcdefghijklmnopqrstuvwxyz"
    if (useUppercase) chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if (useNumbers)   chars += "0123456789"
    if (useSymbols)   chars += "!@#$%^&*()-_=+[]{}|;:,.<>?"
    const bytes = new Uint8Array(len)
    crypto.getRandomValues(bytes)
    let result = ""
    for (const b of bytes) result += chars[b % chars.length]
    return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scrml:auth — decodeJwt()", () => {
    // Build a test token manually
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    const payload = btoa(JSON.stringify({ sub: "123", name: "Alice", role: "admin" }))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    const testToken = `${header}.${payload}.fakesig`

    test("A1: decodes valid JWT payload", () => {
        const p = decodeJwt(testToken)
        expect(p).not.toBeNull()
        expect(p.sub).toBe("123")
        expect(p.name).toBe("Alice")
        expect(p.role).toBe("admin")
    })

    test("A2: returns null for malformed base64", () => {
        expect(decodeJwt("head.!!!.sig")).toBeNull()
    })

    test("A3: returns null for null input", () => {
        expect(decodeJwt(null)).toBeNull()
    })

    test("A4: returns null for empty string", () => {
        expect(decodeJwt("")).toBeNull()
    })

    test("A5: returns null for wrong number of parts", () => {
        expect(decodeJwt("only.two")).toBeNull()
        expect(decodeJwt("too.many.parts.here")).toBeNull()
    })
})

describe("scrml:auth — createRateLimiter()", () => {
    test("A6: first request allowed", () => {
        const limiter = createRateLimiter({ windowMs: 60000, max: 5 })
        const result = limiter.check("user@test.com")
        expect(result.allowed).toBe(true)
    })

    test("A7: remaining decrements per request", () => {
        const limiter = createRateLimiter({ windowMs: 60000, max: 3 })
        const r1 = limiter.check("key1")
        expect(r1.remaining).toBe(2)
        const r2 = limiter.check("key1")
        expect(r2.remaining).toBe(1)
        const r3 = limiter.check("key1")
        expect(r3.remaining).toBe(0)
    })

    test("A8: request beyond max is blocked", () => {
        const limiter = createRateLimiter({ windowMs: 60000, max: 2 })
        limiter.check("key2")
        limiter.check("key2")
        const r3 = limiter.check("key2")
        expect(r3.allowed).toBe(false)
    })

    test("A9: remaining is 0 when blocked", () => {
        const limiter = createRateLimiter({ windowMs: 60000, max: 1 })
        limiter.check("key3")
        const r2 = limiter.check("key3")
        expect(r2.remaining).toBe(0)
        expect(r2.allowed).toBe(false)
    })

    test("A10: different keys are independent", () => {
        const limiter = createRateLimiter({ windowMs: 60000, max: 1 })
        const r1 = limiter.check("alice@test.com")
        expect(r1.allowed).toBe(true)
        const r2 = limiter.check("bob@test.com")
        expect(r2.allowed).toBe(true)
    })

    test("A11: reset() clears counter for key", () => {
        const limiter = createRateLimiter({ windowMs: 60000, max: 2 })
        limiter.check("key4")
        limiter.check("key4")
        limiter.reset("key4")
        const r = limiter.check("key4")
        expect(r.allowed).toBe(true)
        expect(r.remaining).toBe(1)
    })

    test("A12: peek() does not increment counter", () => {
        const limiter = createRateLimiter({ windowMs: 60000, max: 3 })
        const before = limiter.peek("key5")
        expect(before.count).toBe(0)
        expect(before.remaining).toBe(3)
        // peek again — should not increment
        const again = limiter.peek("key5")
        expect(again.count).toBe(0)
    })
})

describe("scrml:auth — generatePassword()", () => {
    test("A13: default length is 16", () => {
        const pw = generatePassword()
        expect(pw.length).toBe(16)
    })

    test("A14: custom length", () => {
        expect(generatePassword(24).length).toBe(24)
        expect(generatePassword(8).length).toBe(8)
    })

    test("A15: two calls produce different passwords", () => {
        const a = generatePassword(16)
        const b = generatePassword(16)
        expect(a).not.toBe(b)
    })
})

describe("scrml:auth — signJwt + verifyJwt (via extracted crypto logic)", () => {
    const secret = "test-secret-key-for-unit-tests"

    test("A16: valid token signs and verifies correctly", async () => {
        const token = await signJwt({ userId: 42, role: "user" }, secret, 3600)
        expect(typeof token).toBe("string")
        expect(token.split(".")).toHaveLength(3)

        const result = await verifyJwt(token, secret)
        expect(result.valid).toBe(true)
        expect(result.payload.userId).toBe(42)
        expect(result.payload.role).toBe("user")
    })

    test("A17: expired token returns valid:false reason:expired", async () => {
        const token = await signJwt({ userId: 1 }, secret, -1)  // expired 1 second ago
        const result = await verifyJwt(token, secret)
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("expired")
    })

    test("A18: tampered token returns valid:false reason:invalid", async () => {
        const token = await signJwt({ userId: 1 }, secret, 3600)
        const parts = token.split(".")
        // Tamper: change the last character of the signature
        const tamperedSig = parts[2].slice(0, -1) + (parts[2].slice(-1) === "A" ? "B" : "A")
        const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`
        const result = await verifyJwt(tampered, secret)
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("invalid")
    })

    test("A19: malformed token returns valid:false reason:malformed", async () => {
        const result = await verifyJwt("not.a.valid.jwt.at.all", secret)
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("malformed")
    })

    // -----------------------------------------------------------------------
    // S89 Phase 3a async migration — exercise the safeCallAsync failure path
    // -----------------------------------------------------------------------
    //
    // Pre-migration: verifyJwt wrapped its async crypto.subtle calls in
    // try/catch and returned { valid:false, reason:"invalid" } on throw.
    // Post-migration (S89 commit 2 of 4): the try/catch is replaced with
    // safeCallAsync + !{} unwrap. This test confirms the new path returns the
    // same result-shape on async crypto throw — the migration is API-stable.
    //
    // A20: directly probe the safeCallAsync wrapping by stubbing
    // crypto.subtle.importKey to reject. The stubbed reject path simulates
    // an async host-throw exactly the way safeCallAsync would catch it in
    // production (e.g., a corrupted runtime crypto provider).

    test("A20: safeCallAsync path contains async crypto throw → valid:false reason:invalid", async () => {
        // Build a well-formed token so we reach the signature-verification step
        // (the failure must come from crypto.subtle, not from earlier guards).
        const token = await signJwt({ userId: 7 }, secret, 3600)

        // Stub crypto.subtle.importKey to reject. The original verifyJwt try/catch
        // would have caught this; the new safeCallAsync wrapping must do the same.
        const originalImportKey = crypto.subtle.importKey
        crypto.subtle.importKey = () => Promise.reject(new Error("simulated host crypto failure"))
        try {
            const result = await verifyJwt(token, secret)
            expect(result.valid).toBe(false)
            expect(result.reason).toBe("invalid")
        } finally {
            crypto.subtle.importKey = originalImportKey
        }
    })

    test("A21: safeCallAsync path contains sync-throw inside crypto thunk → valid:false reason:invalid", async () => {
        // Synchronous throw inside the safeCallAsync thunk must also be caught
        // (the shim's try/catch wraps the thunk invocation, not only the await).
        const token = await signJwt({ userId: 8 }, secret, 3600)
        const originalImportKey = crypto.subtle.importKey
        crypto.subtle.importKey = () => { throw new TypeError("sync throw before promise return") }
        try {
            const result = await verifyJwt(token, secret)
            expect(result.valid).toBe(false)
            expect(result.reason).toBe("invalid")
        } finally {
            crypto.subtle.importKey = originalImportKey
        }
    })
})

// ===========================================================================
// verifyJwtJwks — RS256 / JWKS (BaaS auth-flows-jwks-2026-07-06)
//
// Tests the REAL shim (imported from runtime/stdlib/auth.js) against real
// crypto.subtle. The JWKS fetch is injected via opts.fetchJwks (no network),
// and a fresh injected opts.cache isolates each test from the module-level
// in-shim cache. J17 exercises the default in-shim Map cache path.
//
// Coverage:
//   J1   valid RS256 token verifies against the served JWKS
//   J2   tampered signature → invalid
//   J3   SECURITY: alg:none → alg-not-allowed (no JWKS fetch)
//   J4   SECURITY: alg:HS256 signed with RSA pubkey as HMAC secret → alg-not-allowed
//   J5   expired token → expired
//   J6   nbf in the future → not-yet-valid
//   J7   issuer mismatch → issuer-mismatch
//   J8   audience mismatch → audience-mismatch
//   J9   audience-array match → valid
//   J10  kid-miss on cached JWKS triggers one refetch (rotation) → valid
//   J11  kid present but absent after refetch → key-not-found
//   J12  no kid + single key → valid
//   J13  no kid + multiple keys → kid-ambiguous
//   J14  malformed token → malformed
//   J15  JWKS fetch throws → jwks-fetch-failed
//   J16  clock tolerance — token expired within tolerance still valid
//   J17  default in-shim cache — second verify does not refetch
// ===========================================================================

function _b64urlJson(obj) {
    return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function _b64urlBuf(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function _makeRsaKeypair() {
    return crypto.subtle.generateKey(
        {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
    );
}
async function _publicJwk(keyPair, kid) {
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    if (kid !== undefined) jwk.kid = kid;
    jwk.alg = "RS256";
    jwk.use = "sig";
    return jwk;
}
async function _signRs256(payload, keyPair, kid) {
    const header = { alg: "RS256", typ: "JWT" };
    if (kid !== undefined) header.kid = kid;
    const signingInput = `${_b64urlJson(header)}.${_b64urlJson(payload)}`;
    const sig = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keyPair.privateKey,
        new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${_b64urlBuf(sig)}`;
}
// A fresh injected cache (get/set over a new Map) — isolates each test from
// the module-level in-shim JWKS cache.
function _freshCache(seed) {
    const m = new Map(seed || []);
    return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}
const _nowSec = () => Math.floor(Date.now() / 1000);

describe("scrml:auth — verifyJwtJwks (RS256 / JWKS)", () => {
    test("J1: valid RS256 token verifies against the served JWKS", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256(
            { sub: "42", iss: "issuer", aud: "api", exp: _nowSec() + 3600 },
            kp,
            "key-1"
        );
        const res = await verifyJwtJwks(token, "https://issuer/j1/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(true);
        expect(res.payload.sub).toBe("42");
    });

    test("J2: tampered token (claims rewritten, original signature) → invalid", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256(
            { sub: "1", role: "user", exp: _nowSec() + 3600 },
            kp,
            "key-1"
        );
        const parts = token.split(".");
        // Attacker rewrites the claims (e.g. escalates role) but cannot re-sign;
        // the original signature no longer covers the new signing input. This is
        // a deterministic tamper (a flipped signature *character* can land on a
        // discarded base64url padding bit and decode unchanged).
        const forgedPayload = _b64urlJson({ sub: "1", role: "admin", exp: _nowSec() + 3600 });
        const tampered = `${parts[0]}.${forgedPayload}.${parts[2]}`;
        const res = await verifyJwtJwks(tampered, "https://issuer/j2/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("invalid");
    });

    // -------------------------------------------------------------------------
    // SECURITY — alg-confusion. The alg is pinned to RS256 and checked BEFORE
    // any JWKS fetch or crypto, so neither of these ever reaches a key/HMAC path.
    // -------------------------------------------------------------------------

    test("J3: alg:none token → alg-not-allowed (JWKS never fetched)", async () => {
        const header = _b64urlJson({ alg: "none", typ: "JWT" });
        const payload = _b64urlJson({ sub: "attacker", exp: _nowSec() + 3600 });
        const token = `${header}.${payload}.`;
        let fetched = false;
        const res = await verifyJwtJwks(token, "https://issuer/j3/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => {
                fetched = true;
                return { keys: [] };
            },
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("alg-not-allowed");
        expect(fetched).toBe(false);
    });

    test("J4: alg:HS256 signed with the RSA public key as HMAC secret → alg-not-allowed", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        // The classic alg-confusion attack: the attacker takes the PUBLIC key
        // (which is public) and uses its bytes as an HMAC secret, then signs
        // HS256. If the verifier dispatched off the token's alg into HMAC, this
        // would verify. The alg-pin blocks it outright.
        const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
        const hmacKey = await crypto.subtle.importKey(
            "raw",
            spki,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const header = _b64urlJson({ alg: "HS256", typ: "JWT", kid: "key-1" });
        const payload = _b64urlJson({ sub: "attacker", exp: _nowSec() + 3600 });
        const signingInput = `${header}.${payload}`;
        const forgedSig = await crypto.subtle.sign(
            "HMAC",
            hmacKey,
            new TextEncoder().encode(signingInput)
        );
        const token = `${signingInput}.${_b64urlBuf(forgedSig)}`;
        let fetched = false;
        const res = await verifyJwtJwks(token, "https://issuer/j4/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => {
                fetched = true;
                return { keys: [jwk] };
            },
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("alg-not-allowed");
        expect(fetched).toBe(false);
    });

    test("J5: expired token → expired", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256({ sub: "1", exp: _nowSec() - 3600 }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j5/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("expired");
    });

    test("J6: nbf in the future → not-yet-valid", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256(
            { sub: "1", nbf: _nowSec() + 3600, exp: _nowSec() + 7200 },
            kp,
            "key-1"
        );
        const res = await verifyJwtJwks(token, "https://issuer/j6/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("not-yet-valid");
    });

    test("J7: issuer mismatch → issuer-mismatch", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256(
            { sub: "1", iss: "evil", exp: _nowSec() + 3600 },
            kp,
            "key-1"
        );
        const res = await verifyJwtJwks(token, "https://issuer/j7/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
            issuer: "trusted",
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("issuer-mismatch");
    });

    test("J8: audience mismatch → audience-mismatch", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256(
            { sub: "1", aud: "other-api", exp: _nowSec() + 3600 },
            kp,
            "key-1"
        );
        const res = await verifyJwtJwks(token, "https://issuer/j8/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
            audience: "my-api",
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("audience-mismatch");
    });

    test("J9: audience-array (aud is a list) containing the expected value → valid", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256(
            { sub: "1", aud: ["a", "my-api", "b"], iss: "trusted", exp: _nowSec() + 3600 },
            kp,
            "key-1"
        );
        const res = await verifyJwtJwks(token, "https://issuer/j9/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
            issuer: "trusted",
            audience: "my-api",
        });
        expect(res.valid).toBe(true);
    });

    test("J10: kid-miss on cached JWKS triggers exactly one refetch (rotation) → valid", async () => {
        const kp = await _makeRsaKeypair();
        const freshJwk = await _publicJwk(kp, "key-2"); // the rotated (new) key
        const staleJwk = {
            kty: "RSA",
            kid: "key-1",
            n: "c3RhbGU",
            e: "AQAB",
            alg: "RS256",
            use: "sig",
        };
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp, "key-2");
        const url = "https://issuer/j10/jwks.json";
        // Cache pre-populated with the STALE set (only key-1).
        const cache = _freshCache([[url, { keys: [staleJwk] }]]);
        let fetchCount = 0;
        const res = await verifyJwtJwks(token, url, {
            cache,
            fetchJwks: async () => {
                fetchCount++;
                return { keys: [freshJwk] };
            },
        });
        expect(res.valid).toBe(true);
        expect(fetchCount).toBe(1);
    });

    test("J11: kid present but absent even after refetch → key-not-found", async () => {
        const kp = await _makeRsaKeypair();
        const otherJwk = { kty: "RSA", kid: "someone-else", n: "b3RoZXI", e: "AQAB" };
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp, "missing-kid");
        const url = "https://issuer/j11/jwks.json";
        const cache = _freshCache([[url, { keys: [otherJwk] }]]);
        let fetchCount = 0;
        const res = await verifyJwtJwks(token, url, {
            cache,
            fetchJwks: async () => {
                fetchCount++;
                return { keys: [otherJwk] }; // still no matching kid
            },
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("key-not-found");
        expect(fetchCount).toBe(1); // refetched exactly once
    });

    test("J12: no kid + single key → uses the sole key → valid", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp); // no kid on the JWK
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp); // no kid in header
        const res = await verifyJwtJwks(token, "https://issuer/j12/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(true);
    });

    test("J13: no kid + multiple keys → kid-ambiguous", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "a");
        const other = { kty: "RSA", kid: "b", n: "b3RoZXI", e: "AQAB" };
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp); // no kid
        const res = await verifyJwtJwks(token, "https://issuer/j13/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk, other] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("kid-ambiguous");
    });

    test("J14: malformed token → malformed", async () => {
        const res = await verifyJwtJwks("not.a.jwt.at.all.extra", "https://issuer/j14/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("malformed");
    });

    test("J15: JWKS fetch throws → jwks-fetch-failed", async () => {
        const kp = await _makeRsaKeypair();
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j15/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => {
                throw new Error("network down");
            },
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("jwks-fetch-failed");
    });

    test("J16: clock tolerance — token expired 30s ago is still valid within 60s tolerance", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256({ sub: "1", exp: _nowSec() - 30 }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j16/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
            clockToleranceSec: 60,
        });
        expect(res.valid).toBe(true);
    });

    test("J17: default in-shim cache — a second verify does not refetch", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp, "key-1");
        // Unique url so the module-level cache is not polluted by other tests.
        const url = `https://issuer/j17-${Date.now()}-${Math.random()}/jwks.json`;
        let fetchCount = 0;
        const opts = {
            // NO opts.cache → the default module-level in-shim Map is used.
            fetchJwks: async () => {
                fetchCount++;
                return { keys: [jwk] };
            },
        };
        const r1 = await verifyJwtJwks(token, url, opts);
        const r2 = await verifyJwtJwks(token, url, opts);
        expect(r1.valid).toBe(true);
        expect(r2.valid).toBe(true);
        expect(fetchCount).toBe(1); // second verify hit the cache
    });
});

// ===========================================================================
// verifyJwtJwks / signJwt — adversarial /code-review regressions (S24x)
//   J18  string-typed exp bypass (finding 3)
//   J19  inlined-client default-fetch ReferenceError → graceful (finding 4)
//   J20  signJwt explicit-null TTL → default 3600, not immediate expiry (finding 6)
// ===========================================================================

describe("scrml:auth — verifyJwtJwks security regressions (adversarial review)", () => {
    test("J18a: string-typed past exp is coerced and rejected as expired (was NaN-bypass)", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        // exp as a STRING of a past epoch — `now > exp + tol` would be NaN→false
        // (accept-forever) without numeric coercion.
        const token = await _signRs256({ sub: "1", exp: String(_nowSec() - 3600) }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j18a/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("expired");
    });

    test("J18b: non-numeric exp is rejected (fail-closed, not trusted)", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256({ sub: "1", exp: "not-a-number" }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j18b/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("invalid");
    });

    test("J18c: a numeric-string future exp still verifies (coercion, not rejection)", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256({ sub: "1", exp: String(_nowSec() + 3600) }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j18c/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(true);
    });

    test("J18d: string-typed future nbf is coerced and rejected as not-yet-valid", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp, "key-1");
        const token = await _signRs256(
            { sub: "1", nbf: String(_nowSec() + 3600), exp: _nowSec() + 7200 },
            kp,
            "key-1"
        );
        const res = await verifyJwtJwks(token, "https://issuer/j18d/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [jwk] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("not-yet-valid");
    });

    test("J19: an INJECTED fetch throwing ReferenceError is NOT masked (surfaces as jwks-fetch-failed)", async () => {
        // Finding 6 narrowing: only the DEFAULT http.get path's client-inline gap
        // maps to "jwks-fetch-unavailable"; a genuine bug inside a caller-injected
        // fetch must surface, not be masked.
        const kp = await _makeRsaKeypair();
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j19/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => {
                throw new ReferenceError("some real bug in the injected fetch");
            },
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("jwks-fetch-failed");
    });

    test("J19b: an injected fetch throwing a generic error → jwks-fetch-failed (no crash)", async () => {
        const kp = await _makeRsaKeypair();
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp, "key-1");
        const res = await verifyJwtJwks(token, "https://issuer/j19b/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => {
                throw new Error("network down");
            },
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("jwks-fetch-failed");
    });

    test("J19c: the DEFAULT fetch path degrades gracefully on a fetch failure (no crash)", async () => {
        // No opts.fetchJwks → _defaultFetchJwks → httpGet(malformed url) rejects
        // (Invalid URL, no network attempt). In this runtime http.js's _request IS
        // present (not a ReferenceError), so the graceful reason is
        // "jwks-fetch-failed" — the point is: no throw / no crash.
        const kp = await _makeRsaKeypair();
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp, "key-1");
        const res = await verifyJwtJwks(token, "http://[::malformed::url", {
            cache: _freshCache(),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("jwks-fetch-failed");
    });

    test("J21: a JSON-null header token is rejected as malformed (no TypeError crash)", async () => {
        // base64url("null") → JSON.parse returns null WITHOUT throwing; header.alg
        // would then dereference null OUTSIDE any try/catch → a rejecting promise.
        const nullHeader = _b64urlJson(null);
        const payload = _b64urlJson({ sub: "1", exp: _nowSec() + 3600 });
        const token = `${nullHeader}.${payload}.sig`;
        const res = await verifyJwtJwks(token, "https://issuer/j21/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("malformed");
    });

    test("J21b: a JSON-array header (non-object) is rejected as malformed", async () => {
        const arrHeader = _b64urlJson([1, 2, 3]);
        const payload = _b64urlJson({ sub: "1" });
        const token = `${arrHeader}.${payload}.sig`;
        const res = await verifyJwtJwks(token, "https://issuer/j21b/jwks.json", {
            cache: _freshCache(),
            fetchJwks: async () => ({ keys: [] }),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("malformed");
    });

    test("J22: a transiently-empty keyset is NOT cached (no cache-poisoning)", async () => {
        const kp = await _makeRsaKeypair();
        const jwk = await _publicJwk(kp); // no kid
        const token = await _signRs256({ sub: "1", exp: _nowSec() + 3600 }, kp); // no kid
        const url = "https://issuer/j22/jwks.json";
        const cache = _freshCache();
        let call = 0;
        const fetchJwks = async () => {
            call++;
            return call === 1 ? { keys: [] } : { keys: [jwk] }; // transient empty, then recovers
        };
        const r1 = await verifyJwtJwks(token, url, { cache, fetchJwks });
        expect(r1.valid).toBe(false);
        const r2 = await verifyJwtJwks(token, url, { cache, fetchJwks });
        expect(r2.valid).toBe(true);
        expect(call).toBe(2);
    });
});

describe("scrml:auth — signJwt TTL regression (adversarial review)", () => {
    test("J20: explicit null expiresIn defaults to 3600s (not now → immediate expiry)", async () => {
        const t = await shimSignJwt({ sub: "1" }, "test-secret", null);
        const p = shimDecodeJwt(t);
        expect(p).not.toBeNull();
        // exp must be a full window ahead of iat, not equal to it.
        expect(p.exp - p.iat).toBe(3600);
    });

    test("J20b: explicit undefined expiresIn also defaults to 3600s", async () => {
        const t = await shimSignJwt({ sub: "1" }, "test-secret", undefined);
        const p = shimDecodeJwt(t);
        expect(p.exp - p.iat).toBe(3600);
    });

    test("J20c: an explicit numeric expiresIn is honored", async () => {
        const t = await shimSignJwt({ sub: "1" }, "test-secret", 120);
        const p = shimDecodeJwt(t);
        expect(p.exp - p.iat).toBe(120);
    });
});
