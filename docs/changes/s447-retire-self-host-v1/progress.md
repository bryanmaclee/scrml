# s447-retire-self-host-v1 — progress (append-only)

## Step 1 — survey (before any deletion)

Target: `compiler/self-host/` — 18 files, 22,433 lines (11 `.scrml` = 12,277 lines; `api.js`; 5 `cg-parts/*.js`; README).

Classes: (a) parse/compile corpus · (b) tests self-host v1 behaviour · (c) rebuild tooling · (d) compiler/src runtime dependency · (e) comment/doc-only historical mention.

| Reference | Class | Disposition |
|---|---|---|
| compiler/tests/parser-conformance/corpus-enumerator.js (`SCRML_CORPUS_SOURCES` "self-host" root) | (a) | RE-POINT to `compiler/self-host-v2` (feeds parser-conformance-corpus, -within-node, -collect-hoisted, parser-conformance.test.js) |
| compiler/tests/parser-conformance.test.js (`SIZES["self-host"] > 0`) | (a) | follow the rename to "self-host-v2" |
| compiler/tests/parser-conformance-within-node-allowlist.json (11 `compiler/self-host/*.scrml` keys) | (a) | drop the 11 stale keys (hygiene test fails on stale keys); add baselines for the v2 files |
| compiler/tests/parser-conformance-corpus.test.js (header comment) | (a)/(e) | comment update |
| compiler/tests/parser-conformance-collect-hoisted.test.js:591 (comment) | (e) | comment update |
| compiler/tests/parser-conformance-canary.test.js:609,901,930 (reads `self-host/cg.scrml`, `self-host/bs.scrml` as regression fixtures) | (a) | INLINE the shapes (cg.scrml is 21 lines → verbatim; bs.scrml → the `name: not` object-literal shape) |
| compiler/tests/parser-conformance/dual-pipeline-canary.js:399,420 (comments) | (e) | comment note |
| compiler/tests/integration/self-host-smoke.test.js §B (bs.js parity) + §C (tab.js parity) | (b) | DELETE those two describes (read `compiler/self-host/dist/*.js`; always-skip on a clean checkout). §A (stdlib/compiler/module-resolver.scrml) is NOT v1 → keep |
| compiler/tests/integration/self-compilation.test.js | not v1 | uses `stdlib/compiler/{module-resolver,meta-checker}` via build-self-host.js → KEEP (comment touch only) |
| compiler/src/commands/compile.js `--self-host` loader (optional bs/ast/bpp/pa/ri/ts/dg/cg/tokenizer from `compiler/dist/self-host/`) | (d) | strip the v1-sourced optional modules; keep the required MR+MC pair (sourced from `stdlib/compiler/`) |
| compiler/scripts/build-self-host.js (compiles v1 bs/bpp/tab/ast/pa/ri/ts/dg + assembles cg from `cg-parts`) | (c) | trim to the stdlib/compiler MR+MC entries |
| scripts/rebuild-self-host-dist.ts, scripts/rebuild-bs-dist.ts, scripts/rebuild-tab-dist.ts | (c) | DELETE (rebuild-self-host-dist: 9 of 11 targets are v1; the 2 stdlib targets are covered by build-self-host.js) |
| scripts/migrate-closers.js (default dir list) | (c)-adjacent | drop the dir from defaults |
| scripts/s34-census.ts SCAN list | tooling | drop the dir |
| scripts/hybrid.ts (comments: "what this harness swaps in today") | (e) | comment update; harness is live (v2) |
| compiler/src/codegen/compat/parser-workarounds.js `setBPPOverrides` shim | (d)? | NOT DEAD: m6-5-parser-workarounds-noop-under-native.test.js uses it as its spy-interception hook, and api.js `selfHostModules.bpp` routes through it. Keep; comments updated |
| compiler/src/api.js / pipeline-seam.ts `selfHostModules` option | generic API | KEEP: a stage-substitution API independent of v1; live callers hybrid-stage-swap.test.js, db-uri-redaction-r4.test.js, self-compilation.test.js |
| compiler/native-parser/parse-stmt.js comments (503, 3486, 3557, 4498) | (e) | 4499 names the path → comment touch |
| unit/while-braceless-body..., unit/regex-char-class-colon..., unit/ast-builder-switch-forbidden-bypass, unit/inner-fn-assignment..., integration/g-each-match-body-class-literal-extracted, conformance/s32-fn-state-machine/REGISTRY.md | (e) | inline fixtures already; comments are history. LEAVE |
| compiler/tests/e2e-render-map/render-corpus-enumerator.js | (e) | already excludes; leave |
| scripts/native-parser-flip-harness.ts:313 (`/\/self-host\//` test-path matcher) | (e) | matches the retired compiler/tests/self-host/ tree; harmless; leave |
| .github/workflows/ci.yml:14-30,249 | (e) | comments about self-host-smoke dist / compiler/tests/self-host → update |
| package.json "//files" ("self-host*" excluded) | (e) | still accurate for self-host-v2; leave |
| docs/PA-SCRML-PRIMER.md :966, :1171 | docs | update |
| master-list.md :143,176,182,247,328,519 | docs | update |
| compiler/SPEC.md :18678 ("and the frozen `compiler/self-host/` tree") | docs | update (same-line edit, no SPEC-INDEX drift) |
| docs/known-gaps.md open gaps located in compiler/self-host/ | docs | close as moot (separate commit — PA-owned doc) |
| handOffs/*, docs/changes/*, docs/audits/*, docs/changelog.md, spa-lists/*, hand-off.md | history | LEAVE |
