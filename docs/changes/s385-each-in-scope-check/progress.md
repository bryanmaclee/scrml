# S385 — `<each in=@x>` undeclared-read false negative

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4c73958a8bad6e3b`
Base: `a8448ac946c954355307b1eae136013618ceb345` (== `origin/main`)

Measurement dispatch. BUILD the check, MEASURE corpus impact, DO NOT LAND.

## Phase 0 — baseline reproduced

`<each in=@totallyUndeclaredName as x><li>${x}</li></each>` with no declaration
anywhere compiles **exit 0**, clean. Confirmed on base `a8448ac` (the brief cited
`56473410`; this worktree cuts from `origin/main` which is newer — reproduces
identically).

Emitted client JS contains, verbatim:

    const _items = _scrml_cs_reactive_get("totallyUndeclaredName");

i.e. the typo is lowered to a live runtime lookup of a cell that does not exist.
It returns undefined, `if (!_items) { _scrml_each_clear(_mount); return; }` fires,
and the list silently renders nothing. This is precisely the
"genuine undeclared-cell typo, NOT a silently-synthesised cell" case
SPEC §6.1.2:2081 says SHALL be `E-STATE-UNDECLARED`.

## Phase 1 — THE MECHANISM (prose, written before any code)

### Verdict on the brief's locus: it HOLDS. (I first thought it didn't.)

The brief pointed at `compiler/src/type-system.ts` ~`:7830` — the
`E-STATE-UNDECLARED` fire site reached via `scopeChain.lookup` ~`:7823-7825`.
That is `checkLogicExprIdents`, the §2a identifier walker.

My first read said the locus was WRONG, on this reasoning: `in=` is an
attribute value, attribute values are serviced by `visitAttr` (`:13205`) which
fires `E-SCOPE-001`, not by `checkLogicExprIdents`. The control matrix below
supports that reading.

That reading was incomplete. `<each>` is not a `kind:"markup"` node and has no
`attrs` array — so the attribute route is not actually available to it without
inventing a new AST field. And the codebase already contains the ratified answer
for exactly this situation, in the case block **immediately adjacent** to the one
I need to edit: `type-system.ts:12930`, `<match on=@cell>` (ss42 item-2, §18.0.1 /
§34). Its comment is a description of my bug with one word changed:

> The match-block node carries its `on=` as RAW TEXT (`onExprRaw`); codegen
> lowers it directly to `_scrml_reactive_get(...)` WITHOUT running the typer's
> read-side ident walker, so `<match for=T on=@totallyUndeclared>` compiled
> silent-empty with zero diagnostic. Parse the `on=` expression and feed it
> through the same checker every other expression site uses, so an undeclared
> `@`-read in `on=` fires E-STATE-UNDECLARED like a `${@x}` interpolation does.

`inExprRaw` is to `<each>` what `onExprRaw` is to `<match>`. So the fix is
`parseExprToNode(raw)` -> `checkLogicExprIdents(...)` — **the walker the brief
named**, firing **`E-STATE-UNDECLARED`**, which is **the code the governing SPEC
sentence names**. The brief's locus was right and my refinement was wrong.

This also avoids a trap the `visitAttr` route walks straight into: stamping a new
parsed-value field on the each-block node would make the live AST carry a field
the native parser does not, and
`compiler/tests/parser-conformance-within-node.test.js` (the within-node parity
canary, in `bun run test`) asserts per-fixture MISSING-FIELD residual is ZERO. 40
corpus files carry an `<each>`. The raw-text route adds no field and cannot trip it.

The measured control matrix (base `a8448ac`, undeclared name in each position):

| shape | rc | code |
|---|---|---|
| `${@undeclared}` (logic ctx) | 1 | `E-STATE-UNDECLARED` |
| `<input value=@undeclared/>` | 1 | `E-SCOPE-001` |
| `<if cond=@undeclared>` | 1 | `E-SCOPE-001` |
| `<tableFor in=@undeclared as r>` | 1 | `E-SCOPE-001` |
| `<each if=@undeclared>` | 1 | `E-SCOPE-001` |
| **`<each in=@undeclared as x>`** | **0** | **(none) — the defect** |
| **`<each of=@undeclared as x>`** | **0** | **(none) — same hole, `of=` twin** |
| `<div class="c-${@undeclared}">` | 0 | (none) — SEPARATE hole, see Found-not-fixed |

So attribute-position undeclared reads are already checked language-wide, and they
fire **`E-SCOPE-001`**, not `E-STATE-UNDECLARED`. `<each in=>` is the outlier.

### Why `in=` never reaches the walker

The attribute walker is `visitAttr` (`type-system.ts:13205`). The markup walk feeds
it from `for (const attr of n.attrs)`.

`<each>` is not `kind: "markup"`. The block splitter raw-captures it and
`buildBlock` reconstructs the node by regexing NAMED attributes out of the opener
header. **The node has no `attrs` array at all.** `ast-builder.js:16783`:

    let inExprRaw = _captureAttrValue(header, "in");

`inExprRaw` is a **raw string**, not a parsed §5.2 attribute VALUE object. Nothing
downstream can hand it to `visitAttr`, so `in=` is never scope-checked. The
compile stays green and the element renders nothing, permanently.

### The shape of the fix

Copy the adjacent `<match on=>` block, at the `<each>` case, for `inExprRaw` and
its `ofExprRaw` twin, placed **before** `scopeChain.push("each:…")` — the opener
iterable is evaluated OUTSIDE the per-item scope, so running it after the push
would let `in=x` resolve against the loop's own `as x` binding and stay silent
(the same ordering trap `visitStructuralIfAttr`'s docstring calls out for `if=`).

One parser (`parseExprToNode`), one walker (`checkLogicExprIdents`). No second
predicate, no new AST field, no native-parser mirror, no allowlist bump.

### Which diagnostic code

`E-STATE-UNDECLARED` — the code SPEC §6.1.2:2081 names, the code the `${@x}`
logic-context read already fires, and the code the sibling `<match on=@x>` fires.

Note for the record: the sibling ATTRIBUTE positions (`value=@x`, `cond=@x`,
`tableFor in=@x`, `each if=@x`) all fire `E-SCOPE-001` for the same mistake,
because they route through `visitAttr` instead. That inconsistency is
pre-existing and language-wide; it is not created or widened here. Deciding
whether all attribute-position `@` reads should re-code to `E-STATE-UNDECLARED`
is an operator ruling far larger than this dispatch.

### Exemptions the path must honour (all live inside `checkLogicExprIdents` already)

Routing through the existing walker inherits every one of them for free — that is
the point of reusing it. Verified by reading `type-system.ts:7770-7830`:
`~` (§32 tilde accumulator), `@.` / `@.field` (§17.7.3 each contextual sigil),
`@_`-prefixed (runtime-helper / internal convention),
`RESERVED_AMBIENT_PROJECTION_NAMES` (`@session`), `typeRegistry.has(base)`
(declared type names), `knownFnNames.has(base)` (known fn names), and the
dotted-base slice (`@obj.items` -> resolves `@obj`), with lookup tried on BOTH the
sigil form and the bare form (the reactive double-bind).

Two guards copied from the `on=` precedent, applied before parsing:
- `@.`-prefixed raw — the contextual sigil can confuse the expression parser, so
  it is short-circuited up front rather than relied on to early-return.
- unparseable raw — `parseExprToNode` in a `try`, falling back to no check, so a
  form the expression parser cannot handle defers to codegen rather than
  crashing the typer.

Must-not-break shapes measured green on base and re-measured after:
`in=@rows` (declared), `in=[1,2,3]` (literal), `in=@rows.filter(n => n > 1)`
(call), `in=r.kids` nested inside an outer `<each … as r>` (resolves against the
outer binding because the inner node is visited after the outer scope push).

## Found, not fixed (surfaced, out of scope)

- **`class="c-${@undeclared}"` — interpolated attribute values are NOT scope-checked.**
  A second, independent false negative of the same SPEC sentence, in the
  attribute-interpolation path rather than the structural-opener path. Distinct
  root cause; not touched here.
- The `E-SCOPE-001` attribute message suggests using `@` for a reactive variable
  (`@@undeclaredAttr`) when the value ALREADY starts with `@` — it blindly
  prefixes another `@`. Cosmetic message bug, pre-existing, not touched.

---

## Phase 2 — the check, as built

`compiler/src/type-system.ts`, `case "each-block"`, inserted between
`visitStructuralIfAttr(n)` and `scopeChain.push("each:…")`. For each of
`inExprRaw` / `ofExprRaw`: guard `@.`, strip a `${ … }` wrapper,
`parseExprToNode` in a `try`, then `checkLogicExprIdents(...)`. 57 lines,
~40 of them the comment explaining why the placement is load-bearing.

Coupled test: `compiler/tests/unit/each-opener-iterable-undeclared-read.test.js`,
13 cases, all passing. §3 is the load-bearing half — it pins both ordering traps
(a nested each's `in=` resolving against the OUTER row binding; and `in=@x` NOT
being absorbed by the each's own `as x` binding) plus arrow params, array
literals, the `@.` sigil, and the §59.8 2-name destructure.

Control matrix, base -> build:

| shape | base | build |
|---|---|---|
| `<each in=@undeclared as x>` | rc=0 silent | **rc=1 `E-STATE-UNDECLARED`** |
| `<each of=@undeclared as x>` | rc=0 silent | **rc=1 `E-STATE-UNDECLARED`** |
| `<each in=@undeclaredObj.items>` | rc=0 silent | **rc=1 `E-STATE-UNDECLARED`** |
| `<each in=${@undeclared}>` | rc=1 `E-CODEGEN-INVALID-LOGIC` | **rc=1 `E-STATE-UNDECLARED`** |
| `<each in=@rows as x>` (declared) | rc=0 | rc=0 (unchanged) |
| `<each in=[1,2,3] as x>` | rc=0 | rc=0 (unchanged) |
| `<each in=@rows.filter(n => n > 1)>` | rc=0 | rc=0 (unchanged) |
| nested `<each in=r.kids>` under `as r` | rc=0 | rc=0 (unchanged) |
| `${@undeclared}` | rc=1 `E-STATE-UNDECLARED` | unchanged |
| `<input value=@undeclared>` | rc=1 `E-SCOPE-001` | unchanged |

The `in=${@undeclared}` row is a side improvement: a real diagnostic replaces a
lowering crash (`E-CODEGEN-INVALID-LOGIC`, "the compiler could not lower this
construct").

## Phase 3 — THE MEASUREMENT (the deliverable)

### 0 of 1005

- **Newly-failing files (PASS -> FAIL): 0**
- Newly-passing files (FAIL -> PASS): 0
- Files whose diagnostic CODE SET changed at all (including files already
  failing for other reasons): **0**
- Total swept: **1005** — `examples/**` (71), `samples/**` (877),
  `stdlib/**` (53), `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` (4)
- Base verdicts: 754 PASS / 251 FAIL. Build verdicts: 754 PASS / 251 FAIL.
- Path lists byte-identical between the two sweeps (no silently-dropped file).

Newly-failing files to enumerate: **none**. The list is empty, not truncated.
Nothing to classify as genuine-vs-false-positive, because nothing newly failed.

Harness: `sweep.sh` (per-file verdict + full sorted-unique diagnostic code set),
`diff.sh` (verdict flips + code-set deltas). Raw data in `base.tsv` / `build.tsv`;
`flips.txt` and `codeset-changes.txt` are both 0 bytes.

### Why the zero is real and not a broken probe

A zero from a measurement harness is exactly the result a silently-dead harness
also produces, so the zero was adversarially verified rather than reported.

**Positive control on the whole chain.** Every corpus file carrying a real
`<each in=@cell>` opener that PASSES on the build was copied to scratch, its
iterated cell renamed to a guaranteed typo, and re-run through the EXACT sweep
command. **25 of 25 flipped PASS -> FAIL with `E-STATE-UNDECLARED`.** So the
compiler under measurement is the built one, the sweep reaches these files, and
the check fires on real corpus shapes. The zero means the corpus contains no
undeclared each-iterable — not that the probe was dead.

(First run of that control reported 24/25, with `examples/34-value-native-set.scrml`
"staying". That was a bug in the CONTROL SCRIPT, not the check: its cell-name
grep matched `<each in=@set>` inside a source COMMENT on lines 22 and 73, so the
mutation rewrote comment text and left the three real openers — `@certified`,
`@required.elements()`, `@gaps` — untouched. Re-running against the real opener on
line 75 flipped it. 25/25.)

**Highest-risk class checked by hand.** The bare-identifier (non-`@`) `in=` forms
are the likeliest false-positive source, because they route through the
`E-SCOPE-001` half of `checkLogicExprIdents` and depend on component props /
file-scope `let` / fn decls being bound at opener-evaluation time. All 10 corpus
occurrences hold, base verdict == build verdict, code sets unchanged:
`in=rows`, `in=drivers` (component prop, `props={ drivers: asIs, … }`),
`in=nextStates`, `in=columns`, `in=items` x2, `in=names`, `in=users` x2, and
`in=buildItems(["a","bb","ccc"])` (a call).

**`of=` contributes exactly 0**: there are zero `<each of=…>` openers anywhere in
the swept corpus (verified by grep). It is wired for the same reason the check
exists — the `of=` slot has the identical silent-failure shape — but it changes
no corpus file.

### What this means for the ruling

Brief conditions 1 (governing SPEC sentence exists) and 2 (newly-rejecting
change) were already satisfied. Condition 3 is **measured zero**. Per the brief
that puts the ruling inside the PA's granted authority. Recorded, not acted on —
this branch is not landed and no PR was opened.

The check was NOT tuned toward zero. It was built once, from the `<match on=>`
precedent, and measured once. The only change made after the first measurement
was to the positive-control script, and that change made the control STRICTER.


## Phase 4 — full suite

`bun run test` (= `bun test compiler/tests/`, which includes the browser and
dev-server lanes the pre-commit hook excludes). Base measured on `a8448ac`
BEFORE any edit; build measured on `b4e267b6`.

| | base `a8448ac` | build `b4e267b6` |
|---|---|---|
| pass | 30703 | 30717 |
| fail | 57 | 55 |
| skip | 216 | 216 |
| todo | 2 | 2 |
| test files | 1425 | 1426 |

**Zero new failures.** `+14 pass` is the 13 new test cases plus one browser-lane
test that happened to pass this run; `-2 fail` is browser-lane noise in the other
direction. Counts alone are not evidence here, so the failure NAME SETS were
captured on both sides and diffed:

- Names in build but not base: **1** —
  `M1 — an if= mount/unmount controller in a swapped region RE-EVALUATES > a
  swapped-in if= mounts on true and unmounts on false (not frozen)`
- Names in base but not build: 0

That one name is NOT a regression, established three ways:
1. It is a pre-existing entry in the tracked browser known-failure baseline,
   `compiler/tests/browser/FAILURE-BASELINE.json` line 13 (48 asserted names,
   recorded 2026-08-02) — i.e. it was already-failing before this dispatch
   existed. The base run simply did not hit it that pass.
2. Run in ISOLATION on the build, that test PASSES
   (`bun test compiler/tests/browser/browser-navigate-soft-nav.test.js`) — the
   happy-dom cross-file global-state-leak signature.
3. The authoritative gate agrees: `bun scripts/browser-baseline.ts --check`
   reports **PASS — browser failure name set matches the baseline (48 asserted,
   0 of 2 env-excluded observed)** on the build.

Pre-commit gate lanes (unit + integration + conformance, browser excluded) on the
build: **22985 pass / 0 fail / 70 skip / 1 todo**, 23056 tests across 1277 files,
exit 0. The full pre-commit hook also ran clean at commit time (it gates the
commit; the Phase-2 commit `b4e267b6` would not exist otherwise).

The within-node parser-parity canary
(`compiler/tests/parser-conformance-within-node.test.js`, part of the suite)
passes — the raw-text route adds no AST field, so there is nothing for it to
diverge on against the native parser.

## Terminal state

- Branch: `worktree-agent-a4c73958a8bad6e3b`. **NOT LANDED. No PR opened.**
- The measurement says condition 3 is satisfied at **0 of 1005**.
