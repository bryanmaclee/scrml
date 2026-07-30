# BRIEF (verbatim) — g-pgnotify-listen-case-split

**Dispatched:** S301 (bryan · ASUS) 2026-07-30 · base `1b978fe8`
**Agent:** `scrml-js-codegen-engineer` · model `opus` · `isolation: "worktree"`
**Footprint:** `compiler/src/codegen/emit-channel.ts` — disjoint from the concurrent
`if=` Phase-2 unit-1 dispatch (`emit-html.ts` + `emit-event-wiring.ts`), the
`E-CHANNEL-INSIDE-PAGE` dispatch (`symbol-table.ts`), and Peter's #263 (`emit-client.ts`).

---

Fix **`g-pgnotify-listen-case-split`** (HIGH, CONFIRMED-LIVE): a `<channel>` whose name contains any UPPERCASE letter `NOTIFY`s one Postgres channel and `LISTEN`s on another, so the `watches=` realtime feed delivers **zero rows, silently**.

Read the gap entry first: `docs/known-gaps.md`, heading `### G-PGNOTIFY-LISTEN-CASE-SPLIT`. It is part of the S282 **SPLIT-KEY-PAIR** bug class (a key built from a cell/channel NAME at write and rebuilt at read, split by a name transform) — that sweep found 14 more instances, 10 silent, and this is the one confirmed live. Read the class description in the ledger too; it will tell you what to check for.

## F4 STARTUP GATE — your literal first action
`pwd` MUST begin with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. Confirm `git rev-parse --show-toplevel` equals it and the tree is clean. **If any check fails, STOP and report.** Then `bun install` (worktrees do not inherit `node_modules`) and `bun run pretest`.

**PATH DISCIPLINE:** absolute paths under YOUR worktree root only; never `cd` into `/home/bryan/scrmlMaster/scrml`; use `bun --cwd "$WORKTREE_ROOT"` / `git -C "$WORKTREE_ROOT"`. First commit `WIP(pgnotify-case): start at $(pwd)`. Commit after every meaningful edit and keep an append-only timestamped `progress.md`.

## Locus — PA-located, VERIFY
`compiler/src/codegen/emit-channel.ts` — the `pg_notify('<notifyChannel>', …)` emission is around **:906** (inside the trigger DDL) and the `LISTEN` side is around **:920-947**. I located these by grep, **not** by tracing execution. Report whether the locus HELD, was REFINED, or was WRONG, and if you cannot state how execution reaches a line, say so.

## The mechanism to establish before fixing
Postgres folds **unquoted** identifiers to lower case. So the likely split is that one side interpolates the channel name into a quoted string literal (case preserved) and the other emits it as a bare identifier (folded). **Establish which side does which by reading the emitted SQL**, and quote the two emitted forms in your report. Do not guess — the fix direction depends on it, and the wrong direction produces a fix that looks right and still mismatches.

Prefer the direction that makes both sides agree **without** changing what the developer's channel name means at the scrml level. State explicitly whether your fix normalizes (lower-cases both) or quotes (preserves case on both), and why that choice is right rather than merely sufficient — quoting preserves author intent, normalizing is simpler but silently changes the wire name.

## Verify-before-claim (both directions, mandatory)
1. **REPRODUCE FIRST** on current `main` before changing anything: a `<channel>` with a camelCase name + `watches=`, and show the emitted `pg_notify(...)` string next to the emitted `LISTEN` statement, demonstrating they differ. Paste both. If it does NOT reproduce, STOP and report NOT-REPRODUCED with the evidence — do not fix a ghost.
2. **After the fix**, show the same two emitted forms now agreeing.
3. Add a test pinning the camelCase case specifically. An all-lowercase name already worked, so a lowercase-only test proves nothing.
4. **Sweep for siblings in the same file** — this is a known CLASS, not a one-off. If the same name-transform split exists on another key pair in `emit-channel.ts`, report it (fix it if it is the same one-line shape; file it if it is bigger).

## Done means
`bun test compiler/tests/{unit,integration,conformance}` green — the current baseline is **21597 pass / 0 fail**, do not regress it. Do NOT mark done on "tests pass" alone: item 2 above (the emitted-SQL diff) is the actual proof.

Out of scope — do not touch: `compiler/src/codegen/emit-html.ts`, `emit-event-wiring.ts`, `emit-client.ts` (all three are in other agents' live write-sets).

I will run the S239 adversarial pass on your diff after you report; you cannot invoke it in-agent. Stay resumable.
