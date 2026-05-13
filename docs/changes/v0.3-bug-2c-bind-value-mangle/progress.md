# Bug 2c — bind:value=@x HTML serialization mangle in expanded component bodies

## Progress log (append-only)

### 2026-05-12 — Startup

- Verified worktree root: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-af755e362a047a454`
- `bun install` + `bun run pretest` both pass.
- Read maps + briefings + primer §4/§13.7/§13/L17 + SPEC §5.4.1 bind-dispatch table.
- Pre-existing observation: worktree base is `7a00b1b` (S86 wrap). The Bug 2a if-chain fix (`547566a`) is NOT on this branch. main has it. To reproduce Bug 2c via 05-multi-step-form requires Bug 2a's expansion fix to be active. Approach: build a minimal repro that triggers component expansion via a DIRECT `<MyComp/>` call (no if-chain), which is unaffected by Bug 2a.
