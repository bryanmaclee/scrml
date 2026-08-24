# W-DEAD-FUNCTION false-positive on `<each>` opener expressions

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ad302166242cc28a9`
Base: `origin/main` @ `4036424f` · Fix: `e0fff972`
Gap: `g-usage-analyzer-blind-to-each-in-collection-fn-ref` (LOW, cry-wolf)

**STATUS: COMPLETE.** DONE-PROBE met (brief repro → 0 `W-DEAD-FUNCTION`).

---

## LOCUS VERDICT: **WRONG** (both the brief's and the gap ledger's)

The brief and `docs/known-gaps.md:2336` both name
`compiler/src/codegen/usage-analyzer.ts` (the `kind === "markup"` branch at
`:424`; the GITI-038 precedent at `:691`). **That file cannot produce this
warning.**

- `usage-analyzer.ts` is the Phase-A1c FEATURE-USAGE bitmap pass. Its own header:
  *"What C0 does NOT do: zero new diagnostics, zero AST mutation, zero
  emission. Pure analysis pass."*
- Its only value-producing export is `analyzeUsage() -> FeatureUsage`, a record
  of booleans (`channels` / `engines` / `validators.*` / …). There is no
  referenced-name output for a dead-code gate to consult.
- It has exactly one consumer: `codegen/analyze.ts:35`.
- The `:691` GITI-038 comment merely *cites* W-DEAD-FUNCTION as motivating
  prose. The real GITI-038 suppression is the `_returnedInline` term at
  `route-inference.ts:5549`.

`route-inference.ts:5421` states the relationship outright:

> `record.callees` … have TWO blind spots that surface as W-DEAD false
> positives **even though the tree-shaker (usage-analyzer) correctly KEEPS the
> function**

Independently confirmed by measurement: the emit differential shows **0 of 7388
artifacts changed**, i.e. tree-shaking did not move at all. If usage-analyzer
had been involved, artifacts would have moved.

**Real locus:** `compiler/src/route-inference.ts`
- `walkMarkupContext` (`:4876`) builds `markupReferencedNames` (`:4852`)
- the D4 gate reads it at `:5530` (`isMarkupReferenced`)
- emit site `:5563`

## Where `if=` / `class=${…}` ARE handled — and what I extended

Same walker, the `node.kind === "markup" && Array.isArray(node.attrs)` branch:

| source | AttrValue kind | handled at |
|---|---|---|
| `if=fn()` | `call-ref` | `:4895` `markupReferencedNames.add(av.name)` |
| `class=${fn()}` | `expr` | `:4913` `collectIdentsFromText(av.raw)` |

An `<each>` never reaches that branch. The parser lowers it to
`kind === "each-block"` (`ast-builder.js:16870`) which carries **no `attrs`
array at all**; its opener expressions live in bespoke raw-string fields
(`inExprRaw`, `ofExprRaw`, `keyExprRaw`, `ifRaw`), and none of those names is
in the `EXPR_STRING_FIELDS` fallback (`expr`/`init`/`condition`/`value`/
`test`/`header`/`iterable`) — a union deliberately held byte-identical to the
DG's `sweepNodeForAtRefs` list, so widening it was the wrong lever.

**I EXTENDED the existing mechanism**: one new per-kind block inside
`walkMarkupContext`, sitting beside the walker's existing bespoke-field blocks
(`test` testGroup bodies, `when-*` `bodyRaw`, `component-def` `raw`). **No
second walker was added**, so there is no new near-duplicate predicate to drift.

The `<each>` BODY was already covered — `bodyChildren` / `templateChildren` are
arrays of ordinary markup nodes the generic recursion descends into. Only the
OPENER was blind.

## MEASURED — wider than the brief

The ledger names `in=` only; the brief measured `in=` and `key=`. I also
measured `of=` and the §17.1.2 `<each if=>`: **both false-fire too.**

| position | base | after |
|---|---|---|
| `<each in=fn()>` | FIRES (FP) | silent |
| `<each of=fn()>` | FIRES (FP) — **not in brief** | silent |
| `<each in=@rows key=fn()>` | FIRES (FP) | silent |
| `<each in=@rows if=fn()>` | FIRES (FP) — **not in brief** | silent |
| `<each>` body `${fn()}` | silent | silent |
| plain markup `if=fn()` | silent | silent |
| `class=${fn()}` | silent | silent |
| genuinely unused fn | FIRES | FIRES (bite kept) |

All four verified as genuine FPs by reading the emitted client JS — each fn is
declared AND has >= 1 live call site, e.g.
`const _items = Array.from({length: Number(_scrml_inEachOf_7()) || 0}, …)`.

## Corpus census — `samples/ examples/ stdlib/ benchmarks/ conformance/`

Per-file compile of all 1906 `.scrml`, `write:false`, identical instrument both sides:

| | files with W-DEAD | total W-DEAD warnings |
|---|---|---|
| base `4036424f` | 129 | 146 |
| head `e0fff972` | 128 | 145 |

**Exactly one file changed**, and it is a textbook instance of the bug:

- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-multiline-011.scrml`
  — base `[buildItems]` → head `[]`.
  Source: `<each in=buildItems(["a","bb","ccc"]) as it>`.
  Emitted client JS: declared at line 46, **called at line 8**
  (`const _items = _scrml_buildItems_2(["a","bb","ccc"]);`). Genuine FP.

Delta is exactly the false positives. Nothing else moved.

## Emit differential — `bun scripts/corpus-emit-differential.ts`

⚠ **First run was INVALID and I discarded it.** I captured base from a
`git archive` extraction at a different filesystem path; that produced exit 2
(`<unknown>` revision) *and* 1018 "differing" artifacts. Every one was
same-byte-length, different-hash, and the cause is documented in the repo:
`semdiff.ts:667` — the chunk-namespace token is `fnv1aHash` of the **source
path**, "a cosmetic, path-derived difference". Re-run with **both sides at one
shared path** in a real git clone:

```
base=base-4036424f (4036424f)   head=head-e0fff972 (e0fff972)   exit 1
  sources enumerated        base 1906   head 1906
  source set delta          0
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        1 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    0 of 7388 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  syntax delta (script)     0 new / 0 fixed
  syntax delta (module)     0 new / 0 fixed
  load-context changes      0
  bare server-fn sites      base 144 / head 144  (delta 0)
VERDICT: 1 DIFFERENCE(S)
```

**NO ARTIFACT CHANGED.** The single difference is the one diagnostic above.
Exit 1 = differences found, which is the expected outcome for a change that
removes a warning. Diagnostic-only in FACT, not merely in intent.

## Full `bun run test` — SET-DIFF, same path, same conditions

| run | fails |
|---|---|
| BEFORE (`HEAD~1` source, new test file present) | **61** |
| AFTER (`e0fff972`) | **53** |

- only-in-BEFORE: **exactly my 8 bite-proven cases**
- only-in-AFTER: **EMPTY — zero newly-broken tests**

53 is the stated pre-existing baseline (browser / commands / conformance /
self-host / unit tiers). `30747 tests across 1402 files`, `216 skip`, `1 todo`.

## Merge-blocker test

`compiler/tests/unit/wdead-each-opener-expr-reachability.test.js` — NEW file,
12 cases. **Bite-proven: 8 fail on `4036424f`, 0 fail after.**

Three cases are BITE (the gate must keep firing):
- a genuinely dead fn in a file that CONTAINS an `<each>`
- a dead fn in a file with no `<each>` at all
- a dead fn whose name merely RESEMBLES an each-opener callee
  (`rowsFor` used / `rowsForNothing` dead) — guards against a
  substring-rather-than-token suppression

Plus two non-regressions (plain-markup `if=` / `class=${}`; each-BODY interp)
and one pinning the cry-wolf premise itself (the fn IS emitted and called).

---

## SURFACED, NOT FIXED (outside the brief — PA call)

1. **`match-block` has the IDENTICAL blind spot.** `<match for=T on=fn()>`
   false-fires on a CLEAN compile (exit 0). Measured: `matchOnAttr` warned,
   while the emitted client JS declares it (line 19) and calls it TWICE
   (lines 46, 48). Same walker, same species — `match-block` carries
   `onExprRaw` + `ifRaw` (`ast-builder.js:15893`, `:18085`), neither in
   `EXPR_STRING_FIELDS`. The fix is the same one-block shape I used for
   `each-block`. Deliberately NOT fixed here: the brief scoped me to `<each>`.

2. **"It will be tree-shaken from the output" is FALSE IN EVERY CASE
   MEASURED — including true positives.** Compiled
   `<program>${ fn reallyDead() { return 41 } }<p>hello</p></program>`:
   W-DEAD-FUNCTION fires, and `function _scrml_reallyDead_1() {` is still on
   line 6 of the emitted `.client.js`. So the sentence is not merely wrong
   about false positives — the stated consequence never occurs at all. That is
   a sharper case for editing the prose than the cry-wolf framing alone.

3. **The self-aware hedge.** The message ends *"(Note: RI does not yet track
   all markup reference patterns; if this is a false positive, export the
   function or add an explicit caller.)"* Now that the `<each>` gap it
   apologises for is closed, the hedge is narrower than it reads — but item 1
   means it is not yet FALSE. Recommendation: keep the hedge until the
   `match-block` limb lands, then delete it in the same PR, and fix the
   tree-shaking sentence (item 2) independently and sooner. **Not touched
   here** — the brief said raise it, not rewrite it.

4. **The gap ledger entry needs a locus correction.**
   `docs/known-gaps.md:2335-2337` says
   `locus=compiler/src/codegen/usage-analyzer.ts(... sibling of the already-fixed
   closure-callee false-positive at usage-analyzer.ts:691)`. Both halves are
   wrong (see LOCUS VERDICT). Correct locus:
   `compiler/src/route-inference.ts:4876 walkMarkupContext (each-block opener
   raw fields are not in EXPR_STRING_FIELDS and each-block has no attrs array)`.
   **NOT edited here** — `docs/known-gaps.md` is a PA-owned shared doc.
