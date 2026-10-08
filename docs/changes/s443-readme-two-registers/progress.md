# s443-readme-two-registers progress

- [x] startup verified, BRIEF archived
- [x] new flagship `docs/readme-snippets/tasks.scrml` (old `tasks-app.scrml` served a 302 to a missing /login; left in place — an integration test reads it)
- [x] served + driven in Chromium (Playwright): add, duplicate rejection, toggle, filters, two-tab channel sync, persistence, CSRF 403 without token
- [x] five gated "today" files (`today-*.scrml`), each compiled and driven in Chromium
- [x] README rewritten: banner removed, dev note updated, four linked flagship pieces, "Where the language is going" (5 pairs), "Everything" re-verified
- [x] `README.md` added to `DRIFT_REQUIRED_DOCS` (scripts/snippet-drift.js); drift check proven to fail on a one-line README edit
- [x] snippet-gate: 128 passed, 0 failed; drift 27 blocks / 0 failures
- [ ] push branch

## S459 revive

- 2026-10-08T15:30Z branch s459-readme-revive cut from origin/worktree-agent-a8fca83a59f6533ba; `git merge origin/main` (a merge, not a rebase). 3 README conflicts: two were main's arm-pipe rewrite of the OLD README's code (PR text kept); in the contexts table's Error row I took main's fact (`!{ .V :> ... }`: the `|` lead is deprecated, W-ARM-PIPE-LEGACY). FACTS.md auto-merged; `facts.ts --check` PASS. Merge commit 74d6836de.
- 2026-10-08T15:50Z `scrml fix` (default rules) on docs/readme-snippets/tasks.scrml: arm-pipe (`| ::Duplicate` → `::Duplicate`), sql-failable (`loadTasks` read gets `!{ _ :> [] }`), client-server-call (`load`'s `loadTasks()` gets `!{ .Transport(_) :> { return } }`). Line count unchanged, so the README ranges are unchanged; README copies resynced; drift 27/0. Left for a human by the fixer: `insertTask`'s `!{}` has no `.Transport` arm; `flipTask` called in a value position (`replaceRow(flipTask(id))`); the UPDATE write is unhandled. All compile today (E-ERROR-002 for these is in the SPEC but the compiler does not fire it yet).
- 2026-10-08T16:05Z server smoke on the fixed tasks.scrml: db-migrate creates the table; dev serves; loadTasks [] → insert "milk" → duplicate returns TaskError.Duplicate → flip sets completed_at → load returns the row; no CSRF token → 403.
- 2026-10-08T16:12Z README fact fixes: CLI verbs 11 → 12 (`fix` joined; FACTS.md); removed the "class/async at program top level come out as page text" gap (now E-CLASS-NOT-IN-SCRML / E-ASYNC-NOT-IN-SCRML, probed); conformance "a handful of known, pinned defects" → "known defects, each pinned to a tracked gap" (xfail-pinned cases: 7 at PR time, 50 now).

## S459 tighten

- 2026-10-08T16:41Z — setup: branch s459-readme-tighten from 172247211; brief copied to S459-TIGHTEN-BRIEF.md
