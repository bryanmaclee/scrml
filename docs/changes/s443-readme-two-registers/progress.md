# s443-readme-two-registers progress

- [x] startup verified, BRIEF archived
- [x] new flagship `docs/readme-snippets/tasks.scrml` (old `tasks-app.scrml` served a 302 to a missing /login; left in place — an integration test reads it)
- [x] served + driven in Chromium (Playwright): add, duplicate rejection, toggle, filters, two-tab channel sync, persistence, CSRF 403 without token
- [x] five gated "today" files (`today-*.scrml`), each compiled and driven in Chromium
- [x] README rewritten: banner removed, dev note updated, four linked flagship pieces, "Where the language is going" (5 pairs), "Everything" re-verified
- [x] `README.md` added to `DRIFT_REQUIRED_DOCS` (scripts/snippet-drift.js); drift check proven to fail on a one-line README edit
- [x] snippet-gate: 128 passed, 0 failed; drift 27 blocks / 0 failures
- [ ] push branch
