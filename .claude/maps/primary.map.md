# primary.map.md
# project: scrmlts
# updated: 2026-05-21T09:04:37-06:00  commit: 092fa90a

## Project Fingerprint
Language:   TypeScript + JavaScript (ESM; `.ts` runs directly — no transpile)
Framework:  none (this IS a language toolchain — it has no web framework)
Runtime:    Bun >= 1.3.13 (the only supported runtime)
Type:       compiler / language toolchain (Bun workspace: root + `compiler` member)
Size:       ~3,060 tracked files; 126 compiler/src/ files; 29 native-parser modules (.scrml+.js pairs); 732 test files

scrmlts is the reference compiler for **scrml** — a single-file, full-stack
reactive web language. One `.scrml` source compiles to plain HTML + CSS + JS;
the compiler splits server from client, wires reactivity, and infers routes.

## Map Index
| Map                  | Status  | Contents                                      |
|----------------------|---------|-----------------------------------------------|
| structure.map.md     | present | directory layout, 10 entry points, parallel-track note, K-ledger closure |
| dependencies.map.md  | present | 7 external packages, live + native-parser module graphs (29 modules) |
| schema.map.md        | present | live AST union + codegen IR + symbol table + auth/reachability + native-parser Expr/Stmt AST (39 ExprKind) + seam layer + TagFrame/BodyMode/DisplayTextLiteral catalogs |
| config.map.md        | present | 2 env vars (SCRML_PORT, PORT); --parser=scrml-native flag noted |
| build.map.md         | present | 13 npm scripts, 8 CLI subcommands + --parser=scrml-native, git hooks, v0.4.0 note |
| error.map.md         | present | 9 per-stage diagnostic classes, I-PARSER-NATIVE-SHADOW, stream partition, native-parser §34 codes |
| test.map.md          | present | bun test, 732 files, 8 categories + 6 native-parser conformance files |
| domain.map.md        | present | 18-stage pipeline + native-parser composed-engines COMPLETE (M1-M4+MK1-MK4, K-ledger 12/12) + M5-LIGHT |
| api.map.md           | absent  | no HTTP API — compiler, not a web service      |
| state.map.md         | absent  | no client state store                          |
| events.map.md        | absent  | no event bus                                   |
| auth.map.md          | absent  | no web auth (auth-graph.ts is a compiler pass — see domain.map.md) |
| style.map.md         | absent  | no design-token system                         |
| i18n.map.md          | absent  | no localization                                |
| infra.map.md         | absent  | no Dockerfile / CI workflows / cloud config    |
| migrations.map.md    | absent  | no DB-migration tooling (scrml `<schema>` migration is a language feature) |
| jobs.map.md          | absent  | no job/queue system                            |

## File Routing
live AST node shapes / codegen IR / symbol table → schema.map.md
native-parser Expr AST / Stmt AST / TokenKind / engines / seam layer → schema.map.md
pipeline stages / scrml language concepts          → domain.map.md
native-parser composed-engines front-end           → domain.map.md
diagnostic classes / W-/I- partition / lints        → error.map.md
CLI subcommands / npm scripts / git hooks           → build.map.md
test framework / categories / conformance / fixtures → test.map.md
directory layout / entry points / parallel track     → structure.map.md
external packages / internal module graphs           → dependencies.map.md
environment variables / config files                 → config.map.md
SPEC error codes (E-/W-/I-)                          → compiler/SPEC.md §34 (normative — not mapped)
per-stage contracts / lock map (L1-L22)               → compiler/PIPELINE.md (normative — not mapped)

## Task-Shape Routing (agents — read this section first)

Dispatches against this repo cluster around three task shapes. Each shape lists
2-4 maps in priority order — read them in order until oriented, then read the
named source files. At S114 close the native-parser front-end is FEATURE-COMPLETE;
the dominant next task shape is `m5-pipeline-swap` (M5-FULL downstream-bridge).

**m5-pipeline-swap** (the expected S115 dominant shape — the M5-FULL dispatch
that wires the native-parser output into the live pipeline behind `--parser=scrml-native`):
1. `domain.map.md` — M-ladder status (M5/M6 pending); M5-LIGHT vs M5-FULL distinction;
   the 16-stage pipeline stages the native-parser must bridge into
2. `schema.map.md` — native-parser Expr/Stmt AST shapes + seam layer (the bridge
   contract) + live pipeline FileAST shape (in M5-ast-bridge-scoping.md §2)
3. `structure.map.md` — file-ownership of parse-seam + delegation-frame (the MK4
   seam entry points the M5-FULL bridge attaches to)
4. `error.map.md` — I-PARSER-NATIVE-SHADOW (current M5-LIGHT diagnostic that M5-FULL
   replaces with real routing); the §34 reconciliation for E-STMT-*/E-EXPR-* codes
   Also read: `compiler/native-parser/M5-ast-bridge-scoping.md` (scoping doc — the
   downstream-bridge gap inventory) + `compiler/native-parser/M5-divergence-ledger.md`
   (surface gap inventory at M5.1 close).

**native-parser-milestone** (now closed for the front-end arc; may reopen for
M5/M6 sub-steps under the MD-ladder):
1. `domain.map.md` — composed-engines architecture + current M-ladder status
2. `schema.map.md` — native-parser Expr/Stmt AST + engine catalog
3. `structure.map.md` — file-ownership (which `.scrml`/`.js` pair the milestone touches)
4. `test.map.md` — `parser-conformance-{expr,stmt,markup,lexer,corpus}.test.js`
   Also read: `compiler/native-parser/README.md` (NOTE: M-ladder table STALE — see
   non-compliance report NEW item 1) + `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md`
   (current K-ledger + §5 progress table).

**live-pipeline-fix** (a bug or change to the existing TS pipeline under
`compiler/src/`):
1. `domain.map.md` — 18-stage pipeline; pick the affected stage
2. `schema.map.md` — the live AST union in `compiler/src/types/ast.ts` (NOT
   the native-parser Expr AST — those are SEPARATE)
3. `error.map.md` — which `*Error` class the fix routes through; the W-/I-
   non-fatal partition rule
4. `test.map.md` — the test category matching the affected pass
   Also read: `compiler/SPEC.md` for the relevant § (authoritative).

**spec-amendment / language-feature** (a SPEC.md amendment or a new language
feature that crosses multiple stages):
1. `domain.map.md` — the core-concept slot + pipeline pass interactions
2. `schema.map.md` — AST shape additions required
3. `error.map.md` — new E-/W-/I- codes the amendment introduces
   Also read: `compiler/SPEC.md` (the relevant § + §34 catalog) + the spec
   review checklist via `master-list.md`.

**Don't know which** (e.g., open-ended task brief from user):
1. Read `primary.map.md` (this file) in full
2. Read the **Task-Shape Routing** section above and self-classify
3. If the classification is genuinely unclear, surface to PA before consuming further context

## Use feedback loop

When this map's content was load-bearing for a dispatch outcome, the agent's final report should
note **"map content consulted: [list of map files]; load-bearing finding: [one sentence]"**. When
the map content was NOT useful, report **"maps consulted but not load-bearing"** so PA can
diagnose whether the wrong maps were named in the brief OR the map content is at the wrong
granularity (PA-side fix). 3-5 consecutive "not load-bearing" reports on the same task shape
trigger a map-design review.

## Key Facts
- Entry: compiler/src/cli.js routes 8 subcommands; compiler/src/api.js runs the
  full 18-stage compile pipeline (BS→TAB→NR→MOD→CE→UVB→PA→RI→MC→TS→META→VSS→DG→BP→RS→CG)
  and is the single programmatic API consumed by CLI, tests, watch loops, and the LSP.
  S114 change: api.js accepts `parser` option; when `parser === "scrml-native"` it emits
  `I-PARSER-NATIVE-SHADOW` info diagnostic into result.warnings (M5-LIGHT observability —
  the live pipeline still runs; no native-parser routing at this milestone).
- S114 native-parser arc FEATURE-COMPLETE at HEAD `092fa90a`:
  - M1 (lexer) — ✅ COMPLETE (S99-S103)
  - M2 (JS expression parser, M2.1-M2.4) — ✅ COMPLETE (S112-S113)
  - M3 (JS statement parser, M3.1-M3.4; subsumes BPP) — ✅ COMPLETE (S113)
  - M4.1 (async/generator operators) — ✅ COMPLETE (S113)
  - M4.2 (K6 destructuring unification + noIn flag) — ✅ COMPLETE (S114)
  - M4.3 (full-corpus conformance close; async/await RETRACTED) — ✅ COMPLETE (S114)
  - MK1 (markup BlockContext) — ✅ COMPLETE (S112)
  - MK2 (TagFrame engine, MK2.1-MK2.3) — ✅ COMPLETE (S113)
  - MK3 (BodyMode + DisplayTextLiteral; §4.18 native) — ✅ COMPLETE (S113)
  - MK4 (markup↔JS seam; parse-seam + delegation-frame NEW) — ✅ COMPLETE (S114)
  - K-ledger: 12/12 RESOLVED (K1-K7 in S113; K8-K12 in S114)
  - M5-LIGHT: --parser=scrml-native observability shadow flag WIRED (S114)
  - M5-FULL (downstream-bridge pipeline swap; ~98-180h) — pending
  - M6 (joint retirement of BS + Acorn + BPP; flag retired) — pending
- Native-parser file count: 29 paired `.scrml`/`.js` modules (was 27 at prior map —
  added `parse-seam.scrml/js` + `delegation-frame.scrml/js` at MK4 S114).
- The native-parser modules are `.scrml` CANONICAL + `.js` EXECUTABLE shadow
  pairs. Tests import the `.js`. The shadow exists because compiler v0.3 strips
  `export fn` bodies in `${...}` SPA blocks (native-parser README ANOMALY-2);
  the M5-FULL swap-in retires the shadow. The `.scrml`↔`.js` files are
  hand-maintained — no rebuild script regenerates them.
- v0.4.0 was cut at S114 (pkg.json bump commit `11e2ddf`; tag at `092fa90a`).
- This is a compiler — there is NO HTTP API, NO database, NO event bus, NO client
  state store, NO web auth, NO Docker, NO CI workflows. Conditional-map probes
  return only false positives (compiler code that *processes* routes/auth/events).
- `compiler/src/auth-graph.ts` and `compiler/src/reachability/` are compiler
  analysis passes (domain concepts), NOT a runtime auth or routing system.
- Diagnostics are structured objects, not thrown. Each stage has its own
  `*Error` class (TSError, CGError, ...). api.js partitions the stream:
  W-*/I- prefix or severity warning/info → non-fatal `result.warnings`;
  everything else → fatal `result.errors` (CLI exit 1). Tests asserting on
  W-*/I- codes MUST check `result.warnings`. `I-PARSER-NATIVE-SHADOW` is an
  I-* info code → result.warnings.
- The normative language definition is compiler/SPEC.md (28,489+ lines, §1-§57);
  the normative pipeline contract is compiler/PIPELINE.md. Per project rule,
  SPEC.md is authoritative over docs, primers, and memory; do not decide from
  summaries. Read the relevant SPEC section in full before spec-relevant changes.
  S114 SPEC additions: no-async/await (§19.9.8; +3 §34 codes); Approach C ^{}
  primitives + import:host (§21.3.1 + §22.5.1 + §22.12 + §22.13; +2 §34 codes).
- scrml has no `null` and no `undefined` — `not` is the single absence value.
  `""`/`0`/`false`/`[]`/`{}` are DEFINED values, not absence (SPEC §42).
  scrml also has no async/await — parallel-by-default; canonical async surface
  is the compiler body-split (SPEC §19.9.8; ratified S114 at M4.3 retraction).
- Codegen fans out from compiler/src/code-generator.js → compiler/src/codegen/
  (~50 `emit-*.ts` modules); each emits one scrml construct family.
- `compiler/native-parser/README.md` M-ladder table is STALE (shows S112 OPEN;
  actual status: M1-M4+MK1-MK4 COMPLETE). See non-compliance report NEW item 1.

## Tags
#scrmlts #map #primary #compiler #scrml-language #bun #native-parser #charter-b #mk4 #m5-light

## Links
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
