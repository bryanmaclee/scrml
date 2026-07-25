/**
 * @module codegen/fnv1a-hash
 *
 * FNV-1a (32-bit) hash primitive — shared codegen utility.
 *
 * Authored at S91 wave A-4.6 as the shared extraction point for the
 * previously-internal `type-encoding.ts:fnv1aHash`. The function shape
 * + parameters + output format are NORMATIVE per SPEC.md §47.1.3 and
 * SHALL NOT be modified without a SPEC amendment.
 *
 *   - FNV prime:    `16777619` (32-bit)
 *   - Offset basis: `2166136261` (32-bit)
 *   - Output:       lowercase base36, zero-padded to exactly 8 chars
 *   - Input:        treated as a UTF-16 charcode sequence (the existing
 *                   `String.charCodeAt(i)` walk; matches the §47.1.3
 *                   canonical-string contract for pre-existing per-binding
 *                   name encoding).
 *
 * Two call-site classes consume this primitive:
 *
 *   1. **Per-binding type-encoding (§47.1.2 / §47.1.3).** The compiler's
 *      `encodeTypeName` builds an 8-char hash over a `ResolvedType`'s
 *      canonical string. Existing surface — predates A-4.6. Re-exported
 *      from `type-encoding.ts` so existing callers are byte-identical
 *      (§47.1.3 normative).
 *
 *   2. **Per-chunk content-addressing (§47.5 / §40.9.8).** A-4.6 adds a
 *      per-chunk content-address hash over the canonical concatenation
 *      of the chunk's `ChunkContents` admission sets + the `payloadJs`
 *      bytes. `route-splitter.ts:computeChunkHash` is the call site.
 *
 * **Determinism contract (§40.9.8).** Same input string → same 8-char
 * output. No source-environment axis (timestamp, env var, build flag)
 * participates. The function is pure-PURE: no I/O, no clock read, no
 * RNG seed. The output is therefore reproducible across builds.
 *
 * **Why a standalone file?** Two reasons:
 *
 *   - Per A-4 SCOPING §3.6: "extract FNV-1a helper into a shared util —
 *     no semantic change to existing per-binding name encoding."
 *     Separates the cross-cutting hash primitive from the type-encoding-
 *     specific canonical-string normalization (§47.1.4) so the latter
 *     can evolve independently of the former.
 *
 *   - The eventual self-host rewrite (S66 ratification — from-scratch,
 *     NOT a mechanical TS port) treats `fnv1a-hash.scrml` as a small
 *     self-contained module. Extracting it here pre-organizes the
 *     source surface for that rewrite.
 *
 * Cross-references:
 *   - SPEC.md §47.1.3 — hash parameters + output format (normative).
 *   - SPEC.md §47.5 — content-addressing scope of application.
 *   - SPEC.md §40.9.8 — closure-analysis determinism preservation.
 *   - docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md §3.6.
 *
 * NOTE: `Math.imul(...) >>> 0` keeps the multiply result inside the
 * 32-bit unsigned range — necessary because JavaScript doesn't have a
 * native u32 type. The `>>> 0` cast normalizes the sign and clamps to
 * the lower 32 bits so the output is bit-identical to a true u32 FNV-1a.
 */

/** FNV-1a 32-bit offset basis (normative — SPEC §47.1.3). */
export const FNV_OFFSET = 2166136261;
/** FNV-1a 32-bit prime (normative — SPEC §47.1.3). */
export const FNV_PRIME = 16777619;

/**
 * FNV-1a 32-bit hash, output as a zero-padded 8-char base36 string.
 *
 * **Output entropy: 32 bits, not the base36^8 ≈ 41 the width suggests.** The
 * hash IS a u32, and the base36 rendering is zero-padded to 8 chars purely for
 * a fixed width — it adds no entropy. Because 36^7 (78,364,164,096) already
 * exceeds 2^32 (4,294,967,296), a u32 never needs the 8th digit: **every token
 * this function produces begins with `0`.** Consumers matching tokens by shape
 * should anchor on `0[0-9a-z]{7}`, not `[0-9a-z]{8}` — the looser pattern eats
 * the trailing 8 characters of unrelated identifiers.
 *
 * Birthday-collision probability at 32 bits: ~1.2e-4 over a thousand distinct
 * inputs, ~1.2e-2 over ten thousand. Per SPEC §47.1.5 this is the documented
 * length/collision trade-off; E-CG-010 enforces collision detection for the
 * type-encoding call site (per-binding names), and the content-addressing call
 * site (per-chunk hashes) does NOT enforce E-CG-010 — chunk collisions surface
 * as routing failures rather than compile-time errors (informational policy).
 * The chunk-NAMESPACE call site (`chunk-namespace.ts`) does enforce
 * distinctness, because there a collision is silent and IS the defect the
 * namespace exists to prevent.
 *
 * The walk treats `input` as a UTF-16 charcode sequence (matching the
 * existing per-binding encoding surface that predates A-4.6). For
 * ASCII-only inputs (typical for both call sites) UTF-16 charcodes
 * equal UTF-8 codeunits.
 */
export function fnv1aHash(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(36).padStart(8, "0");
}
