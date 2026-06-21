# A2 W2 — parser recognition of `<api>` — dispatch brief (agent a0761f89e7066e52a, S210)

scrml-js-codegen-engineer · isolation:worktree · opus · dispatched S210 2026-06-20 (user "go").

## Task
W2 (parser wave) of the ratified `<api>` primitive. Compiler-source TS/JS. change-id api-primitive-a2-2026-06-20.

## Scope (parse + parse-level diagnostics ONLY)
1. block-splitter: recognize `<api ...>...</api>` as a structural block (like `<schema>`).
2. ast-builder: register `<api>` (placement = `<db>`/`<schema>` scope); parse `base=` (req) + `src=` (opt) attrs; parse endpoint decls per §60.2 grammar (`name(reqShape) -> METHOD "path" : ResponseT`, method ∈ GET/POST/PUT/PATCH/DELETE; type-refs captured NOT resolved) → new `api-decl` AST node {base, src?, endpoints:[{name,reqShape?,method,path,responseType}]}.
3. Parse-level codes (+ §34 rows, Rule 4): E-API-BASE-MISSING, E-API-METHOD-INVALID, E-API-RESPONSE-TYPE-UNDECLARED, E-API-ENDPOINT-MALFORMED. Mark these "wired S210 W2" in §60.9; rest stay planned.
4. NO codegen / NO emission — valid `<api>` parses to AST + emits nothing; no regressions; §60 Nominal banner stays.
5. DEFER to W3: E-API-ENDPOINT-UNKNOWN, E-API-REQ-SHAPE-MISMATCH, E-API-PATH-PARAM-UNBOUND + the entire `<request api=>` consumption (W4). W2 = the `<api>` DECLARATION only.

## Model loci
ast-builder.js known-structural-elements (~13232 "db","schema","engine","machine"), placement msgs (~187), _STATE_BLOCK_BARE_WRITE_NAMES (~878); block-splitter.js structural-decl-signal (~2514). Normative source = SPEC §60.

## Tests
Unit: valid `<api>` → AST node shape; one per malformed case → right E-API-* code. Compile-verify a valid + malformed `.scrml` (exit-0 / exit-1+code). Full `bun run test` before DONE; re-baseline within-node if shifted.

## Standard blocks (full text in the dispatched prompt)
MAPS-first-read (watermark 5c68e87e, parser files stale-since) · F4 startup-verify + S126 Bash-edit/no-cd path-discipline + merge main first (verify §60 present) + bun install + pretest · S83 commit-discipline (incremental, clean tree, pwd in first commit, progress.md) · report WORKTREE_PATH/FINAL_SHA/FILES_TOUCHED/§34-codes/deferred/compile-verify/full-suite/maps. PA lands S67 file-delta; agent does NOT push/touch main.
