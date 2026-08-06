# gh357-session-sql-interpolation — progress log (append-only)

Worktree: C:/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/gh357
Branch: fix/gh357-session-sql-interpolation (off main @ d8044cf2)

## 2026-08-05 — startup
- Confirmed toplevel == worktree root, clean status, branch correct.
- `bun install` (with PUPPETEER_SKIP_DOWNLOAD=true — Windows puppeteer postinstall fails otherwise, matches CI windows-job) OK.
- `bun run pretest` OK (populated samples/compilation-tests/dist/).
- Read BRIEF (+ dpa-021 revision header, which GOVERNS), dpa-021 artifact, primary.map.md.

## Root cause — HELD (verified by execution + emitted artifact)
- Reproducer compiled on pre-fix baseline: ordinary `session.isAuth` lowers to
  `_scrml_req._scrml_sess.isAuth` (AST member), but bare `session.userId` inside a `?{}` SQL
  interpolation survives as a free variable.
- Execution harness (real handler, seeded session store + csrf/sid cookies, seeded sqlite):
  PRE-FIX => `THROWN: ReferenceError: session is not defined`.
- Blast-radius probe pre-fix (one `?{}`, four ambients):
  `@currentUser.id`->`_scrml_currentUser.id`; `@uid`->`_scrml_body["uid"]`;
  `route.query.id`->`route.query.id`; `session.userId`->`session.userId` (BARE — the bug).

## _scrml_sess object shape (read at emit-server.ts:2419-2454)
- getters: userId/role/isAuth; methods: set(k,v)/get(k)/destroy(); RAW props: sid,_rec,_changes,_dirty,_destroy,_reset.
- `.get(k)` reads inner `_rec[k] ?? null`. A RAW bind would make `session[k]` read raw props
  (sid,_rec incl csrfToken) and `session[customKey]` read undefined — confirming the dpa-021
  confidentiality hazard. => Proxy binding required.
