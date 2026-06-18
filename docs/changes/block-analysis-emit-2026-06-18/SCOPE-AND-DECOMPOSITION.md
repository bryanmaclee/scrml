# SCOPE-AND-DECOMPOSITION: `block-analysis-emit-2026-06-18`

> **Provenance:** authored by the `Plan` agent (read-only architect), S206 (2026-06-18), from a PA brief.
> **Goal:** scrml compiler emits a structured **block-analysis** sidecar that flogence's block-lease / dock
> tooling consumes INSTEAD of a second (regex) parser (the drift-avoidance architecture, delta-log S206 [14]).
> Cross-refs: `scrml-support/docs/deep-dives/{block-lease-parallelism,markup-lease-anchor}-2026-06-18.md`;
> the dock prototype `scripts/dock.ts`.

## Headline decisions (PA summary)
- **ADD-ALONGSIDE** the dotted-path footprint (do NOT extend the body-DG `reads`/`writes`) — the reorder DG
  and the lease footprint have **opposite grain requirements** (reorder wants root-cell coarse for soundness;
  lease wants dotted-path fine for parallelism). Add-alongside = **zero body-DG fixture delta**.
- **The dotted-path resolution is ALREADY BUILT** (`reactive-deps.ts` `_deepSetLeafKey` via
  `stampCompoundDeepSetTargets`) → BREAK-1 is much cheaper than the markup DD assumed; the new module READS
  the already-stamped leaf, `body-dg-builder.ts` stays **untouched for v1**.
- **v1 footprint = SHALLOW** (span-based: a write is in `writes` iff its AST node is lexically inside the
  block's span — no call-graph). Transitive is deferred (it would collapse parallelism — BREAK-2);
  `footprintDepth: "shallow"` is an honesty marker in the artifact.
- **Consumer:** `.scrml` → the artifact (true spans + dotted footprints); `.ts`/`.js` → KEEP `TS_DEFS` regex
  (the compiler doesn't parse its own TS; drift only applies to `.scrml`).
- **4 dispatches:** D1 (footprint fn) + D2 (builder) parallel as **disjoint block-leases on `block-analysis.ts`**
  (dog-foods the tool this builds); D3 (emit wiring) after both; D4 (dock rewire) after D3.

---

## 1. GROUNDED FINDINGS

### Fact 1 — True extents already exist. CONFIRMED, def-node kinds pinned.
`ast-builder.js:34` — "Every node carries a `span` field" (`{file,start,end,line,col}`). Def nodes:

| Lease kind | AST node (`ast.ts`) | `kind` | Name | Found on `FileAST` |
|---|---|---|---|---|
| function/fn | `FunctionDeclNode` (823) | `function-decl` | `.name` | `FileAST.nodes` |
| component | `ComponentDefNode` (888) | `component-def` | `.name` | `FileAST.components[]` |
| engine | `EngineDeclNode` (910) | `engine-decl` | `.engineName`/`_record.engineMeta.varName` | `FileAST.machineDecls` (`collectC12EngineDecls` + `collectC14DerivedEngineDecls`) |
| type | `TypeDeclNode` (1283) | `type-decl` | `.name` | `FileAST.typeDecls[]` |
| channel | `ChannelDeclNode` (1311) | markup node `tag:"channel"` | `attributes.name` | `FileAST.channelDecls[]` |

AST spans give the EXACT boundary → dissolves the next-def-boundary heuristic + the b1 coincidental-adjacency
residual. **Caveat:** `ComponentDefNode` carries only `.raw` (template string) + its span; span is reliable
(v1 ok); the inner markup subtree is unstructured here (matters for v2).

### Fact 2 — RW-footprint source, wrong grain. CONFIRMED + corrected.
`body-dg-builder.ts` `StatementFacts {reads, writes}` (321). Root-cell collapse at:
- `reactive-nested-assign` (`@obj.path=v`) 398-417: `facts.writes.add(reactiveName(target))` = ROOT cell.
  `node.path` (409-416) is read today ONLY for index-reads, NOT to refine the write grain — the BREAK-1 hook.
- **(correction to the PA brief)** a SECOND collapse: `addAssignTargetWrites` 534-553 (the `bare-expr`
  `@obj.prop=v` path) also walks to the base ident + records only `reactiveName(baseName)`. Both sites matter.

**Decisive finding:** the dotted resolution is ALREADY BUILT in `codegen/reactive-deps.ts` —
`collectCompoundLeafTargets` (635), `stampCompoundDeepSetTargets` (739, stamps `_deepSetLeafKey` +
`_deepSetResidualPath` on the node), `collectSynthCellKeys` (512). So `@quoteForm.originCity ≠
@quoteForm.weightLbs` is already computed/stamped. The markup DD's open "does the compiler resolve dotted
writes?" → **yes, for compound cells**.

### Fact 3 — Sidecar pattern. CONFIRMED, 4 wiring sites.
`--emit-engine-graph → <base>.engine-graph.json`: (1) module `engine-graph.ts` (`buildEngineGraphJson`);
(2) `api.js:2551` lazy result fn; (3) write-site `commands/compile.js:586-593`; (4) flag `cli.js:55` + parse/
thread in compile.js (98,168-169,279,409). `chunks.json` (api.js) = 2nd precedent.

### Trace A — DG consumers (spine).
`buildBodyDG` consumed by `codegen/scheduling.ts:446`, `route-inference.ts:3471` (`_`-prefixed probe),
`cps-batch-planner.ts` (imports `BodyDG`/`Node`/`Edge`/`Tier`; `topologicalSort` reads `dg.edges`,
`coalesceServerRuns` reads `node.tier`). **The planner never reads `StatementFacts.reads`/`writes`** — those
are a private intermediate that PRODUCES edges keyed by `via:<root-cell>`. Tests pinning it:
`ext1-m1-2-body-dg-builder`, `ext1-m1-3-cps-batch-planner`, `batch-planner`, `sql-batch-5b-guards`,
`sql-loop-hoist-detection`, `return-sql-chained-call`, `reactive-decl-sql-chained-call`.

### Trace B — parity canary CORRECTED.
The within-node parity canary is `native-parser-canary/within-node-classifier.ts` (parser dual-pipeline
classification) — UNRELATED to reads/writes. The footprint change cannot shift it.

---

## 2. THE DECISION: extend vs add-alongside → **ADD-ALONGSIDE**
1. Extending grain would **drop edges the planner relies on** (`@quoteForm.originCity` write vs
   `@quoteForm.weightLbs` write → no `writes` edge; root read no longer matches dotted write without
   prefix-aware compare). The module forbids missing edges ("would let M1.3 reorder past a real dependency —
   unsound"). Extend-in-place = soundness regression.
2. The reorder DG WANTS root-cell coarseness (two writes to any field of `@quoteForm` must stay ordered — same
   COW value at runtime). The two consumers have **opposite grain needs**; one field can't serve both.
3. Add-alongside = **zero-fixture-delta guarantee** (body-dg-builder untouched).

**Shape:** compute the footprint in the NEW `block-analysis.ts`, reusing `reactive-deps.ts`'s stamped
`_deepSetLeafKey` (else `node.target`+`node.path` joined; index-reads as 409-416; reads via
`extractReactiveDepsFromExprNode`, string-literal-aware). `body-dg-builder.ts` untouched for v1.

> **Spine:** add a separately-computed dotted-path `cellPaths` footprint in the new module, reusing
> `reactive-deps.ts`'s stamped resolution; leave the body-DG root-cell `reads`/`writes` + edges byte-untouched.

---

## 3. `block-analysis.json` SCHEMA (mirrors engine-graph determinism: fixed key order, source-order, `+"\n"`)
```jsonc
{
  "version": 1,
  "file": "examples/.../driver/messages.scrml",
  "blocks": [
    {
      "id": "examples/.../messages.scrml::sendMessage",   // <relpath>::<name> — the lease anchor
      "kind": "function",                                 // function|component|engine|type|channel
      "name": "sendMessage",
      "span": { "start": 5412, "end": 5901, "line": 154, "endLine": 171 },  // byte offsets + 1-based lines
      "reads":  ["currentDriver", "messageForm.draft"],   // SORTED dotted-path, no @ prefix
      "writes": ["errorMessage", "messageForm.draft", "messageHistory"],
      "footprintDepth": "shallow"                         // honesty marker; transitive = later slice
    }
  ]
}
```
`id` = the prototype's `<relpath>::<name>` (zero consumer churn). `line`/`endLine` are the load-bearing
diff-scope fields (raw `git diff` lines ↔ source lines — use `span.line`, which TAB maps back, NOT byte
offsets). type/channel blocks get empty footprints (honest-empty). Two compiles → byte-identical.

---

## 4. v1 STEP-BY-STEP (named defs)

**Depth = SHALLOW** (a write ∈ `writes` iff its assignment node is lexically inside the block's span — no
call-graph; `@x=sendMessage()` does NOT pull the callee's writes; `onsubmit=fn()` does NOT either). Transitive
(`extractReactiveDepsTransitive`, reactive-deps.ts:1068) is a later `footprintDepth:"transitive"` slice — it
would make any caller-of-a-broad-mutator near-universal (BREAK-2 collapse). The span-based rule is what makes
v1 tractable and v2's markup handlers not.

- **v1.1 — footprint extractor** (NEW `compiler/src/block-analysis.ts` — only `footprintForBlock`; NEW
  `tests/unit/block-analysis-footprint.test.js`). Reuses reactive-deps.ts. body-dg-builder.ts UNTOUCHED.
  Must run AFTER `stampCompoundDeepSetTargets` (idempotent — call defensively). BREAK-1 canary:
  `@quoteForm.originCity ≠ @quoteForm.weightLbs`.
- **v1.2 — builder** (`block-analysis.ts` builder/serialize fns; NEW `tests/unit/block-analysis.test.js`).
  Mirror engine-graph.ts. Runs at the **`metaFiles` stage** (api.js:1870, same as engine-graph:2551 — spans +
  symbol table + `_deepSetLeafKey` all present). Node discovery via the FileAST collections above (reuse
  `collectC12/C14EngineDecls`, don't re-walk). Source-order + sorted + honest-empty + byte-determinism.
- **v1.3 — emit** (`api.js` ~2551 `blockAnalysisJson`; `commands/compile.js` flag-parse+thread+write-loop
  ~586-593; `cli.js` ~55; NEW `tests/integration/emit-block-analysis-integration.test.js`). Mirror the 4
  engine-graph sites.
- **v1.4 — consumer rewire** (`scripts/dock.ts`: `defsWithExtents` 274, `unitsMode` 317, `diffScopeMode` 327,
  `SCRML_DEFS` 191/`TS_DEFS` 267). `.scrml` → artifact-backed `DefExt[]` (true spans kill the
  `bubbleClasses[191..301]` swallow + b1 residual); **`.ts`/`.js` → KEEP `TS_DEFS`** (compiler doesn't parse
  its own TS; ripping it loses the compiler-source parallel-edit surface — the DD §7.1 "win"). `SCRML_DEFS`
  retained as a logged fallback (artifact absent / parse error).

---

## 5. v2 FOLLOW-ON (markup-regions) — lighter, harder; artifact-shape work, policy stays in flogence
Add `regions[]`: `{id:"<relpath>@<dominant-binding>", anchorKind:"each|form|if|section", span, reads, writes,
handlerEscalation:[...]}`. Key on the **dominant binding** (`messages.scrml@each:messageHistory`) — reorder-
robust. Hard parts: (1) **markup-region extent is genuinely harder than def spans** — the markup DD's
region-boundary tie-break (`<section>` with co-equal `<each>`+`<form>`) is UNRESOLVED; v2 picks a rule
(nearest enclosing element with ≥1 binding; tie-break = the one with the write, else source-first) + marks it
**provisional**. (2) **component `.raw` gap** — page-render markup first, component-inner may need `.raw`
re-parse. (3) **handler footprints (BREAK-2)** surface here — compute the handler's transitive write-set via
`extractReactiveDepsTransitive` but emit as a SEPARATE `handlerEscalation` list, NEVER folded into `writes`
(preserves G-hybrid's markup-write-default + escalation-flag split; gate-vs-warn = consumer policy).

---

## 6. RISKS / TEST-PARITY
| Risk | Mitigation |
|---|---|
| Footprint shifts body-DG/batch-planner fixtures (`ext1-m1-*`, SQL-batch ×5) | **Add-alongside → ZERO delta** (body-dg-builder untouched). The decisive add-alongside argument. |
| Within-node parity canary | Unrelated (parser classifier, Trace B). No impact. |
| `_deepSetLeafKey` ordering (stamp must precede builder) | metaFiles stage is correct; call the idempotent stamp defensively; assert dotted paths on the quote-form fixture. |
| Span↔line mapping (`span` is PREPROCESSED source, not raw lines) | Use `span.line`/`endLine` (TAB maps back), NOT byte offsets, for diff-scope. **Verify on a real fixture (R26).** |
| SPEC silence | Non-normative tooling (engine-graph precedent). v1 needs no SPEC change. §6.3 authorizes dotted-path writes (footprint is SPEC-grounded). v2 region-boundary, if normative, would need SPEC. |
| Component `.raw` no subtree | v1 span-only (ok); v2 page-render-first. |

---

## 7. DISPATCH BREAKDOWN (`scrml-js-codegen-engineer`, isolation:worktree; D1+D2 ∥, D3 after both, D4 after D3)
- **D1 — footprint extractor:** NEW `block-analysis.ts::footprintForBlock` + helpers + `block-analysis-footprint.test.js`. body-dg-builder.ts must show **zero diff**. R26: BREAK-1 canary green.
- **D2 — builder:** `block-analysis.ts::{buildBlockAnalysisForFile,buildBlockAnalysis,serializeBlockAnalysis,buildBlockAnalysisJson}` + `block-analysis.test.js`. (Disjoint block-lease from D1 on the same file — dog-foods `--units`.) R26: 5 kinds + byte-determinism.
- **D3 — emit:** `api.js`+`compile.js`+`cli.js` + integration test. R26: artifact emitted + determinism + **full `ext1-m1-*`/SQL-batch suite green** (proves add-alongside left the DG untouched).
- **D4 — dock rewire:** `scripts/dock.ts`. R26: (a) `type-system.ts` g-engine-vs-match-alt stays disjoint (`.ts` regex unchanged); (b) `messages.scrml` `bubbleClasses` **false-collision GONE** (artifact's true span) — the headline proof.

### Critical files
- `compiler/src/body-dg-builder.ts` (the root-cell collapse to leave untouched; footprint reference)
- `compiler/src/codegen/reactive-deps.ts` (the already-built dotted resolution: `_deepSetLeafKey`, `collectCompoundLeafTargets`, `extractReactiveDepsFromExprNode`)
- `compiler/src/engine-graph.ts` (the sidecar pattern to mirror)
- `compiler/src/api.js` (~2551 metaFiles-stage wiring)
- `compiler/src/commands/compile.js` (~98/168/279/409/586 flag + write-site)
- `scripts/dock.ts` (consumer rewire)
