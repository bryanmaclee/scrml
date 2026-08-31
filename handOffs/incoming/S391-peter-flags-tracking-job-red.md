# Flag → bryan: the `tracking` CI job went RED (7 fails) — your #724 dev-watcher + S385/S390 each-scope lane

**From:** S391-peter · **Kind:** CI-red flag with root-cause bounds (not a fix; your lane). Surfaced merging the S391-peter continuity PR **#798**.

## What I observed (facts)
- On **PR #798**'s CI run, the **`tracking`** job (non-required "promotion candidates" suite: integration + lsp + commands) was **RED — 7 fails** (3887 pass / 52 skip / 4 todo / 7 fail). Required jobs `gate` + `windows` were **SUCCESS**, so #798 (docs-only) squash-merged on the required gate — state UNSTABLE, not BLOCKED.
- **#798 was docs-only** (delta-log + `handOffs/incoming/` route notes). It is incapable of causing a compiler/dev-server test failure → the 7 live in the **base** (`63f4e3e5`, your recent [1970]-[1986] work) or are timing flakes, not in #798.

## The 7 failures
1. `(fail) S385 — supported mount positions stay accepted AND fully wired > OUT-OF-SCOPE GUARD — <each in=@undeclared> is still not checked` — your known each-scope gap (`g-each-opener-at-read-over-non-reactive-binding` family). An assertion for a guard not yet built.
2–6. **Five dev-watcher / hot-reload tests** — your `#724` dev-server lane, all 10s+ filesystem-watch timeouts:
   - `dev watcher debounce is BOUNDED … edit under 40ms sibling churn detected < 2s` [10393ms]
   - `§1 compileScrml THROW under the watcher → fail CLOSED (500)` [10418ms]
   - `§2 delete-then-restore → recompiles + serves 200 without restart` [10417ms]
   - `§3 atomic save (tmp+rename) keeps hot-reload alive` [10407ms]
   - `scrml dev serves a recompiled server fn without a restart (#724)` [12482ms]
7. `§52.13 — auth-required document is gated in the served-document dispatch` (dev/prod parity) [9.85ms].

## What I could NOT determine (the honest bound — this is why it's a flag, not a verdict)
Whether the 5 dev-watcher fails are a **real regression** in your post-`952cecc6` commits or a **timing flake** on #798's runner. I could not disambiguate from CI history: the last main-commit CI run I can see (`952cecc6`) was green, but the intervening commits + the #798 base have **no inspectable per-commit CI runs** (squash-merge keeps checks on the PR head), and **main pushes don't trigger CI** (only PRs do), so there's no fresh run on current HEAD `635c8193` to compare.
- 5 dev-watcher tests failing *together* leans real over flake (random flake usually hits 1–2), but they ARE the timing-sensitive class that can all miss deadlines on a slow runner.
- Fastest ground truth: your next PR's `tracking` run, or re-run the dev-watcher suite on Linux. If they clear on a re-run with no code change → flake; if they stay red → a `#724` regression.

No action owed by me — flagging because a green→red on the required-adjacent `tracking` job in your lane is worth your eyes, not a silent non-required skip.
