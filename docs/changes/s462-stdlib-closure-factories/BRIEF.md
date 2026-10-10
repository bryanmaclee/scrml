# BRIEF — s462-stdlib-closure-factories

Change-id: `s462-stdlib-closure-factories`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (quote, do not reinterpret)
bryan S462 "go on the package" (scrml-support/user-voice-scrml.md §S462, the "no-function-in-value migration" entry; and the preceding "no value holds a function" entry): stdlib object-of-closures factories MIGRATE to a config struct + free functions; the oauth adapter protocol becomes an enum tag oauth matches on. A function is never STORED in a value (§14.3, extended S462); functions are PASSED and CALLED. This is a public stdlib API change.

## Sites (from the Phase-1 measurement — `docs/changes/s462-no-function-in-value/progress.md` on branch `worktree-agent-af4160785d7ecd763`; `git fetch origin worktree-agent-af4160785d7ecd763` may not exist remotely — the file is also readable at `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-af4160785d7ecd763/docs/changes/s462-no-function-in-value/progress.md`, READ-ONLY)
- `stdlib/http/index.scrml` ~:150, :193, :199, :221, :231 — `withBaseUrl` / `withAuth` / `withDefaults` return `{ get, post, put, del, patch }` closures.
- `stdlib/auth/index.scrml` ~:53 — `createRateLimiter()` returns `{ check(key){…}, reset(key){…} }` (state in a closed-over Map).
- `stdlib/oauth/index.scrml` ~:97 — `memoryAdapter()` returns `{ put, get, del }`; the storage-adapter PROTOCOL is an object of methods (callers inject a production adapter).
- `stdlib/store/kv.scrml` ~:213 — `createCounter()` returns `{ increment, decrement, reset, … }`.

## Design (PA direction; deviations reported, not silent)
- http: `withBaseUrl(url)` / `withAuth(...)` / `withDefaults(...)` return a plain config STRUCT (`{ baseUrl, headers, timeout, … }`); new free functions take it first: `get(client, path, opts)`, `post(client, …)` etc. — keep the existing top-level `get(url)`/`post(url)` working (decide the naming so both coexist cleanly; report).
- auth `createRateLimiter`: returns a config/state struct; `check(limiter, key)` / `reset(limiter, key)` as free functions; the per-key counter state lives where scrml state lives (a cell, the kv store, or a value returned and passed back — choose the one that keeps the current semantics and concurrency behaviour; report).
- oauth: the adapter becomes an enum `OAuthStore` (e.g. `.Memory`, plus whatever production backends the module already anticipates — read the module + SPEC §41 oauth text; do not invent backends it doesn't mention; if the "caller injects a production adapter" use case cannot be expressed by an enum tag, STOP and report — that is a ruling).
- kv `createCounter`: same pattern.
- Each change: SPEC §41 API text updated (find the per-module sections), stdlib tests updated, docs/kickstarter/website API mentions updated where they show these factories (grep), `docs/known-gaps.md` if anything is left.
- Old API: does it need a §63 window (W-lint + reserved E + `scrml fix` rule)? These are stdlib FUNCTIONS, not language forms — PA reading: no §63 window; a straight API change with a changelog note. If you find adopter call sites (flogence/giti/6nz — READ-ONLY, grep + compile) report them with a migration note; do not edit sibling repos.
- Do NOT add the E-VALUE-FUNCTION-STORED refusal itself (a later dispatch). Your stdlib must simply not store functions in values when you're done — verify with the Phase-1 prototype patch (`.claude/worktrees/agent-af4160785d7ecd763/docs/changes/s462-no-function-in-value/phase1-prototype.patch`, apply in your scratch copy only, never commit it): stdlib sites = 0.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-stdlib-closure-factories): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-stdlib-closure-factories/` · full suite + conformance + browser-tier + types:check · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · per-module API before/after (signatures) · state placement choices · adopter call sites found · prototype re-measure (stdlib 0) · direction-setting choices for bryan's veto.
