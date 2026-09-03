# S397 — E-ROUTE-004's untyped-fn-param hole: measure the blast radius, then close it with limb (a)

## RULING — bryan, S397: **"measure true blast radius then a"**

Limb **(a) — usage-based signal** is RATIFIED: a parameter INVOKED as `param(...)` in the body counts
as a function-typed param for `E-ROUTE-004`'s purposes, even when un-annotated. The measurement sizes
the migration; it does NOT gate the decision.

**Limbs NOT taken, recorded so a newest-first sweep does not read one in:** (b) require annotation on
server-fn params — rejected because it breaks the untyped-foreign-signature idiom that exists to work
around a DIFFERENT compiler gap, i.e. it bills the adopter for our defect. (c) warning only — rejected
because it leaves a guaranteed-dead route emitted, and bryan's standing bar is that invalid input must
not produce garbage in the end result.

## THE DEFECT

`checkRouteWireSerializability` (`compiler/src/type-system.ts:4734`):

```js
if (!paramName || !paramAnnot) continue;   // un-annotated param defaults asIs → allow
```

`E-ROUTE-004` only inspects a param's ANNOTATED type. A server-boundary function whose parameter is
**untyped but USED AS A FUNCTION** (called in the body) never reaches the `case "function"` reject in
`isWireSerializable` (`:4618`), so the compiler emits an RPC route that 500s on every call — a
function cannot cross the §12.3 JSON wire. **Exit 0, no diagnostic.**

```scrml
function f(cb: () -> number) { const rows = ?{`SELECT 1 AS n`}.all() return cb() }
// ✓ E-ROUTE-004 fires, exit 1 — correct today

function f(cb)                { const rows = ?{`SELECT 1 AS n`}.all() return cb(rows) }
// ✗ compiles, exit 0, route wired. POST → 500 "cb is not a function"
```

The `continue` is DELIBERATE — un-annotated rides the §14.1.1 `asIs` hatch. This is not a one-line
deletion, and a naive removal would fire on every untyped DATA param too.

## ⚑ STEP 1 — MEASURE, AND REPORT BEFORE BUILDING

**Question: how many sites would limb (a) newly reject?**

Scan for: a function that escalates to the server boundary (§12 — `?{}` SQL, `Bun.*`, file I/O, env,
or a server-fn call), having a parameter that is (i) un-annotated AND (ii) invoked as `param(...)`
somewhere in the body.

**Two populations, reported SEPARATELY — they have different owners:**

| population | where | what it means |
|---|---|---|
| **OURS** | `scrml` (samples, examples, conformance, stdlib), `scrml-native`, `6nz` | we migrate these ourselves |
| **ADOPTER** | `../flogence`, and any other non-scrml-owned tree you can reach | we do NOT edit these — we report them |

⚑ **Use the real parser or the type-system pass, not a text grep.** "Is this param called in the body"
is a structural question. If you fall back to text matching, say so LOUDLY with error bars in both
directions. A prior dispatch on this surface beat a line-based heuristic by driving
`block-splitter.splitBlocks` → `ast-builder.buildAST` over 3,404 files in ~7s with zero parse
failures — that is the bar.

⚑ **The known instance is RELAYED, not PA-verified:** peter reports
`export fn runGatedAgentic(cwd, taskId, run)` in flogenceP as the live case, and reports that its
foreign signatures are left untyped BY DESIGN to dodge a library-mode type-strip gap. **Verify both
claims yourself** — whether that function exists in that shape, and whether it would newly fail.
Report which held.

**If OUR population is large, STOP and report before building** — a big number means the untyped-
called-param shape is load-bearing somewhere nobody modelled, and that is a finding.

## STEP 2 — BUILD LIMB (a)

The signal is USAGE: within the function body, is `paramName` the callee of a call expression? If yes,
treat it as function-typed for the serializability check regardless of annotation, and let it reach the
existing `case "function"` reject.

**Keep the `asIs` hatch intact for data params** — an un-annotated param that is never invoked must
keep passing exactly as it does today. That is the whole reason (b) was rejected.

**Known limit, state it in the diagnostic or the progress log:** a param passed THROUGH to another
function without being directly invoked still escapes. (a) is deliberately narrow. Do not try to close
that with interprocedural analysis in this arc.

## ⚑ SCOPE FENCE — A SIBLING AGENT HOLDS `compiler/SPEC.md`

A concurrent dispatch is minting a §34 code in `compiler/SPEC.md`. **Do NOT edit `compiler/SPEC.md` or
`compiler/SPEC-INDEX.md`.** If limb (a) needs the §34 `E-ROUTE-004` row's text updated (e.g. its
description scopes the check to annotated params), **record the exact owed edit in `progress.md`** and
the PA will land it separately. Reading those files is fine.

Also do not touch: `compiler/src/codegen/emit-expr.ts`, `conformance/cases/control-flow/ctrl-02*`.

## STEP 3 — MIGRATE OURS, REPORT THEIRS

- **Ours:** fix each site. Annotate the param, or restructure so the server function does not take a
  callback across the wire.
- **Theirs:** do NOT edit. Produce a list — file, function, param — that the PA will route to the
  adopter's inbox. Their migration is their call.
- Add a conformance `-neg` case proving the newly-extended `E-ROUTE-004` FIRES on the untyped-called
  shape, verified by flipping it and watching it go red. And a `-pos` case proving an untyped
  NEVER-CALLED param still passes — that is the `asIs` hatch, and it must not regress.

## DIRECTION-OF-CHANGE

**Newly-REJECTING** (base §8) — the reversible direction, and it owes a MEASURED migration, which is
why step 1 gates the build. Not 4(b)-eligible: corpus impact is non-zero by construction, since a
non-zero instance is how the hole was found.

## GATES

- Measurement reported BEFORE any code change, both populations separately, with method.
- Corpus differential vs `origin/main` — only the migrated sites may differ, each named.
- R26, conformance green, suite `comm -13` empty.
- Both `-neg` and `-pos` cases proven to bite.
- ⚑ No `test.failing`. No `git stash` (SHARED across worktrees — two siblings are live). No bare
  `pkill -f` (it matches their suites too).

## CRASH ANCHOR

Commit after each meaningful unit; append-only `progress.md`. Clean `git status` before DONE.

## MAPS — REQUIRED FIRST READ

`.claude/maps/primary.map.md` first; follow Task-Shape Routing to the type-system / route-inference
maps. Report whether they were load-bearing — "not load-bearing" is a useful answer.
