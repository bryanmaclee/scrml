---
from: S282-bryan (bryan-maclee-ASUS-Vivobook)
to: next scrml PA on bryan-XPS-8950
date: 2026-07-22
subject: claude-workflow union is MERGED — you can install now
needs: action
status: unread
---

# The union is merged. Install when convenient.

`claude-workflow` `main` is at **`c0bdf5e`** with the union of both machines' live `~/.claude`
layers — **19 agents**. Your `incoming/bryan-XPS-8950` capture is fully absorbed; the branch can
be deleted whenever you like.

```sh
cd ~/scrmlMaster/claude-workflow && git checkout main && git pull --ff-only && ./install.sh
# then restart Claude Code
```

**This unblocks your codegen dispatches.** Per the S280 hand-off, `scrml-js-codegen-engineer`
was not installed on your clone, so every codegen dispatch there was taking the documented
`general-purpose` fallback. After install it is available.

## What the merge decided, and why (so you can audit it)

Measured rather than assumed, per file:

| file | disposition |
|---|---|
| `_shared-directives`, `agent-forge`, `agent-registry` (agents/) | byte-identical — no decision needed |
| `project-mapper` | **yours won** (+29 lines) — it carries the `Task-Shape Routing` and `Use feedback loop` sections that `pa-base §5` and the overlay's `{{maps_fills}}` both depend on; the ASUS copy had lost them |
| `resource-mapper` | **ASUS won** — your copy predates the S200 rename and still says `scrmlTS`/`scrml` where the tree is now `scrml`/`scrml-native` |
| 11 XPS-only agents | added to `claude/agents/` |
| `design-insights.md` | **merged, not replaced** — see below |
| `agent-registry.md` (root) | left at ASUS's version; it is a generated artifact and is now stale against a 19-agent set. Run `/registry` REBUILD |

**`design-insights.md` was NOT a superset in either direction.** The ASUS copy is larger (332 vs
162 lines) but had **dropped 8 April-2026 entries that survive only on your machine** — `reflect(variable)`,
`^{}` expansion timing, multi-block `^{}` coordination, TodoMVC fine-grained reactivity, type-encoded
variable names, the scrml tutorial rewrite's four ratified decisions, machine-cluster expressiveness,
and multi-block `^{}` lifecycle composition. They are appended verbatim under a marked
`# Recovered entries — bryan-XPS-8950 (S282 union merge)` heading. They belong earlier in
chronological order — re-sort at leisure.

**`claude/agents-store/` is deliberately UNTOUCHED**, so no retirement is reversed. Note that 5 of
the 11 promoted agents also exist there: `gauntlet-overseer` and `scrml-scribe` are byte-identical
to their store copies (pure activations), while `qwik-resumability-expert`, `scrml-voice-author`
and `solid-js-signals-expert` **diverge** from their store copies — so the live versions carry
content the store does not. Prune any you do not want live; nothing is lost either way.

## Two things from your own last session, checked from here

1. **"`main` fails its own pre-commit gate"** (S281 §3) — **does not reproduce on this clone.**
   Local gate at `a0344d75`: 21129 pass, 0 fail, 219s. So it is XPS-clone-local, most likely stale
   gitignored artifacts (`bun run pretest` / `samples/compilation-tests/dist/`) rather than anything
   in the tree. Worth re-running `bun run pretest` there before trusting a red local gate.
2. **#141 is merged.** `fix/each-multi-root` reached origin after you closed, and PR **#150** merged
   at **`d3e961de`**. The PA re-verified it independently before merging (your reproducer, executed
   in a real DOM, both trees) — your verification held up exactly. GH #141 is closed with the SHA.
   The retained worktree `agent-a14165e93444dcd12` can be released.

## Where main is now

`e8fdd44c`. Since your close: #150 (#141 fix), #151 (**the `windows` CI job is green for the first
time** — 6 test-side path assumptions in the ESM arc), #152 (`tracking` 15 → 9; the 6 local failures
were fixtures stale since S264's `E-SQL-004`).

`chunk-namespacing` is dispatched and in flight — the real cross-chunk soft-nav gate, module-format-
agnostic, which unblocks BOTH the held classic Wave-1c loader and ESM U4. Do not start nav work
against it until it lands.
