# progress — s457-unquoted-values-and-event

Append-only. Times local (2026-10-07/08).

## startup
- worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1d9d34bac78c568c`, base `0c1a1b081` = origin/main (#1345 merged).
- bun install + pretest OK (samples/compilation-tests/dist populated). Brief archived as first commit 48ae2d61a.
- Frozen base copy for differentials: `.tmp/base` (git archive HEAD); corpus capture via `scripts/corpus-emit-differential.ts`.

## repro on base (0c1a1b081)
- `onclick=@count = @count + 1` -> `_scrml_cs_reactive_set("count", _scrml_cs_reactive_get("count"))`, exit 0 (the `+ 1` dropped).
- `if=fn(1).ok` -> E-CODEGEN-INVALID-LOGIC (`if ((function(1)))`) — loud, but the condition is lost.
- `title=fmt(1).trim()` -> `title=fmt(1)` wired as a "title" EVENT LISTENER + a stray `trim` attribute, exit 0.
- `onclick=fn(1) .then(g)` -> handler `fn(1)` + stray `then g` attributes, exit 0.
- `onclick=@big = @n > 1` -> handler `big = n`, ` 1>` leaks into the body text, exit 0.
- `title=@msg + "x"` -> `<p title="msg" x>`, exit 0.
- `oninput=f(event.target.value)` / `onclick={ f(event.type) }` / `onclick=${ f(event.type) }` -> all wrapped `function(event) { … event … }`.
- call-ref ARGS are never scope-checked (`onclick=f(nope)` compiles clean) — pre-existing, noted.
- #1345 did NOT rename the handler wrapper parameter (`function(event)` at every site).
