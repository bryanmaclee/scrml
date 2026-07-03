# sPA ss55 → PA · item 1/5 landed

**List:** `spa-lists/ss55-self-host-v2-lexer-completion.md` (self-host-v2 LEXER completion)
**Item:** 1 — slice-4a precise cooked-decode
**Status:** landed-on-branch
**Branch:** `spa/ss55` @ **`41aef81d`** (parent 1c7526f6 — clean linear base; 0 behind / 1 ahead of origin/main)
**Dev-agent branch (source):** `self-host-v2-slice4a` @ c6395a8b (file-delta'd in)

**Token-diff oracle:** `self-host-v2-lexer-slice4a.test.js` **49/49 green**; slices 1-3 **119/119 unchanged** (168/168 total). Independently re-verified in the spa/ss55 worktree (not just the agent's report). The oracle now diffs the **cooked** field on StringLit/TemplateChunk (impl#1 `token.cooked` vs impl#2 `token.kind.data.cooked`) — genuine cross-impl differential (compile→eval real emitter).

**Files (4):** `compiler/self-host-v2/lex.scrml` · `compiler/self-host-v2/progress.md` (slice-4a section appended) · `compiler/tests/integration/self-host-v2-lexer-slice4a.test.js` · `docs/changes/self-host-v2-lexer-slice4a/BRIEF.md`. self-host-v2/ is disjoint from main — file-delta re-integration is clean.

**Dogfood: ZERO NEW.** Notably RESOLVES the slice-2/3 open flag: `parseInt(hex,16)`, `String.fromCodePoint(cp)`, `Number.isNaN` are ALL host-supported + correctly lowered through the live emitter — no workaround. (Reused F1 `<program>` wrapper + F5 `: int` annotations only.)

**⚠ DEPLOY FINDING (PA action):** `isolation:"worktree"` did **not** provision a worktree for this dispatch — the dev-agent landed in the **main checkout on branch `main`** and self-rescued by manually `git worktree add`-ing `.claude/worktrees/self-host-v2-slice4a`. No main-checkout leak (verified: main's lex.scrml has 0 `scanEscape`, no slice4a test in main). Worth checking why the harness skipped provisioning; sPA is now briefing an explicit self-provision + pwd/branch-verify startup step for items 2-5.

Continuing down the list (item 2 = slice-4b BracketStack threading). Item 3 (slice-4c ErrorRecovery) will be **parked + escalated** — impl#1's lexer silently skips stray chars / truncates at EOF (no error token), which conflicts with item 3's "honest ErrorToken emission"; that's a design ruling for you, not an sPA call.
