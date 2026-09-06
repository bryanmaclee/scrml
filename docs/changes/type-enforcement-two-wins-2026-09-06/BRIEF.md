# BRIEF (verbatim, archived at dispatch time)

change-id: `type-enforcement-two-wins-2026-09-06`

---

Land the two measured type-enforcement wins: the `E-TYPE-031` literal-set widening and position-2 state-cell assignability.

change-id: `type-enforcement-two-wins-2026-09-06`

**RULED by bryan, verbatim: "land the two cheap wins."** Both were measured by a scoping dispatch today and both come with archived CANDIDATE patches. **Your job is to land them correctly, not to re-derive them — and the test fallout is the part that needs judgment.**

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is the shared checkout — STOP.
2. `git rev-parse --show-toplevel` equals that root; `git status` clean; `git merge-base HEAD origin/main` == `origin/main`.
3. `bun install`. Then `bun run pretest` PLAINLY from the worktree CWD — ⚑ `bun --cwd <path> run pretest` prints the script list and **exits 0 having done nothing**; verify `samples/compilation-tests/dist/` artifacts appeared.
4. `WORKTREE_ROOT="$(pwd)"`, echo it. First commit: `WIP(type-two-wins): start at <that pwd>` **and write this prompt verbatim to `docs/changes/type-enforcement-two-wins-2026-09-06/BRIEF.md`**.

Edit via Edit/Write on worktree-absolute paths only. NEVER `cd` into the shared checkout. ⚑ **NEVER `git stash`** — `refs/stash` is shared across worktrees here. ⚑ **NEVER a bare `pkill -f`/`killall`**; kill by PID captured at launch. Commit incrementally; append to `progress.md`.

## THE INPUTS — archived patches, NOT applied

```
git fetch origin && git checkout worktree-agent-a13467dfcbdebe503 -- docs/changes/base-annotation-enforcement-scoping-2026-09-06/
```
That directory holds `etype031-literal-set-CANDIDATE.patch`, `pos2-state-cell-CANDIDATE.patch`, the probes, and `progress.md` with every number and its method. **Read `progress.md` before touching either patch.** Treat the patches as a starting point you verify, not as a spec — re-derive the edits against current HEAD if they do not apply cleanly, and say which you did.

## WIN 1 — `E-TYPE-031` literal set

§7.5.1 makes exactly ONE normative assignability promise: `E-TYPE-031` fires at position 1 for an unpredicated `{number, string, boolean}` annotation whose initializer is a literal of a different primitive type. **It holds at 4 of 8 off-diagonal cells.** Misses: `string = true` · `number = true` · `number = \`tpl\`` · `boolean = \`tpl\``.

**THREE functions need the case, not two** — the filed gap `g-e-type-031-is-blind-to-boolean-literals` says two and is wrong:
- `classifyLiteralFromExprNode` (`compiler/src/expression-parser.ts`) — return type declared `value: string | number`, structurally excluding boolean.
- `extractInitLiteral` (`compiler/src/type-system.ts`) — same two branches.
- **`inferExprType`'s `lit` arm** — without it, `let flag = true` keeps emitting `W-TYPE-031-UNPROVEN`.

⚑ **Template literals are a miss CLASS the census never tested.** Cover them, not just boolean.

**Measured consequences (reproduce these, do not assume them):** `types-gate --check` identical 12 diagnostics before and after · corpus over 1920 files **+0 errors, −18 warnings** · suite **23275 pass / 3 fail**, all expected-shape.

## WIN 2 — position 2, state-cell annotation

§7.5.1 row 2: `<n>: number = "nope"` — not checked. The fix is the position-1 arm in `annotateNodes` copied to the reactive-decl site, ~20 lines. **Measured: corpus diff 0 files changed; full suite with it ungated 23278 pass / 0 fail; verified live on census fixture `07-state-decl-number.violation.scrml`.**

⚑ §7.5.1's own ruled order says position 2 "rides with the state-cell decl work". The scoping dispatch recommended diverging and doing it now on the grounds that it is ~20 lines at zero migration and zero churn. **bryan ruled "land the two cheap wins", so the divergence is authorised — but SAY SO in the SPEC amendment rather than letting the order silently drift.**

## ⚑ THE TEST FALLOUT IS THE JUDGMENT CALL — DO NOT WEAKEN A TEST TO GET GREEN

Three expected failures. Each needs the RIGHT disposition, and getting one wrong silently undoes the win:

1. **2× `trucking-dispatch v0.2-shape diagnostic baseline`** — a warning count going DOWN, 338 → 321. That is the fix working. Update the baseline, and state the before/after in the commit.
2. **1× `s365-asis-unknown-split.test.js`** — a `gap at \`lit\`` entry in `GAP_CASES` that must move to `SILENT_CASES`. ⚑ **That entry carries NO FLIP marker** (unlike §7.5.2's `match`/`if` pins), **so closing the gap reads as a regression.** Move it, and add the FLIP marker the sibling pins have so the next person closing a gap here does not read green-turning-red as breakage. **If you conclude the entry should NOT move, stop and report — that would mean the fix changes something we did not intend.**

## SPEC — both wins move §7.5.1, and the section is explicit that this is expected

§7.5.1 says *"Widening §7.5.1 is the normal direction of change and each widening is additive."* Update the **MEASURED table** (row 1's cell coverage; row 2 → CHECKED) and the normative statements. Every row in that table claims to have been reproduced by compiling the stated source — **so reproduce yours and keep that property true.** Carry a `provenance:` line per base Rule 4b (`ruling:` → bryan S402 "land the two cheap wins").

## VERIFICATION

- Both wins proven by execution on the census fixtures (`docs/changes/type-annotation-enforcement-census-2026-09-06/fixtures/`) — and **re-run the census harness itself** (`bun docs/changes/type-annotation-enforcement-census-2026-09-06/type-annotation-census.mjs`); the enforced count should rise. Report the new fraction.
- **Two-sided negative for each:** a correct program must still compile silently. A widening that also rejects valid code is not a win.
- Corpus differential — **both sides at the same `--compiler-root`**, and expect a DIAGNOSTIC delta with ZERO artifact-content delta. Report skipped populations.
- Full `bun run test` — compare failure SETS against base, not counts.
- `bun scripts/types-gate.ts --check` — the NEW set must be unchanged from base (it is red on main at 12; that is pre-existing debt, not yours).
- `bun scripts/facts.ts --check` before you finish.

## SCOPE — out

Do NOT attempt position 3 (call-site arguments) — it is 97.5% false-positive today and blocked on an `int`/`number` assignability ruling that is bryan's. Do NOT touch `compiler/native-parser/` (transition-frozen). Do NOT fix `E-TYPE-072`/`E-TYPE-043` (zero push sites — greenfield, not wiring).

## REPORT BACK — under two pages

1. The new census fraction, before → after.
2. Each test disposition and why, especially the `s365-asis` entry.
3. Corpus differential + suite failure-SET comparison + types:check + conformance + FACTS.
4. The SPEC diff you made to §7.5.1.
5. Final branch + SHA + files touched. Anything contradicting this brief.

Label claims `verified by execution` / `verified by reading <file> at <symbol>` / `INFERRED`. Locate by SYMBOL, never a remembered line. No `--no-verify`; never override `core.hooksPath`.
