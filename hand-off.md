# scrml — Session 468 (bryan · theRog) — LIVE

> Rotated: S467's hand-off → `handOffs/hand-off-467.md` (read it — its NEXT-SESSION PICKUP is still the plan).
> Board: `scrml-support/handOffs/active-sessions/S468-bryan.md`. Rulings: `scrml-support/user-voice-scrml.md` §S468.

## Machine — theRog (`/home/bmacs`), FIRST BOOT (set up S468)
- Cloned this session: scrml, scrml-support, flogence (siblings under `~/scrmlMaster/`). NOT here: scrml-native,
  giti, 6nz, scrml8, RediLedger, scrml-site.
- bun 1.4.3 (mise, global) · node 26.8.2 · gh authed (REST OK; GraphQL was 502-ing at boot) · `gh auth setup-git`.
- Hooks: **config A** (`core.hooksPath = scripts/git-hooks`). No config-B local-rich setup exists on this machine.
- `~/.claude/agents/` populated from `scrml-support/agents/` (home prefix rewritten to `/home/bmacs/scrmlMaster`).
  ⚑ Agent defs load at session START — `scrml-js-codegen-engineer` is NOT dispatchable in S468 (fallback:
  general-purpose briefed to read and follow `~/.claude/agents/scrml-js-codegen-engineer.md`).
- ⚑ `~/.claude/hooks/path-discipline.sh` (the PreToolUse Edit/Write worktree guard) does NOT exist here and is not
  version-controlled anywhere. Overlay paths (`/home/bryan-maclee/...`) do not match this machine.
- flogence.db seeded: `graph:import` (3792 rows) + `ensureFspSchema` (scripts/fsp-core.ts) + `fleet --add scrml ../scrml`.
  A fresh clone's `digest` otherwise fails E-PA-004 (partial schema) → `fleet` can't compile to self-register.

## ⏭ PICKUP
See `handOffs/hand-off-467.md` §0–§2. Correction to it: **#1435 (CPS P0) is MERGED** (`0083fc156`). #1434 (await
P0) is open, 3 behind main (#1433 #1435 #1436) with overlapping files; tip `933c6e51a` (shadow-fix) has no CI run.
