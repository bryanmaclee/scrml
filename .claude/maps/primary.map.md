# primary.map.md
# project: scrmlts
# updated: 2026-05-18T00:00:00-06:00  commit: dae8ff1

## Project Fingerprint
Language:   JavaScript / TypeScript (mixed .js + .ts); Bun runtime
Framework:  Custom compiler — scrml language compiler + LSP server + native lexer (Mn series)
Runtime:    Bun >= 1.3.13
Type:       Compiler + CLI tool + LSP server + 21-module stdlib + native lexer (M1 ladder complete)
Size:       ~1,850+ source files (excluding node_modules/dist/.git);
            compiler/src ~111 .ts/.js files;
            compiler/native-parser/ 17 .scrml/.js shadow pairs + README (NEW S99-S103);
            SPEC.md ~27,400+ lines; SPEC-INDEX.md; PIPELINE.md v0.7.2 (S101);
            samples/compilation-tests: ~311 .scrml fixtures;
            Tests: 658 files (pre-commit subset) — **12,645 pass / 88 skip / 1 todo / 0 FAIL** (S101);
            Full suite: **15,468+ pass / 0 fail** (S101);
            Native-parser conformance: **97 pass / 0 fail** (parser-conformance-lexer.test.js, M1.4)

## Key Facts (S101 / v0.3.1 era — 2026-05-18, commit dae8ff1)

**Current shipped version: v0.3.1** (patch tag `cbe1b1e`). v0.3.0 stable baseline at `13154ba`.

**S99-S103 major additions:**
- NEW `compiler/native-parser/` — bottom-up scrml-native JS lexer. M1.1 (S99) + M1.2 strings/templates/§51.0.Q.1 (S100) + M1.3 line/block comments (S102) + M1.4 regex (S103). **M1 LADDER COMPLETE** — all 7 LexMode state-children have substantive body dispatchers.
- NEW SPEC §4.17 (S101) — raw-content elements `<pre>` / `<code>`; block-splitter recognizes lowercase pre/code as RAW_CONTENT_ELEMENTS; suppresses scrml tokens inside body; E-CTX-001 on unclosed; PIPELINE.md v0.7.2 Stage 2 (BS) addendum; companion §24.3.1 cross-ref.
- NEW SPEC §26.6 (S100) — Tailwind typography plugin (prose family, color + size variants, not-prose opt-out); tailwind-classes.js +415 LOC.
- NEW SPEC §48.6.4 (S98) — fn mutual-recursion-via-hoisting (SPEC-only; parser-recognition implementation-pending).
- NEW SPEC §51.0.B.1 (S98) — engine payload-binding on state-children (three forms); compiler wiring Track 2 CLOSED S99.
- MPA shell-composition `$&` regex-injection fix — S100 `01eeda9` (codegen/index.ts:1214) + S101 `d77a60d` (component-expander.ts:2169, commands/generate.js:242).

**All Approach A sub-waves remain FULLY CLOSED (v0.3.0 baseline):**
- A-2 Reachability Solver (S91), A-3 AuthGraph (S91), A-4 Per-Route Splitter (S91), A-5 Integration Tests (S92). Q-OPEN-4/5/6 closed S92.

## Map Index

| Map                      | Status  | Contents |
|--------------------------|---------|----------|
| structure.map.md         | present | directory layout, entry points, native-parser/ directory (17 shadow pairs); S101 new/modified files (97 lines) |
| dependencies.map.md      | present | 5 runtime + 5 dev packages; pipeline graph with full A-2/A-3/A-4 wiring; v0.3.x version noted (128 lines) — NOT REGENERATED (deps unchanged) |
| schema.map.md            | present | ~80+ AST node kinds; AuthGraph/AuthGate/RoleEnum types; reachability types; ChunkKey/ChunkOutput; native-parser Token/TokenKind/QuoteKind catalog NEW S103 (291 lines) |
| config.map.md            | present | 2 env vars (SCRML_PORT, PORT); bunfig.toml; CLI flags including --emit-per-route + --chunk-size-budget; generate subcommand options (64 lines) — NOT REGENERATED (config unchanged) |
| build.map.md             | present | 11 npm scripts; --chunk-size-budget flag; `scrml generate auth` subcommand; pre-commit hook; CLI subcommands (104 lines) — NOT REGENERATED (build commands unchanged) |
| error.map.md             | present | CGError + 9 runtime error classes; W-CG-CHUNK-* family; E-ENGINE-PAYLOAD-* (§51.0.B.1 S98 SPEC-only); E-TIMER-NAME-* (§51.0.M.1 S79 SHIPPED); full E-/W-/I- families (194 lines) |
| test.map.md              | present | bun:test, 658 files (pre-commit), 97 parser-conformance; M1.x + §4.17 + A-5 + S95 bug-fix tests enumerated (178 lines) |
| native-parser.map.md     | present | NEW S103 — M1.x ladder status, file catalog, TokenKind catalog, §51.0.Q.1 NESTED-ENGINE exemplar, D4 P3 heuristic, conformance test (101 lines) |
| domain.map.md            | present | 35+ domain concepts; native-parser + §4.17 + §26.6 + §48.6.4 + §51.0.B.1 + §51.0.M.1 + MPA-$&-fix concepts; v0.3.1 status; Q-OPEN-4/5/6 closed; diagnostic fire-site table updated (201 lines) |
| events.map.md            | present | no compiler EventEmitter; channel placement rules; WebSocket pub/sub; A-4 chunk prefetch signals (74 lines) — NOT REGENERATED (events unchanged) |
| non-compliance.report.md | present | 4 non-compliant (3 carried from S92 + TIER-C-SCOPE carried; 0 new); 3 uncertain (same 3); ~158 compliant; S101 master-list A1c table-row correction noted (106 lines) |
| api.map.md               | absent  | not applicable — compiler tool, not web API |
| state.map.md             | absent  | not applicable — compiler, not a frontend app |
| auth.map.md              | absent  | not applicable — auth lives in stdlib/auth and user .scrml programs |
| style.map.md             | absent  | not detected |
| i18n.map.md              | absent  | not detected |
| infra.map.md             | absent  | no Dockerfile, no .github/workflows, no Terraform, no docker-compose |
| migrations.map.md        | absent  | per-file `<schema>` blocks (§39) + `scrml migrate` CLI; no migrations dir |
| jobs.map.md              | absent  | stdlib/cron exists but compiler itself does not run jobs |

## File Routing

types / interfaces / AST node kinds              → schema.map.md
native-parser TokenKind / Token / QuoteKind      → schema.map.md + native-parser.map.md
auth-graph types (AuthGraph/AuthGate/RoleEnum)    → schema.map.md
reachability types (RSInput/RSOutput/ChunkPlan)   → schema.map.md
per-route splitter types (ChunkKey/ChunkOutput)   → schema.map.md
hasInternalLinks / hasPrefetchableLinks flags     → schema.map.md + domain.map.md (Q-OPEN-6)
fnv1a-hash primitive (FNV_OFFSET/FNV_PRIME)       → schema.map.md
getCompilerIdentity() / chunks.json `compiler`    → schema.map.md + domain.map.md (Q-OPEN-4)
environment variables / config keys               → config.map.md
CLI flags (--emit-per-route, --emit-reachability, --chunk-size-budget) → config.map.md + build.map.md
generate subcommand options                       → config.map.md
test patterns / fixtures / runner / A-5 suites   → test.map.md
native-parser M1.x ladder / file catalog         → native-parser.map.md
native-parser conformance test infrastructure    → test.map.md + native-parser.map.md
build commands / CLI subcommands / hooks          → build.map.md
directory layout / entry points                   → structure.map.md
external packages / internal pipeline graph       → dependencies.map.md
business rules / pipeline stages / spec           → domain.map.md
error codes / warning families / handlers         → error.map.md
event bus / channel placement / chunk prefetch    → events.map.md
null/absence migration tasks                      → domain.map.md (Task-Shape Routing)
Approach A continuation status                   → domain.map.md (FULLY CLOSED S92)
§4.17 raw-content elements                        → domain.map.md + error.map.md (E-CTX-001)
§26.6 Tailwind typography plugin                  → domain.map.md
§51.0.B.1 payload-binding on state-children      → domain.map.md + error.map.md
§51.0.M.1 named timers / cancelTimer             → domain.map.md + error.map.md
§48.6.4 fn mutual-recursion / hoisting            → domain.map.md

## Key Facts
- Entry point is `compiler/src/cli.js` → `compiler/src/api.js` which orchestrates 15+ pipeline stages (BS→TAB→NR→MOD→CE→UVB→PA→RI→TS→META→DG→BP→AuthGraph→RS→CG plus Stage 3.007 LINT-TRY-CATCH + Stage 3.105 STDLIB-EXPORT-SEED); PIPELINE.md v0.7.2 is the implementation contract (S101: Stage 2 BS addendum for §4.17 raw-content)
- SPEC.md (~27,400+ lines) is normative; §34 + §40.9.11 catalog includes all W-CG-CHUNK-* + W-AUTH-* + E-ENGINE-PAYLOAD-* (§51.0.B.1 SPEC-only, S98) + E-TIMER-NAME-* (§51.0.M.1, S79 SHIPPED)
- `null` and `undefined` do NOT exist in scrml at any level — SPEC §42 + §42.1.1 normative; `""` / `0` / `false` are DEFINED values; canonical absence is `not`; wire encoding is `{"__scrml_absent": true}` (SPEC §57)
- All Approach A sub-waves FULLY CLOSED: A-2 (S91) + A-3 (S91) + A-4 (S91) + A-5 (S92). v0.3.0 STABLE; v0.3.1 patch tag `cbe1b1e`
- `compiler/native-parser/` — bottom-up scrml-native JS lexer, M1 LADDER COMPLETE at M1.4 (S103). 17 .scrml/.js shadow pairs. 7 LexMode state-children active. 97 conformance tests pass. Acorn is the oracle; Acorn replacement is the v1.0 pre-milestone goal
- §4.17 raw-content elements `<pre>` / `<code>` — block-splitter.js RAW_CONTENT_ELEMENTS Set (S101); scrml tokens NOT parsed inside; E-CTX-001 on unclosed; PIPELINE.md v0.7.2 Stage 2 (BS) addendum
- MPA shell-composition `$&` regex-injection bug fixed S100/S101: `String.prototype.replace` dollar-sign backreferences in body-replace calls at codegen/index.ts:1214 + component-expander.ts:2169 + commands/generate.js:242 all converted to function-form replace

## Tags
#scrmlts #map #primary #s101 #v0.3.1 #approach-a #approach-a2 #approach-a3 #approach-a4 #approach-a5 #wire-format #auth-graph #null-eradication #reachability #route-splitter #fnv1a-hash #generate-auth #chunk-prefetch #q-open-4 #q-open-5 #q-open-6 #native-parser #m1-4 #m1-ladder-complete #raw-content #typography #payload-binding #spec-51-0-b-1 #spec-4-17 #spec-26-6 #spec-48-6-4

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [events.map.md](./events.map.md)
- [native-parser.map.md](./native-parser.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
