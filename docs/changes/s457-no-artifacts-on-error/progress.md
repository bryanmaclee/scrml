# progress — s457-no-artifacts-on-error (append-only)

## 2026-10-07 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-af08c258571df003f`, base `d5875e972` = origin/main.
- Governing: SPEC §2.2.1 (S451 5(b)), quoted: "A compile that reports one or more diagnostics of **Error**
  severity (§34) SHALL NOT produce a runnable artifact. After such a compile, either no output file of that
  compile exists, or the compile wrote no file — an output directory left by an earlier compile is left exactly
  as it was, neither overwritten in part nor deleted. This holds for the whole compile, not per file [...]
  Diagnostics of Warning or Info severity do not trigger it."

## Locus — PA hypothesis vs source
- HELD, refined: `commands/refusal-gate.js` `APPLICATION_SCOPE_REFUSALS` was the allow-list; but the decision
  point is `compileScrml` (api.js) — the `beforeWrite` commit decision. Every entry point (compile, build, dev,
  serve) goes through it, so the rule is enforced there once, not per command.
- `validate-emit.ts` (the parse gate) already refused, BUT measured three holes in the existing "no write" paths:
  1. `mkdirSync(outputDir)` ran BEFORE the gate → a gate failure left an empty output dir created.
  2. `bundleStdlibForRun` (copies `_scrml/*.js`) ran BEFORE the gate → a gate failure left stdlib shims on disk.
  3. E-CG-015 (two sources → one dist path; reachable: `a.scrml` + `pages/a.scrml`, `pages/` is stripped) was
     detected MID-WRITE: the runtime and every artifact written before the collision stayed on disk.
  All three closed (stage-then-flush; stdlib set planned without writing via new `planStdlibBundle`).

## Design decision (brief: (i) leave untouched vs (ii) delete stale)
- (i) LEAVE THE OUTPUT DIRECTORY UNTOUCHED, every entry point. Not a free choice: §2.2.1 says "an output directory
  left by an earlier compile is left exactly as it was, neither overwritten in part nor deleted" — (ii) would
  violate the SPEC. Per entry point:
  - `compile` / `build`: dist untouched; stderr says `No files were written to <dir>/ (a compile that reports an
    error leaves it as it was).` (now printed for EVERY failed compile, keyed on the new `result.artifactsWritten`).
  - `dev` / watch: dist keeps the last good build; the fetch handler already serves the compile error at every
    request while failing (#517/#518, `noteCompileResult`), so last-good is never served as current; the next
    green pass replaces it.
  - `serve` POST /compile and /compile-source: compileScrml writes nothing; the response's `outputs` is `{}` on
    any error (new exported `serializeOutputs`), plus `artifactsWritten` in the JSON.
- Diagnostics are UNCHANGED for a failed compile: the gate / E-CG-015 / stdlib warnings run under the pre-S457
  eligibility (`writeEligible`), separately from whether a byte is written (`writeAborted`). Only disk changes.
- `beforeWrite` is still consulted on a failed compile (build's E-MW-007 onion check adds to the failure report).
- `APPLICATION_SCOPE_REFUSALS` / `hasApplicationScopeRefusal` RETIRED (dead: all ten codes are Errors). build's
  callback now decides only E-MW-007 over the post-write unit set (a fact compileScrml cannot see).
- In-memory `result.outputs` on `write:false` is NOT an artifact — kept (LSP, tests, fix-* verify-by-compile and
  the conformance adapter read it). No opt-in "write partial output" flag added: nothing measured needs one.

## Baseline (base d5875e972, `bun test compiler/tests/`)
- 34402 pass / 107 skip / 16 todo / 53 fail (browser tier + env), 664.9 s. Fail names saved for set-diff.

## 2026-10-07 — MEASURED: what relied on error-path artifacts
First post-change full run (`bun test compiler/tests/`): 99 newly-failing tests in 38 files (base-vs-head
fail-NAME set difference; 2 newly passing = TodoMVC env tests, not this change). Fatal codes each file's
compiles hit, captured by a temporary probe in api.js (removed). Every one READ ARTIFACTS OF A COMPILE THAT
REPORTED AN ERROR. Migrated per file (contract: a failing compile writes nothing; tests assert diagnostics, and
where they pin codegen/recovery of an erroring compile, they read the IN-MEMORY `result.outputs` — not an artifact):

A. Incidental fixture error, codegen pin → in-memory read (fixture unchanged, pin preserved):
   unit/issue-26-server-auto-await-stdlib, unit/issue-26-finding2-async-stdlib-sync-callback,
   unit/jwt-auth-bypass-2026-07-11, unit/failable-array-return-server-promotion,
   unit/failable-generic-paren-return-server-promotion, unit/onmount-spaced-escape-hatch-reactive-server-await
   (all E-PA-002: no database file); unit/bare-variant-string-literal-fence (E-VARIANT-AMBIGUOUS);
   unit/g-bare-expr-in-if-arm-rebinds-tilde-context (E-CG-TILDE-UNRESOLVED); unit/g-each-peritem-attr-ternary-quoted-arms
   (E-FN-EQUALS-BODY); unit/inline-map-assign-handler-s169 (E-ENGINE-VAR-DUPLICATE, shared dist);
   unit/issue-165-batch-hoist-across-control-flow (E-SQL-004/E-ERROR-002/E-THROW-NOT-IN-SCRML);
   unit/lift-concurrent-transitive-tdz (E-SQL-MULTIPLE-STATEMENTS — `CREATE …; SELECT …`, newly refused S456);
   unit/error-handler-const-bind-r25-bug-49 (documented false positive E-SERVER-FN-IN-SYNC-CALLBACK);
   unit/failable-match-ok-arm-peter-21 (E-ERROR-002); unit/s454-callref-handler-rejection (E-STATE-UNDECLARED in EB_PRE);
   integration/cg-006-server-only-body-leak-regression, integration/nested-fn-sql-escalation-regression (E-SCHEMA-004,
   no test.db); integration/tilde-gaps-567, integration/tilde-snapshot-codegen-fix, integration/s95-bug-2-engine-payload-variant;
   browser/g-item-derived-local-stale-in-per-item-effect-paths (E-FN-003; mounts in-memory outputs + new `result.runtimeSource()`).
B. Intentional error, pins recovery / fail-closed codegen PAST the error → in-memory read + assert nothing written:
   unit/s441-declared-prose-body, unit/s441-review-fixes, unit/render-by-tag-compound-member-non-lexical,
   unit/match-arm-shapes-f12-f14 (diagnostics only; dist absent), unit/server-keyword-eliminate-d1,
   unit/schema-holes-fail-closed + unit/tenant-floor-raw-ddl-schema ("FAIL-CLOSED even past the error" pins),
   integration/foreign-slice-lexing (E-ATTR-INTERP-EXECUTABLE), integration/protect-error-egress (round 6e: drives the
   refused compile's in-memory server + html at run time — defense in depth), integration/s457-url-scheme-runtime-guard
   (sample phase1-use-named-012 is E-COMPONENT-035), browser/browser-lift-body-lowering (E-ASSIGN-004 lowering pin).
C. Fixture was simply wrong (not what the test is about) → FIXED so it compiles clean (write phase is under test):
   unit/typed-array-no-rhs-default (`@text` → `@.text` in the `<each>` row), integration/f-compile-002-scrml-import-rewrite
   + integration/g-pure-module-server-emit (legacy `h1 "…"` / `p ${…}` → `<h1>…</h1>` / `<p>${…}</p>`,
   E-UNQUOTED-DISPLAY-TEXT / E-STMT-NO-EFFECT), integration/w-server-import-unemitted §3 (server fn wrote `@n` —
   E-RI-002; now returns TTL and the client writes the cell).
D. Pins of the OLD posture → FLIPPED, as their own comments instructed:
   commands/refusal-writes-no-dist "SCOPE PIN" (non-refusal hard error still wrote) → writes nothing;
   conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts "GAP PIN — the failing compile still writes the leaking
   artifacts" → EMISSION GATE, inverted (not deleted).
Tools: conformance adapter (write:false), corpus-compile-floor (write:false), perf scripts (write:false), hybrid.ts
(already refuses an erroring substitute), llm-efficiency validator (checks exit code first): unaffected.
corpus-emit-differential: failing sources now emit 0 artifacts — measured below. bundle-size-benchmark.js ignores
`errors` (a failing benchmark app now leaves no dist, so its size read fails loudly rather than measuring a broken
build); per-route-roles bench fixture compiles clean. LSP: no write path.
New API surface (in-memory only, not an artifact): `result.artifactsWritten`, `result.runtimeSource()`; serve JSON
`artifactsWritten`. No opt-in "write partial output" flag: nothing measured needs one.

## 2026-10-07 — landed + verified (commit 6ada7e611, then this doc)
- Found while migrating: adding a plain-string `runtimeJs` to the result broke control-flow-in-markup-reject
  (it scans every string field of the result for leaked text) — renamed to the function form `runtimeSource()`,
  matching `batchPlanJson` / `tokenSetJson`. And the post-gate `bundleStdlibForRun` call re-pushed the stdlib
  warnings `planStdlibBundle` had already pushed — sink removed, pinned ("reported ONCE", both outcomes).
- Pre-commit gate (unit+integration+conformance): 32034 pass / 0 fail. Full `bun test compiler/tests/`
  (post-commit): 34431 pass / 51 fail — base was 34402 / 53; the 2 fewer = TodoMVC env tests (dist now built by
  the hook's gauntlet step). My own full re-run set-diff vs base: 0 newly failing after the runtimeSource fix.
- `bun conformance/run.ts`: 1342/1392 pass + 50 xfail, 0 FAIL / 0 XPASS.
- CI browser gate `bun scripts/browser-baseline.ts --check` (run exactly, after pretest + TodoMVC compile):
  head 1 PASS ("48 asserted") / 2 "PARSER DISAGREES — bun 48, parsed 47"; base (git-archive copy) 1 PASS /
  1 PARSER DISAGREES. Same flake on base: the tier's one stdout line (`[scrml] W-NAV-CHUNK-LOAD-FAILED …`) is
  merged chunk-wise into stderr and can split a `(fail)` marker. stdout byte-identical base vs head (181 B).
  Not this change; worth its own gap (the merge is by chunk, not by line).
- `pretest` samples dist: byte-identical to base (`diff -r` incl. dotfiles).
- corpus-emit-differential (base = `git archive` copy of d5875e972, head = this worktree): 2421 sources both;
  compile outcomes IDENTICAL (1448 ok / 973 failed, 0 newly failing/passing, 0 diagnostic-CODE changes);
  artifacts 11877 -> 7075: all 7075 head artifacts present on base and byte-identical except 162 `.server.js`
  whose only difference is `_scrml_project_root` (the source tree's absolute path — two trees); 4802 removed,
  every one from a failing compile (0 from an ok source); effective syntax-failing artifacts 76 -> 0 (every
  broken artifact the corpus shipped came from a compile that had reported an error). Verdict line is
  INCOMPARABLE only because the archive copy has no git revision (the tool's provenance guard).
- corpus-compile-floor --check PASS; snippet-gate 122/122; regen-spec-index --check OK.
- facts.ts --check: STALE (FACTS.md is PA-owned): compiler/src 303,559 -> 303,656 lines (255 files),
  test files 1,626 -> 1,628. Base PASSES, so this PR's CI Facts gate needs the PA's regen.
- SPEC §2.2.1 provenance: the "impl#1 divergence (Nominal)" sentence now says impl#1 conforms (S457).
- Empirical (`.tmp/empirical.ts`, three refused programs): compile + build exit 1, output dir ABSENT, "No files
  were written" printed; serve POST /compile: errors returned, outputs {} , artifactsWritten false, dir ABSENT;
  a clean program through serve writes 5 entries. Base for contrast: every refused program wrote 5-6 entries
  through compile, build and serve. dev: pinned by the CLI test (last good build byte-identical, error served,
  recovers on fix) — red on base.

## 2026-10-07 — merged origin/main (#1346 placeholder token, #1347 string(url)) — clean auto-merge
- Both touched api.js / SPEC.md; auto-merged with no conflict (merge 671d1b7cb). #1346's token scrub runs on
  `cgResult` before the gate, so `runtimeSource()` returns scrubbed text; its two comments that said artifacts
  are "still written on the error path" corrected (fbd98d2b4).
- Post-merge: pre-commit gate 32142 pass / 0 fail; full `bun test compiler/tests/` 34539 pass / 51 fail (the
  standing browser-tier set; TodoMVC passing); conformance 1346/1396 + 50 xfail; SPEC-INDEX OK.
- FACTS (PA-owned) after merge: compiler/src 303,969 -> 304,066 lines (256 files); test files 1,628 -> 1,630.
