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

## 2026-08-18 — FIX ROUND 1 (S239 adversarial pass, 7 findings)

All three PA-reproduced blockers reproduced on THIS tree before any code changed. Every one held.

### Blocker reproduction, base `8c8c29cf` vs main `d604df09`

| case | shape | MAIN | BRANCH `8c8c29cf` | verdict |
|---|---|---|---|---|
| K | `a` holds SELECT + calls `b`; `b` calls `a` + raw `Response`; `handle` calls `b` | 0 silent | **0 SILENT** | **B1 CONFIRMED** |
| K2 | same, back-edge `b -> a` REMOVED | 0 silent | 1 FIRES | the edge is the whole difference |
| L | `export server function getUser(id) -> asIs` + protected SELECT | **1 FIRES** | **0 SILENT** | **B2 CONFIRMED — regression vs main** |
| M | unrelated `other(v) { return v.reveal("passwordHash") }` + SELECT + raw Response | 0 silent | **0 SILENT** | **B3 CONFIRMED** |
| M2 | same with `other` returning `v` unchanged | 0 silent | 1 FIRES | the unrelated reveal is the whole difference |

### B1 — a call cycle disabled the gate entirely

Root cause exactly as the PA stated. `closure(f).some(b => b !== f && raw.has(b))` classifies both
members of a cycle as "not innermost" (each because of the other), drops both, and drops every
enclosing caller with them.

Fix: **strict containment.** `R'` suppresses `R` only when `R'` is reachable from `R` AND `R` is not
reachable from `R'`. Cycle members can no longer suppress each other, so a cycle FIRES. To keep one
leak path at one diagnostic, mutually-reachable survivors elect a single deterministic
representative (first in `fnNodes` order — the emitter's own order). Verified: K fires with exactly
**1** diagnostic, reported on `a`.

The PA was right that the existing `MUTUAL recursion terminates` test could not have caught this —
its cycle contains no raw egress, so neither half ever fires and the filter is never exercised. Four
new tests, including a `fireCount === 1` assertion and a cycle-with-no-egress negative control.

### B2 — the enumeration the PA asked for (MEASURED, not assumed)

I did not reason about which fields exist. A temporary probe walked a REAL AST of a program spelling
`asIs` in every position the grammar allows and printed the carrying field:

| position | source spelling | node kind | field | covered before? |
|---|---|---|---|---|
| function return type | `function f() -> asIs` | `function-decl` | `returnTypeAnnotation` | **NO — the regression** |
| let annotation | `let u: asIs = …` | `let-decl` | `typeAnnotation` | yes |
| const annotation | `const u: asIs = …` | `const-decl` | `typeAnnotation` | yes |
| param annotation | `function f(sink: asIs)` | param entry | `typeAnnotation` | yes |
| array/union suffix | `let u: asIs[]` | `let-decl` | `typeAnnotation` (`"asIs[]"`) | yes |
| — | any of the above | `function-decl` | `raw` (the fn SOURCE SLICE) | **deliberately excluded** |

`raw` carries the literal text `asIs` for every spelling because it is the function's source slice.
Matching it would re-introduce the source-text co-occurrence regex dpa-030 D2b removed and would fire
on `asIs` in a comment or a string literal. Two negative-control tests pin that.

Fix matches the **convention**: any node property whose key ends in `Annotation`. Hand-listing
`{typeAnnotation, returnTypeAnnotation}` is the fail-OPEN shape this file's own invariant-52 note
warns about, and `returnTypeAnnotation` is exactly what a two-name list missed. Verified the node
field set ending in `Annotation` is exactly those two at this revision (`synthReturnTypeAnnotation`
is a LOCAL in ast-builder that lands as `returnTypeAnnotation`), so the suffix test is equivalent
today and stays correct when a position is added. Nine tests, one per position plus the two
negatives. Case N (all five positions in one file) now fires 5 diagnostics, `p1`..`p5` — identical to
main.

### B3 — reveal is now path-scoped

The PA is right to raise this above MEDIUM, and right that the tension I flagged is real. The
resolution is to scope it, not drop it.

`reveal("col")` is honoured from the **query holder** and the **egress holder** only. That is the
tightest scope that still covers both natural factorings — the reveal at the fetch
(`return u.reveal("pw")` in the helper) and the reveal at the send
(`JSON.stringify(u.reveal("pw"))` at the boundary). Both are tested.

**Stated bound, tested and documented in source:** a reveal on a MIDDLE function that neither
queries nor egresses is NOT honoured and **fails closed**. The call graph cannot distinguish "mid
reveals the row that leaks" from "mid reveals something unrelated" without value-flow analysis, and
per the PA's constraint the unprovable case fails closed. The author moves the reveal to either end.

Intraprocedural semantics are unchanged: there query-holder == egress-holder == the body, so
`detectProtectedRawEgress` and both conformance protect cases are untouched.

### R4 — RELAYED, then VERIFIED BY EXECUTION, then fixed

Not taken on trust. Extracted `_scrml_read_json_body` from a real emitted artifact and ran it:

```
happy path ok                         = true
malformed -> envelope                 = true
locked body -> envelope (no throw)    = NO — UNCAUGHT TypeError: ReadableStream is locked
disturbed body -> envelope (no throw) = NO — UNCAUGHT TypeError: ReadableStream is locked
```

CONFIRMED. `getReader()` sat outside the `try`, so a locked/disturbed body bypassed the
compiler-owned 400 envelope §61.3 exists to guarantee. Moved inside the `try`. Re-executed against a
FRESHLY emitted artifact: both now `YES status 400`, happy and malformed paths unchanged. Three
executed regression tests added to `json-body-guard.test.js`.

### R5 — REPRODUCED, deliberately NOT changed

A param named `Response` does build-block valid source (`new Response(u)` on a param that is not the
global). But **main fires identically** — this is NOT a regression I introduced, it is pre-existing
behaviour, and it over-fires in the fail-CLOSED direction.

Not fixing it is a deliberate call, and here is the cost: the fix would add a new SUPPRESSION path to
a confidentiality gate, in the same round that found three fail-opens in this exact gate. It also has
a fail-open tail of its own — once a param named `Response` shadows the global, `serveUser(id,
globalThis.Response)` passes the real constructor in and the gate goes silent. That deserves its own
scoping and its own adversarial pass, not a drive-by in a fix round. **Surfaced for PA triage.**

### R6 — REPRODUCED as claimed: drift hazard, no live defect

`emit-server.ts:3140` derives `resolveParamName` while the `resolve` binding at :3125 is hard-coded.
Additionally `requestParamName` at :3129 tests `typeof handleParams[0] === 'string'`, but params are
OBJECTS (`{name, …}`), so that test is always false and it always falls back to the literal
`'request'` — the derivation there is already inert. Both are harmless because `isHandleEscapeHatch`
pins the signature to exactly `(request, resolve)`. NOT changed: it is inside the `handle()` emission
path the brief fenced off, and there is no live defect.

### R7 — taken, because it fell out of B1's rework as the PA allowed

The B1/B3 rework initially made this WORSE: scoping reveal per (query-holder, egress-holder) pair put
an AST walk (`findProtectedQuery`) in the inner loop, i.e. O(roots x egress x query) walks. Fixed
properly rather than left: per-body reveals, raw-egress and protected-query SITES are each walked
ONCE and reused; the pairing loop is now a pure list scan with no AST walk. `findProtectedQuery`
delegates to the same two helpers the interprocedural path uses, so the intraprocedural and
interprocedural entries share one implementation of the coverage rule and cannot drift.

### Verification at `171039fa`

Full 17-shape A/B matrix, both compilers — every leak shape fires, every legitimate factoring and
negative control stays silent:

| case | MAIN | FIX1 | | case | MAIN | FIX1 |
|---|---|---|---|---|---|---|
| A inline `globalThis.Response` | 0 | **1** | | K cycle (B1) | 0 | **1** |
| B inline + spread | 0 | **1** | | K2 cycle, no back-edge | 0 | **1** |
| C SQL in callee + spread | 0 | **1** | | L `-> asIs` return (B2) | 1 | **1** |
| D SQL in callee, no spread | 0 | **1** | | M unrelated reveal (B3) | 0 | **1** |
| E egress in callee | 0 | **1** | | M2 reveal removed | 0 | **1** |
| F reveal in query-holder | 0 | 0 | | N all 5 `asIs` positions | 1 | **1** |
| G protect, no raw egress | 0 | 0 | | P reveal at egress-holder | 0 | 0 |
| H raw 403, no query | 0 | 0 | | Q cycle, no egress | 0 | 0 |
| | | | | R5 param shadow (pre-existing) | 1 | 1 |

- `g-sql-row-protect-leak.test.js` — **89 pass / 0 fail** (was 70; +19).
- `json-body-guard.test.js` — **15 pass / 0 fail** (+3 executed R4 tests).
- Conformance — **883/883**. Neither protect case needed an expected.json change.
- Full suite — **30084 pass / 216 skip / 1 todo / 53 fail / 30354 tests**; failing NAME SET
  byte-identical to the `a112c92f` baseline (`diff` empty). **Zero new failures.**

### Corpus emit differential (same absolute path both sides, `a112c92f` -> `171039fa`)

```
VERDICT: 222 DIFFERENCE(S)  over 1906 sources, 7383 artifacts
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 1 text-only
  artifact content diffs    221 of 7383
  syntax delta (effective)  0 new / 0 fixed
  load-context changes      0
  bare server-fn sites      base 145 / head 145 (delta 0)
```

- **221 of 221 are `*.server.js`. ZERO `*.client.js` changed** — the wire path is still
  byte-identical across the whole corpus, and the gate got strictly STRONGER in this round.
- **`0 newly failing`** — three fail-opens closed and the corpus still rejects nothing.
- Byte deltas cluster at −186 / +344 / +530: the `toJSON` deletion and two comment blocks. Diffed an
  artifact to confirm there is no behavioural JS beyond the intended changes.
- The **1 text-only diagnostic change** is `samples/gauntlet-r13/react-auth-dashboard.scrml`, and it
  is fully explained: a `W-CG-UNDEFINED-INTERPOLATION` message cites `server line 147` on base and
  `server line 154` on head, because the R4 comment lengthened the emitted body guard by 7 lines.
  Same codes, same exit code, same message text otherwise.

### One self-inflicted break, caught by the gate and fixed properly

The first R4 comment used the literal token `ReadableStream`, which is emitted into every
`server.js`, and `server-function-sse.test.js` asserts a non-SSE handler's output does NOT contain
that token (its proxy for "no streaming machinery"). The pre-commit gate caught it. I reworded the
COMMENT rather than loosening the assertion: a streaming-isolation check should not be weakened to
accommodate prose, least of all in a security fix round.

### Standing rules honoured

No `--no-verify`. No `core.hooksPath` override. Did not touch the `handle()` undefined-callee defect
or `docs/known-gaps.md`.

## 2026-08-18 — FIX ROUND 2 (re-review of `da526a7d`, 6 findings, 2 HIGH)

Both HIGHs and M3 reproduced on this tree before any code changed.

| case | shape | MAIN | `da526a7d` | verdict |
|---|---|---|---|---|
| H1 | reveal `a`, egress `b`, two query sites | 0 silent | **0 SILENT** | **H1 CONFIRMED — fail-open** |
| H2 | `fmt(v: asIs)` callee, row never leaves | 0 silent | **1 FIRES** | **H2 CONFIRMED — false build break** |
| H2b | identical with `: asIs` dropped | 0 silent | 0 silent | the annotation is the whole difference |
| M3 | shared `bad()` 404 helper + protect app | 0 silent | **1 FIRES** | M3 CONFIRMED (was relayed) |

### H2 — FIXED. The convention was right; it needed the ingress/egress half.

Matching every key ending in `Annotation` swept in the PARAM entry. A param
annotation is an INGRESS. Egress positions are now named by POSITIVE node-kind
membership (`function-decl` for a return type; `let-decl`/`const-decl`/`state-decl`
for a binding), which is invariant 54's rule — opt in on a positive test, never on
the absence of one. A param entry carries no `kind` at all, so it can never satisfy
the test even if a new annotation key lands on it.

**COUNTED, because round 1's own instruction demands it before any narrowing.** This
gives up one position main covered: main's source-text regex fired on a param, so
`function f(sink: asIs) { sink(row) }` — a param that IS the sink — is no longer
caught. Case N drops from `p1..p5` to `p1/p2/p3/p5`. Separating a sink param from a
formatting param is a value-flow question, not an annotation question. The B2 param
test is INVERTED with that reasoning at its site, plus two tests for the reported
false-break shape.

### L5 — FIXED. A dropped finding is a fail-open.

A span-less innermost root hit `continue` and discarded the WHOLE finding. That was
survivable when every root reported independently; it is not once the innermost
filter elects exactly ONE root per leak path. Now falls back: egress holder's span →
query holder's span → file head. The finding carries both holder nodes so the
emitter can do that. A confidentiality diagnostic is never dropped for want of a
cursor.

### L6 — FIXED. `collectCalledNames` memoized per node (WeakMap).

### M3 — REPRODUCED, deliberately NOT fixed, and here is the cost

`bad()` returns a raw `Response` built from a literal; it takes no parameters, so the
protected row cannot be handed to it. Closure pairing still matches the query in
`getUser` with the egress in `bad`.

The cheap rule I considered: **an egress in a callee can only carry the row if the
callee can RECEIVE it — a zero-arity callee cannot.** That is a DETECTION-precision
fix, not a new declassification hole, which is the safer axis. But it is not
soundness-free: a zero-param helper could read a module-level binding holding the
row, and §14.8.9's stated bound only clearly excludes values "computed from" a
protected column, not the row itself parked in module scope.

I did not implement it, for one reason: **it is entangled with the H1 verdict.** If
cross-call pairing goes back to design, M3 evaporates. If Unit 2 ships as-is, M3 is
worth doing and the rule above is the proposal. Adding a narrowing to a mechanism I
am simultaneously recommending be reconsidered would be working against my own
recommendation. Cost of leaving it: a shared 404/403 helper — the natural factoring
now that D2a made `new Response(...)` ordinary adopter source — hard-blocks any
`protect=` app, with no remedy (`reveal` on a Response carrying no row is nonsense).

### M4 — untouched, as instructed. R5 / R6 — unchanged from round 1.

---

## H1 — ATTEMPTED VIA BINDING IDENTITY AS INSTRUCTED. IT DOES NOT WORK.
## Escalating, per the escape clause.

I probed the class before coding, and it is wider than the reported shape. **Three
fail-opens, three DIFFERENT mechanisms**, all exit 0 with zero diagnostics, all
shipping `passwordHash` at HTTP 200 — measured on `da526a7d`:

| # | shape | binding identity? |
|---|---|---|
| H1 | two query sites, two bindings; reveal `a`, egress `b` | **would fix** |
| H1b | one site; `let b = a`; reveal `a`, egress `b` | **fixes it BACKWARDS** |
| H1c | one site in a callee; `a = fetchUser(1)`, `b = fetchUser(2)`; reveal `a`, egress `b` | **cannot fix, ever** |

**H1b is the one that kills the approach, and for a semantic reason.**
`_scrml_protect_reveal` RETURNS A FRESH VALUE and leaves the receiver tagged — this
repo asserts it: *"reveal is a fresh value, not a mutation — the original still
redacts."* So `a.reveal("pw")` does **not** declassify `a`. Keying declassification
on the RECEIVER binding models the primitive backwards and would mark `a`, and every
alias of it, declassified. Binding identity does not merely miss H1b; it makes it
worse.

**H1c is unanswerable by any location-keyed scheme.** ONE static query site, TWO
runtime values, one revealed and one not. Site identity, binding identity and
function identity all collapse them into a single fact. There is no location to key
on that separates them.

**The general statement:** `reveal` is a VALUE-level operation, and every fact this
pass can compute is LOCATION-level — a query site, a binding name, a function name. A
location-keyed declassification check has a fail-open wherever one value is revealed
and a sibling from the same location is not. That is not a bug in any one narrowing;
it is the shape of all of them, which is why two rounds produced five defects here
and each fix traded a fail-open for a false positive or the reverse.

**I also checked the obvious alternative** — "the reveal must appear inside the egress
expression" (declassify where you send). It closes H1, H1b and H1c and keeps the one
gate-relevant corpus reveal green (`reveal-suppresses-e004` is exactly that shape).
But it breaks TWO documented spellings: the cross-call factoring where the helper
reveals and returns (case F), and the `?{}.reveal("col")` query-chain form this file
already supports. Rescuing those needs a per-function "returns only declassified
values" summary — i.e. new interprocedural analysis. **Not built: the instruction was
explicitly not to build analysis infrastructure to save the unit.**

### The asymmetry that I think is the actual decision

Cross-call has two halves and they have opposite safety properties:

- **DETECTION cross-call** — over-approximating is SAFE. A false pairing costs a
  false positive (M3). This half works.
- **DECLASSIFICATION cross-call** — over-approximating is a FAIL-OPEN. Every
  approximation tried has produced one.

So the shippable configuration, if Unit 2 ships, is *detection cross-call ON,
declassification cross-call OFF (fail closed)* — which means `reveal` narrows to
"declassify the value at the place you send it". That is a coherent language rule
rather than a compiler wart, and it matches what §14.8.9 already says `reveal` is
for: greppable at the boundary, in source and in the emitted handler. But it is a
SEMANTIC NARROWING of a ratified primitive, so it is the operator's ruling, not
mine, and it is why I stopped here.

The three shapes and the reasoning are recorded in a block comment on
`collectRevealedColumns` so the next person hits them before touching it.

### Verification at `0fed3f4c`

23-shape A/B matrix, both compilers. Every round-1 fix re-confirmed intact:
K/K2 (cycle) FIRE, M/M2 (unrelated reveal) FIRE, C/D/E FIRE, F/P (both legitimate
reveal factorings) SILENT, G/H/Q SILENT. H2/H2b now SILENT. H1/H1b/H1c still silent —
the open fail-open. M3 still fires.

- `g-sql-row-protect-leak` **91/91**, `json-body-guard` **15/15**,
  `server-function-sse` **30/30**
- Conformance **883/883**
- Full suite **30086 pass / 53 fail / 30356 tests**; failing NAME SET byte-identical
  to the `a112c92f` baseline (`diff` empty) — **zero new failures**
- Corpus differential vs `a112c92f`: **221 artifacts, 221 of 221 `*.server.js`, ZERO
  `*.client.js`, 0 newly failing / 0 newly passing compiles.** Byte-identical to round
  1's differential, because round 2's changes are compiler-side only and do not alter
  emitted text. The 1 text-only diagnostic remains the shifted emitted line number
  already explained.

No `--no-verify`, no `core.hooksPath` override, `handle()` and `known-gaps.md`
untouched.
