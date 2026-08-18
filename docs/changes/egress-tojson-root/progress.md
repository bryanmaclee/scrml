# progress — egress-tojson-root

Append-only. Timestamps are local (America/Denver).

## 2026-08-18 — startup

- Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a3748d68a1d807f9c`
- `git fetch origin egress-fix-r1` + `git checkout -B egress-tojson-root FETCH_HEAD` -> HEAD
  `a112c92f` (confirmed, matches brief).
- `bun install` (217 packages) and `bun run pretest` (13 samples compiled) both clean.
- Read `docs/changes/egress-tojson-root/BRIEF.md` in full; read `.claude/maps/primary.map.md`
  header + Task-Shape Routing.
- Read `compiler/src/codegen/protect-egress.ts` (531 lines) in full.
- NEXT: reproduce the PA's four A/B shapes on this tree BEFORE touching source (baseline),
  then Unit 1 (delete the toJSON install), then scope Unit 2.

## 2026-08-18 — baseline A/B reproduced (PA's table, re-run on this tree)

Compiled every shape with BOTH compilers: `origin/main` `d604df09` exported to a scratch tree via
`git archive` (read-only on git; no `cd` into the main checkout at any point), and this worktree at
`a112c92f`.

| case | shape | MAIN exit | BRANCH `a112c92f` exit | E-PROTECT-004 |
|---|---|---|---|---|
| A | `handle()` + inline SQL + `new globalThis.Response(JSON.stringify(u))` | 0 | **1** | fires on branch only |
| B | A + `{...u}` spread | 0 | **1** | fires on branch only |
| C | SQL in a CALLED helper + spread | 0 | 0 | **silent on both** |
| D | SQL in a CALLED helper, NO spread | 0 | 0 | **silent on both** |

PA's finding CONFIRMED, and D is the control that settles it: the gate goes silent across one call
hop **with or without the spread**. The CALL BOUNDARY is the defeater, not `{...u}`. The S349 round's
"object spread drops the toJSON hook" was the wrong cause for Blocker 1.

### Executed the emitted helper (extracted from a REAL artifact, not read)

`exec-helper.mjs` slices the `_SCRML_PROTECT` .. end-of-`_scrml_protect_redact` block out of a
compiled `*.server.js` by brace-matching and evaluates it. Both sides:

| probe | MAIN `d604df09` | BRANCH `a112c92f` |
|---|---|---|
| `JSON.stringify(u)` | `{"id":1,"name":"ada","passwordHash":"SECRET"}` | `{"id":1,"name":"ada"}` |
| `JSON.stringify({...u})` | full row | **full row — LEAKS** |
| `JSON.stringify(Object.assign({},u))` | full row | **full row — LEAKS** |
| descriptor survives spread | true | true |
| `toJSON` survives spread | false | **false** |
| `_scrml_protect_redact(u)` | `{"id":1,"name":"ada"}` | `{"id":1,"name":"ada"}` |
| `_scrml_protect_redact({...u})` | `{"id":1,"name":"ada"}` | `{"id":1,"name":"ada"}` |

**Blocker 2 CONFIRMED by execution**: the branch's server-INTERNAL `JSON.stringify(row)` silently
drops columns. **Blocker 1's mechanism CONFIRMED**: `toJSON` does not survive a shallow copy while
the Symbol descriptor does — so the compiler-owned sink is spread-robust and only the hook is not.

## 2026-08-18 — Unit 1 + Unit 2 landed (one commit: coupled code + tests)

### Unit 1 — the `toJSON` install is deleted

`compiler/src/codegen/protect-egress.ts`: `_scrml_protect_mark` removed entirely, callers set the
Symbol descriptor directly (main's exact shape restored). Comment blocks rewritten in three places:
the module docblock item 4, the emitted helper's own header, and the gate's SOUNDNESS BOUND note.

**PA LOCUS WAS INCOMPLETE — three more sites carried the same false claim:**

1. `compiler/src/codegen/emit-server.ts:~4394` — a comment asserting "a tagged row carries a
   non-enumerable `toJSON` that returns the redacted projection". Rewritten.
2. `compiler/tests/integration/g-sql-row-protect-leak.test.js:~198` — the assertion dpa-030 D2c
   changed from the full row to `{ id: 1 }`. Restored to full fidelity, with the reason recorded.
3. same file, `describe("§14.8.9 D2c — a tagged row redacts itself at JSON.stringify")` — an entire
   11-test block asserting the hook's behaviour. Replaced with a block asserting the post-S350
   semantics (tag is inert metadata; the compiler-owned sink is the redaction mechanism; the sink
   redacts THROUGH a shallow copy, which is the property the hook lacked).

Emitted-helper differential: the FIXED tree emits a 37-line helper, identical to main's, with
`toJSON` absent and `INTERNAL JSON.stringify(row) full-fidelity? = true`. Verified by EXECUTING the
extracted block from a real `*.server.js`, not by reading it.

### Unit 2 — E-PROTECT-004 now reaches across the same-file call graph

**AFFORDABLE — no new pass infrastructure.** `emit-server.ts` already had the whole file's function
list in scope (`fnNodes`, api.js `analysis.fnNodes` or `collectFunctions(fileAST)`), and the call
edge is a plain `{kind:"call", callee:{kind:"ident", name}}` — confirmed by dumping a REAL AST from
`C-crosscall-spread.scrml`, not assumed.

Design: for each function F the EFFECTIVE BODY is F plus every same-file function F transitively
calls; the existing single-body predicates run over that set unchanged. One rule covers both
directions. Reported at the INNERMOST firing root, so one leak path yields one diagnostic.

New in `protect-egress.ts`: `collectCalledNames`, `callClosure`, `detectProtectedRawEgressAcrossFile`
(+ `ProtectedRawEgressFinding`). `findProtectedQuery` / `findRawEgress` factored out of
`detectProtectedRawEgress`, which stays exported as the intraprocedural entry.

Deliberate choices, both recorded in-source:
- aliases are collected PER BODY, never merged across the closure (a merged map would make an
  unrelated local `R` in one function resolve to another function's `globalThis.Response` alias);
- `reveal("col")` IS honoured across the closure, matching the within-body rule — otherwise an
  explicit reveal becomes unsilenceable the moment the author factors the query into a helper.

### A/B after the fix (8 cases, both compilers)

| case | MAIN | FIXED |
|---|---|---|
| A inline + `globalThis.Response` | 0 silent | **1 FIRES** |
| B inline + spread | 0 silent | **1 FIRES** |
| C SQL in callee + spread | 0 silent | **1 FIRES** |
| D SQL in callee, no spread | 0 silent | **1 FIRES** |
| E raw egress in CALLEE (reverse direction) | 0 silent | **1 FIRES** |
| F `reveal` in the callee | 0 silent | 0 silent (correctly suppressed) |
| G protect + no raw egress | 0 silent | 0 silent |
| H raw `403` egress, no protected query | 0 silent | 0 silent |

The intraprocedural message is byte-identical to before (case A); the cross-call message names the
other function (`calls \`fetchUser\`, which selects …`, `… via \`wrap\``).

### Verification at this commit

- `bun test compiler/tests/integration/g-sql-row-protect-leak.test.js` — **70 pass / 0 fail**.
- `bun conformance/run.ts` — **883/883**.

**MIGRATION SET REFINEMENT (PA premise, corrected):** the brief named
`conformance/cases/protect/raw-egress-e004` and `.../reveal-suppresses-e004` as the measured
migration set. Both are INTRAPROCEDURAL shapes, so Unit 2 does not change what either asserts and
**zero expected.json edits were required**. The set was identified correctly; the migration cost is
nil.

- NEXT: `bun scripts/corpus-emit-differential.ts` base-vs-head (the standing pre-land gate for
  `compiler/src/codegen/` per primary.map.md), then the full `bun run test`.

## 2026-08-18 — full suite + corpus emit differential

### Full suite: ZERO new failures (name sets byte-identical)

Ran `bun run test` on BOTH sides in this same worktree (checkout base, run, checkout head, run) so
the environment is held fixed:

| | pass | skip | todo | fail | tests |
|---|---|---|---|---|---|
| base `a112c92f` | 30053 | 216 | 1 | **53** | 30323 |
| head `540fdba2` | 30062 | 216 | 1 | **53** | 30332 |

`diff` of the sorted `(fail) <name>` sets is **EMPTY** — the same 53 tests fail on both sides, and
not one of them is protect-related. They live in `browser/browser-navigate-cross-chunk`,
`browser/browser-navigate-soft-nav`, `browser/browser-transitions`, `self-host/bs`,
`unit/a5-2-parser-support`, `unit/esm-script-tag-module-format`. **PRE-EXISTING — not mine.**
(+9 tests, +9 passes = the net new cross-call coverage.)

### Corpus emit differential — and the instrument had to be proved first

`bun scripts/corpus-emit-differential.ts` (the standing pre-land gate for `compiler/src/codegen/`
per primary.map.md's Task-Shape Routing). **My first run was invalid and I nearly reported it.**

- Run 1 captured base from a `git archive` export in the scratchpad and head from the worktree.
  Verdict: `NOT A VALID COMPARISON`, **1070** differing artifacts, all `*.client.js`, every one at
  IDENTICAL byte length. Two defects in MY harness, not in the code:
  1. `git rev-parse` fails in a `git archive` export -> the tool correctly flagged
     `[INCOMPARABLE] a side's revision is "<unknown>"`.
  2. The 1070 were a red herring with a real cause: the emitted chunk-scope id is **path-derived**.
     Diffing one file showed `// --- chunk cell scope (01fu57yg) ---` vs `(000h8maz)` and nothing
     else. Two different `--compiler-root` absolute paths => 1070 spurious diffs.
- **Determinism control before trusting any reading:** captured head TWICE from the same path and
  self-diffed -> `VERDICT: NO DIFFERENCES`, 0 of 7383. The instrument is sound; the inputs were not.
- Run 2, both sides captured from the SAME absolute path (checkout base in the worktree, capture;
  checkout head, capture):

```
VERDICT: 55 DIFFERENCE(S)  over 1906 common sources, 7383 compared artifacts
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    55 of 7383 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  load-context changes      0
  bare server-fn sites      base 145 / head 145 (delta 0)
```

Breakdown of the 55, measured not eyeballed:
- **55 of 55 are `*.server.js`. ZERO `*.client.js` changed.**
- **55 of 55 shrink by exactly −186 bytes** (the deleted `_scrml_protect_mark` + `toJSON` install,
  net of the new comment lines).

**This is the Unit 1 proof the brief asked for: the deletion is INERT ON THE WIRE PATH.** Client
output is byte-identical across all 1906 corpus sources; only server-internal bytes move, uniformly.

**And it is the Unit 2 blast-radius measurement: `0 newly failing`.** The newly-rejecting direction
rejects NOTHING in a 1906-source corpus. Combined with 883/883 conformance, the measured migration
cost of Unit 2 is ZERO files.

### SPEC check (Rule 4) — no amendment owed

Read §14.8.9 in full (`compiler/SPEC.md:8450-8560`) plus the `E-PROTECT-004` catalog row
(`SPEC.md:19284`). **Neither carries a within-function-body qualifier.** The catalog row says a
protected-origin column that "reaches a compiler-unanalyzable egress path ... SHALL fail closed";
the prose says "An egress path the compiler cannot analyze ... that carries a protected-origin
column SHALL fail closed". So **Unit 2 is a COMPLIANCE FIX, not a widening** — the intraprocedural
behaviour was the SPEC-noncompliant state. No SPEC edit made, and therefore no Rule 4b
`> **Provenance:**` line is owed.

Unit 1 is likewise a compliance restoration: §14.8.9 describes a DESCRIPTOR that "propagates
through every compiler-emitted construction step — `{...row}` spread, helper return, `.map` /
iteration" and is "read at the single sink". That is the Symbol descriptor, which the executed
probe confirms survives every shallow copy. A value-level serialization hook appears nowhere in
§14.8.9; it was an unmandated addition, and it lacked the one property the SPEC names.

### The `handle()` masking defect — VERIFIED on this tree, and NARROWED

The PA's mid-dispatch finding (`g-handle-middleware-call-to-escalated-fn-emits-undefined-reference`)
reproduces here. In main's emitted artifact for the cross-call shape, `case.server.js:197` is
`let u = fetchUser(1);` and there are **ZERO definitions of `fetchUser` in the module** — only the
escalated route handler `_scrml_handler_fetchUser_1`.

**REFINEMENT the PA did not have — the discriminator is `handle()`, not callee escalation.** Two
controls:

| probe | caller | callee | peer callable emitted? |
|---|---|---|---|
| I | `server function listUsers` | plain `function fetchUser` | **YES** — `// Issue #1: in-process peer callable for server function "fetchUser"` |
| J | `function handle` | `server function fetchUser` | **NO** — bare `fetchUser(1)`, undefined |

So the callee's declaration form is irrelevant; the peer callable is emitted for a server-fn caller
and NOT for a `handle()` caller, even when the callee is an explicit `server function`. Whoever
fixes this should look at the caller-side call-site collection that drives peer-callable emission,
not at callee escalation.

**SEQUENCING CONSTRAINT — recorded in source, not just here.** The leak Unit 2 closes is currently
MASKED (not absent) by this defect: the cross-call shapes throw a ReferenceError before they can
ship a column. **Fixing the undefined-callee defect WITHOUT Unit 2 in place would UNMASK a
confidentiality leak.** Unit 2 is a prerequisite for that fix, not an alternative to it. This is
written into the `detectProtectedRawEgressAcrossFile` header comment in
`compiler/src/codegen/protect-egress.ts` so it is found by anyone touching the `handle()` call path
(co-location: if a thing does a thing, look at the thing). NOT fixed here — out of scope,
pre-existing on main, and fixing it inside a security branch is exactly the wrong place.

### NOT done, deliberately

- Did NOT fix `g-handle-middleware-call-to-escalated-fn-emits-undefined-reference` (brief: file-or-
  reference only).
- Did NOT edit `docs/known-gaps.md` — it is a PA-owned shared doc and is already modified on main;
  a wholesale file-delta would clobber the PA's session version. The sequencing constraint is in
  source + here instead. **PA: the known-gaps entry is yours to author.**
- Did NOT amend SPEC (see the Rule 4 check above — nothing to amend).
- Did NOT extend the closure across FILES or through indirect calls. Both bounds are stated in
  source. Cross-file would need import resolution the codegen pass does not carry; indirect calls
  need value-flow. Neither is required by §14.8.9's text and both are the fail-closed direction to
  leave open (they under-approximate the gate, they do not weaken the redaction floor).
