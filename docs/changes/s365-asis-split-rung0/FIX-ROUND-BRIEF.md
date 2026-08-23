# FIX-ROUND BRIEF — verbatim, as dispatched (S365, fix round on `feat/s365-asis-split-rung0`)

FIX ROUND on `feat/s365-asis-split-rung0`. An adversarial pass returned **DO-NOT-LAND**, and was explicit that **the code passes and the SPEC text does not**. Emit is byte-identical across 2,724 artifacts; the corpus diagnostic delta is exactly one line. **Every blocker below is text-only.** Four small code items ride along.

## WORKSPACE — EXISTING worktree, already on the branch.
- work in: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a33344eeccf9ddfcb`
- branch `feat/s365-asis-split-rung0`, currently at **`d63ba668`**

**STARTUP GATE — STOP and report if any fails:** `pwd` under that worktree - toplevel equals it - branch correct - `git status --short` clean - HEAD == `d63ba6685370b2c7d3902d187b509dec8ba6a014`.

**PATH DISCIPLINE.** Absolute paths under the worktree root. **NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`.** `git -C` / `bun --cwd=`. **Never `git stash`.** NEVER disable the commit gate — not `--no-verify`, and NOT by setting `core.hooksPath` (this repo sets none, so `git -c core.hooksPath=...` silently skips it; a dispatch did that today and its tree was RED).

**STEP 0:** `git fetch origin && git merge origin/main` — MERGE, never rebase. Delta-log collision => the already-merged side keeps its numbers; do NOT run `delta-lint --fix`. Resolve `@generated` blocks by REGENERATING.

---

## BLOCKING — all in `compiler/SPEC.md`

**B1 - The headline SHALL is FALSE, and a 6-line program refutes it.** 7.5.2 and 14.7 both say *"Type inference SHALL NOT produce `asIs`."* On this very branch:
```
function eat(powerUp) { match powerUp { .Mushroom(n) :> n ; .Star :> 0 } }
```
-> `error [E-TYPE-025]: Cannot match on \`asIs\`-typed subject.` Nobody signed for that `asIs`. `tAsIs()` has **101 call sites** in `type-system.ts`; this change converts **one** give-up path.
**Narrow both sentences to what is provable:** *`inferExprType` SHALL NOT return `asIs`, and the un-annotated `let`/`const` declaration site SHALL NOT bind `asIs`.* Keep the ruling's intent visible — say plainly that other `asIs`-producing paths remain and are rungs 1-3 — but **do not assert a global invariant the compiler does not hold.**

**B2 - 14.7 contradicts an unamended bullet two lines above it.** `SPEC.md:8219` still says component bare props *"follow `asIs` rules: the compiler infers the concrete type constraint from how the prop is used"* — immediately above the new *"`asIs` SHALL arise only from an author"*. Reconcile; do not leave a paragraph arguing with itself.

**B3 - The `_{ ... }` carve-out is unconditional in text, conditional in code.** 7.5.2 and the new 34 row say the diagnostic SHALL NOT fire for a `_{ }` foreign initializer. Reproduced A/B — inside `export function f()` it is clean; at `<program>` logic scope the identical shape fires, because the guard is `!(n.foreignNode)` and no `foreignNode` sidecar is attached at program scope. **Either qualify the text to where `foreignNode` is attached, or fix the guard — say which you chose and why.** The branch's own test covers the `?{ }` carve-out and not this one; add the missing case either way.

**B4 - The 34 `E-TYPE-031` row carries a false citation and mis-books its own fire domain.** All PA-relayed from the review; **verify each yourself before editing**:
- ``compiler/src/type-system.ts:10112`` -> line 10112 is an **E-ERROR-010** fragment; the sole `E-TYPE-031` push in that file is **10364**. (It was right on main; this branch's own +252-line insertion moved it.)
- `14.6` for `using (expr)` -> that line is inside **15.3**; 14.6 is *Pattern Matching*.
- `18` for if-as-expression -> those lines are **17.6.x**; 18's heading starts later.
- `53.4` for the validator emitter -> `checkValidator`'s own message cites **55.1**.
- The *"provable fire domain"* sentence names prop / validator / `using`. Measured: `grep -rn '"E-TYPE-031"' compiler/src` -> **18 push sites, 17 validator (`symbol-table.ts`), 1 `type-system.ts`. Zero prop. Zero `using`.** Drop the two positions with no code behind them — and note this contradicts 7.5.1's own measured table **in the same commit**.

**B5 - `Result<ResolvedType, InferenceGap>` (SPEC.md:6251) — no such type.** It is `InferenceResult`. Fix the name.

**Do not "fix" 7.5.1.** The review called its provable-domain table the best-calibrated section in the diff, all five rows independently reproduced. Leave it alone.

---

## SHOULD SHIP WITH IT — small, low-risk

**S6 - Close the rung-1 trap.** At the wired site, `inferExprType`'s `ok` branch discards its type — there is no `else`. Measured: `ok` fires **0 times** across 2,362 files today, so `else resolvedType = inferredResult.type;` is **zero behaviour change now** — but `progress.md` says rungs 1-3 are *"a matter of moving one arm from `inferenceGap` to `inferenceOk`"*, and doing that as written yields **silence without typing** — the `asIs`/`unknown` collapse re-created inside the fix for it. Close it now.

**S7 - 122 warnings (1.2%) name the declaration `[object Object]`.** `gapName` reads `n.name`, an object for a destructuring decl. Reproduced: `const { a, b } = someObj()`.

**S8 - The `escape-hatch` detail text mis-describes regex literals.** Every sampled site is `const re = /ab+c/g`, reported as *"inference stopped at foreign-code escape hatch"* — the adopter wrote no escape hatch.

**S9 - A leaked position, NOT in your deferred list.** ~60 corpus sites: `match`- and `if`-as-expression initializers carry the initializer in a sidecar rather than `initExpr`, so the guard skips them and **inference failure still silently produces `asIs`**. `inferExprType`'s `case "match-expr"` arm is **unreachable at its only production call site**. Reproduced: `const r = match x { 1 :> 10 ; _ :> 20 }` -> no warning, type stays `asIs`. **Do not build the fix** — add it to the deferred-positions list in `progress.md` and file it as a gap entry, since it is the ruling's stated invariant not holding.

**S10 - `types-gate` is runnable and nothing runs it**, while `ci.yml:4` still advertises a layer *"types (always-on local)"* that does not exist. That is the script's own thesis reproduced one level up. **Pick one:** wire `types-gate --check` into the **non-blocking `tracking` job** (zero merge risk), or correct the `ci.yml:4` header. Do not ship both untouched. Say which and why.

## OUT OF SCOPE — do not touch
- **Severity.** It ships at `warning`. The flip is a HELD operator call.
- **Tier-A warning retirement** (362 bool/`not`/template/comparison sites the review flagged as adopter-refutable). Ruled out of this round; it is rung-1 scoping.
- The 9 live `never` failures — a separate fix-vs-drain decision.
- `codegen/` beyond the one already-approved reason-aware line.

## VERIFICATION
- **Re-reproduce B1's 6-line refutation and B3's A/B** before and after your edits; paste both.
- Corpus must stay at **exactly `+9954 W-TYPE-031-UNPROVEN` and no other code delta** (S7/S8 change message TEXT, not counts — prove the count is unchanged).
- Blocking gates: `bun --cwd="$WT" test compiler/tests/unit` and `conformance/run.ts` (baselines 17,773/0 and 883/883), plus `s34-census --check-new --base origin/main`, `facts --check`, `regen-spec-index --check`, `delta-lint`, `types-gate --check`. **Measure exit codes DIRECTLY (`cmd; echo $?`), never through a pipe.**
- After any SPEC edit, regenerate SPEC-INDEX — the pre-push gate blocks on stale totals and warns to regenerate AFTER the last content commit.

## COMMIT DISCIPLINE
First commit: this brief verbatim to `docs/changes/s365-asis-split-rung0/FIX-ROUND-BRIEF.md` + a `progress.md` append. Crash anchor. **`progress.md` must disclose what went wrong, not only what worked** — a transcript disclosure evaporates, that file does not.

## REPORT
Per-item fixed/deferred with evidence; the B1 and B3 before/after reproductions; proof the warning count is unchanged; gate exit codes; final SHA; and any premise in this brief you found false.
