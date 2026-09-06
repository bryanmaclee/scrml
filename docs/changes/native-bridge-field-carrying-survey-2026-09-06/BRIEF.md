# BRIEF (verbatim) — native-bridge-field-carrying-survey-2026-09-06

Survey the native→live FileAST bridge: are the 128 non-firing diagnostic codes ONE structural gap, a handful, or 128 separate ones?

change-id: `native-bridge-field-carrying-survey-2026-09-06`

**SURVEY dispatch. Do not fix anything. `compiler/native-parser/` is transition-FROZEN by operator ruling. The deliverable is a decomposition and a defensible cost estimate.**

## WHY — this single number decides a multi-quarter call

A flip re-measure landed today (`scripts/native-parser-flip-harness.ts`, committed — **use it, do not rebuild it**). Reading, *verified by execution*: control **54**, flipped **1907**, **NEW 1860 / GONE 7**.

The estimate that came out of it — **INFERRED 60–130 sessions to flip, midpoint ~90, ~180–360h** — rests on the residue being flat and unleveraged: largest single contributor 15%, top-50 = 50%, 358 files. After 230 sessions of freeze, that puts the remaining cost at roughly the ORIGINAL estimate for building the whole front-end. bryan is weighing that against a language he is no longer confident is usable.

**But the dispatch that produced it named its own strongest counter-hypothesis and did not test it:**

> `conformance/corpus-bridge.test.js` contributes **271 failures (15%)** — and it is not one bug: **128 distinct diagnostic codes fail to fire** under the native parser (`E-SCOPE-001` ×6, `E-REACTIVE-003` ×5, `E-STRUCTURAL-ELEMENT-MISPLACED` ×4, `E-MATCH-SUBSET-DEAD-ARM` ×4, `E-TYPE-020` ×4, …). The failures are `r.missing` non-empty: **downstream checks read AST fields the native bridge does not carry, so the diagnostic never fires.**

**If that is ONE structural fix — the bridge failing to carry a CLASS of fields — the 271 collapse and the 90-session midpoint is wrong by a lot. If it is 128 separate omissions, the estimate stands.** That is your question. Nothing else.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED checkout — STOP.
2. `git rev-parse --show-toplevel` equals that root; `git status` clean; `git merge-base HEAD origin/main` == `origin/main`.
3. `bun install`. Then `bun run pretest` — PLAINLY from the worktree CWD. ⚑ `bun --cwd <path> run pretest` prints the script list and **exits 0 having done nothing**; verify `samples/compilation-tests/dist/` artifacts appeared.
4. `WORKTREE_ROOT="$(pwd)"`, echo it. First commit: `WIP(bridge-survey): start at <that pwd>` **and write this prompt verbatim to `docs/changes/native-bridge-field-carrying-survey-2026-09-06/BRIEF.md`**.

Edit via Edit/Write on worktree-absolute paths only. NEVER `cd` into the shared checkout. ⚑ **NEVER `git stash`** — `refs/stash` is shared across worktrees here. ⚑ **NEVER a bare `pkill -f`/`killall`** — other agents are running suites; kill by PID captured at launch. Commit incrementally; append to `progress.md`.

⚑ **A SIBLING AGENT IS LIVE** measuring type-annotation enforcement in its own worktree. Stay out of `docs/changes/type-annotation-enforcement-census-2026-09-06/` and do not add scripts under a name it might also pick. Keep your artifacts in your own change-dir.

## THE METHOD

1. **Reproduce the 271 / 128** with the committed harness (`--tier conformance/`) or by running `corpus-bridge.test.js` under the flip. **Confirm the numbers before reasoning from them** — they are one agent's measurement and this dispatch exists to second them.
2. **Enumerate the MISSING FIELDS, not the codes.** For each failing case, what does `r.missing` actually name? The codes are the symptom; the fields are the cause. Build the field→code map.
3. **Cluster the fields by WHERE THEY SHOULD HAVE BEEN SET.** Locate by SYMBOL — `parse-file.js` / `nativeParseFile`, `translate-stmt.js`, `translateExpr`, `engine-statechild-walker.ts` are the known bridge surfaces; there may be others. The question is whether the missing fields share a producer, a node kind, or a translation path.
4. **Answer the shape question.** Is this: (a) one translation layer dropping a whole class — e.g. every annotation/span/scope field, or every field on one node kind; (b) a handful of clusters; or (c) genuinely 128 independent omissions? **Give the cluster count and the population under each.**
5. **Cost each cluster.** Not "hours" in the abstract — say how many DISTINCT edit sites each cluster implies, and whether closing the largest one is a single dispatch or an arc.

## WHAT WOULD MAKE ME DISTRUST THE ANSWER

- A conclusion drawn from reading `translate-stmt.js` rather than from the failure data. **Start from `r.missing`, work backwards.**
- Treating "128 codes" as the unit. If 128 codes reduce to 6 fields, say 6.
- An optimistic collapse claim with no test. If you believe one fix closes N cases, **name the fix and predict N before checking** — then check, and report the prediction against the result. A prediction that survives is worth ten that were never made.
- Ignoring that some of the 271 may be genuine native-parser semantic gaps wearing a missing-field costume. **Say which fraction is bridge-plumbing versus real parser divergence** — those have very different costs and the whole estimate turns on the split.

## SCOPE — out

Do **NOT** fix anything, including a one-line field copy that looks irresistible. Do **NOT** touch `compiler/native-parser/` source. Do **NOT** modify the flip harness. If a fix is obvious, describe it precisely enough that someone else can do it in one sitting — that description IS the deliverable.

## REPORT BACK — under two pages

1. **The shape answer**: cluster count, population per cluster, and whether the largest is one fix.
2. The field→code map, condensed.
3. The bridge-plumbing vs real-parser-divergence split, with the basis.
4. **Your revised read on the 90-session midpoint** — does the survey collapse it, confirm it, or leave it? Label INFERRED.
5. Any prediction you made and whether it held.
6. Final branch + SHA + files touched. Anything contradicting this brief.

Label every claim `verified by execution` / `verified by reading <file> at <symbol>` / `INFERRED — not measured`. Locate by SYMBOL, never a remembered line. No `--no-verify`; never override `core.hooksPath`.
