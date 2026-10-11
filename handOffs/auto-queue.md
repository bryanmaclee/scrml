# AUTO queue — the only work an AUTO (unattended) run may take

Contract: `../scrml-support/pa-auto.md`. **Written by S464 (2026-10-11)** from the S462 wrap carry-overs; replaces the S460/S461 queue (all done; history in `docs/changelog.md` §S461).
Every code item: isolated dispatch (F4 block) → S239 differential review on a FROZEN commit → land only when clean + cloud `gate` green.
Mark each item `DONE <PR>` / `BLOCKED → auto-questions.md` / `PARKED <why>` as you go.

## Read first
- **The six in-flight S462 branches died with the S462 process.** Each was pushed to origin by S464 as `wip/s464-<topic>`. Five also had UNCOMMITTED work, saved as patches in `scrml-support/handOffs/s462-wip-patches/s464-salvage/agent-<id>.patch` (`.status` lists the files). **Every dispatch below starts by checking out its branch and applying its patch** (`git apply`), then reading the branch's own `docs/changes/<id>/progress.md` — that file, not this queue, holds the round state.
- **Concurrency: at most 3 agents at once.** The cloud box has 4 cores; S461 measured 3 agents plus a local suite saturating it (timing tests flake). Do not run a full local suite while agents run — the cloud `gate` is the full run.
- Each brief names a unique scratch directory (S462 miss: parallel agents clobbered a shared scratchpad 3×) and says "keep tool output small" (S462: one agent died of context overflow mid-fix).
- Remote branch deletes are refused in the cloud (403). Leave `wip/*` branches; list them in the hand-off.

## 1. P0 — CPS: server logic and the password hash on the client
- Branch `wip/s464-p0-cps-r1` @ `544401e8b` (round 1 complete; no salvage patch — the tree was clean). Base-work history on `worktree-agent-aaf433dac5f8224df` = `a466175f9`. Change-id `s462-p0-cps-server-logic-to-client`.
- Rests on: **bryan S464 "Ratify" — SPEC §19.9.9.8 is normative** (user-voice §S464). Before landing, change the §19.9.9.8 provenance line from `pa-ruled:S462 P0 …` to `ruling:user-voice-scrml.md S464 "Ratify (Recommended)"`.
- Next: merge `origin/main`, freeze the commit, S239 re-review against the original findings (H1 helper-call bypass · H2 derived-local leak · H3 cross-batch forged trust — a forged `role` ran a DELETE · H4 silent login break · M1 crypto browser-safe chunk) plus new ground. Fix rounds → re-review each on its new frozen commit.
- Done when: merged, review markers written.

## 2. P0 — SQL chain truncation: `?{…}.get().name` returns the whole row (hash leak)
- Branch `wip/s464-p0-sql-chain` @ `c6b774770` + patch `agent-a1a75d1c0988a788f.patch` (6 files). Change-id `s462-p0-sql-chain-truncation`.
- State: fix + tests committed (`f6f00bb3c`); **remaining: corpus differential, gates**, then S239 review, then land. Governing-sentence gate: quote the §8 / §44.3 chaining sentence in the PR body.
- Done when: merged.

## 3. Brace-less `else` dropped (silent miscompile)
- Branch `wip/s464-braceless-else` @ `deadc1e23` + patch `agent-aa155c755ea34011f.patch` (1 file). Change-id `s462-braceless-if-else-dropped`.
- State: fix round 1 — the handler template-literal regression. Rests on bryan S462 Q23: "the S462 brace-less-else miscompile fix still lands".
- Done when: merged. **Unblocks item 7.**

## 4. Markup display text parsed as code
- Branch `wip/s464-markup-text-not-code` @ `a273fd596` + patch `agent-ab499a58703c346b4.patch` (8 files). Change-id `s462-given-body-text-as-code`.
- State: fix round 1 — drop the `collectExpr` hunk; fail closed when the desugar declines. Deferred items in its progress.md stay deferred (file them as gaps if not already).
- Done when: merged. **Unblocks item 8.**

## 5. `<md>` phase 2 (static lowering)
- Branch `wip/s464-md-phase2` @ `bc9e44455` + patch `agent-a68b98aae5ab9517d.patch` (5 files). Change-id `s462-md-phase2`.
- Rests on bryan S462 `<md>` F1–F4 + Q22 (SPEC §67). State: fix round 1 — MED-A `match` prose → E-TYPE-026; MED-B code-span `${` swallow.
- Done when: merged. **Unblocks item 11.**

## 6. S462 gap filing (docs-only)
- Branch `wip/s464-wrap-gaps` @ `b4a0983c6` + patch `agent-a2214e9573c113571.patch` (1 file). Change-id `s462-wrap-gaps`.
- Finish, run `bun scripts/state.ts --write` + `--check`, PR. Docs-only: review = PA mechanical check (carve-out).
- Done when: merged.

## 7. Q23 — braces required for `if` / loop bodies (§63 retirement) — AFTER item 3
- Rests on bryan S462 Q23 "b absolutely". PR 1: W-lint + `scrml fix` brace rule + SPEC §50.2.1 / §49.2 / §34 + reserved E-code. PR 2 (separate): corpus migration (2,363 bootstrap sites + stdlib / examples / conformance). giti / flogence: drop a notice in their inboxes (push to their `inbox` branch), do NOT edit them.
- ⚑ The W-/E- code NAMES: if no name follows from an existing §63 / §34 pattern, that is a direction call → BLOCKED with a proposed name.

## 8. Q24 — statement-position markup in a logic body is a compile ERROR naming `lift` — AFTER item 4
- Rests on bryan S462 Q24 "a". **MEASURE the corpus first** (compile, don't grep). If the count is not small (more than a handful of files), → BLOCKED with the count and the file list. bryan's words: "if the count is not small, it returns to bryan."

## 9. E-VALUE-FUNCTION-STORED refusal
- Rests on bryan S462 "a — no value holds a function" + "go on the package" (no-function-in-value migration). stdlib, registerMessages and scrml:data already migrated; the refusal itself never landed. Measure the corpus; non-zero outside the already-migrated surfaces → BLOCKED with the list.

## 10. `lift` of `<pre>` / `<code>` raw content renders as text (`g-lift-pre-code-not-raw-content-s462`, MED)
- Rests on bryan S462 Q21 "I like a" (raw bodies render as text at every emitter). Same encoding as #1402, on the lift path.

## 11. `<md>` phase 3 — `<md of=…/>` with the Q22 forgiving mode — AFTER item 5
- Rests on bryan S462 F2 "yes a." + Q22 "c is good". Same reader, same closed set + §5.2 URL guard, no heading ids from data, md chunk shipped only on pages using `of=`.

## 12. Migration: 234 `.Transport(_) :> { return }` sites → bare `:> return`
- Rests on bryan S462 dpa-068 "2 W1". Mechanical; README.md:109 included. Emit differential must be identical.

## 13. Docs currency (docs-only)
- `docs/PA-SCRML-PRIMER.md` still teaches `is some` and in-place `given` (retired S462, §63 window): §6.5, §8, §9.4, §10 set idioms. Rewrite to `is given` / the S462 forms; mark the old forms deprecated. Kickstarter (`docs/articles/llm-kickstarter-v2-2026-05-04.md`) likewise. NOT the website (Rule 1).
- Refresh `.claude/maps/` (stamp is ~30+ commits stale).

## Not for AUTO (needs bryan)
- `<md>` inside `lift` / markup-value positions (currently E-MD-IN-LOGIC-NOMINAL) — not ruled.
- X build (attribute forwarding `...attrs:button`) — ratified destination, but schedule it with bryan.
- Narrowing-checker simplification — after item 9; design judgement.
- The four open S462 questions (hand-off §S462.2): quoted event handlers; ParseError implicit vs import-only; `scrml fix` refusing already-failing files; the local pre-commit `gen-md-shim --check` line.
