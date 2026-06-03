# primary.map.md
# project: scrmlts
# updated: 2026-06-02T21:33:23-06:00  commit: 57edc794

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed; Bun runtime)
Framework:  Custom compiler pipeline (no web framework)
Runtime:    Bun >=1.3.13
Type:       CLI compiler + language toolchain (single-file full-stack web language compiler)
Size:       ~1400 source files (869+ test + 143+ compiler/src + 30 native-parser + stdlib + lsp)
Version:    v0.7.0 (project-tracked; compiler/package.json reads 0.2.0 — subpackage drift, ignore)

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|---------------------------------------------------------------|
| structure.map.md     | present | directory layout, entry points, S148-S156 source changes (engine-graph, source-map, _scrml_modules, dev watcher, Shape 4, S153 each-in-dynamic-context, S154 message-arm parser, S155 #14 typer+codegen, S156 Bug 62 engine-ctx + (d)-A enum-subset 4 batches) |
| dependencies.map.md  | present | 9 packages (3 runtime root + 2 compiler + 4 devDeps), internal graph (HEADER STALE — content not touched by S154-S156, last refreshed 4e1f9492) |
| schema.map.md        | present | ~47 AST node types + `acceptsType` on EngineDeclNode (S154) + `subsetVariants` on PredicatedType (S156) + MessageArmEntry + EnumSubsetParse (S155-S156) |
| config.map.md        | present | 4 env vars, 3 config files (HEADER STALE — last refreshed 948d3f2f) |
| build.map.md         | present | 12 npm scripts, maintenance scripts, pre-commit hook (HEADER STALE — last refreshed 948d3f2f) |
| error.map.md         | present | 379+ error codes; +5 new S154-S156 codes (E-ENGINE-ACCEPTS-NOT-ENUM, E-ENGINE-MSG-WITHOUT-ACCEPTS, E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE, E-ENGINE-MSG-UNKNOWN, E-MATCH-SUBSET-DEAD-ARM) |
| test.map.md          | present | bun:test, ~869 .test.js files; +11 S154-S156 unit+browser+conformance tests |
| domain.map.md        | present | 12-stage pipeline + sidecar, 30+ domain concepts incl. S153 each-in-dynamic-context, S155 `accepts=`/message-dispatch/#14 plane, S156 Bug 62 engine-ctx threading (emit-each.ts pattern → Bug 65 next), enum-subset refinement §53.15.1; codegen each/match/engine emit map |
| api.map.md           | absent  | no HTTP route handlers in compiler source                     |
| state.map.md         | absent  | no client state management (compiler is a pure function)      |
| events.map.md        | absent  | no EventEmitter/pubsub detected in compiler source            |
| auth.map.md          | absent  | auth is a COMPILED FEATURE (auth-graph.ts), not compiler auth |
| style.map.md         | absent  | no design tokens or CSS framework in compiler source          |
| i18n.map.md          | absent  | no i18n detected                                              |
| infra.map.md         | absent  | no Dockerfile, CI workflows, or IaC detected                  |
| migrations.map.md    | absent  | no database migrations (runtime DBs are user-app concerns)    |
| jobs.map.md          | absent  | no job scheduler in compiler source                           |

## File Routing

| Query | Map |
|-------|-----|
| types / interfaces / AST node shapes | schema.map.md |
| error codes / CGError / diagnostic stream / fix-notes | error.map.md |
| environment variables / config keys | config.map.md |
| test patterns / fixtures / conformance / happy-dom canaries | test.map.md |
| build commands / pre-commit hook | build.map.md |
| directory layout / entry points / pipeline stages / per-session source changes | structure.map.md |
| external packages (acorn, astring, MCP SDK, vscode-languageserver) | dependencies.map.md |
| domain concepts (pipeline stages, engine-graph, source-map, each/match emit, enum-subset, message-dispatch) | domain.map.md |
| business invariants (null-not-in-scrml, auth-content-not-gated, arm-separator, Shape 4, each-chunk-survival, dep-first-read, engine-ctx-threading, subset-range-forbidden) | domain.map.md |
| `<each>` / `<match>` / engine codegen emit modules | domain.map.md "Codegen each/match/engine Emit Map" + structure.map.md S154-S156 |

## Task-Shape Routing (agents — read this section first)

This is a COMPILER repo. Task shapes are bug-fix / codegen / parser / new-feature / spec-amendment /
test-authoring / audit. Each shape lists maps in priority order — read in order until oriented.

**compiler-source bug fix (the dominant shape — most dispatches):**
1. `error.map.md` — find the offending code, its family, AND the "Fix Notes" for any prior fix on the same class (the S153 each-in-dynamic-context, S152 each-cell-init, S150 source-map notes are pattern templates — read them before re-diagnosing)
2. `domain.map.md` — locate the responsible pipeline stage + its primary source file (Pipeline Source Files table) and any relevant invariant
3. `structure.map.md` — the "Key S148-S156 Source Changes" section gives exact file + function + line for recently-touched code; the codegen directory ownership line names the emit-* module
4. `test.map.md` — find the existing canary for the feature; a behavior fix WITHOUT a happy-dom test is the S140/S152 blind-spot trap — always add one

**codegen (`<each>` / `<match>` / engine / emit-* work — highest-churn area right now):**
1. `domain.map.md` — the **"Codegen `<each>` / `<match>` / engine Emit Map"** table (the single most load-bearing table for codegen work; names every emit module + its role + the S153-S156 runtime helpers and Bug 62 engine-ctx pattern)
2. `structure.map.md` — S154-S156 source-changes section: exact functions + line numbers in emit-each.ts / emit-engine.ts / emit-predicates.ts / emit-schema-for.ts / runtime-template.js
3. `error.map.md` — E-CODEGEN-INVALID-JS fix notes + chunk-survival / dep-first-read / engine-ctx-threading invariants (a codegen change that tree-shakes a needed chunk → ReferenceError; engine-ctx absence → silent wrong JS)
4. `test.map.md` — happy-dom canary list; emit-string-only tests mask runtime miscompiles

**Bug 65 dispatch (next arc — Tier-0 `${for…lift}` engine-ctx threading):**
1. `domain.map.md` — `<each>` engine-ctx threading concept (Bug 62 / Bug 65 delta)
2. `structure.map.md` — S156 Bug 62 change detail: `buildEachEngineCtx` in emit-each.ts is the EXACT PATTERN to mirror at emit-lift.js ~line 529
3. `error.map.md` — Bug 62 fix note (the root cause and the three-part intercept)
4. Read `emit-each.ts:1074-1221` for the implementation pattern; apply to `emit-lift.js:~529`

**parser / grammar fix (block-splitter / ast-builder / engine-statechild-parser / native-parser):**
1. `domain.map.md` — pipeline stage (BS/TAB) + engine-arm-parsing row; the native-parser M5-swap precondition (does NOT promote each/match → structural nodes)
2. `structure.map.md` — engine-statechild-parser.ts S154 `parseMessageArms()` + S153 `isColonShorthandOpener` change + native-parser directory note
3. `error.map.md` — E-ENGINE-STATE-CHILD-MISSING / E-ENGINE-ACCEPTS-NOT-ENUM / E-ENGINE-MSG-* / E-CTX-* / E-EXPR-* / E-STMT-* families
4. `test.map.md` — parser-conformance within-node allowlist (live-pipeline vs native-parser parity)

**enum-subset refinement work ((d)-A arc follow-up / Bug 69 / batch 5 if confirmed):**
1. `domain.map.md` — enum-subset refinement concept + three consumers (match exhaustiveness, predicate codegen, schemaFor DDL)
2. `structure.map.md` — S156 (d)-A batch descriptions; `enum-subset-refinement.ts` is the shared recognizer
3. `error.map.md` — E-MATCH-SUBSET-DEAD-ARM + E-CONTRACT-002 extension
4. `schema.map.md` — `PredicatedType.subsetVariants`, `EnumSubsetParse`, `parseEnumSubsetAnnotation` shapes

**new feature / spec-amendment:**
1. `domain.map.md` — invariants + concept lexicon (check language cohesion before proposing syntax)
2. `structure.map.md` — where the feature's stage lives
3. `schema.map.md` — AST node shapes (a new construct needs a node type)
4. `error.map.md` — code-family conventions for any new diagnostic

**test-authoring:**
1. `test.map.md` — runner, categories, patterns, cross-stream W-/I- helper requirement
2. `error.map.md` — the code under assertion (and which stream it lands in)

**audit / non-compliance:**
1. `non-compliance.report.md` — current findings + dispositions (Bug 69 NON-GAP tension flagged as uncertain)
2. `structure.map.md` — what's in-scope vs out-of-scope (archive/, handOffs/, samples/)

**Don't know which** (e.g., open-ended task brief from user):
1. Read `primary.map.md` (this file) in full
2. Read the Task-Shape Routing section above and self-classify
3. If genuinely unclear, surface to PA before consuming further context

## Use feedback loop

When this map's content was load-bearing for a dispatch outcome, the agent's final report should
note **"map content consulted: [list of map files]; load-bearing finding: [one sentence]"**. When
the map content was NOT useful, report **"maps consulted but not load-bearing"** so PA can diagnose
whether the wrong maps were named in the brief OR the map content is at the wrong granularity.
3-5 consecutive "not load-bearing" reports on the same task shape trigger a map-design review.

## Key Facts
- Entry point: `compiler/src/cli.js` → subcommand router; public API in `compiler/src/api.js` → `compileScrml()`; `--emit-engine-graph` flag (S149) writes `<base>.engine-graph.json` sidecar
- Pipeline: 12 ordered stages BS → TAB → NR → MOD → CE → PA → RI → TS → META → VSS → DG → CG; stage contracts at `compiler/PIPELINE.md`; engine-graph sidecar runs after CG via lazy getter in compile result
- Spec: `compiler/SPEC.md` (30,704+ lines, 58 sections + appendices); normative per pa.md Rule 4
- Error surface: CGError with `severity: 'error'|'warning'|'info'`; W-*/I-* → result.warnings (non-fatal); all else → result.errors (fatal, CLI exit 1); emitted-JS parse-gate (E-CODEGEN-INVALID-JS) is default-ON
- `<each>` codegen is the highest-churn area: Bug 62 (S156) closed the engine-ctx threading gap in emit-each.ts; **Bug 65 (NEXT arc)** is the IDENTICAL gap in emit-lift.js Tier-0 `${for…lift}` path (~line 529); emit-each.ts `buildEachEngineCtx` is the exact template. Read domain.map.md's "Codegen Emit Map" before touching emit-each.ts / emit-lift.js / emit-engine.ts
- S155 runtime contract: `_scrml_engine_dispatch_message(varName, msg, armTable, table, ...)` (runtime-template.js) dispatches `(state × message)` arms; calls `_scrml_engine_advance` for the target transition; handles §51.0.R idle reset on a handled message
- S156 (d)-A runtime contract: `Enum oneOf([.A,.B])` / `notIn([...])` annotated cells carry `subsetVariants: Set<string>` in `PredicatedType`; boundary checks lower to `(["A","B"].includes(v))`; schemaFor fields lower to `CHECK IN ('A','B')`. Range form is forbidden (§53.15.1). `enum-subset-refinement.ts` is the shared dependency-free recognizer.
- S153 runtime contract: `_scrml_each_renderers` registry + `_scrml_remount_each(root)` (runtime-template.js) — each-mount inside a non-`initial=` engine arm registers at module-init and re-renders when the variant-swap dispatcher mounts its arm
- HARD M5-swap precondition (S153, witnessed twice): the native parser does NOT promote `<each>`/`<match>` to structural each-block/match-block nodes; two S153 fixes route around it via legacy BS+TAB; when native becomes default it MUST promote them or every each/match breaks
- null/undefined: BOTH do not exist in scrml (`W-ABSENCE-IN-SCRML-SOURCE`); `""` / `0` / `false` ARE defined values; `async`/`await`/`switch`/`try`/`throw` are forbidden vocabulary
- type-system.ts is 17070 lines (largest single source file); type-checking, linear types, validity-surface synthesis, enum-subset resolution
- symbol-table.ts is 11280 lines; engine state-child walkers, PASS 20 match exhaustiveness (incl. subset dead-arm), message-arm exhaustiveness (S155)
- Native parser: `compiler/native-parser/` paired `.js` + `.scrml` bootstrap; `--parser=scrml-native`; M5-swap incomplete (see precondition above)
- **Bug 69 / NON-GAP tension:** hand-off.md records a conflict: user said "fold Bug 69 in" (tableFor §41.16.6 subset reach) but the S156 CLOSE block called it NON-GAP. Confirm with user before scheduling (d)-A batch 5. See `non-compliance.report.md` Uncertain section.

## Tags
#scrmlts #map #primary #compiler #bun #v0.7.0 #each-in-dynamic-context #codegen #enum-subset #message-dispatch #bug62 #bug65 #s148 #s149 #s150 #s151 #s152 #s153 #s154 #s155 #s156

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
