// scrml:crypto — runtime shim
//
// Hand-written ES module mirroring stdlib/crypto/index.scrml.
//
// Surface:
//   - hash(algorithm, input)            → string                [server-only for argon2]
//   - verifyHash(algorithm, input, h)   → boolean               [server-only for argon2]
//   - generateToken(bytes)              → string (hex)          [browser-safe]
//   - generateUUID()                    → string (UUID v4)      [browser-safe]
//   - hmac(secret, payload)             → Promise<string>       [browser-safe]
//   - safeCompare(a, b)                 → boolean               [browser-safe]

// S462 fix round 1 — mirrors the scrml enum declared in stdlib/crypto/index.scrml. An enum is a
// run-time value (scrml code constructs `CryptoError.VerifyFailed(…)`), so the shim
// MUST export it: the server bundle imports every enum name it is given, and
// a missing ES export is a link error that takes the whole bundle down.
// Same shape the compiler emits for payload variants ({ variant, data }).
export const CryptoError = Object.freeze({
  VerifyFailed: function(message) {
    return { variant: "VerifyFailed", data: { message } };
  },
  variants: ["VerifyFailed"],
});

export function hash(algorithm, input) {
  if (typeof input !== "string") input = String(input);
  if (algorithm === "argon2") {
    return Bun.password.hashSync(input, { algorithm: "argon2id" });
  }
  const algMap = {
    sha256: "SHA-256",
    sha512: "SHA-512",
    md5: "MD5",
    blake2b256: "BLAKE2b256",
  };
  const bunAlg = algMap[algorithm];
  if (!bunAlg) {
    throw new Error(
      `[scrml:crypto] Unsupported algorithm: ${algorithm}. Use argon2, sha256, sha512, md5, or blake2b256.`
    );
  }
  const hasher = new Bun.CryptoHasher(bunAlg);
  hasher.update(input);
  return hasher.digest("hex");
}

export function verifyHash(algorithm, input, storedHash) {
  if (typeof input !== "string") input = String(input);
  try {
    if (algorithm === "argon2") {
      return Bun.password.verifySync(input, storedHash);
    }
    const computed = hash(algorithm, input);
    return computed === storedHash;
  } catch (e) {
    return false;
  }
}

export function generateToken(bytes) {
  // Mirrors stdlib/crypto/index.scrml line 90-97. Uses globalThis.crypto so
  // it works in both Bun and browser environments.
  const size = bytes || 32;
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateUUID() {
  return crypto.randomUUID();
}

export async function hmac(secret, payload) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(
    typeof payload === "string" ? payload : JSON.stringify(payload)
  );
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
