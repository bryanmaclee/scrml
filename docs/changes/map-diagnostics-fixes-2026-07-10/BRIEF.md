# BRIEF — Fix three §59 map-diagnostic divergences + author unblocked conformance cases

Dispatch archived verbatim (S135/S136 archival protocol). Isolated worktree; PA reviews (S239) + lands.

---

Fix three §59 map-diagnostic divergences (impl#1-vs-SPEC, PA-ruled fix-impl) + author the conformance cases they unblock. Isolated worktree — do NOT land to main; commit on your branch; PA reviews (S239) + lands. Reproduce EACH divergence empirically before fixing (Rule 4: read the SPEC subsection in full; author to the SPEC).

## Divergence 3 — W-MAP-* severity: warning → Info (§34/§59.11)
`W-MAP-DUPLICATE-LITERAL-KEY` (and its siblings `W-MAP-STRUCT-KEY-LITERAL`, `W-MAP-ITERATION-ORDER` if they exist/fire) are emitted at severity **"warning"**, but SPEC §34/§59.11 declare them **Info**. Fix the impl to emit Info. Grep the fire sites (`grep -rn 'W-MAP-DUPLICATE-LITERAL-KEY' compiler/src/`); flip the severity to match §34/§59.11. Verify the W-/I- diagnostic-stream partition (info-level → result.warnings, non-fatal).

## Divergence 4 — E-MAP-BRACKET-WRITE escapes inline handlers (§59.7)
`@m[k]=v` (bracket-write, forbidden by §59.7) fires `E-MAP-BRACKET-WRITE` only in a function body / top-level logic, NOT inside an inline `${...}` event handler. Extend the diagnostic's fire-site to cover the inline-handler locus (the forbidden write must be caught everywhere it can occur). Find the E-MAP-BRACKET-WRITE fire site + the inline-handler scan seam.

## Divergence 6 — enum-key bare `.Variant` → spurious E-VARIANT-AMBIGUOUS (§59.4)
A bare `.Variant` in a map-KEY position (or a `getOr`-key arg) on a typed map (e.g. `<m>: [City:int]`) fires `E-VARIANT-AMBIGUOUS` — but §59.4 declares enum keys supported, and §14.10 bare-variant inference should resolve `.Variant`'s enum from the map's declared key-type. Extend the bare-variant inference (§14.10) to flow the map's key-type into a `.Variant` in key position, suppressing E-VARIANT-AMBIGUOUS when the key-type is an enum. (If this is a genuinely hard inference-context gap, STOP and report the scope — don't force it.)

## Author the unblocked conformance cases (in conformance/cases/maps/)
Once the fixes land on your branch, author the cases that were blocked on these divergences (the ss62 verify-pass found them — see `git show ce3b84d7:docs/changes/conformance-capability...` context; the shapes: a severity-assertable duplicate-key case now that it's Info; an enum-key map case (`.Variant` key resolves, no E-VARIANT-AMBIGUOUS); and the coverage GAP-1: a raw `@m[k]` bracket-READ on a miss yields `not` per §59.6 (`@m["XXX"]` → `not`, renders empty). Follow the existing maps/ case shape (id/description/spec/rationale/expect{codes,notCodes,severity}).

## Method + verify
Read SPEC §59 (esp §59.4/§59.6/§59.7/§59.11) + §45.7 in full. Reproduce each divergence against impl#1 first (scratchpad). `bun conformance/run.ts` all green + full pre-commit gate (`bun test compiler/tests/{unit,integration,conformance}`) — 0 fail (compiler-source change = wide blast radius). Commit per-fix + per-case-group on your branch; do NOT push/advance main.

## Deliverables
- S136: `docs/changes/map-diagnostics-fixes-2026-07-10/BRIEF.md` + progress.md.
- Return: each fix's fire-site + change; whether divergence 6 was tractable or scope-flagged; the conformance case-ids authored; oracle before→after; full-gate result; branch tip SHA. Do NOT claim done without the gate + oracle output. Do NOT land.
