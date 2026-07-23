# dg-class-attr-consumed — progress

Startup pwd: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ad324d31f306a261b`
Base: `e8fdd44c`. Gap: `g-dg-class-attr-interp-not-consumed` (MED).

Append-only.

---

## 1. Startup + map

- `pwd` / `git rev-parse --show-toplevel` agree; tree clean at `e8fdd44c`.
- `bun install` OK (218 pkgs). `bun run pretest` OK (13 samples compiled to
  `samples/compilation-tests/dist/`).
- `.claude/maps/primary.map.md` read in full. **Load-bearing finding: NONE.** The Task-Shape
  Routing table has no row for the dependency graph / E-DG-002, and `grep -rn "E-DG" .claude/maps/`
  returns zero hits across every map. The map's one adjacent caution — "`codegen/sql-lex.ts` is the
  single source of truth for LIVE-vs-INERT `${}` inside `?{}` SQL. Do not add a second
  interpolation scanner." — is about SQL `?{}`, not markup attribute values, but its *principle*
  (one scanner per interpolation surface) directly shaped the fix: see §4, where I reuse the
  codegen lowerer instead of writing a second markup-attr `${}` scanner.

## 2. Reproduction (BEFORE any edit)

First attempt did NOT reproduce, for two reasons worth recording:

1. **Wrong API surface.** `compileScrml(sourceString, {filename})` silently returns
   `{errors: [], warnings: []}` — it does not run the pipeline. The DG-bearing surface is the
   file-based form `compileScrml({ inputFiles: [path], outputDir, write:false })` used by every
   existing E-DG-002 test.
2. **Wrong declaration form.** The brief's reproducer wraps the decl in `${ ... }`
   (`<program>${ <theme> = "dark" }...`). Under that form nothing fires — not even the
   genuinely-unused negative control. The V5-strict form (`<theme> = "dark"` as a direct
   `<program>` child) reproduces. This is the known decl-form-in-reproducers trap.

The negative control (genuinely-unused cell) firing E-DG-002 is what proved the harness was live;
without it the first run's all-empty table would have read as "already fixed".

### Empirical table — BASE `e8fdd44c`

| shape | E-DG-002 |
|---|---|
| `<theme>` declared, never read (negative control) | **FIRES** (correct) |
| `<div class="box ${@theme}">` only | **FIRES** — FALSE POSITIVE |
| `<div class="box ${@theme}">hello ${@theme}</div>` | silent (credited by the text read) |
| `<div title="t ${@theme}">` only | **FIRES** — FALSE POSITIVE |
| `<div class="${@theme}">` (no static prefix) | **FIRES** — FALSE POSITIVE |
| `<div title=@theme>` (bare variable-ref attr) | silent (already credited) |
| `<div>hello ${@theme}</div>` (text interp) | silent (already credited) |

**The gap is wider than the title suggests: it is not `class`-specific.** Every attribute name is
affected identically, because the miss is in the attribute *value shape*, not the attribute name.

## 3. Root cause — the credit is never reached, not lost later

The brief asked me to establish first whether a class-attr interpolation reaches the A-1.2/A-1.3
`MarkupReadDGNode` path and loses its credit later, or never reaches it. Answer: **it never
reaches any credit path at all.**

AST for `<div class="box ${@theme}">` (dumped via `splitBlocks` + `buildAST`):

```json
{ "name": "class",
  "value": { "kind": "string-literal", "value": "box ${@theme}", "span": {...} },
  "span": {...} }
```

The attribute-value handler in `dependency-graph.ts` (the markup sweep, ~:2709) branches:

- `typeof attrVal === "string"` — scans the raw string for `@x`. **Not taken**: the value is an
  *object*, not a string.
- `else if (attrVal && typeof attrVal === "object")` — taken, but every sub-branch misses:
  - `valObj.name` (variable-ref / `bind:value`) — `undefined` on a string-literal.
  - `valObj.refs` (expr-valued attr, e.g. `if=`) — `undefined`.
  - `valObj.raw` (expr fallback) — `undefined`; the payload lives in `valObj.value`.
  - `valObj.kind === "call-ref"` — false.

So a `string-literal` attribute value carrying `${...}` interpolations falls through **all** of
them and is never credited. No `creditReader`, no `emitMarkupReadEdge`.

### The read is genuine — proved by executing the pipeline, not by grepping

`compiler/bin/scrml.js compile` on the class-attr-only fixture emits, in `*.client.js`:

```js
// template-attr class="box ${@theme}"
_scrml_tpl_elem_div_2.setAttribute("class", `box ${_scrml_reactive_get("theme")}`);
_scrml_effect(() => { _scrml_tpl_elem_div_2.setAttribute("class", `box ${_scrml_reactive_get("theme")}`); });
```

A `_scrml_effect` reading `theme` is a reader edge in a render context — exactly the condition
whose *absence* the §34 E-DG-002 row defines as the trigger. So this is a BUG, not a doc gap.

Same probe across `class` / `title` / `style` / `data-x` / `aria-label`: **all five** emit the
identical `setAttribute` + `_scrml_effect` pair. Codegen is attribute-name-agnostic here, so the
DG credit must be attribute-name-agnostic too — narrowing the fix to `class` would leave four
known-live false-fire shapes standing.

### SPEC authority (normative, not derived)

- **§5.5.3** (Template Literal Class Interpolation), line 1875: "Reactive variables referenced as
  `${@varName}` inside the template literal SHALL each subscribe to changes."
- **§5**, line 1244: the `${...}` token "keeps a single meaning across the language: ... the same
  token in an attribute-value string (`attr="${@x}"` — §5, already template-string-shaped) and in
  a body display-text literal." — the token is not `class`-scoped, so neither is the rule.
- **§34** E-DG-002 row (line 18709): trigger is "no reader edge in any render or logic context
  (`readers.size === 0`)".

No SPEC amendment needed; the implementation was simply not honouring §5.5.3.

### The negative that bounds the fix

`<div title="mail @theme now">` — a bare `@theme` **outside** any `${...}` segment. Compiled
output contains no `_scrml_reactive_get("theme")`: codegen does not wire it, so E-DG-002 there is
**correct** and must keep firing. Therefore the fix must scan only *inside* `${...}` segments,
never the whole attribute string. (Note the pre-existing plain-`string`-typed branch at :2715 does
scan the whole string; I left it alone — see §6.)

## 4. Fix

`compiler/src/dependency-graph.ts`, in the markup-sweep attribute loop: one new branch for
`valObj.kind === "string-literal"`, gated on the value containing `${`.

**Parity by construction, not by a second scanner.** Rather than re-deriving "which cells does
this attribute interpolate", the branch calls `rewriteTemplateAttrValue` from
`codegen/rewrite.ts` — the *same* function both codegen wiring paths use
(`emit-html.ts` → `lowerAttrTemplateValue` → `rewriteTemplateAttrValue`; and the `<match>`-arm
path via the same helper). Its `reactiveVars` set is by definition exactly the set of cells the
emitted `_scrml_effect` subscribes to. If the two ever drift, they drift together, and the
false-fire cannot silently return. This is the map's "no second interpolation scanner" principle
applied to the markup-attr surface.

`src/ → codegen/` imports are an established edge here (`type-system.ts`, `route-inference.ts`,
`expression-parser.ts`, `block-analysis-footprint.ts`, `api.js`, … all import from `./codegen/`).
Checked for a cycle: nothing under `codegen/` imports `dependency-graph.ts` (only comment
references in `route-splitter.ts`, `reactive-deps.ts`, `emit-engine.ts`).

**Footprint fence honoured:** `codegen/rewrite.ts` was READ only, never edited, and is not in the
parallel `chunk-namespacing` arc's file set. The only `src` file written is
`compiler/src/dependency-graph.ts`.

**Scope discipline — `creditReader` only, deliberately no `emitMarkupReadEdge`.** Every sibling
attribute branch also pushes a `MarkupReadDGNode`. I did not, per the brief's "credit the read for
E-DG-002 accounting without changing what any other consumer sees". See DEFERRED-1: that omission
is itself a real (pre-existing, separate) under-count and should be closed deliberately, not as a
side effect of this fix.

## 5. Verification

### 5.1 Empirical table — AFTER (same harness, same fixtures as §2)

| shape | base `e8fdd44c` | after |
|---|---|---|
| declared, never read (negative control) | FIRES | **FIRES** (preserved) |
| `class="box ${@theme}"` only | FIRES (false) | **silent** |
| `class="box ${@theme}"` + text read | silent | silent |
| `title="t ${@theme}"` only | FIRES (false) | **silent** |
| `class="${@theme}"` (no static prefix) | FIRES (false) | **silent** |
| `title="mail @theme now"` (bare `@`, no `${}`) | FIRES | **FIRES** (preserved) |
| `title=@theme` (bare variable-ref attr) | silent | silent |
| `<div>hello ${@theme}</div>` (text interp) | silent | silent |

Both negative controls hold. The check was fixed, not disabled.

### 5.2 Regression tests

`compiler/tests/unit/e-dg-002-false-positive-class.test.js` — new section (C), 7 tests
(5 positive + 2 negative guards). `bun test <file>` → **15 pass / 0 fail** (8 pre-existing + 7 new).

### 5.3 Full suite, baseline-diffed BY TEST NAME

A base worktree was checked out at `e8fdd44c` (in the scratchpad, `bun install` + `bun run pretest`
run in it) and `bun run test` executed in both trees:

| | base `e8fdd44c` | fix `cc94d90d` |
|---|---|---|
| tests ran | 28889 across 1250 files | 28896 across 1250 files (+7 = the new tests) |
| fail | 33 | 33 |
| skip / todo | 216 / 1 | 216 / 1 |

`diff` of the sorted `(fail)` **name sets** is **EMPTY** — zero new failures by name, not merely by
count. (The brief estimated ~31 pre-existing; measured 33 at this base. The named set is identical
either way, which is the assertion that matters.)

### 5.4 Corpus — no E-DG-002 delta

`examples/23-trucking-dispatch` + `examples/22-multifile` (`build`) and all 30 single-file
`examples/*.scrml` (`compile`), run in BOTH trees, greping every
``E-DG-002: Reactive variable `@…` `` line: **byte-identical output, zero E-DG-002 on both sides.**

Guarded against a vacuous result two ways:
- **Positive control on the grep**: the same pattern applied to the known-firing fixture returns
  ``E-DG-002: Reactive variable `@theme` ``, so a fire would have been caught.
- **The corpus does exercise the shape** — 9 interpolated-attr sites, e.g.
  `href="/driver/loads/${@currentLoad.id}"` and `placeholder="bol-load-${@currentLoad.id}.pdf"` in
  `23-trucking-dispatch`. Zero delta is the *correct* expected result there: `@currentLoad` is also
  read through other loci, so it was already credited; the fix adds credit that changes no outcome.
  (It does confirm the member-access form `${@currentLoad.id}` credits the ROOT cell
  `currentLoad`, which is the cell that owns the DG node.)

## 6. Deferred / filed, NOT fixed here

- **DEFERRED-1 (recommend a follow-up gap) — reachability under-counts interpolated-attr reads.**
  `MarkupReadDGNode`s are not inert: `reachability/component-2.ts` walks
  `RenderDGNode → MarkupReadDGNode → reads-edge → ReactiveDGNode` to answer "which cells does this
  render block read", feeding the reachability/artifact-splitting substrate. Because the new
  branch credits without emitting a markup-read node, a cell read ONLY through an interpolated
  attribute is still invisible to Component-2. Pre-existing (this dispatch does not worsen it),
  but it is the *same* read locus and the under-count direction is the dangerous one. Closing it
  is a one-line addition (`emitMarkupReadEdge(attrSpan ?? node.span, cellName)`), but it changes
  reachability output and therefore possibly artifact-splitting, which is out of this brief's
  scope and lands in the parallel codegen arc's blast radius. Recommend a separate dispatch.
- **DEFERRED-2 (observation, no action requested)** — the plain-`string`-typed attr-value branch
  (`typeof attrVal === "string"`, :2715) credits **every** `@x` in the raw string, not just those
  inside `${...}`. If any AST path still produces a plain-string attribute value, that branch
  over-credits in exactly the way §3's negative control forbids. I found no live producer of that
  shape in the probes I ran (interpolated and non-interpolated attr values both arrive as
  `{kind:"string-literal"}` objects), so it may be dead legacy. Not touched.
