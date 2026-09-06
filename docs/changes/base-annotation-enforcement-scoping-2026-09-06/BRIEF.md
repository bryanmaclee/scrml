Scope what it costs to connect scrml's base-type annotations to the enforcement engine that already works — implementation cost AND migration cost, separately, both measured.

change-id: `base-annotation-enforcement-scoping-2026-09-06`

**SCOPING dispatch. Build a THROWAWAY prototype only as a measuring instrument. Do NOT land an enforcement change.**

## WHY — this number sits next to a 90-session parser estimate in an operator decision about whether the language is salvageable

bryan hand-wrote ~20 lines of scrml — the first scrml ever written by a human, since the ~2,400-file corpus is entirely LLM-authored — and hit a type hole on his only attempt. A census (landed today, `docs/changes/type-annotation-enforcement-census-2026-09-06/`, on branch `census/s402-type-annotation` and merging to main as PR #869) then measured the whole surface:

| surface | positions | enforced | DECORATIVE |
|---|---|---|---|
| §53 predicates / refinements | 7 | **6** (3 compile + 3 runtime) | 1 |
| §7.5 base-type annotations | 29 | **4** | **25** |

**The engine exists and works. It is not wired to plain annotations.** Same position, one character apart — `fn charge(a: number)` emits `function _scrml_charge_1(a) { return a; }`, while `fn charge(a: number(>0))` emits a boundary check throwing `E-CONTRACT-001-RT` with variable, constraint, value and location.

**`git fetch origin census/s402-type-annotation && git checkout FETCH_HEAD -- docs/changes/type-annotation-enforcement-census-2026-09-06/`** if it is not already in your worktree — the 46 paired fixtures and the full per-position table are the input to this dispatch, and its harness is re-runnable.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is the shared checkout — STOP.
2. `git rev-parse --show-toplevel` equals that root; `git status` clean; `git merge-base HEAD origin/main` == `origin/main`.
3. `bun install`. Then `bun run pretest` PLAINLY from the worktree CWD — ⚑ `bun --cwd <path> run pretest` prints the script list and **exits 0 having done nothing**; verify `samples/compilation-tests/dist/` artifacts appeared.
4. `WORKTREE_ROOT="$(pwd)"`, echo it. First commit: `WIP(annotation-scoping): start at <that pwd>` **and write this prompt verbatim to `docs/changes/base-annotation-enforcement-scoping-2026-09-06/BRIEF.md`**.

Edit via Edit/Write on worktree-absolute paths only. NEVER `cd` into the shared checkout. ⚑ **NEVER `git stash`** — `refs/stash` is shared across worktrees here. ⚑ **NEVER a bare `pkill -f`/`killall`** — sibling agents are running suites; kill by PID captured at launch. Commit incrementally; append to `progress.md`. ⚑ **A SIBLING AGENT IS LIVE** surveying the native→live bridge in its own worktree — stay out of `docs/changes/native-bridge-field-carrying-survey-2026-09-06/` and do not modify `scripts/native-parser-flip-harness.ts`.

## ⚑ THE COST THAT WILL DOMINATE IS NOT THE IMPLEMENTATION — MEASURE IT FIRST

Turning on base-type assignability is **newly-REJECTING at scale** (base §8). It is recoverable — a migration exists — but it **owes a MEASURED migration**, and assumed-zero is not measured-zero. **My strong prior, which you should try to falsify: the migration dwarfs the wiring.**

So the order of work is:

1. **Build a throwaway prototype check** for the cheapest meaningful slice — start with `fn`/`function` parameter assignability at the CALL SITE (bryan's exact case, and §7.5.1 position 2).
2. **Run it over the corpus and COUNT.** How many of the 1920 `.scrml` in `examples samples stdlib conformance benchmarks` newly fail? How many distinct sites? Then the flagship `examples/23-trucking-dispatch` alone, and `compiler/self-host/` separately — the self-host is scrml-authored and will behave differently from LLM-authored samples.
3. **Sample the failures and classify them.** This is the load-bearing judgment: what fraction are GENUINE type errors the check should reject (a real bug in the corpus), versus code that is fine and the checker is too naive (inference gaps, `asIs`, union narrowing, `not`-handling)? **A high false-positive rate means the wiring is harder than it looks and the estimate must say so.**
4. **Only then** cost the implementation.

## THE THREE PARTITIONS HAVE THREE DIFFERENT COSTS — keep them separate

The census partitions the 26 decorative rows:

- **8 — decorative by explicit SPEC ruling.** §7.5.1 (`SPEC.md:6195`, amended S365): *"Positions 2-5 are NOT YET CHECKED. A program that assigns a non-assignable value at those positions SHALL compile … a later widening of this section MAY reject it."* ⚑ **The widening is pre-authorised in principle and has a ruled ORDER — read §7.5.1 IN FULL and honour it.** These are wiring + migration.
- **6 — specified and DEAD.** A §34 code exists, its fire condition is met, nothing is emitted (`E-TYPE-072`, `E-TYPE-046`, `E-TYPE-043`, `E-TYPE-004`, `E-TYPE-031`). These need no SPEC work and may be much cheaper — **cost them separately; this could be the fast win.**
- **12 — never specified.** Array element, union member, struct-field construction, enum payload type, map key/value, schema column, component prop, `int`, non-literal initializers, and **fn call arity**. These need a SPEC amendment BEFORE any implementation and are therefore not PA- or agent-scopeable — **cost them as "ruling required", not as hours.**

## ALSO COST THE ONE-LINE-SHAPED FIX

`g-e-type-031-is-blind-to-boolean-literals` (filed today, HIGH): `classifyLiteralFromExprNode` declares its return `value: string | number`, structurally excluding boolean; `extractInitLiteral` has the same two branches. **Two functions, one missing case each.** Confirm that shape and cost it — if §7.5.1's only normative SHALL can be made whole in an afternoon, that is worth knowing on its own.

## WHAT I NEED

1. **The migration number**, measured, with the false-positive fraction from your sample. This is the headline.
2. **Implementation cost per partition** — sessions or an hour band, basis stated, INFERRED and labelled.
3. **A recommended ORDER** — what to turn on first for the most confidence per unit of migration pain. §7.5.1's own ruled order constrains this; say where you follow it and where you would diverge and why.
4. **The `E-TYPE-031` boolean fix**, costed separately.
5. **Your honest read on whether "it's wiring, not invention" survives contact with the prototype.** If the checker needs real inference work the census's framing is too optimistic and I need to know that plainly — it is currently shaping how the operator thinks about salvageability.

## SCOPE — out

Do NOT land an enforcement change. Do NOT amend SPEC. Do NOT fix the boolean hole (cost it). Do NOT touch `compiler/native-parser/` (transition-frozen). The prototype is an instrument — keep it in your change-dir, and if it is worth keeping, say so and commit it clearly labelled as a measuring tool, not a gate.

## REPORT BACK — under two pages

Numbers first. Label every claim `verified by execution` / `verified by reading <file> at <symbol>` / `INFERRED — not measured`. Locate by SYMBOL, never a remembered line. State anything that contradicts this brief — especially if the migration turns out small, which would invert my prior and is exactly the kind of thing I would rather learn from you than assume. No `--no-verify`; never override `core.hooksPath`.
