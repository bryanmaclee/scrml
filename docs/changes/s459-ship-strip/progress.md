# s459-ship-strip — progress

Base: `origin/main` @ `6fcde7f7e`, branch `s459-ship-strip`.

## Commits

- `07761a1ad` BRIEF archived.
- `d3e70dd81` `compiler/src/codegen/ship-strip.ts` (acorn token reprint + token-identity proof).
- `bd1338c61` wiring (runCG runtime + chunk boot, route-splitter finalizeChunkHash, api.js page +
  worker bundles), CLI (build default strip / `--keep-comments`, compile `--minify`), whitespace-
  tolerant post-strip readers, SPEC §47.9.9 + §34 `W-CG-SHIP-STRIP-FALLBACK`, size tests moved
  to the production shape, unit tests.
- `4b2f946d8` browser-tier TodoMVC behaviour equivalence (stripped vs emitted, isolated processes).

## Design (as built)

- Acorn reprint, not Bun.Transpiler: tokens are copied as exact source slices; gap -> `\n` if it
  held a line terminator (a removed comment spanning a line counts), else one space only where the
  join would fuse (word chars, regex flags, `1 .x`, multi-char punctuators incl. `//`, `/*`, `<!--`,
  `-->`, `</`, with a 4-char lookahead/tail so multi-token fusions are caught), else nothing.
  Toolchain comments kept (`/*!`, `@license`, `@preserve`, `__PURE__`, `__NO_SIDE_EFFECTS__`,
  `sourceMappingURL` / `sourceURL`, `#!`).
- Proof: re-parse in every goal the input parses in; token type + exact text + line-break-before
  must match. Mismatch -> comment-only form (proven the same way) -> unchanged input;
  `W-CG-SHIP-STRIP-FALLBACK` (Warning). Unparseable input is left alone without a warning (that is
  the §2.2.1 gate's finding).
- Strip points = each artifact class's final-bytes point, BEFORE its hash:
  runtime (index.ts, after assembleRuntime + toEsmRuntime, before FNV), per-route chunks
  (route-splitter finalizeChunkHash), chunk boot script (before FNV), page + worker bundles
  (api.js `shipClient`, after the relative/stdlib rewrites, before the emit gate, the #82 hash
  pre-pass and the write; memoised so gate and write see one result).
- Not stripped: `.server.js`, `_server.js`, library / tool `.js`, `_scrml/` stdlib shims, source
  maps, and a page bundle that HAS a source map (the map would desync).

## Measurements (gzip -9, zlib in-memory; before = main 6fcde7f7e, after = branch + strip)

| shape | runtime before | runtime after | total client before | total client after |
|---|---|---|---|---|
| S1 counter | 57,017 / 16,328 | 22,579 / 5,101 | 59,675 / 17,361 | 24,332 / 5,714 |
| S2 shell | 82,730 / 26,211 | 28,845 / 7,442 | 83,292 / 26,586 | 28,972 / 7,569 |
| S3 todomvc | 153,775 / 47,662 | 54,836 / 13,445 | 174,406 / 51,640 | 72,010 / 16,601 |
| S4 trucking | 240,167 / 73,419 | 76,189 / 18,137 | 1,332,906 / 230,863 | 977,542 / 146,190 |

(raw / gz9 bytes.) S4 server.js comment share: 469,335 of 1,478,321 B = 31.7% (not stripped).

## Differential (corpus: examples, samples, conformance, stdlib, benchmarks = 2,477 sources)

- main vs branch, default compile (no strip): 7,164 artifacts byte-identical.
- main vs branch `stripShippedJs`, default compile: 2,971 changed artifacts, ALL browser JS
  (runtime 1,433, client 1,533, worker 5), every one token-identical; every other artifact
  identical up to runtime-hash renames. Zero `W-CG-SHIP-STRIP-FALLBACK`.
- main vs branch, build mode (`contentHashAssets` + `emitPerRoute`) + strip: 4,953 changed browser
  JS artifacts (route chunks 1,158, chunk boot 823, runtime 1,433, client 1,533, worker 5)
  token-identical except ONE chunk-mount node id in gauntlet-r10-odin-filebrowser that also
  differs main vs branch WITHOUT strip in-process (pre-existing in-process id drift; a fresh
  process gives identical ids and the fresh-process stripped output is token-identical).
- CLI `scrml build <dir>` on the 4 multi-file program dirs: `--keep-comments` byte-identical to
  main; default (stripped) token-identical, everything else hash-rename only.
- esm + build + strip (`moduleFormat: "esm"`, `contentHashAssets`, `emitPerRoute`): 4,949 changed
  browser JS artifacts, token-identical except the same odin-filebrowser in-process id drift.
- Harness artifact, both directions: 3 stdlib sources (`data/form-for`, `data/messages`,
  `mcp/index`) fail under the extracted main tree (stdlib exemption is by REAL path) — not a change.

## Gates (executed on the branch)

pretest, gauntlet TodoMVC compile, types-gate, regen-spec-index --check, s34-census --check-new,
delta-lint, conflict-marker, snippet-gate, corpus-compile-floor --check, root tests,
e2e-render-map, integration+lsp+commands, unit+conformance, `bun conformance/run.ts`,
browser-baseline --check: all exit 0. facts --check was STALE (new module) -> `--write`.
host-global-scan --check FIRST FAILED (1176 R2 in `build` mode): the gate's own shape regexes
(`^var _scrml_g = globalThis;`, `^import _scrml_g from "`, `^import {…} from "…scrml-runtime…";`)
were whitespace-exact and the build mode now reads stripped bytes. Made whitespace-tolerant ->
0 violations (119 threw, unchanged).
