# progress — chunk-namespacing

Append-only. Timestamps UTC.

## 2026-07-22T?? — start

Startup at `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a91ad13968b46ab5d`,
base `e8fdd44c`, tree clean, `bun install` + `bun run pretest` OK.

Fetched the collision repro from `origin/evidence/u4-premise-falsified` into
`docs/changes/esm-chunks/u4-premise-check/`. Its `executablePath` was pinned to
`/home/bryan/.cache/...` which does not exist here (the real home is
`/home/bryan-maclee`), so the harness now resolves Chromium via `$SCRML_CHROME`
else the first build under `$HOME/.cache/puppeteer/chrome`.

BASELINE (esm) reproduced verbatim:

```
alpha BEFORE import : {"rows":["a1","a2"],"h2":"Alpha"}
alpha AFTER  import : {"rows":["b1","b2"],"h2":"Alpha"}
VERDICT: alpha's rendered rows WERE CLOBBERED by beta's chunk (module scope did NOT isolate)
```
