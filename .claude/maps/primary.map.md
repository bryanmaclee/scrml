# primary.map.md
# project: scrmlts
# updated: 2026-05-29T00:00:00-06:00  commit: 9ab7aa38

## Project Fingerprint

Language:   JavaScript / TypeScript (Bun runtime >=1.3.13)
Framework:  Custom compiler pipeline — no web framework (compiler is a CLI library)
Runtime:    Bun >=1.3.13
Type:       CLI + library — full-stack `.scrml` language compiler
Size:       ~1,500+ source files (compiler/src/ + compiler/native-parser/ + compiler/self-host/ + compiler/tests/ + stdlib/)
Version:    0.6.10 (released 2026-05-29, S141 close — gate-found fix-wave PARTIAL + emitted-JS parse gate)

## Map Index

| Map                      | Status  | Contents                                                  |
|--------------------------|---------|-----------------------------------------------------------|
| structure.map.md         | present | directory layout, 4 entry points, 20 significant dirs; validate-emit.ts noted |
| dependencies.map.md      | present | 8 packages, internal pipeline module graph; validate-emit.ts import wiring |
| schema.map.md            | present | ~80 AST types/interfaces; CGError; compileScrml() return |
| config.map.md            | present | 4 env vars, bunfig.toml, compileScrml() options surface   |
| build.map.md             | present | 10 npm scripts, 9 CLI subcommands, output artifact shapes |
| error.map.md             | present | 12 error types, §34 code catalog; E-CODEGEN-INVALID-JS + E-CG-003 added S141 |
| test.map.md              | present | bun:test, 828 test files, 8 notable new test files S138+  |
| domain.map.md            | present | 22 compiler concepts, pipeline stage table, invariants    |
| api.map.md               | absent  | no REST/GraphQL/gRPC API (compiler is a library, not server) |
| state.map.md             | absent  | no Redux/Zustand/etc. (compiler has no client state)      |
| events.map.md            | absent  | no EventEmitter/pubsub in compiler source                 |
| auth.map.md              | absent  | no JWT/session in compiler source (adopter apps use §52)  |
| style.map.md             | absent  | no design tokens/component library in compiler source     |
| i18n.map.md              | absent  | no localization                                           |
| infra.map.md             | absent  | no Dockerfile, no CI workflows (only FUNDING.yml)        |
| migrations.map.md        | absent  | schema-differ.js is compiler output, not DB migrations    |
| jobs.map.md              | absent  | no background job system in compiler source               |

## File Routing

types / interfaces / models           → schema.map.md
AST node kinds / compiler stages      → domain.map.md
error codes / diagnostic handling     → error.map.md
environment variables / config keys   → config.map.md
test patterns / fixtures              → test.map.md
build commands / CLI flags            → build.map.md
directory layout / entry points       → structure.map.md
external packages                     → dependencies.map.md
pipeline stage flow / invariants      → domain.map.md

## Key Facts

- Entry point is `compiler/src/cli.js`; the full pipeline lives in `compiler/src/api.js`'s `compileScrml(options)` export; dev agents should read `api.js` comment block first before touching pipeline code
- SPEC.md (30,604+ lines, 58 sections + appendices) at `compiler/SPEC.md` is NORMATIVE per pa.md Rule 4; code changes with spec implications require reading the relevant SPEC section in full before writing; §2.2.1 + §34 updated S141 with E-CODEGEN-INVALID-JS + E-CG-003
- Emitted-JS parse gate (S141 ratified): `compiler/src/codegen/validate-emit.ts` runs an in-process Acorn re-parse of every generated artifact after codegen; emits `E-CODEGEN-INVALID-JS` and aborts write phase on any parse failure; wired in `api.js:1919` behind `validateEmit` option (default `false`, flag-gated); mirrors `E-META-EVAL-002` pattern; ~24 ms median cost on a 64-artifact reference app
- Diagnostic-stream partition: `result.errors` = fatal (E-* or severity:"error"); `result.warnings` = non-fatal (W-*/I-* or severity:"warning"/"info"); tests asserting W-*/I-* MUST check `result.warnings` — `result.errors.filter(e => e.code === "W-...")` always yields empty (S93 precedent)
- `null` and `undefined` do NOT exist in scrml source; both map to `not`; `""` is a defined value (not absence); W-ABSENCE-IN-SCRML-SOURCE lint enforces
- R26 doctrine (pa.md S138 addendum): empirical re-compile of real `.scrml` source on baseline is MANDATORY for any HIGH bug close; forward (verify before claim-CLOSED) AND reverse (verify before claim-OPEN/dispatching fix) directions both apply
- Current health: per `docs/known-gaps.md` §0 (authoritative) — HIGH=2 (Bug 54 tableFor `:let` slot-drop DEFERRED + C10 gate-found compound-predicate lowering open), MED=11, LOW=12; v0.6.10 close (gate-found fix-wave PARTIAL; gate stays flag-gated; R27 C1/C2/C3/C5 RESOLVED, C4/C6/C7/C8/C9/C10/C11 deferred or open)
- `collectSynthCellKeys` (reactive-deps.ts) is the authoritative registry of dotted synth-cell keys for `@compound.<synthProp>` read routing; threaded into `CompileContext.synthCellKeys`; any new validity-surface property MUST be added to this collector AND `emit-synth-surface.ts` in sync
- Native parser (`compiler/native-parser/`) is behind `--parser=scrml-native` flag; M6.6 arc (replacing BS+Acorn entirely) is in progress; BS+Acorn remains the production pipeline path
- CPS multi-batch planner (Bug 9 L2 + Bug 55 fix): `scheduling.ts:isStatementShapeStmt` forces statement-shape stmts to size-1 groups; `body-dg-builder.ts` edges folded into scheduler dep sets (Bug 56 fix) — both at `compiler/src/codegen/`
- Self-host target (`compiler/self-host/*.scrml`) is post-v1.0; scrml-authored from scratch, not a mechanical TS port — these are future human-authored scrml files that showcase scrml's advantages
- Pre-commit hook runs full test suite; never bypass with `--no-verify` without explicit user authorization

## Tags
#scrmlts #map #primary #compiler #scrml-language #bun #v0.6.10

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
