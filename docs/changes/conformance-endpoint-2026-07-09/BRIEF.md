# BRIEF — Conformance cases for the scrml `<endpoint>` typed-inbound primitive (§61)

Dispatch: Author conformance cases for the scrml `<endpoint>` typed-inbound primitive (§61).
Isolated worktree — do NOT land to main, do NOT push; commit per-item on branch; PA reviews +
integrates. Mirrors the just-landed realtime §38 conformance pattern
(`conformance/cases/channel/`, commit b1b3a7b2) — same method, same discipline.

## VERIFY FIRST (non-negotiable)
Establish GROUND TRUTH before authoring — NOT from any planning doc:
1. `grep -rlF '<endpoint' conformance/cases/` + `grep -rli endpoint conformance/cases/` — see
   EXACTLY what §61 coverage already exists (last check: zero). Read any hit; do NOT duplicate.
2. `bun conformance/run.ts` — baseline oracle (currently 250). DoD measured against the real number.
Author ONLY genuine, verified-uncovered §61 surfaces.

## The surface (SPEC §61 + §34)
Read SPEC.md §61 IN FULL (the `<endpoint>` typed-inbound primitive — landed S219, W2-W5) + the
`E-ENDPOINT-*` codes in §34. Ground behavior against the source + tests. The surface covers: the
`<endpoint>` declaration + typed inbound payload, method/route, validation of the inbound shape,
and its placement/composition rules.

## Harness reality (author what's SOUNDLY testable; escalate the rest)
The RUNTIME half of `<endpoint>` (an actual inbound HTTP request → typed parse → handler
execution) is harness-gated the same way server-fn runtime is. AUTHOR the codes half (all the
`E-ENDPOINT-*` / validation / placement diagnostics — pos + neg) + any compile-shape that is
soundly observable. FLAG any runtime case that needs a driver the adapter lacks as track-B
harness-gated + escalate — do NOT author a runtime case that only asserts a stub.

## Method (the suite contract)
Each case = `conformance/cases/endpoint/<case-id>/{case.scrml, expected.json}`; assert ONLY
(a) codes-fire + (b) runtime effect. Message text / emitted-JS / AST = impl-freedom.
EMPIRICAL-FIRST + Rule 4: probe impl#1's actual behavior AND read the SPEC §61 subsection before
locking each expected.json. If impl#1 diverges from SPEC, author to the SPEC and ESCALATE.

## Verify + land (branch only)
`bun conformance/run.ts` all green + `bun test compiler/tests/conformance/corpus-bridge.test.js`.
Commit per-item on branch. Do NOT advance/push main.

## Deliverables
- `docs/changes/conformance-endpoint-2026-07-09/BRIEF.md` + progress.md.
- Return: existing §61 coverage found, case-ids authored, oracle before→after, harness-gated
  runtime cases FLAGGED, any impl#1-vs-SPEC §61 divergence (escalated), branch tip SHA.
