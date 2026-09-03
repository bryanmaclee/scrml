# S397 — measure the `~` trigger question: backward-resolution population + `lift` compatibility

## WHY THIS EXISTS

bryan is deciding the **fork under the fork** on `~` (SPEC §32). This is a MEASUREMENT dispatch, not
a build. Produce numbers and a compatibility analysis; change no compiler behaviour.

**The design under consideration (PA proposal — NOT ratified, NOT the dPA's):** today §32.2
initializes `~` **eagerly and forward** from *every* unbound expression statement. The proposal is to
resolve `~` **lazily and backward** from the read site — `~` means "the value of the preceding
expression statement," computed where it is consumed rather than assigned at every statement.

Under that change most of the 828 obligations evaporate because they were never real obligations,
and §32.6's all-or-nothing elision becomes unnecessary. **Your job is to find out whether that is
true and what it would cost.**

## BACKGROUND YOU NEED (verified, do not re-derive)

- §32.2 normative: *"An expression statement whose value is not bound to any identifier SHALL
  initialize `~` to the result of that expression."* **Unconditional — no void exemption.**
- §32.3: `~` is a `lin` variable; consumed **exactly once** between inits; scope-exit-unconsumed is
  `E-TILDE-002`; at-most-once between inits.
- §32.6: the obligation is elided **all-or-nothing per `${}` body** — if `~` is referenced *anywhere*
  in the body, the full obligation applies to *every* init in that body.
- ⚑ **`E-TILDE-001/002` FIRE ZERO TIMES.** `type-system.ts:19259` and `:18586` carry
  `if (name.startsWith("@") || name === "~") return;`. `checkLinear`'s switch has **no
  `case "let-decl"`/`"const-decl"`**, and both `exprNodeFields` lists omit `ifExpr`/`forExpr`/`matchExpr`
  — PA-verified this session. **So you cannot measure this by compiling and counting diagnostics.
  Nothing fires. You must measure structurally.**
- The dPA's `828 consecutive bare-call runs across 3,407 files` is a **line-based heuristic** —
  its own author says treat the order of magnitude as the finding, not the integer.

## MEASUREMENT 1 — the backward-resolution population

**Question: of the sites §32.2 currently burdens, how many would a backward rule still burden?**

Partition the corpus (`scrml`, `scrml-support`, `6nz`, `flogence`, `scrml-native`, `giti` — the same
set the dPA used, and state the set you actually reached) into:

| bucket | shape | what it means |
|---|---|---|
| **A** | unbound expression statements in a `${}` body with **NO `~` read anywhere in that body** | obligations today under §32.2+§32.6? NO (elided). Under backward? Also none. **Should be the bulk.** |
| **B** | unbound expression statements in a body that **DOES** contain a `~` read, but which are **not** the immediate antecedent of any read | obligations TODAY (§32.6 switches the whole body on). **Zero under backward.** ⚑ **This bucket is the entire argument.** |
| **C** | statements that ARE the immediate antecedent of a `~` read | obligations under BOTH rules. The honest residual cost |
| **D** | `~` reads with **no** antecedent expression statement in scope | `E-TILDE-001` under both — count them, they are today's silent bugs |

**Report each bucket with a count, a file count, and 3 real examples.** ⚑ **B's size is the finding.**

⚑ **Do BETTER than the line-based heuristic.** Use the real parser
(`bun compiler/bin/scrml.js` with whatever AST/analysis dump it offers — check
`--emit-block-analysis` and the `scripts/` dir) or `compiler/native-parser`. If you must fall back to
text matching, say so **loudly** and give error bars in both directions. A number without a stated
method is worthless here.

## MEASUREMENT 2 — does `lift` survive a lazy `~`?

**This is an ANALYSIS, not a count, and it is the case most likely to falsify the proposal.**

§32.6: *"Each `lift` call reinitializes `~`. In a sequential `lift` loop, `~` is reinitialized on
every iteration."* Enumerate every interaction shape and state what backward resolution yields for
each. At minimum:

1. `for (x of xs) { lift <li>${x}</li> }` — accumulation, no `~` read. (Expect: unaffected.)
2. `for (x of xs) { lift step(~) }` — a `~` read inside a loop body with **no preceding statement in
   that iteration**. Does `~` resolve to the previous iteration's `lift`? To nothing? **This is the
   sharp one.**
3. `getHeader() let hdr = ~` then a `lift` loop — §32.6's own worked "Invalid" example.
4. `const a = if (c) { lift 3 }` — §32.6's last normative statement says this forces no obligation.
5. `lift` in value-lift mode vs accumulation mode (§10.8) — does backward resolution have to
   distinguish them, or does the distinction become unnecessary?
6. `fn` bodies: `lift` accumulates into the `fn`'s own `~`, returned via `return ~` (§48.5).
   **Does backward resolution break `return ~`?**

For each: **what does the rule give, is it the same as today, and if different is the difference an
improvement or a regression?** Ground each in a real compile — emit the JS for the shape at HEAD and
show what the current pipeline does, so the comparison is against measured behaviour and not against
the spec's description of itself.

**If you find a shape backward resolution CANNOT express, say so plainly and stop hedging — that is
the most valuable possible result and it kills the proposal cleanly.**

## SCOPE — hard boundaries

- **Change NO compiler behaviour.** No edits under `compiler/src/`. This is measurement only.
- Do **not** build backward resolution. Do not prototype it in the compiler.
- Do **not** touch `emit-expr.ts`'s orphan fallback — a separate fail-closed arc lands after you.
- ⚑ A sibling agent is live on `compiler/src/codegen/emit-logic.ts` + `compiler/SPEC.md` +
  `conformance/cases/control-flow/ctrl-02*`. **Do not write those paths.** Reading is fine.

## OUTPUT

`docs/changes/s397-tilde-trigger-measurement/FINDINGS.md` — buckets with counts + method + error
bars, the six-shape table, and a plain verdict: **does backward resolution survive `lift`, and what
is bucket C's real size?** Lead with the answer, not the process.

## WORKSPACE RULES

- Startup gate: `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
  VCS toplevel equals it; clean tree. Else STOP and report.
- `bun install`. Run `pretest` PLAINLY from the worktree CWD — ⚑ `bun --cwd <path> run <script>`
  silently no-ops and exits 0.
- Get this brief: `git fetch origin research/s397-tilde-trigger-measurement && git checkout FETCH_HEAD -- docs/changes/s397-tilde-trigger-measurement/`
- ⚑⚑ **NEVER `git stash`** — `refs/stash` is shared across every worktree including the PA's main
  checkout and a live sibling agent's. Use file copies.
- ⚑ **Never a bare `pkill -f` / `killall`** on a command string every checkout shares.
- Commit incrementally + append-only `progress.md`. ⚑ **A research dispatch has no natural crash
  anchor — commit partial findings as you get them.** A timeout with everything in your head loses
  100%.
- Never `--no-verify`.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first (stamp `8e278c73`); follow Task-Shape Routing to the
codegen/type-system maps. HEAD is `c91969c7`; landings past the stamp are docs-only. Treat map claims
as verify-against-source hypotheses and report whether they were load-bearing.
