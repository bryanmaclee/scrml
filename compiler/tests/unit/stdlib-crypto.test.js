// stdlib-crypto.test.js — behavioral coverage for scrml:crypto.
//
// The stdlib .scrml source (stdlib/crypto/index.scrml) resolves at runtime to the
// hand-written host shim compiler/runtime/stdlib/crypto.js; this suite exercises
// that shim against real Bun crypto (Bun.password argon2, Bun.CryptoHasher,
// crypto.subtle HMAC, crypto.randomUUID). The .scrml `~{}` block can only reach the
// pure safeCompare at compile time — this file closes that gap (referenced by
// stdlib/crypto/index.scrml). Added S247 (stdlib completeness sweep).

import { describe, test, expect } from "bun:test";
import {
  hash,
  verifyHash,
  generateToken,
  generateUUID,
  hmac,
  safeCompare,
} from "../../runtime/stdlib/crypto.js";

const SHA256_HELLO =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("scrml:crypto — hash", () => {
  test("C1 sha256 is deterministic + matches the known vector", () => {
    expect(hash("sha256", "hello")).toBe(SHA256_HELLO);
    expect(hash("sha256", "hello")).toBe(hash("sha256", "hello"));
  });

  test("C2 sha512 / md5 / blake2b256 produce distinct hex digests", () => {
    const s512 = hash("sha512", "hello");
    const md5 = hash("md5", "hello");
    const b2b = hash("blake2b256", "hello");
    expect(s512).toMatch(/^[0-9a-f]{128}$/);
    expect(md5).toMatch(/^[0-9a-f]{32}$/);
    expect(b2b).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([s512, md5, b2b]).size).toBe(3);
  });

  test("C3 non-string input is coerced (no throw)", () => {
    expect(hash("sha256", 12345)).toBe(hash("sha256", "12345"));
  });

  test("C4 argon2 returns a salted argon2id verifier string", () => {
    const h = hash("argon2", "correct horse");
    expect(typeof h).toBe("string");
    expect(h.startsWith("$argon2id$")).toBe(true);
    // Salted → two hashes of the same input differ.
    expect(hash("argon2", "correct horse")).not.toBe(h);
  });

  test("C5 unsupported algorithm throws with a helpful message", () => {
    expect(() => hash("sha3", "x")).toThrow(/Unsupported algorithm/);
  });
});

describe("scrml:crypto — verifyHash", () => {
  test("C6 sha256 roundtrip: match true, mismatch false", () => {
    const h = hash("sha256", "s3cret");
    expect(verifyHash("sha256", "s3cret", h)).toBe(true);
    expect(verifyHash("sha256", "wrong", h)).toBe(false);
  });

  test("C7 argon2 roundtrip: match true, mismatch false", () => {
    const h = hash("argon2", "hunter2");
    expect(verifyHash("argon2", "hunter2", h)).toBe(true);
    expect(verifyHash("argon2", "hunter3", h)).toBe(false);
  });

  test("C8 malformed stored hash fails closed (returns false, no throw)", () => {
    expect(verifyHash("argon2", "x", "not-a-real-hash")).toBe(false);
    expect(verifyHash("sha256", "x", "garbage")).toBe(false);
  });
});

describe("scrml:crypto — generateToken / generateUUID", () => {
  test("C9 default token is 32 bytes = 64 lowercase hex chars", () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  test("C10 byte length is honoured", () => {
    expect(generateToken(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(generateToken(8)).toMatch(/^[0-9a-f]{16}$/);
  });

  test("C11 tokens are unique across calls", () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(generateToken(16));
    expect(seen.size).toBe(100);
  });

  test("C12 generateUUID returns a v4 UUID", () => {
    const u = generateUUID();
    expect(u).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(generateUUID()).not.toBe(u);
  });
});

describe("scrml:crypto — hmac", () => {
  test("C13 HMAC-SHA256 is 64 hex chars + deterministic for the same input", async () => {
    const a = await hmac("secret", "payload");
    const b = await hmac("secret", "payload");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  test("C14 different key or payload changes the signature", async () => {
    const base = await hmac("secret", "payload");
    expect(await hmac("other", "payload")).not.toBe(base);
    expect(await hmac("secret", "payload2")).not.toBe(base);
  });

  test("C15 non-string payload is JSON-encoded (stable)", async () => {
    const a = await hmac("k", { b: 1, a: 2 });
    const b = await hmac("k", { b: 1, a: 2 });
    expect(a).toBe(b);
  });
});

describe("scrml:crypto — safeCompare", () => {
  test("C16 equal strings compare true", () => {
    expect(safeCompare("abc", "abc")).toBe(true);
    expect(safeCompare("", "")).toBe(true);
  });

  test("C17 unequal / different-length / non-string compare false", () => {
    expect(safeCompare("abc", "abd")).toBe(false);
    expect(safeCompare("abc", "abcd")).toBe(false);
    expect(safeCompare("abc", "")).toBe(false);
    expect(safeCompare(null, "abc")).toBe(false);
    expect(safeCompare(undefined, undefined)).toBe(false);
    expect(safeCompare(123, "123")).toBe(false);
  });
});
