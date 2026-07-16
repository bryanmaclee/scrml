/**
 * path-canonical.js — the ONE internal-path-key canonicalization boundary.
 *
 * Cross-OS path-model canonicalization (deep-dive
 * `scrml-support/docs/deep-dives/windows-path-model-canonicalization-2026-07-14.md`).
 *
 * ## The problem
 * `node:path` `resolve`/`join`/`dirname` emit NATIVE separators — `\` on Windows,
 * `/` on POSIX. The compiler keys its module graph, export registries, and the
 * compile-set on these native paths, but emitted specifiers (`toPosixSpecifier`,
 * #18) and path COMPARISONS (`isStdlibFilePath`, #26) use posix. On Windows the
 * three regimes disagree → cross-file registry lookups miss, `absSource === filePath`
 * comparisons fail → ~38 Windows-only test failures. (Invisible on POSIX, where
 * native ≡ posix.)
 *
 * ## The contract (deep-dive ruling)
 * INTERNAL keys are canonicalized to posix; the PUBLIC `outputs` Map key and the
 * `compileScrml` entry `filePath` are PRESERVED as the caller gave them (echoing
 * the input path is a public contract — entry-normalization was tried and hit 474
 * failures). This module owns the INTERNAL boundary only.
 *
 * ## Why a class, not sprinkled `toPosix()` calls
 * Routing every one of the ~30 graph/registry `.get/.set/.has` sites through
 * `toPosix` by hand is the desync-prone shape — miss one consumer and it looks up
 * a native key in a posix map (the exact failure mode that sank two earlier
 * attempts: posix-graph-only → 10 regressions). `PathKeyedMap`/`PathKeyedSet`
 * canonicalize the key AT THE MAP BOUNDARY, so producers and consumers may pass
 * native OR posix and can never desync. Raw `===` path comparisons outside a map
 * still normalize explicitly via `toPosix` (there is no boundary to interpose).
 */

import { sep } from "node:path";

/**
 * Canonicalize a filesystem path to posix (`/`) separators for use as an
 * INTERNAL key or comparison operand.
 *
 * `sep`-AWARE by construction: it folds `\`→`/` ONLY when `\` is the host
 * separator (`sep === "\\"`, i.e. Windows). On POSIX a literal backslash is a
 * legal filename character and MUST be preserved — a hardcoded `\`→`/` (the old
 * `normalizeSep` / `toPosixSpecifier` idiom) widens matches on POSIX (e.g. a file
 * `stdlib\evil.scrml` would falsely enter the stdlib carve-out, a #26 auth-classifier
 * surface). Querying `path.sep` is the legitimate "what is the separator" question —
 * NOT `process.platform`-branching on behavior (see `docs/cross-os-invariants.md`).
 *
 * Native-algorithm-first: callers `resolve()`/`join()` with the native `path` API
 * (preserving drive letters + `..` collapse), THEN pass the result here — the
 * inverse of delegating to `path.posix`, which drops the Windows drive.
 *
 * @param {string} p — a filesystem path (native or already-posix)
 * @returns {string} — the same path with host separators folded to `/`
 */
export function toPosix(p) {
  if (typeof p !== "string") return p;
  return sep === "\\" ? p.replaceAll("\\", "/") : p;
}

/**
 * A `Map` whose keys are canonicalized through `toPosix` on every `get`/`set`/
 * `has`/`delete`. Producers and consumers may key with native OR posix paths and
 * never desync. Iteration (`keys`/`entries`/`values`/`forEach`/`for..of`) yields
 * the stored posix keys — consistent by construction. Use for the module graph,
 * export registries, and any INTERNAL path→value map. Do NOT use for the public
 * `outputs` map (its key is the caller's as-given input path — preserve it).
 */
export class PathKeyedMap extends Map {
  get(key) { return super.get(toPosix(key)); }
  set(key, value) { return super.set(toPosix(key), value); }
  has(key) { return super.has(toPosix(key)); }
  delete(key) { return super.delete(toPosix(key)); }
}

/**
 * A `Set` of paths canonicalized through `toPosix` on every `add`/`has`/`delete`.
 * The `PathKeyedMap` analogue for the compile-set membership check.
 */
export class PathKeyedSet extends Set {
  add(value) { return super.add(toPosix(value)); }
  has(value) { return super.has(toPosix(value)); }
  delete(value) { return super.delete(toPosix(value)); }
}
