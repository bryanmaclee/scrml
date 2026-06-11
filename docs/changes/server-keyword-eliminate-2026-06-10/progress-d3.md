# D3 progress — Escalation-aware Migration 4 (`server function` → `function`)

Append-only. Worktree: `.claude/worktrees/agent-a8d51757f256bde29`.

## 2026-06-10 — startup
- Worktree verified; pwd starts with `.claude/worktrees/agent-`; show-toplevel matches; tree clean.
- Base HEAD == `bf4e51c4` == origin/main (D1+D2 already landed; `git merge origin/main` → "Already up to date").
- `bun install` OK; `bun run pretest` OK.
- Maps: read `.claude/maps/primary.map.md` in full. Load-bearing: migrate.js Migration 3 anchor (`pure`→`fn`) at `commands/migrate.js:197`; W-DEPRECATED-SERVER-MODIFIER from route-inference.ts (D2 added T7 channel-broadcast / T8 middleware-handle reasons).

## 2026-06-10 — Phase 0 survey findings

### 1. W-DEPRECATED-SERVER-MODIFIER span shape
- Emitted at `route-inference.ts:3217-3227` (Step 5d, the D5 loop). Span passed = `record.fnNode.span` — the FUNCTION DECL node span, NOT a keyword-only span.
- `fnNode.span` for a top-level `server function NAME(...)` is `spanOf(startTok, peek())` (ast-builder.js:9599) where `startTok` is the `server` KEYWORD token (consumed at :9406). So `span.start` points AT the `server` keyword for a bare `server function`.
  - For `pure server function` / `async server function`, `startTok` is the `pure`/`async` token (:9387/:9399), so `span.start` is before `server`.
- DESIGN DECISION: do NOT depend on span.start landing exactly on `server`. Anchor the strip on the W-DEPRECATED span, then SEARCH FORWARD from `span.start` for the `server` keyword immediately followed by `function` (+ NAME), and strip the `server ` there. Same approach as `rewriteGivenGuardArrows` (find-glyph-at/after-span.start). String/token-boundary-aware.
- Generators (SSE `function*`) are NOT skipped by the D5 fire-path (isGenerator only gates W-DEAD-FUNCTION at :3136). So a SQL-bearing `server function*` WOULD fire W-DEPRECATED → the `function*` exclusion in Migration 4 is REQUIRED (brief-confirmed).

### 2. migrate.js compile-diagnostic infra
- `sanityCheckParse` (:1945) already stages the rewrite in-place + calls `compileScrml({ inputFiles:[path], write:false, gather:true, log:()=>{} })` then restores. It returns only blocking ERRORS (filters out warnings).
- For Migration 4 I need `result.warnings` (W-DEPRECATED) of the ORIGINAL source. Approach: a sibling staged-compile helper `gatherDeprecatedServerWarnings(source, path)` mirroring sanityCheckParse's stage/compile/restore, returning the W-DEPRECATED-SERVER-MODIFIER diagnostics (code + span).
- Migration 4 belongs in the `--fix` tier (migrateFile Step 1, after the colon-shorthand rewrite), NOT pure-text `applyMigrations`. Brief is explicit + corrects SCOPE.md line 38. Mirrors rewriteMatchArmArrows/rewriteGivenGuardArrows/rewriteColonShorthandPlacement (:263/:375/:541), each returns `{ rewritten, changed, count }`.

### 3. Docstring collision + label
- migrate.js:8-22 docstring labels BOTH `pure` (line 11/12) "3." AND program-shape (line 16) "3." — pre-existing collision (per brief/lens-1).
- Chosen label for the new migration: **"Migration 4"** (the SCOPE.md + brief name; no existing "4." label in either docstring block). Update BOTH blocks (header docstring + printHelp).

### The strip predicate (load-bearing invariant)
- For each W-DEPRECATED-SERVER-MODIFIER fire-site: from `span.start`, scan forward over `pure`/`async` modifier words + whitespace to find a `server` word-token whose next word-token is `function` (NOT `fn`, NOT `function*`). Strip `server` + the following whitespace run.
- EXCLUDE `function*` (SSE) by checking the char(s) after `function` is `*` (possibly via whitespace) — never strip. Belt-and-suspenders: never strip when the keyword after `server` is `fn`.
- W-DEPRECATED never fires on `server fn` (no other trigger when pure) → auto-preserved.
- W-DEPRECATED never fires on a keyword-only-no-trigger `server function` (the client-flip DANGER) → left untouched.

## 2026-06-10 — implementation + wiring + tests

- Migration 4 impl `rewriteServerFunctionKeyword` + `gatherDeprecatedServerWarnings` landed (commit 0a9c7079). Diagnostic-driven: staged-compile (mirrors sanityCheckParse option-β) → collect W-DEPRECATED-SERVER-MODIFIER fire-sites → span-anchored strip of `server ` from each `server function NAME(`.
- Strip predicate: from W-DEPRECATED span.start, scan past `pure`/`async` modifier words to the `server` keyword; require next word == `function` (NOT `fn`); EXCLUDE if a `*` follows `function` (SSE deferred); strip `[server-start, function-start)` (the `server` kw + its trailing ws). Right-to-left apply with a `/^server\s+$/` fail-safe re-check.
- Fixed a JSDoc hazard: `W-*/` in a comment prematurely closed the `/** */` block → replaced `W-*/` with `W-* ` (semantically identical, no comment-close).
- Wired into migrateFile Step 1e (after colon-shorthand); threaded `totalServerFnKeyword` accumulator + `+= ?? 0` + summary line (commit b0a205eb). Pre-commit gate GREEN.
- Both docstring blocks updated: header docstring Migration-3 label collision FIXED (numbered chain now 1/2/3/4; `--fix` + `--program-shape` as gated sub-sections, no duplicate "3."); Migration 4 added. printHelp Optional-migrations list + `--fix` option text updated.
- Test file `compiler/tests/commands/migrate-server-keyword.test.js` — 12 tests, 9 sections, ALL PASS:
  - §1 SQL-body → STRIPPED (count 1). §2 `server fn` → UNTOUCHED. §3 SSE `server function*` (with SQL) → UNTOUCHED (exclusion). §4 keyword-only stub → UNTOUCHED (client-flip danger). §5 channel publisher (T7) → STRIPPED. §6 handle() (T8) → STRIPPED. §7 idempotency → 0 on re-run. §8 composition M2(<machine>)+M3(pure)+M4 via migrateFile --fix (dry-run + in-place, compiles). §9 no-client-flip — stripped SQL stays in serverJs NOT clientJs; channel + handle still compile.
- Composition fixture fix: engine body needed the compiling transition-only `.Idle => .Done` shape (the MACHINE_FIXTURE shape), not a render-state engine (which needs state-children → E-ENGINE-STATE-CHILD-MISSING).
- Empirical verification (smoke probes): clientJs has SQL 'secretcol' = false; serverJs has it = true (no client-flip after strip). routeMap is NOT on the top-level compileScrml return — used the `{ clientJs, serverJs }` output record for the leak check instead.
