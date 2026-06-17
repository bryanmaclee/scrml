# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

No deputy instance is running yet — this is the stub the first deputy boot initializes. The deputy
keeps the three fields below current each maintenance tick.

---

## Deputy status

- **State:** NOT YET BOOTED (stub; awaiting first `"you are the vPA deputy, read scrml-support/vpa-scrml.md and boot"`).
- **Last-absorbed delta seq:** — (set on first absorb; the delta-log is at `handOffs/delta-log.md`)
- **`deputy-maint` branch tip:** — (set on first commit; `git worktree add` it off main at boot)
- **Owed maintenance:** none recorded (the deputy lists outstanding maps/changelog/state.ts/flograph work here)

## Maintenance seams (Function 2 — the deputy's live surface)

- `.claude/maps/*` — `project-mapper` incremental on the session's changed files; watermark in `.claude/maps/primary.map.md`.
- `docs/changelog.md` — append/extend the current session block.
- `@generated` §0 rollup in `docs/known-gaps.md` + `master-list.md` §0.6 `@generated:recent-sessions` — `bun scripts/state.ts --write` (gate with `--check`).
- flograph + dock projection — `scripts/flograph.ts`.
- block-lease registry — (the dock's parallelism follow-on; not built yet).

## Cross-refs

- `scrml-support/vpa-scrml.md` — the deputy contract (boot, surface partition, commit protocol, re-hydration, narrow-role rule).
- `scrml-support/pa-scrml.md` §"S199 addendum — vPA deputy (PA side)" — the PA-side contract.
- `handOffs/delta-log.md` — the live PA-state stream the deputy absorbs.
- `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — the design.
