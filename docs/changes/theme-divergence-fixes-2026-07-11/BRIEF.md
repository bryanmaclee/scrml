# BRIEF — Fix two §65 `<theme>` impl-vs-SPEC divergences + author unblocked conformance cases

> Archived verbatim from the dispatch prompt (S136 dispatch-archive protocol).

Fix two §65 `<theme>` impl-vs-SPEC divergences (PA-ruled fix-impl) + author the conformance cases they unblock. Isolated worktree — do NOT land to main; commit on your branch; the PA reviews (S239) + lands. Reproduce EACH first; Rule 4 (read the SPEC subsection in full; author to the SPEC).

## Divergence A — <theme> (and <defaults>) misplacement fires the wrong code (§65.9/§65.10)
SPEC §65.9/§65.10 promise `E-STRUCTURAL-ELEMENT-MISPLACED` for a misplaced `<theme>`/`<defaults>`. Empirically impl#1 instead fires `E-COMPONENT-020/021/035` when `<theme>` is inside a component body, AND wrongly ACCEPTS `<theme>` at file top-level (no diagnostic). Read SPEC §65.9 + §65.10 in full to learn the VALID placement of `<theme>`/`<defaults>` (where are they allowed? what's the misplacement rule?), then fire `E-STRUCTURAL-ELEMENT-MISPLACED` when outside it. NOTE: the diagnostic-precision fix (commit `205a67b3`) added a structural-element-placement mechanism (`ENGINE_CHILD_MARKUP_ONLY_ELEMENTS` in ast-builder.js) for `<onTimeout>`/`<onIdle>` — study it; `<theme>`/`<defaults>` may extend the same mechanism, or need their own placement gate (their valid loci differ from engine-children). Author to what §65.9/§65.10 actually specify.

## Divergence B — theme/defaults name-collision not caught (§65.9/§65.10)
SPEC §65.9/§65.10 promise `E-NAME-COLLIDES-RESERVED` when `theme`/`defaults` is used as a user identifier; empirically `const theme = <...>` compiles clean. Read the SPEC to confirm the exact reserved-name rule (are `theme`/`defaults` reserved as identifiers, or only as element names? what triggers the collision?). Find the existing reserved-identifier / name-collision check (grep for `E-NAME-COLLIDES-RESERVED` fire-site) and extend it to cover `theme`/`defaults` per the SPEC.

## Reproduce FIRST
For each: a scratch file exhibiting the misplacement / the `const theme = ...` collision → confirm the current wrong behavior (E-COMPONENT-* / clean-compile) before fixing.

## Author the unblocked conformance cases (conformance/cases/style/)
The CSS §65 dispatch flagged these as divergences + couldn't author them. Now author: `theme-misplaced` (a misplaced `<theme>` → E-STRUCTURAL-ELEMENT-MISPLACED) + `theme-name-collision` (`const theme = <...>` → E-NAME-COLLIDES-RESERVED). Follow the existing style/ case shape (id/description/spec/rationale/expect{codes,notCodes,severity}).

## Verify + land (branch only)
Reproduce-first. `bun conformance/run.ts` all green + FULL pre-commit gate — 0 fail (a new placement/collision error could red pre-existing samples/cases that used `<theme>` top-level or a `theme` identifier — check + reconcile; the CSS §65 conformance cases just landed use `<theme>` at valid loci + a `theme` token-name inside `<theme>`, distinct from a top-level `const theme` — verify they stay green). Commit per-item on your branch; do NOT push/advance main.

## Deliverables
- S136: `docs/changes/theme-divergence-fixes-2026-07-11/BRIEF.md` + progress.md.
- Return: each fix's fire-site + the SPEC rule it implements; whether they share the structural-placement mechanism or needed a new gate; any pre-existing sample/case that flipped (and how reconciled); the conformance case-ids; oracle before→after; full-gate result; branch tip SHA. Do NOT claim done without the gate + oracle output. Do NOT land.
