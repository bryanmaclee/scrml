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

---

# ROUND 2 — closing the class, not two-thirds of it

Rebased onto `origin/main` `9a0ad569`. Round-1 sections above are unchanged and
still accurate for `in=`/`of=`; this section supersedes the round-1
"Found, not fixed" list, which was WRONG BY OMISSION — it named two other holes
but not `key=`, so a reader would have concluded the `<each>` opener was fully
covered when one slot was still open.

## The third slot: `key=`

`keyExprRaw` is captured by the same `_captureAttrValue` raw-text path
(`ast-builder.js:16786`) as `inExprRaw`, and lowered by codegen without reaching
the typer. Round 1 enumerated only `["inExprRaw", "ofExprRaw"]`.

Reproduced on the round-1 branch:

```scrml
<each in=@rows key=undeclaredBareKey as r><li>${r}</li></each>
```

compiled **exit 0** and emitted, in TWO places:

    (r, _scrml_each_idx) => undeclaredBareKey
    const _scrml_each_key_1 = undeclaredBareKey;

A bare reference to an identifier that does not exist: **ReferenceError on first
render**. That is strictly worse than the silent-empty list `in=` produced — an
undeclared `in=` breaks one list, an undeclared `key=` takes the page down.

## The correction: `key=` is the ORDERING MIRROR of `in=`

The round-2 brief said to add `keyExprRaw` to the same loop. **That would have
been a false positive**, and the file's own premise ranks over-firing as worse
than the false negative it closes.

The key expression is evaluated PER ITEM, with the row variable bound as a
function parameter. Verified in emitted output — `<each in=@rows as r key=r.id>`
lowers to:

    (r, _scrml_each_idx) => r.id

So `r` IS in scope for `key=`. The `in=`/`of=` loop runs BEFORE
`scopeChain.push("each:…")` — deliberately, so the loop's own `as` binding cannot
absorb the iterable's lookup. Putting `key=` there would have rejected the
documented `key=r.id` row-variable form.

| slot | evaluated | checked |
|---|---|---|
| `in=` / `of=` | once, before any row exists | BEFORE the scope push |
| `key=` | per item, row var in scope | AFTER the push AND after the `as` / `as (k, v)` bindings |

The shared routine (`checkEachOpenerExpr`) is therefore extracted ONCE and called
from BOTH scopes — still one parser, one walker, no second predicate. Pinned by
ORDERING TRAP A/B (§3, `in=`) and ORDERING TRAP C (§5, `key=`).

## `iterShape` gating (verified, then applied)

- `ast-builder.js:16917`: `else if (inExprRaw && ofExprRaw) iterShape = "in";` —
  tie-break to `in=` when both are present.
- `emit-each.ts:3748-3760`: lowering branches on `node.iterShape`, so with both
  present the `of=` text is **dead** — it has zero effect on output.

Round 1 checked both unconditionally, so `<each in=@rows of=@typo>` raised a
scope error about an attribute that does not affect the emitted program. Now
gated on `iterShape`. The both-present CONFLICT is PASS's diagnostic to fire; this
check no longer shadows it with a misleading one. Pinned by §6.

## `of=` semantics — the round-1 comment was WRONG

The round-1 comment called `of=` the "`of=` twin" iterable. It is not. Verified at
`emit-each.ts:3755`: `of=` is a repeat COUNT —

    Array.from({length: Number(ofExprResolved) || 0}, (_v, _i) => _i)

The CHECK on it was correct either way (`<each of=@daysLeft>` is still a cell
read), but that comment block is the designated explanation for the next reader,
so it is corrected in place.

## TWO DEFECTS IN MY OWN ROUND-1 TEST

Both are mine, both found in round 2, and both are the same class as the
control-script bug: an assertion that reads like it proves something and proves
nothing.

**1. `§1`'s emitted-JS assertion was VACUOUS.** It asserted

    expect(r.clientJs).not.toContain('_scrml_reactive_get("totallyUndeclaredName")')

Chunk-cell-scoping emits `_scrml_cs_reactive_get(...)`, which does not contain the
substring `_scrml_reactive_get(`. So it passed against output that still carried
the bad lowering **verbatim** — confirmed by probing the in-memory `clientJs`.

It was also the WRONG ARTIFACT. Codegen runs regardless of TS errors, and the CLI
writes artifacts even on a failed compile (verified: `exit 1`, and
`key-bare.client.js` / `.html` / runtime all still written). The DIAGNOSTIC is the
contract; emitted text is not. Both `clientJs` assertions removed, with the
reasoning recorded at the site so it is not re-added.

**2. The no-regression helper under-asserted.** It filtered on
`E-STATE-UNDECLARED` only, while `checkLogicExprIdents` also fires `E-SCOPE-001`
(bare undeclared ident, and the missing-`@`-sigil variant), `E-SCOPE-012`
(`session` outside a server fn), and — via `checkRowFieldAccessInExpr` —
`E-TYPE-004`. A future edit making `in=@rows.filter(n => n > 1)` fire on the arrow
param would have passed every §3 case green. Now code-agnostic: asserts NO `E-`
diagnostic at all. Re-run under the stricter assertion: still green, so nothing
was hiding behind it.

## `positive-control.sh` is now reproducible from a clean checkout

It previously read an uncommitted `/tmp` scratch file for its corpus list — for
the one artifact that makes the zero credible rather than a dead-harness result.
It now builds the list inline like `sweep.sh`, takes the slot and sweep label as
arguments, verifies the mutation landed on a real opener, and **exits non-zero if
any file stays passing**.

It also now handles the comment trap properly. `examples/34-value-native-set.scrml`
documents the feature by writing the opener literally inside a `//` comment
("`(also: <each in=@set> directly)`"). Anchoring the grep on `<[[:space:]]*each`
does NOT help — the comment genuinely contains that text. Round 1 caught this by
hand; round 2 first tried a stricter anchor which STILL failed, and the working
fix is to match against a comment-blanked view of the file. Both slots now run
clean with no manual intervention.

# ROUND 2 MEASUREMENT

Same harness, same 1005 files, same roots.

## `key=` delta — round-1 build -> round-2 build: **0 of 1005**

This is the number the `key=` slot owes on its own. It does NOT inherit the
`in=`/`of=` zero.

- Newly-failing (PASS -> FAIL): **0**
- Newly-passing: 0
- Files with ANY diagnostic code-set change: **0**

## Cumulative — base `a8448ac` -> round-2 build: **0 of 1005**

- Newly-failing (PASS -> FAIL): **0**
- Newly-passing: 0
- Files with ANY diagnostic code-set change: **0**
- Verdict totals identical across all three sweeps: 754 PASS / 251 FAIL
- Path lists byte-identical

Newly-failing files to enumerate: **none**, in both directions. The lists are
empty, not truncated. Nothing to classify genuine-vs-false-positive.

## Why the `key=` zero is real

The corpus uses only two `key=` forms — `key=@.id` (22 uses) and `key=__index__`
(13 uses) — and BOTH are exempt by design:

- `@.id` is the §17.7.3 contextual iteration sigil, short-circuited up front.
- `__index__` is the documented positional-fallback sentinel. It is not declared
  anywhere; it survives on the walker's `_`-prefix exemption
  (`type-system.ts:7843`, `if (raw.startsWith("_")) return;`). This is a concrete
  argument for routing through the walker rather than re-deriving a local notion
  of what counts as a read — a hand-rolled predicate would have had to
  rediscover that rule, and would have broken 13 corpus files if it hadn't.

So the zero is explained, not merely observed. And it was positive-controlled
anyway, because the corpus containing no `key=@cell` form is exactly the
condition under which a dead check would also measure zero:

**Positive control, `key` slot: 20 of 20 flipped PASS -> FAIL, 0 stayed.** Every
corpus file with a real `key=` opener, rewritten to a bare undeclared key, now
fails. (`skipped=14` are files with no `key=` opener or already failing.)

**Positive control, `in` slot, re-run against the round-2 build: 25 of 25
flipped, 0 stayed.** The `in=` path did not regress.

# FOUND, NOT FIXED (round-2 revision — supersedes the round-1 list)

The `<each>` opener is now covered on all three expression slots: `if=` (S302,
pre-existing), `in=`, `of=`, `key=`. Remaining, all OUTSIDE this node:

1. **Interpolated attribute values are not scope-checked.**
   `<div class="c-${@undeclared}">` compiles clean — a second, independent false
   negative of the same SPEC §6.1.2 sentence, in the attribute-interpolation path.
   Different root cause. Untouched.

2. **A failed compile still writes artifacts.** `bun compiler/bin/scrml.js
   compile` exits 1 on an undeclared read but still writes `.client.js`, `.html`,
   `.css` and the runtime to the output dir — including, in the `key=` case, JS
   that throws a ReferenceError on load. The exit code is the gate, so a CI
   pipeline is safe, but a dev server or a stale-artifact consumer may not be.
   Surfaced, not diagnosed.

3. **`<each in=… of=…>` (both present) fires no conflict diagnostic.** The AST
   builder's own comment says "PASS surfaces conflict", but the both-present case
   compiles rc=0 today. Round 1 accidentally shadowed this with a scope error on
   the dead `of=`; round 2 correctly stops doing that, which leaves the real gap
   visible. Pre-existing, not this dispatch's to fix.

4. **The `E-SCOPE-001` attribute message mis-suggests.** It advises "use `@` for a
   reactive variable (`@@undeclaredAttr`)" when the value already starts with `@`
   — it blindly prefixes another `@`. Cosmetic, pre-existing.

# LANDING NOTE — newly-rejecting outside the swept corpus

`<each in=laterNames>` where `laterNames` is a `const` declared LATER in a `${…}`
logic body was rc=0 on base and is now `E-SCOPE-001`. Zero corpus hits, so it does
not appear in the measurement — recorded here because an adopter could hit it.

**It is consistency, not a new rule.** Verified directly, all three on this build:

| form | verdict |
|---|---|
| `${laterNames}` (interpolation) | `E-SCOPE-001` — already rejected before this dispatch |
| `<tableFor in=laterNames>` | `E-SCOPE-001` — already rejected before this dispatch |
| `<each in=laterNames>` | `E-SCOPE-001` — NEW; now matches its siblings |

Reactive CELLS hoist to file scope (§6.9, and the typer pre-binds them for exactly
this reason), so `<each in=@laterCell>` above the declaration still resolves. A
`const` in a `${}` logic body does not hoist. Both halves pinned by §7.

## ROUND 2 — full suite

| | base `a8448ac` | round-1 build | round-2 build |
|---|---|---|---|
| pass | 30703 | 30717 | 30727 |
| fail | 57 | 55 | 55 |
| skip | 216 | 216 | 216 |
| todo | 2 | 2 | 2 |
| test files | 1425 | 1426 | 1426 |

**Zero new failures.** Failure NAME SETS diffed against the base set captured
before any edit: exactly **1** name in round-2-not-in-base, and it is the same
documented browser-lane entry as round 1 —
`M1 — an if= mount/unmount controller in a swapped region RE-EVALUATES > a
swapped-in if= mounts on true and unmounts on false (not frozen)` — a pre-existing
line in `compiler/tests/browser/FAILURE-BASELINE.json` (48 asserted names,
recorded 2026-08-02), which the base run simply did not hit that pass. Zero names
in base-not-in-round-2.

Authoritative gate on the round-2 build:
`bun scripts/browser-baseline.ts --check` -> **PASS — browser failure name set
matches the baseline (48 asserted, 0 of 2 env-excluded observed)**.

Pre-commit hook (unit + integration + conformance, browser excluded) on the
round-2 build: **29373 pass / 0 fail**. It gates the commit, so `b01b5658` would
not exist otherwise.

## Terminal state (round 2)

- Branch: `worktree-agent-a4c73958a8bad6e3b`, rebased onto `origin/main`
  `9a0ad569`, 0 behind. **NOT LANDED. No PR opened.**
- `<each>` opener now covered on all four expression slots: `if=` (S302,
  pre-existing), `in=`, `of=`, `key=`.
- Corpus impact: **0 of 1005** for the `key=` delta, **0 of 1005** cumulative.

---

# ROUND 3 — the suite was blessing a crash

Rebased onto `origin/main` `085570ca`. Round-1/2 sections above stand except where
this section says otherwise.

## The test was pinning the exact failure class this landing closes

Round 2's §5 asserted `<each in=@m.entries() as (k, v) key=k>` compiles clean.
It does — and the JS it emits crashes on first render, twice:

    (_scrml_each_item, _scrml_each_idx) => k,   // free `k` -> ReferenceError
      const _scrml_each_key_1 = k;              // read here...
      const k = _scrml_each_item.key;           // ...bound AFTER -> TDZ

**The scope check is right; codegen is wrong.** `k` genuinely IS in scope for
`key=` — that is ORDERING TRAP C, and it stands. The defect is `emit-each.ts`:
`keyFnBody` is computed at ~`:3160` and consumed at ~`:3164` and ~`:3172`, but
`emitDestructureBindingLines` does not run until ~`:3184`.

- §5's case is now a **`test.todo` naming `GAP-S385-EACH-KEY-DESTRUCTURE`**, sited
  where the bad assertion was so it cannot be silently reinstated.
- Full write-up in `GAP-DRAFTS.md` for the PA to file (`known-gaps.md` is PA-owned).

**Not fixed here, and it is NOT a line move** — reporting that explicitly because
it was the stated condition for touching codegen. Reordering fixes fire (2) only;
fire (1) needs the standalone arrow to gain a block body carrying the bindings, or
the key expression rewritten against `_scrml_each_item.key`. Either is an
emitted-shape change, so the differential is not byte-identical on every
non-destructured `key=`.

Scope is narrow, verified: it needs `key=` to REFERENCE a destructure name.
Without `key=`, the default key expression never mentions `k`/`v` and the same
source emits fine. Single-name `as r` + `key=r.id` is also fine — `r` IS the key
fn's own parameter.

## The `@.` bail is gone

`if (trimmed.startsWith("@."))` returned on the ENTIRE opener value, not the `@.`
sub-read, so any cell read beside a leading sigil went unchecked.

| shape | before | after |
|---|---|---|
| `key=@.id + @hiddenKeyTypo` | `E-CODEGEN-INVALID-LOGIC` | **`E-STATE-UNDECLARED`** naming the cell |
| `in=@.rows.concat(@hiddenTypoCell)` | `E-CODEGEN-INVALID-LOGIC` | **`E-STATE-UNDECLARED`** naming the cell |
| `key=@.id` | clean | clean |
| `key=@.email` | clean | clean |
| `${@.}` in body | clean | clean |

**Divergence from the round-3 brief, recorded because measurement wins.** The brief
described both holes as "compiles clean". They did not — both exited 1 with
`E-CODEGEN-INVALID-LOGIC`. So they were **bad-diagnostic** holes, not
silent-failure holes: the compiler did stop, but reported "could not lower this
construct" instead of naming the typo. The fix still matters, and the direction
was right; the failure mode was one notch less severe than relayed.

The guard bought nothing, verified directly rather than assumed:
`parseExprToNode` was called on `@.`, `@.id`, `@.id + @typo`,
`@.rows.concat(@typo)` — **none throw**; they yield `ident` / `binary` / `call`
nodes whose `@.` idents the walker already exempts at its own check (~`:7795`).
The `try` covers any parse failure regardless.

## Every interpolation is a read site

The `${…}` unwrap inherited from the `<match on=>` precedent was
`/^\$\{([\s\S]*)\}$/` — greedy and single-shot. On `key=${@a}-${@b}` it collapses
to the inner text `@a}-${@b`, so **`@b` was never checked**.

My first fix was wrong in a new way. Tightening the class to `[^}]` makes the
multi-interpolation shape simply not match, which hands the raw template to the
parser and produces **"Undeclared identifier `$`"** — a diagnostic that names
nothing and would have been worse than the silence it replaced.

Replaced with a brace-depth scan that collects every `${…}` body and checks each,
so `${ {a: 1}.a }` also survives. `key=${@a}-${@hiddenSecondTypo}` now reports
`@hiddenSecondTypo` by name. Pinned by §9, which asserts both the correct fire AND
the absence of the `` `$` `` diagnostic.

## `E-EACH-ITER-SHAPE` does not exist — comment corrected

Round 2 justified the `iterShape` gate with "the both-present conflict is PASS's
diagnostic to fire". Verified: that code is **never implemented**.

    $ grep -rn E-EACH-ITER-SHAPE compiler/src compiler/native-parser compiler/tests
    compiler/src/ast-builder.js:16911:   ... as E-EACH-ITER-SHAPE ...
    compiler/native-parser/parse-file.js:1029: ... missing-or-both as E-EACH-ITER-SHAPE.

Two comments, zero fires. `<each in=@rows of=@typo>` compiles with zero
diagnostics today.

Corrected in BOTH places that cited it — the source comment and test §6. The gate
is now described honestly: deliberate **under-fire** on a shape nothing else
catches either, chosen over **over-fire** with a message pointing at text the
compiler is about to discard. Filed as `GAP-S385-EACH-ITER-SHAPE-UNFIRED`.

# ROUND 3 MEASUREMENT

Dropping the `@.` bail can only WIDEN coverage, so it owes its own number.

## `@.`-guard-drop delta — round-2 build -> round-3 build: **0 of 1005**

- Newly-failing (PASS -> FAIL): **0**
- Newly-passing: 0
- Files with ANY diagnostic code-set change: **0**

## Cumulative — base `a8448ac` -> round-3 build: **0 of 1005**

- Newly-failing (PASS -> FAIL): **0**
- Newly-passing: 0
- Files with ANY diagnostic code-set change: **0**
- Verdict totals identical across all four sweeps: 754 PASS / 251 FAIL
- Path lists byte-identical

Positive controls re-run against the round-3 build — the chain is still live:

    positive control [in  vs build-r3]: flipped=25 stayed=0 skipped=9
    positive control [key vs build-r3]: flipped=20 stayed=0 skipped=14

# WHAT STANDS FROM EARLIER ROUNDS

Unchanged and still measured: `in=`/`of=`/`key=` all fire on undeclared reads;
`key=__index__`, `key=@.id`, `in=@rows.filter(n => n > 1)`, component-prop
`in=drivers`, `@session`, nested-each `in=r.kids` all clean; the `as (k,v)`
ordering placement (TRAP C) is correct and stays; the §7 bare-`in=<later const>`
behaviour change is real, documented, corpus-zero.

## ROUND 3 — full suite

| | base `a8448ac` | round-1 | round-2 | round-3 |
|---|---|---|---|---|
| pass | 30703 | 30717 | 30727 | 30730 |
| fail | 57 | 55 | 55 | 55 |
| skip | 216 | 216 | 216 | 216 |
| todo | 2 | 2 | 2 | 3 |
| test files | 1425 | 1426 | 1426 | 1426 |

**Zero new failures.** The `todo` count rises 2 -> 3: that is
`GAP-S385-EACH-KEY-DESTRUCTURE`, the case that previously passed by asserting a
crash was fine. A green test became an honest todo, which is the point.

Failure NAME SETS diffed against the base set captured before any edit: the same
single documented browser-lane entry as rounds 1 and 2
(`M1 — … a swapped-in if= mounts on true and unmounts on false (not frozen)`,
`FAILURE-BASELINE.json` line 13), zero names in the other direction.

Authoritative gate on the round-3 build:
`bun scripts/browser-baseline.ts --check` -> **PASS — browser failure name set
matches the baseline (48 asserted, 0 of 2 env-excluded observed)**.

Pre-commit hook (unit + integration + conformance): **29376 pass / 0 fail**.

## Terminal state (round 3)

- Branch `worktree-agent-a4c73958a8bad6e3b`. **NOT LANDED. No PR opened.**
- `<each>` opener covered on all four expression slots — `if=` (S302,
  pre-existing), `in=`, `of=`, `key=` — with `in=`/`of=` checked outside the
  per-item scope and `key=` inside it.
- Corpus impact: **0 of 1005** for the `@.`-guard-drop delta, **0 of 1005**
  cumulative from base.
- Two reproduced gaps drafted in `GAP-DRAFTS.md` for the PA to file.
