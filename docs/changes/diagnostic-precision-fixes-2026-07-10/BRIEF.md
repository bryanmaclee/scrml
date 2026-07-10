# BRIEF — diagnostic-precision-fixes-2026-07-10

Verbatim dispatch brief (archived per S136 / DD Rec #14).

---

Fix two diagnostic-precision divergences (impl#1-vs-SPEC, PA-ruled fix-impl) + author the conformance case they unblock. Isolated worktree — do NOT land to main; commit on your branch; PA reviews (S239) + lands. Reproduce EACH empirically first; Rule 4 (read the SPEC subsection in full; author to the SPEC).

## Divergence 1 — §61 dead/unknown <endpoint> arm fires NOTHING (§61.4/§61.9)
An `<endpoint>` arm naming a variant NOT in the `accepts=` enum (a genuinely dead/unknown arm — all real variants also covered) fires NO diagnostic. SPEC §61.4 + §61.9 say such an arm follows the §18.0.1 arm-validity rules → it SHALL fire a §18.0.1 diagnostic. (Contrast: a DUPLICATE arm correctly fires E-TYPE-023 today — that path works; the dead/unknown-variant arm is the gap.) Read SPEC §61.4, §61.9, §18.0.1 in full. Fix the endpoint typer to diagnose the dead/unknown arm with the §18.0.1-correct code. Find the endpoint arm-validity check (mirror how the duplicate-arm E-TYPE-023 path fires) + the §18.0.1 arm-validity machinery.

## Divergence 2 — §51.0.M <onTimeout> misplacement fires the wrong code
`<onTimeout>` placed OUTSIDE an engine state-child — specifically in plain `<program>` markup — fires `E-ATTR-001` + `E-SCOPE-001` instead of the SPEC-mandated `E-STRUCTURAL-ELEMENT-MISPLACED`. SPEC §51.0.M states "outside an engine state-child → E-STRUCTURAL-ELEMENT-MISPLACED" for ANY outside locus; impl#1 only fires the specific code for the `${}`-logic-body locus (the markup locus degrades to the incidental E-ATTR-001/E-SCOPE-001 pair). Read SPEC §51.0.M in full. Fix the placement diagnostic so the markup-locus (and any outside locus) fires E-STRUCTURAL-ELEMENT-MISPLACED. Find where E-STRUCTURAL-ELEMENT-MISPLACED fires for the ${}-locus + extend it to the markup locus. (This is the same class as the ss56 escalation — check whether `<onIdle>` / other structural elements share the markup-locus gap and fix consistently if trivially adjacent; else note it.)

## Author the unblocked conformance case (conformance/cases/endpoint/)
The §61 endpoint dispatch could NOT author the dead/unknown-arm case (it was divergent). Now that divergence 1 is fixed, author it: an `<endpoint>` with a fully-exhaustive `accepts=` PLUS a dead arm naming a variant not in the enum → the §18.0.1 code fires. Follow the existing endpoint/ case shape. (Optionally add an onTimeout-markup-misplaced case under the engine category if a clean shape exists — the ss56 onTimeout cases live under engine/.)

## Verify
Reproduce each first (scratchpad, canonical shapes from samples/tests). `bun conformance/run.ts` all green + full pre-commit gate — 0 fail (typer/diagnostic change = wide blast radius; the onTimeout code change may flip pre-existing engine cases/samples that asserted the old codes — check + reconcile). Commit per-fix on your branch; do NOT push/advance main.

## Deliverables
- S136: `docs/changes/diagnostic-precision-fixes-2026-07-10/BRIEF.md` + progress.md.
- Return: each fix's fire-site + change; whether onIdle/siblings shared the gap; any pre-existing case/sample that flipped (and how reconciled); the conformance case-id(s) authored; oracle before→after; full-gate result; branch tip SHA. Do NOT claim done without the gate + oracle output. Do NOT land.
