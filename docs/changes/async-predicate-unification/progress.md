# progress — Limb 1, one async-name provider for three consumers

Append-only. Timestamps UTC.

Startup pwd: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4e4ecf46884144ef`
Worktree base SHA: `3c3e82e3` (branch `worktree-agent-a4e4ecf46884144ef`).
Note: the brief says "HEAD is `27eba1aa`"; the actual worktree base is `3c3e82e3`
(`27eba1aa` + `3c047151` review drain + `3c3e82e3` brief archive). No compiler-source
diff between those three, so the brief's post-map landing list still applies verbatim.

---

## 2026-08-05 — startup

- `pwd` / `git rev-parse --show-toplevel` agree; tree clean.
- `bun install` OK (217 packages). `bun run pretest` OK (13 samples -> `samples/compilation-tests/dist/`).
- Corpus population under the harness default roots
  (`examples,samples,conformance,stdlib,benchmarks`): **1878** `.scrml` sources.

## 2026-08-05 — re-derivation of the loci (PA's framing verified, and ONE correction)

Re-derived from source, not from the brief:

| # | consumer | locus | question it actually asks | answer for a client server fn |
|---|---|---|---|---|
| 1 | `isClientServerFnCall` | `emit-expr.ts:1736` | "is this CALL a client->server RPC that must be awaited?" | INCLUDES |
| 2 | `combinatorIsAsyncName` | `emit-expr.ts:1630` | "is this NAME async in this mode?" | INCLUDES (U1 F2, `:1649`) |
| 3 | drain-local `isAsyncName` closure | `emit-library-shared.ts:487` (inside `collectNonAwaitableAsyncCalls`) | "is this NAME async?" | **EXCLUDES** |

PA's correction to the DD is CONFIRMED: #3 is not a function, it is the closure
built at `emit-library-shared.ts:487` and injected into `async-combinators.ts`'s
`isAsyncName` parameter (`:93`, `:125`, `:169`). Its source of truth on the client
path is `computeAsyncFnNames(..., _serverFnNames)` at `emit-functions.ts:1208`,
whose `callsServerFn` seeds the CALLER and never admits the callee
(`emit-library-shared.ts:169-177` says so in its own comment).

**One correction back to the brief** (see report): #1 does NOT ask the same question
as #2/#3. `isClientServerFnCall` asks an IDENTITY question ("is this an RPC"), not an
ASYNCNESS question. Routing it through a full async provider would make a stdlib async
callee take the U1 RPC branch at `emit-expr.ts:3246` instead of the stdlib branch at
`:3298` — a different sink and a different diagnostic. So #1 shares the provider's
shadow-aware SERVER-FN MEMBERSHIP component, not the whole predicate.

## 2026-08-05 — base capture started

`bun scripts/corpus-emit-differential.ts capture --label base --expect-total 1878`
run BEFORE any source edit, from this worktree (which is byte-identical to `3c3e82e3`
on `compiler/src/`).

BASE result: 1878 enumerated (oracle AGREE) · 1207 OK / 671 failed · 7254 artifacts ·
4339 checked · 66 syntax-failing (effective). **Bare client server-fn call sites: 142**
— matches the brief's stated baseline exactly. TESTS_BEFORE: 28445 pass / 0 fail /
86 skip / 1 todo across 1221 files.

## 2026-08-05 — commits 1 and 2 (the provider + emit-expr's two consumers)

- `76b490b9` — `isAsyncCalleeName` + `isServerBoundaryCallee` + `AsyncNameFacts` land
  in `async-combinators.ts`, the module that already documented the injected-predicate
  contract (and whose doc-comment falsely claimed the two injectors agreed).
- `08ee3ef3` — `combinatorIsAsyncName` collapses from four hand-written disjuncts to
  one delegation; `isClientServerFnCall` shares `isServerBoundaryCallee`.

## 2026-08-05 — head-NOFIX capture: measured ZERO corpus delta

Captured with the drain change in the working tree BEFORE the over-fire was fixed.
Against base: **0 differences of every kind** — 0 newly-failing, 0 newly-passing,
0 diagnostic changes, 0 of 7254 artifacts differing, 0 syntax delta under all three
goggles, bare-site delta 0 (142 -> 142).

Distrusted per the brief and cross-checked rather than accepted: the affected shape's
corpus population was measured directly (brace-matched scan for a `!{` nested inside a
`!{` region) = **0 of 1878**. So the zero is real, not a truncated probe.

## 2026-08-05 — the over-fire, and TWO wrong turns before the right one

Widening the drain broke `compiler/tests/integration/nested-error-handler-no-invalid-js.test.js`
(R25-Bug-49 §5). Root cause: a `!{}` arm with a BLOCK handler parks an escape-hatch on
`handlerExpr`, and the drain's raw-TEXT branch treated it as a verbatim region. It is
not — `emitArmBody` (emit-logic :627-645) emits from `arm.handler`, the STRING,
re-parsed — and the emitted output really does `await _scrml_fetch_b_5()`.

- WRONG TURN 1: read the emitted `function _scrml_run_6()` as a stranded `await` in a
  non-async fn. It was a **measurement error of mine** — my `search(/function\s+…/)`
  matched the `function` token and the slice cut off the preceding `async `. Base and
  head emissions are byte-identical and both are `async`.
- WRONG TURN 2: narrowed on `nativeKind === "ParseError"`. WRONG — a RETURNED ARROW
  closure containing a `!{}` parks under the same nativeKind but IS spliced verbatim.
  The pre-commit gate caught it (`colorless-async-seam-a.test.js` "a RETURNED ARROW
  closure stays FAIL-CLOSED"). Node KIND does not discriminate; **whether the emitter
  emits the node** does.
- LANDED: skip the single dead `handlerExpr` key when the sibling `handler` is a block.
  Both guards green together.

## 2026-08-05 — commit 3 + the measured bite

`1d0d9aa7` — drain routed onto the provider, `serverFnNames` threaded, region
narrowing, and `compiler/tests/unit/async-name-provider.test.js` (9 tests).

The bite is real and verified by removal: `function usesDefault(x = loadRows())`
compiled CLEAN at base and shipped a bare Promise; it now raises
`E-ASYNC-STDLIB-IN-SYNC-CALLBACK`. A parameter default is spliced as raw text by
`paramSignature`, so emit-expr's `_clientSyncPeerCalls` sink structurally cannot reach
it — only the drain can.

Post-commit browser tier reported `Bug 60 — nested compound render-by-tag` failing;
PRE-EXISTING, listed in `compiler/tests/browser/FAILURE-BASELINE.json`, and the
name-set gate passed.

## 2026-08-05 — FINAL head capture + diff

`VERDICT: NO DIFFERENCES` over 1878 common sources and 7254 compared artifacts.
0 newly-failing / 0 newly-passing, 0 diagnostic changes, 0 of 7254 artifacts
differing, 0 syntax delta under EFFECTIVE / SCRIPT / MODULE goggles, 0 load-context
changes, bare client server-fn call sites 142 -> 142 (delta 0).

## 2026-08-05 — was this actually a subtraction?

Honest accounting, comments excluded: **+46 / -19 code lines.** Raw lines went UP,
because the provider (interface + 2 functions = 16 lines) and the region narrowing
(4 lines) are new. What went DOWN is the thing that mattered: the number of places
that decide "is this name async here" is **3 -> 1**. Deleted outright: the
four hand-written disjuncts in `combinatorIsAsyncName`, the inline membership +
shadow test in `isClientServerFnCall`, and the drain's bespoke `isAsyncName`
closure. Reporting this as a line-count win would be dishonest.

## Deferred / surfaced, NOT closed here

1. `collectAliasedAsyncCalls` (emit-library-shared) is a FOURTH consumer of
   `_clientAsyncFnNames` and was deliberately left alone — an indirect client alias
   `const f = loadRows; f()` is U1's remaining scope, not Limb 1's.
2. **RETRACTED — see the S239 fix round below. The residual as described here was
   wrong in both halves and the narrowing that produced it was wrong.**
3. `emit-functions.ts:1499` drains `_clientSyncPeerCalls` with the SAME code+span
   key as the structural drain, so overlapping sites dedup. Not a problem; recorded
   because it is why the newly-rejecting surface is smaller than it first looks.
4. Observed in passing while building a reproducer, NOT chased: a
   `[scrml] warning: statement boundary not detected — trailing content would be
   silently dropped` on a `!{}` arm body whose first statement is a bare call
   followed by a nested `!{}`. Unrelated to Limb 1.

---

## 2026-08-06 — S239 ADVERSARIAL REVIEW: DO NOT LAND. Fix round.

The unification was cleared. The reviewer independently verified all four
`collectNonAwaitableAsyncCalls` call sites consume the result only via
`errors.push(...)` — **the drain never feeds emission** — which is the structural
reason NO DIFFERENCES was correct rather than a measurement artifact, and re-ran an
independent full-corpus digest diff (empty). The `emit-expr` refactor was confirmed
exactly equivalent.

**The `handlerExpr` narrowing was wrong and blocked the landing.**

### FINDING 1 (HIGH) — the guard was ~55x wider than its justification

`emitArmBody` (`emit-logic.ts:632-646`) has **TWO** block paths:

1. `handlerHasTopLevelGuardedExpr(inner)` → `_emitNestedGuardedArmBody` → **re-parse,
   auto-await RUNS.** Only here is `handlerExpr` dead. This is the only case my
   rationale described, and for it the skip is correct.
2. otherwise → `rewriteBlockBody(inner)` → **token-splice, NO auto-await.** The
   region IS verbatim, `handlerExpr` IS a faithful proxy, and skipping it discarded
   real coverage — the **structural lambda walk**, not just the raw-text branch.

My guard matched both. Re-verified by me before fixing, not taken on trust:
reviewer's repro is **3 pass at base `3c3e82e3`, 0 pass / 3 fail at `a8944f06`** —
all three failing the DIAGNOSTIC assertion while every emitted-JS assertion passed on
BOTH sides. Identical wrong output, diagnostic silently gone.

- **R1** raw-text: `const v = helper(1)` in a block arm → emitted BARE in a PLAIN
  function, Promise written to a rendered cell → page shows `[object Promise]`.
- **R2** structural: `xs.sort((p,q) => helper(p))` — `handlerExpr.kind === "call"`,
  `raw === undefined`, so NO text scan involved. Base caught it via the ratified
  `.sort` FORK-2 fail-close.
- **R3** LIBRARY mode — the literal shape of `stdlib/auth/jwt.scrml`'s arms.

**FIX (`8af422af`):** gate the skip on the SAME predicate `emitArmBody` branches on.
`_handlerHasTopLevelGuardedExpr` is EXPORTED from emit-logic as
`handlerHasTopLevelGuardedExpr` and imported, rather than re-implemented — two
look-alike predicates is the exact defect class Limb 1 exists to remove. R1/R2/R3 all
fail closed again AND the original over-fire stays fixed, so no STOP was needed.

Declared residual: if the re-parse FAILS, `emitArmBody` falls back to
`rewriteBlockBody` and the skip is then wrong. Bounded by reasoning, NOT measurement:
that fallback splices the nested `!{ }` wrapper verbatim → invalid JS →
`E-CODEGEN-INVALID-LOGIC`, so it cannot ship silently.

### FINDING 2 — direction-of-change, re-measured and re-classified

My migration scan measured the **sub-case** (nested `!{` inside `!{`, 0 of 1878), not
the population the guard blinded. Re-measured through the real BS→TAB pipeline with
the reviewer's `count-arms.ts`, run by me over the same 1878 sources:

```
NON-block  !{} arms (handlerExpr still walked):  52
BLOCK      !{} arms (handlerExpr WAS SKIPPED):   55   in 17 files
  ... whose inner text has a nested `!{`:         0   <-- the number I reported
  ... whose handlerExpr is an escape-hatch:       7
```

Blinded files included `stdlib/auth/jwt.scrml` (10 block arms, 3 escape-hatch),
`stdlib/crypto/index.scrml`, `stdlib/oauth/google.scrml`, `stdlib/auth/password.scrml`,
`examples/09-error-handling.scrml`. **55, not 0.**

**Why the corpus gate did not protect me, and this is the lesson:** those 55 arms
contain no lambda (`w/lambda: 0`) and no async call today, so there was nothing live
to differ. The gate measured correctly and found nothing **because there was nothing
there yet.** A zero artifact/diagnostic differential does not bound a
coverage-removal risk — only a population count on the blinded surface does.

**Direction of change, corrected — BOTH directions, per class:**

| class | direction | evidence |
|---|---|---|
| drain gains `serverFnNames` (structural + text scans) | **newly-REJECTING** | `function usesDefault(x = loadRows())` compiled clean at base, now `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`. Corpus migration **0 of 1878**, measured. |
| `handlerExpr` skip, AS FIRST LANDED | **newly-ACCEPTING** — a one-way door, undeclared and unquoted | R1/R2/R3: base rejects, head compiled clean. Blinded population **55 arms / 17 files**. |
| `handlerExpr` skip, AS CORRECTED | **inert** vs base | skip fires only where `emitArmBody` re-parses; that population is **0 of 1878** on this corpus, so nothing that base scanned is now unscanned. |
| `emit-expr` consumer routing | **inert** | provably equivalent; reviewer-confirmed. |

**RETRACTED — this row overstated its clearance and is superseded by round 3 below.**
It read: *"Net after the fix: newly-rejecting only, migration measured 0 of 1878. No
newly-accepting surface remains, so no governing sentence is owed."* The second
sentence was false as written: the scoped skip still removed the drain's coverage on
the re-parse path for every async-name class, every position and all four callers —
round 3's A1/A2/B2 are exactly that surface. **Second time this log cleared something
it had not measured.** The rule I should have been applying, and now am: a
clearance claim names the measurement that backs it, or it is not made.

### FINDING 4 — my disclosure was wrong in both halves. Corrected.

- *"caught by nothing"* — TRUE and I understated it. Uncovered on the client path
  (R1, R2), the **library** path (R3), and tool / server-value: the narrowing lives
  inside the SHARED drain and none of the four callers is exempt.
- *"only ACCIDENTALLY, by a text scan"* — **FALSE.** R2's catch came through the
  sanctioned structural lambda walk and the ratified `.sort` FORK-2 fail-close. And
  R1's text-scan catch was a **TRUE positive** — `rewriteBlockBody` really does
  splice that region verbatim.
- The `.sort` example I used to illustrate the residual is uncaught on base **only**
  when the callee is a client server fn — the single sub-case with no regression.
  Swap in a stdlib-async or transitively-async callee and base catches it. I picked
  the one example that made the residual look benign.

### FINDING 5 — misleading residue removed

- Deleted the 22-line comment at `emit-library-shared.ts:542-563` describing the
  reverted `nativeKind === "ParseError"` attempt. There is no `nativeKind` test in
  the file; the comment told a reviewer the branch was guarded when it was not.
- Corrected the `@param serverFnNames` JSDoc: "omit → byte-identical" is true of the
  PARAMETER, false of the FUNCTION, because the `handlerExpr` skip applies on every
  caller regardless of that argument. R3 proves the library caller was not identical.

### New permanent coverage

`async-name-provider.test.js` §6 — the reviewer's R1/R2/R3 adopted as the standing
guard that a block arm **without** a nested `!{}` still fails closed, across the
raw-text branch, the structural lambda walk, and library mode. Each asserts the WRONG
EMISSION **and** the DIAGNOSTIC together, because when this was broken every
emitted-JS assertion still passed on both sides. Verified they bite: re-breaking the
guard fails exactly those 3.

### Post-fix re-measurement

Fresh full capture at `8af422af` against the same base manifest:
`VERDICT: NO DIFFERENCES` over 1878 common sources / 7254 compared artifacts —
0 newly-failing, 0 newly-passing, 0 diagnostic changes, 0 artifact content diffs,
0 syntax delta under EFFECTIVE / SCRIPT / MODULE goggles, bare client server-fn call
sites 142 → 142.

Note what that zero does and does not mean, which is the whole lesson of this round:
it bounds emission and diagnostics on the corpus **as it exists today**. It does NOT
bound coverage removal. The count that bounds coverage removal is the blinded-arm
population — **55 → 0** — and that had to be measured separately, on the surface the
guard touches, with the real parser.

---

## 2026-08-06 — S239 ROUND 3: DO NOT LAND again. The skip is DELETED.

The unification cleared a third time (claims 1/3/6/8 confirmed; no import cycle, no
load-order hazard, argument shapes byte-matched, `emit-logic.ts` otherwise unmoved,
full-suite failure SETS identical, full-corpus diagnostic differential byte-identical).

**The blocker was a SHAPE error, not a scoping one:**

> **The gate is ARM-granular; the hazard is SITE-granular.**
> `emitArmBody`'s re-parse awaits SOME *awaitable-position* sites. The drain's entire
> population is *non-awaitable-position* sites. Agreeing on which BRANCH runs says
> nothing about whether that branch awaits a given SITE.

So no subtree skip is correct at any granularity — which is why two successive
scopings both failed. I verified all four reviewer fixtures myself before acting; all
four were clean at `a58e4c23` and error at base. **B2 kills the premise outright** —
on the LIBRARY caller the re-parse does not await even an *awaitable-position* site:

```js
export function inspect(obj) {                                    // PLAIN, not async
  let _scrml__scrml_result_2 = safeCallAsync(() => obj.retry());  // BARE Promise
  if (_scrml__scrml_result_2 && _scrml__scrml_result_2.__scrml_error) {  // never true
```

`.__scrml_error` read off a Promise → the nested error arm **can never run**, and a
sync fn hands back a Promise. Base's diagnostic there was a **true positive**.

### The measurement, taken BEFORE writing any fix (as instructed)

Skip removed entirely, unification kept, full-corpus differential vs base:

```
0 newly FAILING · 0 newly PASSING · 0 diagnostic-CODE changes
0 diagnostic-TEXT-only changes · 0 of 7254 artifacts differing
bare client server-fn call sites 142 -> 142
```

**Over-fire population corpus-wide: 0 of 1878.** In-repo instances: **2**, both
R25-Bug-49 §5 guards for the same shape, enumerated by a no-bail full-suite run
rather than discovered one at a time:

- `compiler/tests/integration/nested-error-handler-no-invalid-js.test.js`
- `compiler/tests/unit/error-handler-const-bind-r25-bug-49.test.js:309`

### Decision — coordinator rule 2: land with NO SKIP

| | scope | corpus population |
|---|---|---|
| the over-fire | one disjunct × one position × **one** caller | **0** |
| any subtree skip | **all** async-name classes × **all** positions × **all four** callers | 55 arms / 17 files blinded (round-2 measurement) |

A loud false positive is visible and fixable. A silently deleted fail-close is the
class this arc exists to kill.

- `collectNonAwaitableAsyncCalls`: the `handlerExpr` skip is **deleted**. The drain is
  now a pure predicate unification and nothing else.
- `emit-logic.ts`: reverted to **byte-identical with pre-Limb-1**
  (`git diff 8ed11004 -- emit-logic.ts` is empty). The round-2 export is unnecessary,
  so the cross-module coupling is gone entirely.

### The false positive is LOCKED, not hidden

Filed as `g-drain-textscan-overfires-on-awaited-nested-arm-site`.
`async-name-provider.test.js` §5 asserts the diagnostic **is** present AND that the
emission it fires against **is correct** (`async function _scrml_run_N` +
`await _scrml_fetch_b_N`). Fix the root and that test fails, telling you to delete
it. Both R25-Bug-49 guards had their *incidental* blanket zero-errors assertion
narrowed to exclude that one code — every subject assertion untouched, and any OTHER
new diagnostic still fails them.

**Root cause, for the follow-up:** the raw-TEXT scan is POSITION-BLIND. It records
every async name in an arm handler's text with no way to tell an awaitable site from
a non-awaitable one. The two principled fixes the reviewer named — run the drain
against the **re-parsed AST** so positions are real, or suppress the **single site**
the re-parse awaits — are both scope growth and are **PROPOSED, not built**.

### Standing coverage

A1 / A2 / B2 joined R1/R2/R3 as permanent tests. Every one asserts the **diagnostic
AND the emitted JS together**, because all six emit *identical JS on both sides* — a
diagnostic-only assertion would have passed while the leak shipped, which is exactly
how round 1's defect cleared 79 green tests. A useful incidental: the re-parse path
emits normally-spaced JS from a real AST (`xs.sort((p, q) => …)`) while
`rewriteBlockBody` token-splices (`sort ( ( p , q ) => …`), so the two paths are
distinguishable in the assertions themselves.
