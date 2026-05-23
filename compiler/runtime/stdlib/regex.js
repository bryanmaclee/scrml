// scrml:regex — runtime shim
//
// Hand-written ES module mirroring stdlib/regex/index.scrml. Pure functions
// over a vetted catalog of common patterns + named-group helpers. Safe in
// both server and client contexts.
//
// Surface (must match stdlib/regex/index.scrml exports):
//   - patterns                                — object of vetted RegExp
//   - test(pattern, str)                      → boolean
//   - match(pattern, str)                     → groups | array | null
//   - extract(pattern, str)                   → array
//   - replace(pattern, str, replacement)      → string
//   - escape(str)                             → string
//   - caseInsensitive(source, additionalFlags?) → RegExp
//   - isValid(patternName, str)               → boolean

export const patterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/[^\s/$.?#].[^\s]*$/i,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
  ipv6: /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}$|^(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}$|^(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}$|^::$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  hexColor: /^#(?:[0-9a-fA-F]{3}){1,2}$/,
  semver: /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  isoDate: /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  phoneE164: /^\+[1-9]\d{1,14}$/,
  usZip: /^\d{5}(?:-\d{4})?$/,
  creditCard: /^\d{13,19}$/,
  username: /^[a-zA-Z0-9_]{3,32}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
};

export function test(pattern, str) {
  if (typeof str !== "string") return false;
  return pattern.test(str);
}

export function match(pattern, str) {
  if (typeof str !== "string") return null;
  const m = pattern.exec(str);
  if (!m) return null;
  if (m.groups) return m.groups;
  return m;
}

export function extract(pattern, str) {
  if (typeof str !== "string") return [];
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const p = new RegExp(pattern.source, flags);
  const out = [];
  let m;
  while ((m = p.exec(str)) !== null) {
    if (m.groups) {
      out.push(m.groups);
    } else if (m.length > 1) {
      // Has capturing groups — push the first capture if there's one, else the full match.
      out.push(m[1] !== undefined && m[1] !== null ? m[1] : m[0]);
    } else {
      out.push(m[0]);
    }
    // Guard against zero-length matches infinite loop.
    if (m.index === p.lastIndex) p.lastIndex++;
  }
  return out;
}

export function replace(pattern, str, replacement) {
  if (typeof str !== "string") return str;
  return str.replace(pattern, replacement);
}

export function escape(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function caseInsensitive(source, additionalFlags) {
  const flags = "i" + (additionalFlags || "");
  return new RegExp(source, flags);
}

export function isValid(patternName, str) {
  const p = patterns[patternName];
  if (!p) return false;
  return test(p, str);
}
