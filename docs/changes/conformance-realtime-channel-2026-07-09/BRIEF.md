# BRIEF — Conformance cases for scrml realtime (§38.13 `<channel watches=>` + `<onchange>`/RowChange)

Dispatch: Author conformance cases for scrml realtime — §38.13 `<channel watches=>` +
`<onchange>`/RowChange. Isolated worktree — do NOT land to main, do NOT push; commit
per-item on branch; PA reviews + integrates.

## VERIFY FIRST
Establish ground truth (not from any planning doc):
1. `grep -rlF '<channel' / 'watches=' / '<onchange' conformance/cases/` — see exactly what
   realtime coverage already exists.
2. `bun conformance/run.ts` — baseline oracle count.
Author ONLY genuine, verified-uncovered §38.13 surfaces.

## Surface (SPEC §38.13 + §38 + §34)
- `<channel watches=<table>>` — a server-fed read-only change-feed mode of §38 over EXTERNAL
  Postgres commits.
- `<onchange>` exhaustive arms over the compiler-synthesized
  `RowChange:enum = { Inserted(row), Updated(row), Deleted(key) }` (§38.13.2/§38.13.3).
- Composition with a §52 `authority="server" table=` collection (§38.13.5).
- Codes: `E-CHANNEL-WATCHES-*` family + `<onchange>` non-exhaustive-arms + misplacement.

## Harness reality
The realtime RUNTIME half (real Postgres commit → pg_notify → LISTEN bridge → client
`__change` patch) has NO test-env driver in the conformance adapter (no real-PG, no WebSocket).
- AUTHOR the codes half (all `E-/W-CHANNEL-WATCHES-*` / exhaustiveness / placement — pos + neg).
- AUTHOR any compile-shape client-observable without live PG (RowChange synthesis recognized,
  `<onchange>` arm typing).
- FLAG the live-PG/WS runtime cases as harness-gated (track B) + escalate; do NOT author a
  runtime case that only asserts a stub (the unsound ss60 trap).

## Method
Each case = `conformance/cases/<category>/<case-id>/{case.scrml, expected.json}`; assert ONLY
(a) codes-fire + (b) runtime effect. Message text / emitted-JS / AST = impl-freedom.
EMPIRICAL-FIRST + Rule 4: probe impl#1 actual behavior AND read the SPEC §38.13 subsection
before writing expected.json; if impl#1 diverges from SPEC, author to SPEC and ESCALATE.

## Verify + land (branch only)
`bun conformance/run.ts` all green + `bun test compiler/tests/conformance/corpus-bridge.test.js`.
Commit per-item on branch. Do NOT advance/push main.
