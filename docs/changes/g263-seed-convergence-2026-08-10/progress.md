# progress — g263 seed convergence (append-only)

Startup `pwd`: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a72905887573ded02`
Base: `2cc0e4fc` (branch `worktree-agent-a72905887573ded02`).
The BRIEF landed on `fix/g263-seed-convergence` @ `036680e9` AFTER this worktree was cut, so it is
not in the worktree tree; read verbatim via `git show 036680e9:docs/changes/g263-seed-convergence-2026-08-10/BRIEF.md`.

## Step 0 — BASELINE, measured (not inherited)

Probe: two-file fixture. `models.scrml` exports `NEEDED`; `index.scrml` imports it and reads it
**only** in the position under test. PASS = `models.client.js` declares `const NEEDED = …` AND the
`_scrml_modules` footer carries `NEEDED: NEEDED` AND the importer destructures it.

Every one of the six positions ALSO emits a real client reference to `NEEDED` in `index.client.js`
(verified by dumping the bundle), so each miss is a live `ReferenceError`, not a theoretical one:

| # | position | probe | at base `2cc0e4fc` | client ref emitted |
|---|---|---|---|---|
| 1 | member/namespace call-ref base | `onclick=NEEDED.go(1)` | FAIL | `function(event){ NEEDED.go(1); }` |
| 2 | unparseable call-ref args | `onclick=handle(NEEDED, , 2)` | FAIL | `function(event){ handle(NEEDED); }` |
| 3 | `<match>` block arm body | `<match for=Phase on=@phase>` arm attr | FAIL | `function(event){ NEEDED(); }` |
| 4 | engine transition guard | `<onTransition to=.Playing if=(NEEDED == 1)>` | FAIL | `if (NEEDED === 1) {` |
| 5 | engine state-child body | `<Title rule=.Playing : @hits = NEEDED>` (`:`-shorthand) | FAIL | `_scrml_cs_reactive_set("hits", NEEDED)` |
| 6 | engine `derived=` projection | `derived=(NEEDED == 1 ? .X : .Y)` | FAIL | `const __scrml_derived_v = ((NEEDED === 1 ? "X" : "Y"));` |

### Shape corrections to the BRIEF's stated repro shapes (measured)

- **Position 2** — "if any one arg fails to parse, `argExprNodes=undefined` for the WHOLE call" is
  true but the trigger is narrower than the brief implies. `safeParseExprToNodeGlobal` returns
  `undefined` ONLY for an empty/whitespace arg; a genuinely unparseable arg returns a
  `{kind:"escape-hatch"}` node, which keeps `argExprNodes` defined. Measured:
  `handle(NEEDED, , 2)` and `handle(NEEDED, ,)` → `argExprNodes === undefined`;
  `handle(NEEDED, "a,b")` / `handle(NEEDED, [1,)` → present, with escape-hatch members.
- **Position 5** — the BARE-BODY state-child form (`<Title rule=.Playing><onTransition …>${…}</></>`)
  is ALREADY reachable at base: the engine's `bodyChildren` carries a walkable markup subtree and the
  old walker's array recursion found it. The genuinely unreachable shape is the **`:`-shorthand**
  body (`<Title rule=.Playing : @hits = NEEDED>`), which exists ONLY as `rulesRaw` /
  `_record.engineMeta.stateChildren[].bodyRaw`. Probe amended accordingly.
- **Position 4** — the guard IS present on the `bodyChildren` `<onTransition>` node as
  `attr.value.exprNode` (`{kind:"expr", raw:"(NEEDED == 1)", exprNode:{…}}`), so it is reachable via
  the attribute-value route, not only via `_record…onTransitionElements[].ifExprRaw`.
- **Position 3** — the arm body IS walkable at `matchBlock.armBodyChildren`; the miss is the
  attribute-value route (`call-ref` under `attr.value`), not the raw `armsRaw` text.

Probe scripts (scratch, not committed):
`$SCRATCH/g263/probe.mjs`, `$SCRATCH/g263/ast.mjs`, `$SCRATCH/g263/argprobe.mjs`.

## Step 1 — `526796cd` — Peter's `${}`-scan extraction, reviewed and taken

`forEachTemplateInterpolation` (`codegen/rewrite.ts`) is now the single escape-aware `${}` scan;
`rewriteTemplateAttrValue` consumes it. Verified byte-equivalent to the pre-extraction
implementation over a 21-case battery + 20,000 randomized fuzz strings drawn from
`$ { } \ ` @ a b space \n 1 .` — identical `jsExpr` AND identical `reactiveVars` in every case.

## Step 2 — `8e9beb97` — the walker DELETED, the table born

- NEW `compiler/src/expr-positions.ts` — the position table + `EXPR_NODE_FIELDS`.
- NEW `compiler/src/codegen/client-read-seed.ts` — `collectClientReadIdents`.
- `collectClientReferencedIdentsForAST` deleted from `emit-client.ts` (-238 lines).
- All six positions FAIL→PASS. All six §14.8 leak vectors clean.
- Perf: a per-file memo keyed on AST identity collapses `runCG`'s cross-file precompute and the
  per-file export-const gate into ONE walk. `examples/23-trucking-dispatch`, 3 runs each:
  base 4.579/4.708/4.542s, head 4.598/4.795/4.669s.

## Step 3 — `dace93db` — dependency-graph consumes the same table

`creditFromAttrValue` + five hand-inlined blocks → one `creditFromPositions`. Net -372 lines.
`EXPR_NODE_FIELDS` shared (was 6 fields in DG, 11 in the walker).

**Corpus emit-differential, by hand, base `036680e9` vs head — VERDICT: NO DIFFERENCES.**
1904 sources · 7375 artifacts · 0 diagnostic changes · 0 artifact content diffs · 0 syntax delta
under either goggle · 0 load-context changes · bare server-fn sites 145/145.

## Step 4 — `fed3ae70` — tests + the build-side-const fix

`conf-CG-263-seed-position-convergence.test.js` (39) + `expr-positions-shared-table.test.js` (16).
Measured at base `2cc0e4fc`: **14 fail / 25 pass**; at head **39 pass / 0 fail**.

`import.meta` in an export-const initializer is now a fail-closed skip. Measured on the emitted
`models.client.js`: bun `vm.Script` PARSE **OK**, node `vm.Script` PARSE **SyntaxError**, EXECUTION
**fails under both**. A parse check under bun alone reports it clean.

## Findings to FILE (docs/known-gaps.md is PA-owned — not edited here)

1. **`g-263` re-characterisation.** Stated locus `emitReferencedModuleExportConstLines` is WRONG;
   the locus was the `crossFileClientReads` seed, and the CLASS is wider than one emitter — it was
   a position-enumeration drift between two untyped walkers. Now closed at the substrate.
2. **`g-stdlib-module-resolver-emits-import-meta-into-a-classic-script-bundle` — locus WRONG and
   symptom UNDER-stated.** It is NOT the #263/#358 machinery: `STDLIB_ROOT` is a plain (non-export)
   top-level `const`, emitted by `emitReactiveWiring`'s top-level logic walk. Symptom evidence:
   bun `vm.Script` parse OK / node `vm.Script` parse FAILS / EXECUTION fails under both; the HTML
   loads it as `<script src="module-resolver.client.js">` with no `type="module"`. Two further
   defects in the same emission, neither in the gap text: the initializer is DOUBLED
   (`new URL(resolve ( dirname ( new URL ( import . meta . url ) …`), and the `const` is emitted
   AFTER the `_scrml_meta_effect` call that reads it (TDZ) while `resolve`/`dirname` are bound only
   INSIDE that effect's async body — so the reference is dangling regardless of `import.meta`.
   Fixing it needs a build-side classification rule, which is a design question, not a patch.
3. **Call-ref argument ELISION is emitted verbatim.** `onclick=handle(NEEDED, , 2)` emits
   `handle(NEEDED, , 2)` into the client bundle — invisible to `new vm.Script` under bun, invalid
   JS in a browser. Separate from g-263; surfaced by its position-2 fixture.

---

# FIX ROUND (adversarial review) — `9bdd6eed`

Five findings. Two are real defects in this arc, one is a real defect in this arc PLUS two
pre-existing leaks on `main` that the same fix closes, one is a real widening, one is a real
sharp edge, one is a real cost. All five addressed; two of the reviewer's characterisations
needed correcting, both with measurement.

## The root, restated

The reviewer's framing is right and is worth keeping: two callers, two reaches, two shadow
policies, neither re-derived after the merge. But the deeper problem is that **shadow policy
lived in the CALLERS at all**, expressed as a flat bag of bound names. A flat bag cannot say
*where* a name is bound, and the two defects below are the two directions of that one gap.
The fix is a real SCOPE STACK inside the collector; `ClientReadOptions`/`boundOut` are deleted,
and `codegen/index.ts` no longer subtracts anything. There is now no policy for a call site to
get wrong because there is nothing for a call site to do.

## Finding 1 — CRITICAL, confirmed, and WIDER than filed

Reproduced exactly. **Correction: only ONE of the three same-file shadow vectors was introduced
by this arc.** Measured with a same-file probe (no imports, so the cross-file guard never runs):

| same-file vector | `main` 2cc0e4fc | pre-fix b821e7c0 | now |
|---|---|---|---|
| lambda param shadow (`@rows.map(SECRET => …)`) | no leak | **LEAK** | no leak |
| `<each … as SECRET>` loop-var shadow | **LEAK** | **LEAK** | no leak |
| client `function compute(SECRET)` param shadow | **LEAK** | **LEAK** | no leak |
| local `let SECRET` shadow | no leak | no leak | no leak |
| no shadow, read only in a pruned `server fn` | no leak | no leak | no leak |
| positive control — genuinely client-read const | emitted | emitted | emitted |

**The same-file gate has never had a shadow guard of any kind.** On `main` the two non-lambda
vectors already ship the secret; the arc's unconditional deep walk added the lambda one. So this
arc made a pre-existing §14.8 scope-blindness leak one vector worse, and the scope stack closes
all three.

The reviewer's diagnosis of WHY it was invisible is exactly right and is the transferable part:
**all six `LEAK_VECTORS` put the secret in a separate `models.scrml`, so every one travelled the
cross-file path. A test suite that exercises one of a helper's two callers reads exactly like one
that exercises both.** §4 of the conformance file now covers the same-file caller.

## Finding 2 — HIGH, confirmed. Was the dead code dead by design?

**By ACCIDENT** (a `return` sat above it), and its INTENT was half right.

- The half that was right: function params genuinely must not be read as module-scope reads.
  `function compute(SECRET) { return SECRET }` beside a server-only `export const SECRET` leaks
  without them — that is finding 1's third row, and it leaks on `main` today.
- The half that was wrong: binding them into a FLAT, file-wide set is a different claim. A
  param binds inside its own body and nowhere else.

Both halves are now expressed exactly: params bind INSIDE the body; the fn NAME binds in the
ENCLOSING scope (a top-level `function greet` really is a module binding, and if an import shares
that name the local wins, so the import genuinely is not read).

Measured: `function greet(NEEDED)` + `on mount { @a = NEEDED }` → `main` decl=true, pre-fix
decl=**false** with `index.client.js` reading a free variable, now decl=true and the read
RESOLVES when the two bundles are executed deps-first in one scope.

## Finding 3 — MEDIUM, confirmed. Scoped, not justified.

`state` and `state-constructor-def` do carry `attrs` (`compiler/src/types/ast.ts:270,286`).
Attribute positions now carry `render: node.kind === "markup"`, which restores the
pre-convergence edge topology exactly — the identifier consumer still SEES the position, only
`render` differs, so nothing is lost on the seed side. The structural `if=` gate keeps
`render: true` on its non-markup owners because it governs whether they render.

## Finding 4 — LOW, confirmed. Both stated cases reproduced.

`${@a} && ${@b}` → `@a} && ${@b`; `'a' == 'b'` → `a' == 'b`. Now brace-balanced (the `${`'s own
match must be the last character) and delimiter-checked (the quote must not recur unescaped
inside). When in doubt it returns the string UNSTRIPPED — the outer form then parses, or fails
honestly.

## Finding 5 — LOW, bounded and measured.

Markup text no longer goes through the statement parser: an `<each>` body, `<match>` arms and an
engine `rulesRaw` are markup and never parse as an expression, so the loop burned a
`parseExprToNode` to learn that on every compiled file. The `${…}` interior scan — where the code
actually is — runs either way. `examples/23-trucking-dispatch`, 3 runs each:
`main` 4.468/4.467/4.433 vs head 4.673/4.548/4.565 → **+3.1%**.
**RESIDUAL, acknowledged not closed:** a raw body is still scanned for `${…}` while the recursion
independently walks the same children. Closing it needs the raw and the rebuilt-children
representations reconciled, which is a bigger change than the 3% justifies today.

## Verification

- Two test files, 74 tests, three source states:
  `main` 53 pass / **21 fail** · pre-fix `b821e7c0` 64 pass / **10 fail** · now **74 pass / 0 fail**.
- Full suite (unit + integration + conformance + top-level): **28741 pass / 86 skip / 1 todo / 0 fail**.
- Corpus emit-differential, base `036680e9` vs head: **NO DIFFERENCES** — 1904 sources, 7375
  artifacts, 0 diagnostic changes, 0 content diffs. Both leaks closed here have zero corpus
  incidence, which is why nothing moved.
- `grep -rn collectClientReferencedIdents` → **zero**.
- `expr-positions.ts` EXPORTED contract UNCHANGED (`ExprPosition`, `ExprPositionKind`,
  `forEachExprPosition`, `EXPR_NODE_FIELDS`). The `renderBase` parameter added this round is on a
  module-private helper. Relevant to the sibling arc converging the validation walk onto it.

## DISPUTED — the browser-failure figures

The brief reports 49 failures on this branch vs 51 on `main`, i.e. this branch fixing 2.
**I measure 48 on BOTH sides, and the failure SETS are byte-identical by name** (compared as
sorted name lists, per the "gate on the failure NAME SET, not the count" rule — a count
comparison cannot tell a fix from a swap). Method: `bun run pretest` re-run on each side before
the browser suite, with only `compiler/src` swapped, so each side reads fixtures compiled by its
own compiler.

There is also an independent argument that a 2-test browser improvement is impossible here: the
corpus emit-differential reports **0 artifact content diffs across 7375 artifacts**. If no emitted
byte changed anywhere, no browser behaviour can change. The most likely explanation for 49/51 is
stale `samples/compilation-tests/dist/` fixtures on one of the two sides.

---

# FIX ROUND 2 — the wired/not-wired ruling — `f64eb848`

## The diagnosis, kept because it is the durable part

**The seed asks "which identifiers does CLIENT-EXECUTED code reference?" The table
answered "where does user expression SOURCE appear?"** Three leaks across three rounds all lived
in the gap: prose that looks like code, an attribute that lowers to static text, a name that is
merely shadowed. And the seed failed **OPEN** into that gap every time — over-emitting ships a
secret silently, under-emitting throws a loud `ReferenceError`. Ruling (b) built.

## THE CONTRACT CHANGE to `compiler/src/expr-positions.ts`

Stated plainly for the sibling arc converging `symbol-table.ts`'s validation walk onto this table:

1. **`ExprPosition` GAINS a required field** `wired: WiredClass`, where
   `WiredClass = "client" | "static" | "unknown"` (newly exported type).
2. **`ExprPositionKind` REPLACES `block-source`** with `statement-source` + `markup-source`.
   A flag could not carry this — the two need different EXTRACTION, not just different consumption.
3. **`EXPR_NODE_FIELDS` SHRINKS** from 11 entries to 7.

Unchanged: `forEachExprPosition`'s signature, `origin`, `span`, `render`, alternate-group semantics.

## Leak A — prose parsed as code. Reviewer named 2 vectors; there were 4.

| vector | `main` | pre-fix `9bdd6eed` | now |
|---|---|---|---|
| `<each in=@rows as r>SECRET items</each>` | no leak | **LEAK** | no leak |
| the same body wrapped in `<p>` | no leak | no leak | no leak |
| `<match>` arm prose | no leak | no leak | no leak |
| **`<Title rule=.Playing>SECRET screen</>`** (engine state-child, NOT filed) | no leak | **LEAK** | no leak |
| **bare `data-x=SECRET`** (NOT filed) | no leak | **LEAK** | no leak |
| bare `class=SECRET` | no leak | **LEAK** | no leak |
| quoted `title="SECRET"` | no leak | no leak | no leak |

Fixed at the ROOT, not with a better heuristic: **the AST already knows** which raw bodies are
statements (`isColonShorthand` on a state-child / `<onTransition>` entry; the field's own identity
everywhere else), so the table DECLARES it and the downstream guess is deleted. A markup body's
only code is its `${…}` interiors, and that is now all the seed reads from one.

## Leak B — the attribute classification is MEASURED

Method: compile `<tag ATTR=X>` where X is a client-read export const, compile the same file
WITHOUT that element, diff the count of X in the emitted client bundle.

| value shape | wired? |
|---|---|
| BARE (unquoted) | **client** on `if=` and every `on…=` tested; **static** on class id title style data-* aria-* src href role name show key disabled checked readonly value placeholder hidden |
| `call-ref` (`X.go()`) | **client** on EVERY attribute name tested, `class=` / `data-x=` included |
| parenthesized `expr` (`(X)`) | **client** on every name |
| quoted with `${…}` | **client** on every name |
| quoted, no `${}` | **static** |

`bind:*` / `class:*` reject a bare non-cell value upstream (`E-ATTR-010` / `E-ATTR-013`) so they
cannot reach the predicate with one; deliberately NOT listed as wired, because for an unmeasured
name the fail-closed answer is "not wired".

## C — phantom fields, WORSE than filed

A census (`types/ast.ts` declarations + `ast-builder.js` construction sites) finds **zero** of
`subjectExpr`, `targetExpr`, `returnExpr` **and zero of `testExpr`** — the brief credited
`testExpr` as genuinely new and it is not. Its only appearances in `compiler/src` are a local
function in `meta-checker` and **a THIRD hand-rolled ExprNode field list at
`reactive-deps.ts:1776`** (worth filing: same drift class, third copy). `defaultExprRaw` exists
only on ast-builder's internal `scan` object. All five removed; `defaultExpr` (3 declarations /
9 sites) is the one real addition the union ever had. A regression test asserts the phantoms are
ABSENT.

## D — the DG widening is gated, and the FIRST GATE WAS WRONG

An attribute position is credited only when the **owning node is markup** — exactly where the
pre-convergence code reached `attrs` from.

Recording how the first cut failed, because it is the same class of mistake as everything else
this round: it tested the position's `render` flag instead of the node's kind, and **those are
different properties**. `class="${@theme}"` is `render: false` BY DESIGN (it credits a reader
without minting a markup-read node) while still being a markup attribute that must be credited.
Four E-DG-002 tests caught it.

## Verification

- Two test files, 96 tests: pre-fix `9bdd6eed` 82 pass / **14 fail** · now **96 pass / 0 fail**.
- Full suite: **28763 pass / 86 skip / 1 todo / 0 fail**.
- Corpus emit-differential, base `036680e9` vs head: **NO DIFFERENCES** — 1904 sources, 7375
  artifacts, 0 diagnostic changes, 0 content diffs. All four leaks have zero corpus incidence.
- `grep -rn collectClientReferencedIdents` → zero.

## `compiler/tests/unit/_tmp_fire-logic/` — not this dispatch

No commit on this branch ever added a path matching `_tmp_fire-logic`
(`git log --all --diff-filter=A -- "**/_tmp_fire-logic/*"` is empty), and all six probe scripts in
this dispatch's scratch dir write to `os.tmpdir()`. Grepping the SHARED scratchpad for that path
hits `scratchpad/dsor/` and `scratchpad/probe/` — two other dispatches' directories, not
`scratchpad/g263/`. Flagging the attribution only because the scratchpad is shared across
concurrent dispatches, so "which agent left this" is not answerable from the file alone.

---

# ROUND 5 (S338) — append-only

Startup `pwd`: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a04bd31168a2ab141`
Base: `8ad13b84` (the BRIEF-round5 commit itself). Branch `worktree-agent-a04bd31168a2ab141`.
`bun install` + `bun run pretest` both clean at start.

## R5 Step 0 — MEASURED baseline (branch `8ad13b84` vs `origin/main` `c5499773`)

Wiredness matrix, cross-file (`models.scrml` exports `MARKC`, `index.scrml` reads it ONLY at the
position under test). "binding ref" = `index.client.js` names `MARKC` as a JS identifier, EXCLUDING
the `const { … } = _scrml_modules[…]` destructure (that line is emitted BECAUSE of the seed, so
counting it is circular).

| vector | emitted client reference | genuine JS binding? | branch declares const? |
|---|---|---|---|
| `if=MARKC` | `_scrml_cs_reactive_get("MARKC")` | NO (store key) | YES → **LEAK** |
| `if=MARKC.field` | `(_scrml_cs_reactive_get("MARKC").field)` | NO | YES → **LEAK** |
| `if=MARKC[0]` | `_scrml_cs_reactive_get("MARKC")` | NO | YES → **LEAK** |
| `if=(MARKC)` | `if ((MARKC))` | YES | YES (correct) |
| `if=MARKC()` | `if ((MARKC()))` | YES | YES (correct) |
| `if=` on `<each>`/`<match>` | `_scrml_cs_reactive_get("MARKC")` | NO | YES → **LEAK** |
| `onclick=MARKC` | `"_scrml_attr_onclick_1": MARKC,` | YES | YES (correct) |
| `onclick=MARKC.go` | HTML `onclick="MARKC.go"` | NO | YES → **LEAK** |
| `onclick=MARKC()` / `.go(1)` / `(MARKC)` | `function(event){ MARKC…; }` | YES | YES (correct) |
| `on=` `on-tap=` `on_tap=` `on2=` + plain ident | `"_scrml_attr_on…_1": MARKC,` | YES | **NO → under-emit** |
| `only=` `once=` `onward=` + plain ident | `"_scrml_attr_only_1": MARKC,` | YES | YES (correct) |
| `class=` `show=` `value=` bare | static HTML attribute | NO | NO (correct) |

Cell axis (`attr=@probecell`), for the A2 claim:
`if=` `show=` `bind:value=` `class:on=` `disabled=` → client-executed code reads the CELL STORE
(`_scrml_cs_reactive_get("probecell")` inside an `_scrml_effect`). `title=` `class=` `value=` →
static HTML attribute. NONE of them produces a JS binding named `probecell`.

## R5 corrections to the BRIEF (measured, not inferred)

- **A3 example list is WRONG.** `only=` / `once=` / `onward=` are NOT an "unmeasured set force-
  classified by `/^on[a-z]/`" — `"only".startsWith("on")` is TRUE, so codegen's own predicate wires
  them too, and the emitted `"_scrml_attr_only_1": MARKC,` is a real binding read. The two
  predicates AGREE there. The disagreement set is exactly the four A4 names.
- **A4 locus list includes one non-site.** `emit-html.ts:675` is `attrIsWiringFree`, a purity test
  feeding `isCleanIfNode` — NOT the attribute-value lowering decision. The lowering sites are
  `:3153` (bare-ref handler) and `:3223` (expr-form handler); `:3422`'s `call-ref` else-branch is a
  third, and it is NAME-INDEPENDENT (any attribute name with a `call-ref` value becomes an event
  binding — that is why `class=X.go()` is wired).
- **A1's second vector is narrower than stated.** `onclick=X` (plain bare identifier) IS a genuine
  binding read — measured. Only the DOTTED bare form (`onclick=X.go`) falls to static HTML.
- **A1 and A2 cannot both be satisfied by one tri-state field.** A1 requires `if=MARKC` to be
  NOT-wired; A2 requires `show=@x` to be wired. Both positions emit client-executed code that
  references the source AS A STORE KEY. The field was answering two questions at once. See the
  ruling below.

## R5 ruling — `wired` becomes `clientBinding`, two values, ONE question

`wired: "client" | "static" | "unknown"` is replaced by
`clientBinding: "binding" | "not-binding"`, answering exactly one question:

> does CLIENT-EXECUTED code reference this position's source as a JS BINDING — a free identifier
> the emitted bundle must DECLARE, or the browser throws `ReferenceError`?

That collapses the whole bare-attribute name table to ONE predicate, imported from codegen
(`isEventAttrName`), and `if=` needs no special case at all: it was in the old predicate only
because the old question ("does the compiler emit client code?") answers YES for a store-key read.
`"unknown"` is DELETED rather than made real — an undetermined position is not representable, so a
new position cannot ship unmeasured (B3, the delete branch).

## R5 — WHAT LANDED

| item | status | note |
|---|---|---|
| A1 `wired` leaks server-only consts | FIXED | measured on `if=X` / `if=X.f` / `if=X[0]` / `if=` on `<each>`/`<match>` / `onclick=X.go` |
| A2 `wired` FALSE for `show=@x` etc. | DISSOLVED, not "fixed" | A1 and A2 are incompatible under one field; the field was asking two questions. See the ruling above. |
| A3 `"unknown"` is a dead value | FIXED (deleted) | the type is two-valued; §7 asserts BOTH values are LIVE |
| A4 predicate drifts from codegen's | FIXED | `on=` `on-tap=` `on_tap=` `on2=` were live under-emits; `only=`/`once=`/`onward=` were NOT (brief wrong) |
| A5 `import.meta` regex over source text | FIXED | tested on the parsed `{kind:"escape-hatch", nativeKind:"MetaProperty"}` |
| A6 missing `variable-ref` guard on `raw` | FIXED | guard moved to the GROUP, not one alternate |
| A7 `emitGroup` prefers first SUPPORTED | FIXED | `isEmptyPositionValue` skip + unit test |
| B1 dual-direction `EXPR_NODE_FIELDS` gate | LANDED | §8; added `resultExpr` `bodyExpr` `callbackExpr` `fileExpr` `urlExpr`; 6 exclusions each with a reason |
| B2 call codegen's predicate | LANDED | new leaf `compiler/src/attr-lowering.ts`, 2 callers |
| B3 make `"unknown"` real or delete | LANDED (delete branch) | |
| B4 re-base tests on compiled sources | LANDED | §8 matrix × {same-file, cross-file} × {const, let} |

### R5 measurements

- **Corpus emit differential vs `origin/main`, project roots MATCHED**: 1904 sources · 7375
  artifacts · **0 content diffs** · 0 syntax delta (both goggles) · 0 compile-failure delta ·
  0 artifact-set delta · 0 load-context change · bare-server-fn delta 0.
  **A first run reported 1014 content diffs and every one was a HARNESS artifact**: the
  chunk-namespace id is `fnv1aHash(projectRootRelativeSourcePath)` and the reference tree was a
  `git archive` extract with no `.git`, so the project root resolved differently. `mkdir .git`
  in the reference tree took it to 0. **A capture whose two sides have different project roots
  cannot compare emit content at all** — worth knowing before the next codegen dispatch.
- **Diagnostic delta: 1 code + 2 text-only, all one class.** `phase2-when-self-write-085` /
  `-083` / `-082` lose a FALSE-POSITIVE `E-DG-002`. Bisected to `bodyExpr`. Correct: an
  `on mount { @x = 2 }` body ALREADY suppressed E-DG-002 on both refs while
  `when @x changes { @x = 1 }` did not, for no principled reason.
- **B1 migration measurement**: 0 corpus files change EMIT. The only corpus effect of all five
  added fields is the 3 diagnostic changes above. Instrument power is low by construction (the
  collector executes only where a file has export consts read client-side) — a floor, not a proof.
- **R26 empirical**: `gauntlet-r25/dev-{1..4}.scrml` recompiled on both refs → artifacts
  BYTE-IDENTICAL (`diff -r` exit 0), diagnostics identical once the two root paths are normalised.
- **`e2e-render-map/generate-baseline.js --check`**: output identical to `main` modulo the timing
  line. The baseline drift it reports is entirely pre-existing.
- **Full suite**: 30161 pass / 216 skip / 1 todo / **49 fail**. Failure NAME SET vs `main` (52):
  **0 NEW**, 3 gone — and those 3 are artifacts of the archived reference tree (no `.git` for
  `resolveProjectRoot`, no compiled `benchmarks/todomvc/dist`), not fixes.

### R5 bite proofs

| corruption | result |
|---|---|
| add a phantom to `EXPR_NODE_FIELDS` | RED (1) |
| remove `resultExpr` from the list | RED (2 unit, and 2 conformance) |
| revert the shared predicate to `/^on[a-z]/` | RED (1) |
| make a bare `if=` a binding again | RED (3 conformance) |
| bare-value shape guard removed (leak direction) | RED (6) |
| bare-value binding always FALSE (under-emit direction) | RED (14) |
| empty-alternate skip removed | RED (1) |
| local-decl binding branch deleted | RED (2) — needed the CROSS-FILE vector |
| `engine.initialCell` / `serverSource` / `inlineMatchBody` deleted | RED (1 each) |
| `markup-source` routed through the statement parser | RED (6) |
| `collectFromMarkupSource` no-op'd | **GREEN — redundant, reported not faked** |
| `collectFromCalleeName` no-op'd | **GREEN — redundant, reported not faked** |

### R5 — TWO NEW GAPS FILED, both PA-verified on the branch AND on main

- `g-263-lift-body-invisible-to-the-client-read-seed-node-traversal` (MED). The out-of-scope
  node-traversal item, verified: three `lift`-body shapes are live cross-file `ReferenceError`s.
  Both docblocks corrected to say the FIELD half is closed and the NODE half is not.
- `g-263-match-expr-rawarms-is-an-unparsed-string-inside-an-exprnode` (MED). **The brief's own B1
  reproducer measures THIS, not `resultExpr`.** `on mount { @a = match … }` parses to a
  `match-expr` carrying `rawArms: [raw string]` — a raw string INSIDE an ExprNode, one layer
  deeper than the raw-source POSITIONS the table enumerates. `resultExpr` genuinely fixes the
  LOGIC-BLOCK / client-`fn`-body shape (`match-arm-inline` nodes), which is now pinned.

---

# ROUND 6 (S338, after the S239 DO-NOT-LAND) — append-only

Base for this round: `ad262baa` (round-5 tip). Same worktree.

## R6 — what was fixed

| item | status | evidence |
|---|---|---|
| F1 `bodyExpr` leaks a `when message` worker body | FIXED | node-kind PRUNE in `client-read-seed.ts`; measured before: `const FACTOR = ["LEAK","CANARY","WORKER"]…` in `models.client.js`, only line in `index.client.js` = the destructure |
| F2 block-bodied arrow hides `import.meta` in `raw` | FIXED | 4 fatal-direction shapes; acorn re-parse of the OPAQUE node only |
| F3 four fields with no behavioural coverage | FIXED | `§1b`; per-field bite now 2·1·1·1·1 (was 2·1·0·0·0) |
| F4 `callbackExpr` partial no-op | PINNED as the DISCRIMINATOR + reported below | expression-arrow resolves, block-arrow does not |
| F6 §8 rationale comment factually wrong | FIXED | corrected in 3 places, incl. the statement-vs-expression axis |

### R6 measurement corrections to my own round-5 work

- **A false measurement was caught and discarded.** `splitBlocks` takes
  `(filePath, source)`. Two round-6 probes called it `(source, filePath)`, which returns a single
  `text` node, and on that basis I briefly concluded `cleanup-registration` / `upload-call` are
  "never built" and started writing a §9 gate around that claim. They ARE built — at LOGIC TOP
  LEVEL. The §9 block was deleted before commit and every AST-shape claim re-measured. **Round 5's
  `rawArms` conclusion is unaffected**: it was established by `parseExprToNode` and by compile-level
  probes, not by that call.
- **F2's prescribed fix was one shape too coarse.** A raw-TEXT fallback on the opaque node
  re-opens the round-4 false positive one level down: `() => { return "read import.meta later" }`
  is a block-bodied arrow whose interior mentions the characters INSIDE A STRING. Acorn-parsing
  the node's own `raw` gets it right; it is a MUST-SHIP row in `§3b` and it passes.
- **F3's framing.** `cleanup(…)`/`upload(…)` build their node kinds ONLY at logic top level.
  Inside a `function` body or `on mount` the same text is an ordinary `bare-expr` whose `exprNode`
  was already listed — a case written that way passes with the field deleted. Measured on four
  framings before the fixture was settled.

## R6 — REPORTED FOR PA FILING, NOT FIXED (`docs/known-gaps.md` is contended)

1. **F5 — the shared predicate enshrines codegen's over-wide `startsWith("on")`.** `only=` /
   `once=` / `onward=` are routed to event wiring by `emit-html.ts`, so the seed now DECLARES a
   const used there. On `main` that shape is a loud under-emit; here it is a silent value-crossing.
   The right fix is NARROWING `emit-html.ts` (there is no `only` DOM event), which moves emitted
   output — a separate arc. The shared predicate is correct as "what codegen DOES"; it is codegen
   that is wrong.
2. **F7 — `if=X[0]` silently drops the index.** `<p if=MARKC[0]>` emits
   `if (_scrml_cs_reactive_get("MARKC"))` — the subscript is gone. Pre-existing on both refs.
3. **The block-bodied-function escape-hatch class, THREE live instances, one root cause.** A block
   body is never mapped to an ExprNode; the interior survives as opaque source on
   `{kind:"escape-hatch", nativeKind:"ArrowFunctionExpression"|"FunctionExpression", raw}`, and
   every ExprNode walker in the tree sees nothing:
   - `cleanup(() => { … NEEDED … })` — live cross-file `ReferenceError`, pinned as a discriminator
     in `conf-CG-263 §1b`;
   - the `import.meta` fence — FIXED here by acorn-re-parsing the opaque node, which is the shape
     of the general fix;
   - `g-263-match-expr-rawarms-…` (already filed) is the same class with a different carrier.
   Worth ONE gap entry naming the class, with those three as instances.
4. **A nested worker `<program name=…>` is walked by the client-read seed.** Beyond `when message`:
   a plain logic statement inside the worker program (`@wk = FACTOR`) still crosses and buys
   nothing — pre-existing (`exprNode`, an original list entry), not from the new fields. The
   structural fix is pruning the worker subtree, and it is BLOCKED: a `function` declared inside a
   worker program is measured to be emitted into `index.client.js` as well, so pruning would turn a
   live reference into a `ReferenceError`. Emitter first, seed second, same commit.
5. **`cleanup` / `upload` are invisible to the scope checker in non-top-level framings.** Inside a
   `function` body / `ref=` handler / `on mount`, `cleanup(…)` and `upload(…)` raise
   `E-SCOPE-001: Undeclared identifier`. Pre-existing; noticed while looking for a clean fixture.

## R6 — baseline-count correction, carried

The reviewer measured 49 suite failures where round 5 reported 52 for `origin/main`, in a worktree
with `todomvc/dist` symlinked and a real `.git`. **Do not quote either count as a baseline.** The
delta is absent gitignored build dirs, not behaviour. NAME-SET diffs only — both refs measured
identically under each setup, so the set comparison is sound and the counts are not.

## R6 — `docs/known-gaps.md` WARNING FOR LANDING

Round 5 committed TWO entries to `docs/known-gaps.md` (`66dc805f`, `20e7480a`) before it was
declared contended. **Do NOT wholesale `git checkout <branch> -- docs/known-gaps.md`** — that
clobbers the PA's session version. Cherry-pick the two entry BLOCKS:
`g-263-lift-body-invisible-to-the-client-read-seed-node-traversal` and
`g-263-match-expr-rawarms-is-an-unparsed-string-inside-an-exprnode`. No round-6 commit touches
that file.

## R6 verification (final)

- **Corpus emit differential, branch BASE `8ad13b84` vs HEAD** — the comparison that isolates THIS
  branch's delta: 1904 sources · 7375 artifacts · **0 content diffs** · 0 compile-failure delta ·
  0 syntax delta (both goggles) · 0 artifact-set delta · bare-server-fn delta 0. Round 6 adds ZERO
  corpus delta on top of round 5; the only diagnostic movement is still the 3 E-DG-002
  false-positive removals from round 5's `bodyExpr` entry.
- **Full suite** 30197 pass / 216 skip / 1 todo / 49 fail. Failure NAME SET vs base, both measured
  in trees with a real project root AND the gitignored build dirs symlinked:
  **49 = 49, ZERO new, ZERO gone.**
- **R26 empirical**, `gauntlet-r25/dev-{1..4}.scrml` base vs head: artifacts BYTE-IDENTICAL
  (`diff -r` exit 0), diagnostics identical path-normalised.
- **F2 matrix** 14 rows × {declaration, EXECUTE as classic script} — all pass; dropping the
  escape-hatch branch turns exactly the four regressed shapes RED (8 assertions).
- **Per-field bite** (conformance failures when the entry is deleted): resultExpr 2 · bodyExpr 1 ·
  callbackExpr 1 · fileExpr 1 · urlExpr 1 · the `when-message` prune 1.

## R6 — `origin/main` MOVED MID-DISPATCH. READ BEFORE LANDING.

`origin/main` advanced `c5499773` -> **`1bfa8544`** during this dispatch (S339-peter, PRs
#503 #506 #508). A main-vs-head corpus capture therefore reports main's NEWER content as
"differences" — e.g. `sql-in-for-loop-001.scrml` shows as "newly PASSING" because
`E-EACH-BODY-DECL-UNSUPPORTED` was ADDED to `emit-each.ts` on main after this branch was cut, and
`git diff origin/main..HEAD` shows that code being REMOVED. That is S67 staleness, not a
regression: **verified by compiling the file at three points on this branch** (round-5 tip,
round-6 tip, and with `expr-positions.ts` rolled back) — it never fired here, and the diagnostic
does not exist in this branch's `emit-each.ts` at all.

**File-set intersection between main's new work and mine is EXACTLY ONE FILE: `docs/known-gaps.md`.**
Main changed `emit-each.ts`, `emit-server.ts`, `emit-ssr-render.ts`, `emit-tool.ts`, SPEC, FACTS
and hand-off docs — all disjoint from my eight code/test files, so a file-delta of those eight is
safe. `docs/known-gaps.md` is contended on BOTH sides now (main moved it too): cherry-pick the two
entry blocks, never checkout the file.

---

# ROUND 7 (S338, after the delta-review DO-NOT-LAND) — append-only

## R7 — what was fixed

| item | status | evidence |
|---|---|---|
| F2 regex fallback re-opened the round-4 defect | FIXED | PARSE -> LEX -> UNANSWERED; 18/18 on the scrml-operator family, 0 unanswerable; 4 bites (8·2·2·10) |
| F2 in-source rationale was FALSE as written | FIXED | the comment now describes what the code does; neither the initializer text nor the node's raw is ever regexed |
| F6 over-correction ("wherever it appears") | FIXED + made EXECUTABLE | `§9` asserts the 9-row FORM×POSITION table |

### R7 — why not a blanket fail-closed on unparseable raw

Rejected on measurement. Failing closed on every raw acorn's PARSER rejects would drop every
block-bodied callback containing a scrml operator — `() => { return "a" is not "zzz" }` and its
whole family — which `origin/main` DECLARES. That is a real under-emit, not a theoretical one.

A regex cannot see a string literal; a LEXER can. acorn's tokenizer emits a string as ONE token, so
`"import.meta"` is never the token triple `import` `.` `meta`, and a real meta-property always is.
The `[@#]` -> `_` pre-lex mapping exists only to let the lexer run on scrml sigils; neither
character can occur inside `import`, `.` or `meta`, so it cannot create or destroy a match. What is
left genuinely unanswerable (a raw that does not even LEX) fails CLOSED, and that branch is pinned
by a row rather than described — `() => { return 0x }`, which reaches the fence as
`{kind:"escape-hatch", nativeKind:"ParseError"}`.

### R7 — the F6 table, measured

| form | position | `match-arm-inline` |
|---|---|---|
| STATEMENT | logic top level / `function` body / `fn` body | **2** |
| STATEMENT | `on mount { … }` | 0 — `match-expr` + `rawArms` |
| STATEMENT | `when @v changes { … }` | 0 — same |
| STATEMENT | MULTI-statement `on mount` | 0 — no match node at all |
| EXPRESSION | any position | 0 |

Round 5 said POSITION and was narrow; round 6 said FORM and was wrong; it is BOTH. `§9` executes
the table, and its bite covers the methodological error too: mis-calling
`splitBlocks(source, filePath)` — the mis-call that produced round 6's discarded false measurement
— turns 9 rows RED via the guard-the-guard.

## R7 — REPORTED, NOT FIXED

**The F2 FALSE-NEGATIVE surface — 9 nested / getter / method / async shapes.** Spot-checked three
directly, and the root cause is sharper than "the fence misses them": the mapper records
**`raw: ""`** for these hatches, so the interior is DROPPED before any fence can look at it.

```
() => () => { return import.meta.url }     -> lambda > escape-hatch  raw: ""
({ get u() { return import.meta.url } })   -> object > escape-hatch  raw: ""
({ m()     { return import.meta.url } })   -> object > escape-hatch  raw: ""
```

No work inside `exprNodeReadsImportMeta` can reach these; it is an EMITTER gap in what the escape
hatch records. **Precise provenance: introduced at ROUND 5** (the structural-only walk), i.e. a
regression against round 4's whole-initializer regex, which did catch them — and NOT a round-6 or
round-7 regression. Still open at this tip.

**"All 21 rows pass" is a claim about the chosen rows, not about the surface.** §3b covers what it
enumerates. The nine shapes above are outside it by construction, and no row count implies
otherwise.

## R7 — METHODOLOGY, worth carrying beyond this arc

**A differential that reads only `result.errors` is blind to an entire diagnostic class.**
`E-DG-002` carries severity `warning` and lands in `result.warnings`, so a harness capturing only
`errors` reports a 0 diagnostic delta over a corpus where the delta is real. The reviewer's first
pass hit exactly this. The 3 `E-DG-002` false-positive removals recorded in round 5 ARE confirmed;
the point is about the instrument, and it applies to every probe in this arc that filtered
`result.errors` by severity.

**`head` ↔ `prior` differential is 0/0/0/0, and that is a LIMIT ON THE EVIDENCE, not a pass.**
Rounds 6 and 7 move nothing in the 1904-source corpus, which means the corpus is SILENT on the
`when-message` prune and on the `import.meta` fence — in BOTH directions. Neither the leak they
close nor a regression they might introduce would show up there. The evidence for those two is the
targeted conformance matrices and their bites, and nothing else.

## R7 — LANDING PLAN: MY ROUND-6 NOTE WAS WRONG. CORRECTED HERE.

Round 6 computed the intersection against `8ad13b84`, **which is a commit ON THIS BRANCH, not an
ancestor of `origin/main`** — so the file set it produced was the round-5+6 delta, not the branch's.
Verified now:

- real merge-base: **`34d211ab`** (`git merge-base origin/main HEAD`)
- the branch touches **16 files**, not 8
- intersection with main's post-merge-base work is **TWO** files, not one:
  **`docs/known-gaps.md` AND `docs/FACTS.md`** — both editing the same generated counts rows

Executing the round-6 note would have silently dropped rounds 1–4's changes to
`codegen/context.ts`, `codegen/index.ts`, `codegen/rewrite.ts`, `dependency-graph.ts`,
`compiler/tests/unit/cross-file-module-export-const-client.test.js`, `BRIEF-round5.md` and
`FACTS.md`. **Land from `34d211ab..HEAD`, and cherry-pick — never checkout — the two contended
docs.** The full 16-file list is `git diff --name-only 34d211ab..HEAD`.
