# primary.map.md
# project: scrmlts
# updated: 2026-05-20T13:42:44-06:00  commit: 78faa65

## Project Fingerprint
Language:   TypeScript + JavaScript (ESM; `.ts` runs directly — no transpile)
Framework:  none (this IS a language toolchain — it has no web framework)
Runtime:    Bun >= 1.3.13 (the only supported runtime)
Type:       compiler / language toolchain (Bun workspace: root + `compiler` member)
Size:       ~3,015 tracked files; ~126 compiler source files; 728 test files

scrmlts is the reference compiler for **scrml** — a single-file, full-stack
reactive web language. One `.scrml` source compiles to plain HTML + CSS + JS;
the compiler splits server from client, wires reactivity, and infers routes.

## Map Index
| Map                  | Status  | Contents                                      |
|----------------------|---------|-----------------------------------------------|
| structure.map.md     | present | directory layout, 6 entry points              |
| dependencies.map.md  | present | 7 external packages, internal pipeline graph   |
| schema.map.md        | present | AST union + codegen IR + symbol table + auth/reachability types |
| config.map.md        | present | 2 env vars (SCRML_PORT, PORT), no .env file    |
| build.map.md         | present | 13 npm scripts, 8 CLI subcommands, git hooks   |
| error.map.md         | present | 9 per-stage diagnostic classes, stream partition |
| test.map.md          | present | bun test, 728 files, 8 categories + e2e        |
| domain.map.md        | present | 18-stage pipeline, scrml language concepts     |
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
AST node shapes / codegen IR / symbol table   → schema.map.md
pipeline stages / scrml language concepts      → domain.map.md
diagnostic classes / W-/I- partition / lints   → error.map.md
CLI subcommands / npm scripts / git hooks      → build.map.md
test framework / categories / fixtures         → test.map.md
directory layout / entry points                → structure.map.md
external packages / internal module graph      → dependencies.map.md
environment variables / config files           → config.map.md
SPEC error codes (E-/W-/I-)                     → compiler/SPEC.md §34 (normative — not mapped)
per-stage contracts / lock map (L1-L22)         → compiler/PIPELINE.md (normative — not mapped)

## Key Facts
- Entry: compiler/src/cli.js routes 8 subcommands; compiler/src/api.js runs the
  full 18-stage compile pipeline (BS→TAB→NR→MOD→CE→UVB→PA→RI→MC→TS→META→VSS→DG→BP→RS→CG)
  and is the single programmatic API consumed by CLI, tests, watch loops, and the LSP.
- This is a compiler — there is NO HTTP API, NO database, NO event bus, NO client
  state store, NO web auth, NO Docker, NO CI workflows. Probes for those triggers
  return only false positives (compiler code that *processes* routes/auth/events).
- `compiler/src/auth-graph.ts` and `compiler/src/reachability/` are compiler
  analysis passes (domain concepts), NOT a runtime auth or routing system.
- Diagnostics are structured objects, not thrown. Each stage has its own
  `*Error` class (TSError, CGError, ...). api.js:1779 partitions the stream:
  W-*/I- prefix or severity warning/info → non-fatal `result.warnings`;
  everything else → fatal `result.errors` (CLI exit 1). Tests asserting on
  W-*/I- codes MUST check `result.warnings`.
- The normative language definition is compiler/SPEC.md (28,489 lines, §1-§57);
  the normative pipeline contract is compiler/PIPELINE.md. Per project rule,
  SPEC.md is authoritative over docs, primers, and memory; do not decide from
  summaries. Read the relevant SPEC section in full before spec-relevant changes.
- scrml has no `null` and no `undefined` — `not` is the single absence value.
  `""`/`0`/`false`/`[]`/`{}` are DEFINED values, not absence (SPEC §42).
- Codegen fans out from compiler/src/code-generator.js → compiler/src/codegen/
  (~50 `emit-*.ts` modules); each emits one scrml construct family.
- Self-hosting is in progress: compiler/self-host/*.scrml and
  compiler/native-parser/ are a from-scratch scrml-authored compiler; the
  TypeScript compiler is the temporary scaffold.

## Tags
#scrmlts #map #primary #compiler #scrml-language #bun

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
