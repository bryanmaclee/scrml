# REINTEGRATE — sPA ss74: inline foreign §23.2 + meta-eval §22 (codes-half)

**From:** sPA ss74 · **List:** `spa-lists/ss74-conformance-foreign-23.md`
**Branch:** `spa/ss74` · **tip:** `18a7ca87dbebebe22bbe4155aac5e18f656aa469`
**Base:** `211dc076` (origin/main at boot) · **1 commit ahead** · single commit `18a7ca87`.
**Worktree:** `../scrml-spa-ss74` (node_modules symlinked → main; safe to `git worktree remove` after reintegrate).

## Status: DONE — 8/8 codes landed, 0 parked, 0 dropped

Conformance **593 → 605 green** (independently verified standalone in a fresh ss74 worktree
AND by the pre-commit suite on the commit). All files are ADDITIVE (new case dirs) — a clean
file-delta onto current main; no conflicts with anything main added since 211dc076.

12 case dirs (9 foreign + 3 meta), reject `-neg` (fires) + clean `-pos` (silent):

| code | fires (-neg) | clean (-pos) |
|---|---|---|
| E-FOREIGN-003 | `foreign/foreign-inline-no-lang-neg` | `foreign/foreign-inline-lang-declared-pos` (notCodePrefixes E-FOREIGN-) |
| E-FOREIGN-004 | `foreign/foreign-bare-block-neg` | (covered by -lang-declared-pos) |
| E-FOREIGN-005 | `foreign/foreign-lang-unsupported-neg` | (covered by -lang-declared-pos) |
| E-FOREIGN-006 | `foreign/foreign-crossing-shadow-neg` | `foreign/foreign-crossing-clean-pos` |
| E-FOREIGN-LANG-DUPLICATE | `foreign/foreign-lang-duplicate-neg` | `foreign/foreign-lang-single-pos` |
| E-FOREIGN-LANG-IN-PROGRAM | `foreign/foreign-lang-in-program-neg` | (covered by -single-pos) |
| E-META-EVAL-001 | `meta/meta-eval-runtime-error-neg` | `meta/meta-eval-clean-pos` (notCodePrefixes E-META-EVAL-) |
| E-META-EVAL-002 | `meta/meta-eval-reparse-error-neg` | (covered by -clean-pos) |

Provenance brief committed at `docs/changes/conformance-foreign-meta-eval-ss74-2026-07-15/BRIEF.md`.

## ESCALATED — 3 divergences (author-to-impl; the PA disposes)

**Both were the ss74 LIST PROSE being wrong — impl matches SPEC exactly (no SPEC/impl gap).**
Cases were authored to the impl (codes-half ground truth). Suggest the PA correct the list text:

1. **E-FOREIGN-006** — list said "an inline foreign block that *crosses a client/server boundary*".
   Impl (`codegen/emit-logic.ts:2980`) fires on a **crossing-name SHADOW**: an `in:{ x }` crossing
   name the slice ALSO redeclares as a top-level `const/let/var/function/class x` — which would
   redeclare the emitted async-IIFE parameter (invalid JS). SPEC §23.2.4a
   (`compiler/SPEC.md:16238-16241, :16344, :17843`) describes exactly this. **List prose to fix.**

2. **E-FOREIGN-003** — list said "a foreign block with *no content*" / "a non-empty foreign block → silent".
   Impl (`type-system.ts:21757`) fires on **no `lang=` declaration in any ancestor** (`<program>`
   or `<foreign lang>`) — a missing-lang check, not empty-content. SPEC §23.2/§23.6
   (`compiler/SPEC.md:16124, :16330-16341, :17840`) matches. **List prose to fix.**

3. **E-META-EVAL-001 trigger recipe** (surfaced while authoring; not SPEC/impl divergence).
   The list/brief's intuitive triggers do NOT reach E-META-EVAL-001: `^{ throw new Error(...) }`
   fires `E-THROW-NOT-IN-SCRML` first (throw is forbidden scrml vocab); `^{ notDefined() }` fires
   `E-SCOPE-001` first AND a `^{}` with no `emit(...)`/`reflect(...)` is classified *runtime* meta
   (so `meta-eval.ts`'s compile-time `new Function` path never runs). Working recipe:
   `^{ emit(JSON.parse("{")) }` — the `emit(...)` pattern classifies it compile-time, and
   `JSON.parse("{")` throws a real SyntaxError at eval → E-META-EVAL-001. Recorded here so a
   future author doesn't re-burn the cycle.

## Item 8 note (from the list)
`E-META-EVAL-002` was carried `[tier-1?]` (sibling of the tier-split's `E-META-EVAL-001`, added for
coverage). It's pinned; reclassify if the freeze audit wants only 001 in tier-1.
