---
from: S278-bryan (ASUS-Vivobook machine)
to: next scrml PA (the OTHER machine)
date: 2026-07-22
subject: claude-workflow repo is live — capture THIS machine's unique ~/.claude content for the union BEFORE install.sh
needs: action
status: unread
---

# The cross-machine `~/.claude/` workflow layer is now a repo

`bryanmaclee/claude-workflow` (private) holds the shared `~/.claude/` layer — forged agents (folded from the now-**retired** `claude-agents` repo), the workflow slash-commands, `statusline.sh`, `themes/`/`scripts/`, `CLAUDE.md` + `pa-global.md` + `agent-registry.md` + `design-insights.md`, and `hooks/`. The ASUS-Vivobook machine is migrated: those items in `~/.claude/` are symlinks into the repo (`install.sh` set that up).

## ⚠️ Do the UNION capture FIRST — do NOT run `install.sh` yet

The machines diverged (different forged experts, a slightly different statusline). `install.sh` symlinks the repo's versions over yours (backing yours up to `*.pre-workflow.bak`), so if you install before merging, THIS machine's unique agents/statusline features are only in a `.bak`. Capture them onto a branch first; the ASUS session merges the union into `main`; THEN install.

## Capture + push (run on THIS — the other — machine)

```bash
set -e
cd ~/scrmlMaster
git clone git@github.com:bryanmaclee/claude-workflow.git 2>/dev/null || (cd claude-workflow && git fetch origin)
cd ~/scrmlMaster/claude-workflow
MACHINE="$(hostname | tr -cd 'A-Za-z0-9-' | cut -c1-24)"
git checkout -B "incoming/$MACHINE" origin/main
mkdir -p "_incoming/$MACHINE"
cp -r ~/.claude/agents        "_incoming/$MACHINE/agents"
cp    ~/.claude/statusline.sh  "_incoming/$MACHINE/statusline.sh"      2>/dev/null || true
cp    ~/.claude/design-insights.md "_incoming/$MACHINE/design-insights.md" 2>/dev/null || true
cp    ~/.claude/agent-registry.md  "_incoming/$MACHINE/agent-registry.md"  2>/dev/null || true
# the agents dir may carry a nested .git (the retired claude-agents clone) — drop it so it stages as files
rm -rf "_incoming/$MACHINE/agents/.git"
git add "_incoming/$MACHINE"
git commit -m "capture: $MACHINE unique ~/.claude (agents + statusline + design-insights + registry) for the union merge"
git push -u origin "incoming/$MACHINE"
echo "Pushed incoming/$MACHINE. Tell the ASUS session; it merges the union into main. THEN run ./install.sh here."
```

## After the ASUS session merges the union

```bash
cd ~/scrmlMaster/claude-workflow && git checkout main && git pull --ff-only && ./install.sh
# restart Claude Code (agent defs are cached at boot); the statusline updates live.
```

`install.sh` backs up any existing `~/.claude/<item>` to `<item>.pre-workflow.bak` before symlinking — nothing is destroyed. Your pre-existing `claude-agents` clone at `~/.claude/agents` becomes `agents.pre-workflow.bak`; its content is already captured on your `incoming/` branch, so it's safe to leave or delete.

## Also (unrelated, from the S278 wrap)
- The held **Wave-1c pieces 2+3** branch `worktree-agent-a2ed001a5de228134` @ `8fd5fd07` is now on origin (was the ASUS-only stranded copy). Fetch + `git worktree add` per the board note.
- Pull BOTH scrml AND scrml-support before working. Next scrml arc unit is **U4** (`import()` nav loader → unblocks Wave-1c → #27).
