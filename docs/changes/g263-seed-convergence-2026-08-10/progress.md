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
