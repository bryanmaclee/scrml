# TRACE — why `${render name(...)}` renders nothing

change-id: render-snippet-slot-trace-2026-08-24
gap: `g-render-snippet-slot-renders-empty` (HIGH)
base: `origin/main` @ `b0abcbc6`
dispatch: TRACE-ONLY — **no file under `compiler/` was modified.** `git diff --stat b0abcbc6 -- compiler/` is empty.
method: every claim below is EXECUTED, not read. Every mount loads the SHIPPED runtime chunk
(`result.runtimeFilename`), never `runtime-template.js`.

Probes (all committed in this directory, all runnable from the worktree root with `bun <path>`):

| probe | what it establishes |
|---|---|
| `repro-three-highs.mjs` (supplied) | PROBE 2 reproduces on `b0abcbc6` |
| `probe-matrix.mjs` | the four call-site shapes + the `${children}` control, mounted |
| `probe-ast.mjs` | TAB stores a component body as `raw` text with `defChildren: []` |
| `probe-ce.mjs` | the post-CE node at the render site is `escape-hatch raw:""` |
| `probe-tab.mjs` | the LIVE parser handles `render name()` correctly at every level |
| `probe-native.mjs` | LIVE vs NATIVE diff on the same component body |
| `probe-decision-site.mjs` | the decision site, confirmed on the flagship's own Card body |
| `probe-q2-severity.mjs` / `probe-q2-severity2.mjs` | Q2 limb (ii) is a whole-page boot kill |
| `probe-blast-radius.mjs` | 15/15 corpus files affected |
| `probe-diagnostic-net.mjs` | none of §16.8.1's SHALL-reject codes fire |
| `probe-sufficiency.mjs` … `probe-sufficiency4.mjs` | the three rows do NOT share one root |
| `probe-parametric-msg.mjs` | the second decision site's exact failure |

---

## 0. The headline correction — say it first

**SPEC §16.8.1's mechanism was never implemented. There is no `render-expansion` node to break.**

```
$ grep -rn "render-expansion|renderExpansion|inlinedChildren" .   # whole repo
compiler/SPEC.md:11117,11118,11126,11130,11142,11144
docs/known-gaps.md:2438,2454
docs/changes/render-snippet-slot-trace-2026-08-24/BRIEF.md
handOffs/delta-log.md:2795
```

Zero hits in `compiler/src/`, `compiler/native-parser/`, `scripts/`, `stdlib/`, `lsp/`, `conformance/`.
The three identifiers exist only in SPEC prose and in the gap ledger that quotes it.

The BRIEF said *"the break is somewhere between CE expansion and emit."* That framing is wrong.
CE implements a **different, undocumented mechanism**: `injectChildren` / `_injectChildrenWalk`
(`component-expander.ts:2995` / `:3011`) walks the expanded component body, structurally matches a
logic node whose `bare-expr.exprNode` is a `call` to `__scrml_render_NAME__`, and **splices the
caller's nodes in place**. There is no transient node, no TS consumption step, and no
`inlinedChildren` field. The pipeline stage boundary SPEC describes does not exist.

That is a Rule-4 finding for PA, not something a fix dispatch can settle: either SPEC §16.8.1/§16.8.2
is amended to describe the substitution CE actually performs, or the implementation is rebuilt around
the render-expansion node. **This trace assumes neither.** Everything below describes what the code does.

---

## 1. DECISION SITE

### 1.1 Primary site — the whole of row 1, and the necessary first half of row 3

```
compiler/native-parser/translate-expr.js:296-297

        case ExprKind.Render:
            return makeEscapeHatch("Render", "", nativeExpr.span);
```

The native parser parses `render name(args)` **correctly and completely** —
`parse-expr.js:2659 parseRenderExpr` produces `makeRender(nameTok.name, args, span)`
(`ast-expr.js:434`), carrying `propName` and `argExpr`. The A2 expression bridge then throws both
away: `makeEscapeHatch("Render", "", span)` — `nativeKind: "Render"`, **`raw: ""`**. No diagnostic.

Measured (`probe-decision-site.mjs`, on the flagship's own Card body):

```
NATIVE : expr="" exprNode={"kind":"escape-hatch","nativeKind":"Render","raw":""}   diagnostics: (NONE)
LIVE   : expr="render header ( )" exprNode.kind=call callee="__scrml_render_header__"
```

Controls through the **same** native path survive intact — which is exactly why the symptom looks
the way it does:

| body expression | native result |
|---|---|
| `${children}` | `ident name="children"` ✓ (unslotted children DO render) |
| `${label}` (a prop) | `ident name="label"` ✓ (the sibling prop DOES render) |
| `${someFn()}` | `call callee="someFn"` ✓ |
| `${render body()}` | **`escape-hatch raw:""`** ✗ |
| `${render control(label)}` | **`escape-hatch raw:""`** ✗ |

### 1.2 The execution path that reaches it

```
compileScrml (api.js:1779)  Stage 3.2 CE
  └─ runCE  → buildComponentRegistry (component-expander.ts:1347)
       └─ parseComponentDef (:1230)
            └─ parseComponentBody (:1181)
                 └─ normalizeTokenizedRaw (:595)
                 └─ reparseSynthesizedFile (:1153)          ◀── THE ROUTING FORK
                      ├─ sourceNeedsLiveFallback(source)? (:1079)   → live splitBlocks+buildAST
                      └─ DEFAULT → nativeParseFile(...)             ◀── taken 15/15 in the corpus
                           └─ parse-expr.js:2659 parseRenderExpr  → {kind:Render, name, args}  ✓
                                └─ translate-expr.js:296          → escape-hatch raw:""        ✗
  ↓
CE injectChildren / _injectChildrenWalk (:2995 / :3011)
  renderMatch predicate (:3066-3089) requires exprNode.kind === "call".
  It is "escape-hatch" → renderMatch stays null → the logic node falls through to
  the terminal result.push(child) (:3174) and state.slotFound stays FALSE.
  ↓
codegen: emit-html emits <span data-scrml-logic="_scrml_logic_N"></span>;
  emit-expr.ts:4010 emitEscapeHatch → rewriteExpr("") → "" → a bare `;` in the client.
```

Two things fall out of `state.slotFound` staying false, and both are observed:

* **`_injectChildrenWalk`'s trailing `if (!state.slotFound) result.push(...callerChildren)` (`:3178-3181`)
  runs at EVERY recursion level.** With no slot ever matched, the caller's children are appended once
  by the recursion into `<div class="card__body">` and again by the outer level — measured as the
  `<em slot="body">SLOTTED-EM</em>` appearing **twice**. **That is the whole of the S371
  "slot=-duplication" row. It is not a separate defect; it is the same missing match.**
* The flagship shows NO duplication because its Card *does* have a `${children}` spread, which sets
  `slotFound` and consumes `unslottedChildren` — so the slotted content is silently **dropped**
  instead of duplicated. Same root, two surface presentations depending on whether the component
  body has a spread.

**The routing fork is the load-bearing surprise.** `reparseSynthesizedFile` sends component bodies to
the native parser **by default**. This has nothing to do with `--parser=scrml-native`; that flag
governs the TAB stage (`api.js:1222`) and is opt-in. The CE re-parse is native unconditionally unless
`sourceNeedsLiveFallback` trips on `<each>` / `<match>` / a template-literal interp / a
`const fn:` binding. **Measured: 15 of 15 corpus files with `${ render X(` take the native path.**

### 1.3 Secondary site — the parametric row (`§16.6`)

```
compiler/src/component-expander.ts:3150-3157

          const paramRe = new RegExp(`\\b${snippet.paramName}\\b`, "g");
          const substituted = snippet.body.replace(paramRe, () => renderParamMatch.argExpr);
          result.push({
            kind: "logic",
            body: [{ kind: "bare-expr", expr: substituted, span: child.span }],
            span: child.span,
          } as unknown as ASTNode);
```

`substituted` is the lambda's **markup body text**, pushed as a raw-string `bare-expr.expr` with
**no `exprNode`**. Codegen lowers it as a JS expression. Measured with the LIVE re-parse forced
(so the primary site is out of the way) on the SPEC-correct declaration
`control: snippet(n: string)` + `control={ (n) => <strong>${n}</strong> }`:

```
E-CODEGEN-INVALID-LOGIC: the compiler could not lower this construct to valid output.
  artifact: m.client.js (byte 383, line 17, column 30)
  Unexpected token
    ..._scrml_render_value(el, <strong>${"LBL"}</strong>);...
```

Note also `component-expander.ts:2683-2684`:

```ts
      const snippetDecl = def.snippetProps.get(attr.name);
      if (!snippetDecl || snippetDecl.snippetParamType === null) continue;
```

`parametricSnippets` is populated **only** for props declared `snippet(param: T)`. A plain
`snippet` prop given a lambda is silently skipped — correct per §16.6 (which requires the
parametric declaration), but worth knowing: it is a `continue`, not a diagnostic.

---

## 2. SHARED ROOT — verdict: **NO. The three rows do NOT share one root.**

This is the finding the dispatch was designed to protect. Established by **natural experiment**, not
by reading: placing a `<match>` in a component body trips `sourceNeedsLiveFallback`, which routes
the body to the LIVE re-parse — producing **exactly** the node a fix at `translate-expr.js:296` would
produce. So the rest of the pipeline runs as if the fix were already in.

| row | baseline (native re-parse) | LIVE-proxy (= post-primary-fix) | verdict |
|---|---|---|---|
| **1** `slot="body"` (§16.5) | `<div class="h"><span data-scrml-logic></span><em slot="body">SLOTTED-EM</em></div>` **+ a second `<em slot="body">` at the root** | `<div class="h"><em>SLOTTED-EM</em></div>` — filled, `slot=` stripped, **no duplication** | **CLOSED by the primary fix alone** |
| **2** `body={ <em>…</em> }` on a plain `snippet` prop | empty | **still empty** | **not a defect — SPEC-SILENT shape.** See §3.3 |
| **3** parametric `control={ (n) => … }` with `control: snippet(n: string)` (§16.6) | silent empty, **exit 0** | **`E-CODEGEN-INVALID-LOGIC`, compile fails** | primary fix is **necessary but not sufficient**; needs the §1.3 site too |

A fix that lands only at `translate-expr.js:296`, adds tests for the `slot=` shape, and runs the
suite green **would be exactly the recorded failure mode**: correct at that site, and it converts
row 3 from a silent empty render into a hard compile failure across the corpus.

**Explicitly refuted:** the S371 hypothesis that "slotted content is inlined as ordinary children
INSTEAD of routed to the render site" describes the *mechanism* correctly but framed it as a
**separate** phenomenon. It is not separate — it is `_injectChildrenWalk`'s `slotFound=false`
fallback firing per recursion level, i.e. a direct consequence of the primary site. Confirmed by
the LIVE-proxy run, where the duplication disappears together with the empty placeholder.

---

## 3. Q2 — the `if=(prop is some)` → `null` finding SPLITS IN TWO

### 3.1 Limb (ii) — an INDEPENDENT defect. Reproduces with NO snippet anywhere in the file.

```scrml
const Box = <div class="box" props={ tag: string, note?: string }>
  <span class="n" if=(note is some)>${note}</span>
</>
<Box tag="hello" note="present"/>
```

Compiles **exit 0**. Emitted client:

```js
if ((((present !== null && present !== undefined)))) _scrml_if_mount__scrml_if_marker_2();
```

The prop VALUE `present` is spliced in as a **bare unquoted identifier** →
`ReferenceError: present is not defined`, thrown inside the `DOMContentLoaded` listener.

**Blast radius, measured on the live DOM with `<template>` contents excluded** (my first pass
matched the canary *inside* an unmounted `<template>` and read as a pass — corrected in
`probe-q2-severity2.mjs`):

```
prop SUPPLIED  <Box note="present"/>   canary LIVE-mounted: NO   → WHOLE-PAGE BOOT KILL
CONTROL prop OMITTED  <Box/>           canary LIVE-mounted: YES  → boot survived
```

An independent later `if=@ok` element never mounts. Everything after the throw in `_scrml_nav_rewire`
/ `_scrml_boot` — all `if=` controllers, all non-delegable handler wiring, the rehydrator
registration — is skipped.

**Locus:** `component-expander.ts:2338-2339` calls `substitutePropsInRawExpr(exprVal.raw, props)` on an
attr `expr` value that has no `exprNode`; the helper (`:2452-2464`) splices the prop value string
verbatim. The in-source comment at `:2333-2337` **already names this behaviour** —
*"String-literal props would substitute a bare name (`row`->`x`); that is the same value the
string-form `props` map carries everywhere and the predicate lowering downstream consumes it as the
member-access base."* That reasoning holds when the prop is a member-access **base** (`row.name`);
it does not hold when the substituted name is the whole operand, which is what `X is some` produces.

**This deserves its own gap ID and its own severity.** It is orthogonal to snippets: reproduce with
any component, any string prop, any `if=(prop is some)`.

### 3.2 Limb (i) — a real snippet-side defect, and **not** closed by the primary fix

`if=(actions is some)` with `slot="actions"` **supplied** at the call site lowers to
`null !== null && null !== undefined`. Under the LIVE-proxy (primary fix simulated) the render site
fills correctly *inside the template* but the section still never mounts — the `is some` still sees
`null`. `slot=` children populate `slottedGroups`; they never become a prop binding, so the
presence predicate cannot see them.

`resolveSnippetIfConditions` (`:3511`, called at `:2903`) exists and computes exactly the right
thing — `const isProvided = slottedGroups.has(propName) || parametricSnippets.has(propName);` — but
it is keyed on `optionalSnippetNames` and did not resolve this condition in the measured run. That
is where the fix dispatch should start for limb (i); I did not trace inside it.

### 3.3 Row 2 is SPEC-SILENT, not broken

SPEC §16.5 (`SPEC.md:11031`) defines exactly one call-site form for a zero-parameter snippet:
`slot="name"` on direct children. §16.6 defines exactly one for a parametric snippet: the lambda.
**There is no governing sentence for `body={ <em>…</em> }` on a plain `snippet` prop.** Per the
governing-sentence gate this is outcome 2: a **RULING**, not a fix. The BRIEF and the S371 delta-log
entry both list it as a reproduced defect row; it is not one. If PA wants that form to work it is an
amendment; if not, it wants a diagnostic (today it is silent).

---

## 4. The diagnostic net is dead, and for the same class of reason

**Zero of §16.8.1 / §16.8.2's SHALL-reject codes fire on their own shapes** (`probe-diagnostic-net.mjs`):

| SPEC obligation | shape probed | fires |
|---|---|---|
| E-COMPONENT-023 — `render NAME` not a declared snippet prop | `render nosuch()` in a body declaring only `header` | **no** |
| E-TYPE-071 — `render` outside a component body | `${render header()}` in plain `<program>` markup | **no** |
| E-TYPE-072 — zero-arg `render` on a parametric snippet | `snippet(n: string)` + `render control()` | **no** |
| E-TYPE-072 — one-arg `render` on a zero-param snippet | `snippet` + `render control(@lbl)` | **no** |
| E-TYPE-073 — unguarded `render` on an optional snippet | `extra?: snippet` + bare `render extra()` | **no** |

`E-COMPONENT-023`, `E-TYPE-072`, `E-TYPE-073` have **zero implementation sites** in
`compiler/src` or `compiler/native-parser`. `E-TYPE-071` has one — `codegen/rewrite.ts:2478
rewriteRenderKeyword`, wired into the client rewrite pipeline at `:2710` — and **it can never match
real pipeline input**: it text-scans for `render\s+NAME\s*\(`, but `expression-parser.ts:1745-1749`
has already rewritten that text to `__scrml_render_NAME__(`. Its only test
(`compiler/tests/unit/snippet-slot.test.js:453`) calls the function directly with the literal string
`"render header()"`, which the pipeline never produces.

That is the map set's own recurring shape — **obligation and probe resolving to different
artifacts** (primary.map.md, "four things to read", item 1).

**A third defect falls out of this.** `${render header()}` **outside** any component body — where
the LIVE parser is the path — emits into the client:

```js
__scrml_render_header__();
_scrml_render_value(el, __scrml_render_header__());
```

a call to a function that is never defined, at **exit 0**, where SPEC SHALLs `E-TYPE-071`. Page dead
on load. (`emit-lift.js:757 cleanRenderPlaceholder` cleans `__scrml_render_NAME__` → `NAME` but only
on the lift path, and `NAME` is not defined either.) I did not trace this one; it is filed here as a
sibling.

---

## 5. FIX DIRECTION

### 5.1 Primary — `translate-expr.js:296`. EXTENDS an existing mechanism.

Translate `ExprKind.Render` into the live node the rest of the compiler already understands: a
`call` whose callee is `ident("__scrml_render_" + name + "__")` with `args` translated normally —
byte-identical to what `expression-parser.ts:1745` produces on the live path. The exact precedent is
**four lines below, in the same switch**: `ExprKind.MarkupValue` used to be
`makeEscapeHatch("MarkupValue", "")` and was fixed by `translateMarkupValueExpr` for precisely this
reason. Its in-source comment (`:305-310`) describes this defect class verbatim. This is the same
patch, one case up.

`upgradeNativePropsDeclsInFileAST` / `upgradeNativeCallRefArgExprNodesInFileAST` (`:1176-1177`) show
the alternative shape — a post-hoc upgrade pass on the assembled FileAST. **Prefer the switch arm**:
the upgrade passes exist because the native node has no live counterpart, and here it does.

**Direction-of-change: SEMANTICS-CHANGED.** Not newly-accepting (these files already compile exit 0;
nothing previously rejected becomes accepted), not newly-rejecting on its own. The one-way-door rule
does not bar it, so it ships as a bug fix.

⚠ **It changes emitted output for 15 corpus files.** Any golden/snapshot artifact for those files
must be regenerated with review, not blessed.

### 5.2 Secondary — `component-expander.ts:3150-3157`. Must land WITH the primary or the corpus goes red.

The substituted parametric-snippet body must become a structured node, not a raw string. The live
pipeline already has the target shape: `markup-value` (`ast.ts` — `{kind:"markup-value", span, node}`),
lowered by `emit-expr.ts case "markup-value"` via `emit-lift.js emitMarkupValueExpr`. Note the
current code also writes only the legacy string field `.expr` with no `exprNode`, which
primary.map.md item 2 flags as the un-migrated surface.

⚠ **The regex substitution `new RegExp("\\b" + paramName + "\\b", "g")` on the lambda body text is
its own latent defect** — it rewrites the parameter name inside string literals, attribute values
and nested identifiers. A structured substitution over the parsed lambda body removes that too.
That is a widening of scope for the fix dispatch and should be scoped explicitly, not absorbed.

**Direction-of-change: SEMANTICS-CHANGED** (silent-empty → correct render). Judged against the
LIVE-proxy baseline it is **newly-accepting** relative to `E-CODEGEN-INVALID-LOGIC` — but that error
only exists on a path nothing currently takes, so there is no adopter dependency to protect.

### 5.3 Limb (ii) — `component-expander.ts:2338-2339` / `:2452-2464`. A PARALLEL mechanism, separate dispatch.

The raw-text substitution cannot distinguish "prop value as a member-access base" from "prop value
as a whole operand"; the fix is to stop deciding it textually. Either the `is some` predicate is
parsed structurally before substitution, or string-literal prop values are emitted **quoted**. The
existing structured path (`substitutePropsInExprNode`, `:1583`) is the mechanism to extend — the
raw path is only reached because `is some` is not plain JS and so the attr has no `exprNode`.
**Direction-of-change: SEMANTICS-CHANGED** (a boot-killing `ReferenceError` becomes a correct
truthy/falsy). **Own gap, own severity, own dispatch.**

### 5.4 Not a fix — a RULING for PA

1. **SPEC §16.8.1/§16.8.2 describes a mechanism that does not exist** (`render-expansion`,
   `inlinedChildren`, the CE→TS→codegen hand-off). Amend the SPEC to the substitution CE performs,
   or rebuild CE. Rule 4: SPEC wins, but it cannot be satisfied incrementally by a bug fix.
2. **Row 2 (`body={ <em/> }` on a plain `snippet` prop) is SPEC-silent.** Amendment or diagnostic.
3. **Four §16.8 SHALL-reject codes have no implementation** (023 / 071-effective / 072 / 073).
   Restoring them is **NEWLY-REJECTING** — permitted as a bug fix by the one-way-door rule, but it
   will fail corpus files that are silently broken today. Land it after §5.1/§5.2, not before.

---

## 6. BLAST RADIUS — measured, not estimated (`probe-blast-radius.mjs`)

**15 corpus `.scrml` files use `${ render X(`. 15/15 take the native re-parse path. 15/15 lose every
`Render` node.** All 15 change behaviour on the §5.1 fix.

| file | render sites | native path | compile errors today |
|---|---|---|---|
| `conformance/cases/components/missing-required-slot-clean/case.scrml` | 1 | yes | 0 |
| `conformance/cases/components/missing-required-slot-reject/case.scrml` | 1 | yes | 1 |
| `conformance/cases/components/slot-on-parametric-snippet-clean/case.scrml` | 1 | yes | 0 |
| `conformance/cases/components/slot-on-parametric-snippet-reject/case.scrml` | 1 | yes | 1 |
| `conformance/cases/components/slot-targets-non-snippet-clean/case.scrml` | 1 | yes | 0 |
| `conformance/cases/components/slot-targets-non-snippet-reject/case.scrml` | 1 | yes | 1 |
| `conformance/cases/components/unslotted-children-no-spread-clean/case.scrml` | 1 | yes | 0 |
| `conformance/cases/components/unslotted-children-no-spread-reject/case.scrml` | 1 | yes | 2 |
| `examples/12-snippets-slots.scrml` | 3 (+2 in comments) | yes | 0 |
| `samples/card.scrml` | 1 | yes | 1 |
| `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-slot-basic-059.scrml` | 2 | yes | 0 |
| `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-slot-in-lift-062.scrml` | 1 | yes | 1 |
| `samples/compilation-tests/snippet-001-basic-slot.scrml` | 2 | yes | 0 |
| `samples/compilation-tests/snippet-002-parametric.scrml` | 1 | yes | 0 |
| `samples/gauntlet-s19-phase4/nested-comments.scrml` | 2 | yes | 6 |

Four of these are in `samples/compilation-tests/`. ⚠ **They are NOT in the `bun run pretest` set** —
`samples/compilation-tests/dist/` holds 13 compiled samples and none of them is a snippet file, so
no browser test reads these artifacts today.

### 6.1 Why it survived — and the BRIEF is wrong about this too

The BRIEF says *"nothing loads the artifact and looks at the DOM."* **Something does. It looked, it
recorded the empty render, and it blessed it.**

`compiler/tests/e2e-render-map/e2e-render-map-baseline.json` is a committed known-state map that
mounts the corpus and classifies each page. It carries:

```json
"samples/compilation-tests/snippet-001-basic-slot.scrml#empty": {
  "tier": "probe", "state": "renders-empty", "smells": [], "seeded": false },
"samples/compilation-tests/snippet-002-parametric.scrml#empty": {
  "tier": "probe", "state": "renders-empty", "smells": [], "seeded": false },
"examples/12-snippets-slots.scrml#empty": {
  "tier": "flagship", "state": "renders-clean", "smells": [], "seeded": false },
```

Two mechanisms let this through, and they are independent:

1. **`renders-empty` is a GREEN state.** `e2e-render-map.test.js:44`:
   `const GREEN_STATES = new Set(["renders-clean", "renders-empty", "needs-server"]);`
   A page that renders **nothing at all** is a PASS by construction. The two `snippet-00*` samples
   sit there, correctly observed as empty, permanently green.

2. **There is no partial-emptiness detector at all.** `render-detectors.js:249-254` is the terminal
   rule:

   ```js
   // No smell, no throw, no compile error. If the body is empty WITHOUT a seed,
   // that's a valid empty/partial render (records as renders-empty, NOT a fail).
   if (bodyText.trim() === "") { return { state: "renders-empty", smells, detail }; }
   return { state: "renders-clean", smells, detail };
   ```

   The flagship has `<h1>Team Directory</h1>`, so `bodyText.trim() !== ""` and it classifies
   **`renders-clean`** — while every one of its six cards is empty. The detector's question is
   *"is the whole body empty?"*, and the defect's question is *"is this REGION empty?"*.
   Obligation and probe resolving to different artifacts, again.

The eight `conformance/cases/components/*` assert **CODES only** (`slot-targets-non-snippet-reject`
asserts `E-COMPONENT-033`); none assert DOM. And per primary.map.md invariant 67 the conformance
runtime half concatenates the FULL `SCRML_RUNTIME` monolith, so it is blind to chunk pruning as well.

**Consequence for the fix dispatch:** when §5.1 lands, the two `snippet-00*` cells move
`renders-empty` → `renders-clean`, which is a red→green improvement and requires a baseline update
in the same landing (the allowlist-shrink rule, `e2e-render-map.test.js:12-13`). The flagship cell
does **not** move — it is already `renders-clean` and will stay so. **A regression test for this
defect cannot be an e2e-render-map cell**; it needs a DOM assertion on the specific render site.

**BRIEF correction on the counts.** The BRIEF says "17 declare a `snippet` prop". I measure **15**
files matching `: snippet`, and they are the **same 15**. A bare `snippet` grep returns 26, but 11 of
those are prose/self-host/native-parser-source mentions (`compiler/native-parser/ast-expr.scrml`,
`compiler/self-host/ts.scrml`, `docs/website/pages/...`, `dashboard/app.scrml`, etc.). One extra
genuine near-neighbour is
`samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-slot-non-snippet-063.scrml`, a reject
fixture with no `render` site. **The "15 + 17" framing is really "15, counted twice."**

---

## 7. BRIEF CORRECTIONS — plainly

1. **"the break is somewhere between CE expansion and emit"** — wrong. The break is **upstream of CE
   expansion**, in the native expression bridge, before CE's matcher ever runs. The BRIEF's own
   ordered question 1 ("is the `render-expansion` node emitted at all?") has the answer *"that node
   does not exist in this compiler."*
2. **"CE, where §16.8.1 says the `render-expansion` node is born"** — no such node is born anywhere.
   §16.8.1 describes an unimplemented design.
3. **"the three reproduced call-site shapes"** — they do **not** share one root, and one of them
   (`body={ <em/> }`) is not a defect at all: SPEC §16.5 does not define that call-site form.
4. **"17 `snippet`-prop files"** — 15, and the same 15 as the `render` set. See §6.
5. **"following that placeholder id from emission to wiring is likely the fastest path"** — it is a
   dead end. The placeholder and the `;` are both *correct* renderings of an empty expression; the
   information was destroyed three stages earlier. The fastest path was diffing the LIVE and NATIVE
   parsers on the same component body (`probe-native.mjs`, ~30 lines).
6. **The suggested entry points were all in `compiler/src/`.** The decision site is in
   `compiler/native-parser/`, which the BRIEF's grep list did not cover.
7. **"Why it survived: nothing loads the artifact and looks at the DOM"** — false. The
   `e2e-render-map` tier mounts the corpus and looks at the DOM. It observed the empty renders
   correctly and **classified them GREEN**: `renders-empty` is in `GREEN_STATES`, and the flagship
   is `renders-clean` because the classifier only asks whether the WHOLE body is empty. See §6.1.
   This matters — the fix dispatch's regression test cannot be an e2e-render-map cell.

---

## 8. MAPS

Read: `primary.map.md` (full), plus targeted greps across all 13.

**Load-bearing:** exactly one row — **invariant 67**, *"a runtime-behaviour claim must name which
runtime it executed."* It is why every mount here loads `result.runtimeFilename`. Its sibling
observation that the conformance tier concatenates `SCRML_RUNTIME` and is therefore blind by
construction is the direct explanation for why the eight `conformance/cases/components/*` cases pass
while their pages are empty.

**Not load-bearing, and a routing hole worth closing:**

* **`reparseSynthesizedFile` and `nativeParseFile` have ZERO hits across all 13 maps.** The single
  most load-bearing fact in this trace — that a component-def body is re-parsed by the **native**
  parser **by default**, with no `--parser` flag involved — is absent from the entire map set. The
  maps discuss the native parser only as the opt-in TAB-stage router.
* **The Task-Shape Routing table has no row for components / snippets / slots / `render` / CE.** The
  `component-expander.ts` row in `structure.map.md:176` covers `_deepCloneAst` and node-id freshness
  and says nothing about the re-parse fork.
* `structure.map.md:200` carries a standing note that `emit-tool.ts` depends on the SHAPE of
  `component-expander.ts`'s helper-bind augmentation — adjacent, but not this surface.

Suggested map delta (for whoever runs the next `/map`): a Task-Shape Routing row of the form
*"a component BODY that behaves differently from the same markup written inline → the body is
re-parsed by `nativeParseFile` via `reparseSynthesizedFile` (`component-expander.ts:1153`) unless
`sourceNeedsLiveFallback` (`:1079`) trips; any live-vs-native expression divergence shows up here
first, silently."*
