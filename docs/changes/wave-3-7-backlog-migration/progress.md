# Wave 3.7 §4 backlog migration — progress

- start: base SHA 9b98118 (head). Audit doc opened. Items M-1..M-10 enumerated.
- false start: first round of edits accidentally landed in the main checkout (`/home/bryan-maclee/scrmlMaster/scrmlTS/...`) instead of the worktree (`/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a7d425362367b1bcc/...`). Reverted with `git checkout HEAD -- <files>` in the main repo (left pre-existing dirty paths alone). Worktree clean. Restarting edits inside the worktree.
- M-1: `examples/23-trucking-dispatch/components/driver-card.scrml` migrated (6 sites). Compiles clean. Committed `9516994`.
- M-2: `examples/23-trucking-dispatch/components/load-card.scrml` migrated (4 sites). Compiles clean. Committed `e6fc83e`.
- M-3: `examples/23-trucking-dispatch/components/customer-card.scrml` migrated (4 ternaries). Compiles clean. Committed `605ebb1`.
- M-4: `examples/23-trucking-dispatch/components/invoice-card.scrml` migrated (9 sites — heaviest-drift file). Compiles clean. Committed `ab81a66`.
- M-5: `examples/23-trucking-dispatch/models/auth.scrml` migrated (2 `return null` -> `return not`, 2 JSDoc references, plus tightened `if (!cookieHeader)` -> `if (cookieHeader is not)` and `if (!token)` -> `if (token is not || token == "")`). Compiles clean. Committed `e23b01c`.
- M-6: `examples/14-mario-state-machine.scrml` — file-top `#{}` block + line-17 comment deleted; root `<div>` gets `font-mono bg-[#1a1a2e]` Tailwind utilities (audit option a). Compiles clean. Committed `1d405c7`.
- M-7: `docs/PA-SCRML-PRIMER.md:90` `default=null` — SKIPPED. Per task brief: `null` in markup `default=` / `value=` attributes is canonical per S89 audit finding on SPEC §6.4. Do not touch.
- M-8: `docs/articles/llm-kickstarter-v1-2026-04-25.md` login() rewritten to failable shape: `type LoginError:enum = { UnknownUser, InvalidPassword }` + `server function login(...)! -> LoginError { ... fail LoginError::UnknownUser ... fail LoginError::InvalidPassword ... }`. Notes section adds a bullet on the `!{}` caller arm. Committed `d0809d7`.
- M-9: `docs/articles/llm-kickstarter-v2-2026-05-04.md:243` `default=null` — SKIPPED for same reason as M-7.
- M-10: `docs/articles/llm-kickstarter-v2-2026-05-04.md` login() rewritten to failable shape (mirror of M-8). Committed `9cdcf8f`.

## Disposition summary
- 8 of 10 §4 items CLOSED (M-1 through M-6, M-8, M-10).
- 2 of 10 §4 items SKIPPED as canonical per S89 audit finding (M-7, M-9 — `default=null` in markup attributes).
- Kickstarter login() disposition: structural rewrite to failable-fn `! -> LoginError` (audit M-8 option b, the right answer per pa.md Rule 3 — the kickstarter is the load-bearing dev-agent brief).
- Tests: pre-commit hook ran the test suite after every commit. 0 fail throughout (11170 pass / 88 skip / 1 todo each run).
