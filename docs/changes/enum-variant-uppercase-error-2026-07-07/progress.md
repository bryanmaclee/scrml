# progress — enum-variant-uppercase-error-2026-07-07

CHANGE-ID: enum-variant-uppercase-error-2026-07-07
Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-afff7ab753f8596b5

## Goal
§14.4: lowercase enum variant / type names must ERROR (not silent-drop). New codes:
- E-ENUM-VARIANT-CASE (variant name not uppercase)
- E-ENUM-TYPE-CASE   (enum type name not uppercase)

## Fire site
compiler/src/type-system.ts `parseEnumBody` (type-system.ts:~1705):
- Type-name check at top (before empty-body early return) — uses `typeName` param.
- Variant-name check in BOTH the unit-variant arm and payload-variant arm — was
  `if (!/^[A-Z].../.test(name)) continue;` (silent drop) → now fires the diagnostic.
- `pushCaseError` dedups by code+message so the two-pass buildTypeRegistry
  (Pass 2 + Pass 3, shared `errors` array) surfaces each violation ONCE
  (E-ENGINE-004/010 in the same fn double-fire; we chose single-fire per the
  E-STRUCT-FUNCTION-FIELD single-fire intent, line ~20574).
- Payload FIELD names (`shade` in `Green(shade:int)`) are NOT checked — only the
  variant NAME (slice before `(`).

## Status
- [x] source change (type-system.ts) — VERIFIED via buildTypeRegistry + real CLI; committed 7b302e3d (full suite 19584 pass / 0 fail)
- [x] regression unit tests — compiler/tests/unit/enum-variant-uppercase-error.test.js (13 pass)
- [x] conformance case (codes-half) — conformance/cases/enum/variant-name-lowercase-reject/ (1 pass)
- [x] SPEC §14.4 amendment (cite codes on the two SHALL bullets) — SPEC.md:7644-7645
- [x] SPEC §34 catalog rows — SPEC.md:18140-18141 (after E-ENGINE-021)
- [x] full suite green (final gate) — `bun test compiler/tests/{unit,integration,conformance}` = 19598 pass / 65 skip / 0 fail (1075 files)

## Commits
- 7b302e3d — source change (type-system.ts) + progress.md
- 87bf662d — regression tests + conformance case + SPEC §14.4/§34 amendment

## Deferred polish (out of scope for this dispatch; negligible)
- The variant/type "Rename it `X`." hint degenerates to a no-op suggestion for a
  variant/type name that begins with a NON-letter (digit/underscore/symbol, e.g.
  `_internal`). The primary "must begin with an uppercase letter (§14.4)" guidance
  is still correct in that case. No real adopter writes such a name. A future DRY
  pass could fold the two identical variant-arm message-builders into one shared
  `fireVariantCase` helper and drop the rename clause when it does not change the
  name.

## Evidence so far
- delta-log-like `type Kind:enum = { rule, disp, land }` → 3 errors (one per variant), FAILED.
- `type Color:enum = { Red, Green(shade:int), Blue }` → Compiled clean.
- No lowercase enum type names / variants in real corpus (stdlib/examples/samples);
  `div`/`formresult` are p1e-name-resolver W-CASE-001 fixtures (separate pass).
