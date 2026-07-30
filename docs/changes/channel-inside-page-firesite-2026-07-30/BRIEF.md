# BRIEF (verbatim) — g-channel-inside-page-never-fires

**Dispatched:** S301 (bryan · ASUS) 2026-07-30 · base `1b978fe8`
**Agent:** `scrml-js-codegen-engineer` · model `opus` · `isolation: "worktree"`
**Footprint:** `compiler/src/symbol-table.ts` (SYM PASS 15) — disjoint from the concurrent
`if=` Phase-2 unit-1 dispatch (`emit-html.ts` + `emit-event-wiring.ts`), the pgnotify
dispatch (`emit-channel.ts`), and Peter's #263 (`emit-client.ts`).

**PA pre-work that unblocked this:** the in-code comment at `symbol-table.ts:~9455` claimed the
fire site had to wait for `<page>` parser support. That comment is STALE — `<page>` is parsed
today (`block-splitter.js:183` registers it; `ast-builder.js:18518` walks `node.tag === "page"`).
The gap read as precondition-blocked and was not.

---

Wire the missing fire site for **`g-channel-inside-page-never-fires`** (HIGH): `E-CHANNEL-INSIDE-PAGE` is catalogued in SPEC §34 but has **ZERO fire sites**, so a `<channel>` nested inside a `<page>` compiles clean AND is wired program-scoped — a claimed guarantee that does not hold.

Read the gap entry first: `docs/known-gaps.md`, heading `### G-CHANNEL-INSIDE-PAGE-NEVER-FIRES`.

## The precondition is MET — and the in-code comment saying otherwise is STALE
`compiler/src/symbol-table.ts` (~:9455) carries a comment stating the code will fire *"once `<page>` parser support lands in a later wave … (Wave 1 has no `<page>` parsing)"*. **That comment is out of date.** I verified `<page>` IS parsed today: `compiler/src/block-splitter.js:183` registers `"page"` as a structural block name, and `compiler/src/ast-builder.js:18518` walks `node.kind === "markup" && node.tag === "page"`. So `<page>` nodes exist in the tree and a walker can see them.

**Correcting that stale comment is part of this task** — it is the thing that would stop the next reader from doing this work (pa-base §2, the write-once/ouroboros problem). Do not just delete it; replace it with what is now true.

## F4 STARTUP GATE — your literal first action
`pwd` MUST begin with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. Confirm `git rev-parse --show-toplevel` equals it and the tree is clean. **If any check fails, STOP and report.** Then `bun install` and `bun run pretest`.

**PATH DISCIPLINE:** absolute paths under YOUR worktree root only; never `cd` into `/home/bryan/scrmlMaster/scrml`; use `bun --cwd "$WORKTREE_ROOT"` / `git -C "$WORKTREE_ROOT"`. First commit `WIP(channel-in-page): start at $(pwd)`. Commit after every meaningful edit; keep an append-only timestamped `progress.md`.

## Locus — PA-located, VERIFY
`compiler/src/symbol-table.ts`, **SYM PASS 15** — `walkValidateChannels`, whose sub-walk `walkChannelPlacement` already carries a `markupDepth` counter and already fires `E-CHANNEL-OUTSIDE-PROGRAM`. The natural shape is a sibling check in that existing walker rather than a new pass. I located this by reading the walker, **not** by tracing a `<page>`-nested case end-to-end. Report whether the locus HELD, was REFINED, or was WRONG.

## Governing sentences — read them before deciding behaviour (Rule 4)
Read **SPEC §38.1** and **§38.9** IN FULL via targeted `offset:`/`limit:` (SPEC.md is too large to full-read; use `compiler/SPEC-INDEX.md` to find the line ranges). Establish from the spec text, and **quote the governing sentence in your report**:
- what the canonical placement is (`<channel>` as a CHILD of the entry-file `<program>`, sibling of `<page>` — Insight 30, S87);
- the **PURE-CHANNEL-FILE dispensation** (§38.12.6): a `<channel>` at file top in a module file with no `<program>` anywhere is canonical and must NOT fire;
- whether a `<channel>` inside `<page>` is genuinely forbidden, or merely unspecified. **If the spec turns out not to forbid it, that is a RULING for the operator, not a fix for you to make — STOP and report that instead of firing a new error.** An error code existing in §34 is not by itself a normative prohibition.

## Direction-of-change — this is NEWLY-REJECTING, so it owes a MEASURED migration
Per pa-base §8: a change that makes previously-accepted source fail requires a measured migration, not an assumed one. **Grep the whole corpus** (`samples/ examples/ stdlib/ conformance/ docs/ benchmarks/ compiler/tests/`) for `<channel>` nested inside `<page>` and **report the count and the files**. Assumed-zero is not measured-zero. If the count is non-zero, STOP and report — migrating adopter-visible shapes unilaterally is not yours to decide.

## Done means
- The diagnostic fires on a `<channel>` inside `<page>`, with a message naming the canonical placement and cross-referencing §38.1.
- The **pure-channel-file dispensation still does not fire** (regression test required — this is the easiest thing to break).
- `E-CHANNEL-OUTSIDE-PROGRAM` behaviour unchanged (regression test).
- A conformance case pinning the new fire, both halves (codes + runtime) where applicable.
- The stale comment replaced with current truth.
- `bun test compiler/tests/{unit,integration,conformance}` green — baseline **21597 pass / 0 fail**, do not regress.

Out of scope — do not touch: `compiler/src/codegen/emit-html.ts`, `emit-event-wiring.ts`, `emit-client.ts`, `emit-channel.ts` (all in other agents' live write-sets).

I will run the S239 adversarial pass on your diff after you report; you cannot invoke it in-agent. Stay resumable.
