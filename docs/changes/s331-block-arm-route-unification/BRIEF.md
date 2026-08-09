# BRIEF — §18.5 block-arm body: unify the three lowering routes

**Dispatched:** S331-bryan, 2026-08-08. **Agent:** `scrml-js-codegen-engineer`, `isolation: "worktree"`.
**Base:** `main` `b4fb2f1f`. **Gap:** `g-match-block-arm-body-has-three-divergent-lowering-routes` (HIGH).
**Authorization:** bryan, S331 — *"go, take 1"*.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, then follow its **Task-Shape Routing** section to the maps
for a codegen task. Treat map content as a **verify-against-source hypothesis**, not fact.

- Map stamp: **`35d4d32e`** / 2026-08-07.
- True HEAD: **`b4fb2f1f`**.
- **Post-map landings you MUST factor in — two of them are the exact code you are editing:**
  - **#469** (`e8db05a7`) — block-arm tail lift across all value-position IIFE paths; added
    `emitIifeBlockArmBody` (emit-control-flow.ts) and exported `planBlockArmLift` (emit-logic.ts).
  - **#470** (`73df79ed`) — unified the §18.5 tail **classifier** to one `_blockTailIsValueExpr`;
    deleted the structuredBody branch's ad-hoc predicate; `\s` fix in the assignment-guard regex.
  - #468, #472 — docs/continuity only.

Report the load-bearing map finding at the end, **including "not load-bearing"** if that is the answer.

---

## THE SYMPTOM (this is evidence — I reproduced all of it by emission)

`#470` unified the tail **classifier**. It did **not** unify the **emission route**. Three routes remain,
and the same source compiles to different meanings depending on the value position it sits in:

| position | route | nested assignment | tail after a block stmt |
|---|---|---|---|
| `return match …` | raw-string | ✅ `a = 1` | ✅ `return a` |
| `${ match … }` markup-interp | raw-string | ✅ `a = 1` | ✅ `return a` |
| `const <d> = match …` derived | derived | ✅ `a = 1` | ❌ `a;` → **`undefined`** |
| `const r = match …` local decl | tilde / statement-emitter | ❌ **`const a = 1`** | ✅ `_tilde = a` |

### Reproducer (compiles clean at `b4fb2f1f`; no diagnostic on either defect)

```
<program>

type Phase:enum = { Idle, Busy }
<phase>: Phase = .Idle
<items>: string[] = []
<out> = ""

const <derivedPos> = match @phase { .Idle :> { let a = 0; for (const i of @items) { a = 1 } a } .Busy :> 9 }

<INTERP_OPEN>
    function localPos() {
        const r = match @phase { .Idle :> { let a = 0; for (const i of @items) { a = 1 } a }  .Busy :> 9 }
        @out = "" + r
    }
    function selfRef() {
        const r = match @phase { .Idle :> { let a = 0; for (const i of @items) { a = a + 1 } a }  .Busy :> 9 }
        @out = "" + r
    }
<INTERP_CLOSE>

<div><INTERP_OPEN>@derivedPos<INTERP_CLOSE></div>
<button onclick=localPos()>go</button>

</program>
```

> **Note on the placeholders:** `<INTERP_OPEN>` / `<INTERP_CLOSE>` stand for scrml's logic-block
> delimiters (dollar-brace and closing brace). They are written as placeholders here ONLY to keep this
> brief safe to round-trip through shell heredocs and tooling. **Substitute the real delimiters when you
> build the reproducer file.**

**Compile it yourself before changing anything.** Command:

```
bun compiler/bin/scrml.js compile <file>.scrml --output-dir <tmpdir>
```

### Defect A — derived position drops a tail that follows a block-bodied statement

Emitted today:

```js
_scrml_cs_derived_declare("derivedPos", () => (function() {
  const _scrml_match_9 = _scrml_cs_reactive_get("phase");
  if (_scrml_match_9 === "Idle") { let a = 0; for (const i of _scrml_cs_reactive_get("items")) {
  a = 1;
}
a; }                                  // <-- bare expression statement, NO `return`
  else if (_scrml_match_9 === "Busy") return 9;
})());
```

The IIFE falls off the end → the cell holds `undefined`, which **does not exist in scrml** (§42.1.1,
S89 ABSOLUTE ruling). Straight-line bodies (`{ const t = 1; t }`, `{ let a = 0; a = a + 1; a }`) lift
correctly, so the trigger is specifically **a block-bodied statement immediately before the tail**
(`for` and `if` both reproduce; check `while`, `match`, nested blocks, `try`-shaped forms if any).

### Defect B — the tilde/local-decl route turns a nested bare assignment into a `const` declaration

Emitted today:

```js
function _scrml_localPos_4() {
  let _scrml_tilde_5 = null;
  ...
  if (_scrml_match_6 === "Idle") {
    let a = 0;
    for (const i of _scrml_cs_reactive_get("items")) {
      const a = 1;                     // <-- source said `a = 1` (an ASSIGNMENT)
    }
    _scrml_tilde_5 = a;                // <-- reads 0, not 1
  }
```

Two outcomes from the one defect:
- `{ … for (…) { a = 1 } a }` → **silent wrong value** (the tail reads the pre-loop value).
- `{ … for (…) { a = a + 1 } a }` → emits `const a = a + 1` → **runtime TDZ `ReferenceError`**, and
  **`node --check` on the bundle PASSES**. Do not use `node --check` as your oracle for this one.

**Scope check I already ran, so you don't have to re-derive it:** the identical statements inside a
plain `function` body (no match) emit correctly as `a = 1;`. So this is the structuredBody route's
per-statement `emitLogicNode` path, **not** general logic codegen.

---

## LOCI — ALL PA-LOCATED-VERIFY, NOT TRACED

I derived these from emitted output across four value positions. **I did not trace execution to any of
them.** Verify first; report whether each hypothesis HELD, was REFINED, or was WRONG.

- `compiler/src/codegen/emit-logic.ts` ~4721-4747 — the `arm.structuredBody` branch; per-statement
  `emitLogicNode(stmt, bodyOpts)` loop and the `_i === _tailIdx && stmt.kind === "bare-expr"` tail
  redirect. **Prime suspect for Defect B.**
- `compiler/src/codegen/emit-control-flow.ts` — `emitIifeBlockArmBody` (added #469), the raw-string route.
- `compiler/src/codegen/emit-event-wiring.ts` ~1193 — the derived-cell path. **Prime suspect for Defect A.**
- `_blockTailIsValueExpr` / `planBlockArmLift` (exported from emit-logic.ts) — the ONE classifier #470
  landed. **Do not add a fourth predicate.**

**Relevant contextual note (PRIMER §13.7, B16 specifics):** scrml's parser surfaces `name = expr` in a
function body as a **decl-shaped node** — there is no separate assignment-statement kind at that level.
The raw-string routes preserve source text and dodge this; the statement-emitter route does not. That is
a hypothesis about the mechanism, not a verified fact — check it.

---

## WHAT TO BUILD

**The root fix is ONE emission route for the §18.5 block-arm body**, completing on the *route* axis what
#470 did on the *predicate* axis. Per the fork rule, root beats per-position: do **not** patch three
call sites to agree.

Constraints:

1. **Behaviour-preserving where it is already correct.** The two raw-string positions
   (`return match`, markup-interp) are correct on both axes today. Whatever route survives must keep
   their emission **byte-identical** on the existing corpus.
2. **No new classifier.** Route the value/void decision through the existing `_blockTailIsValueExpr` /
   `planBlockArmLift`. The repo has a standing disagreeing-near-duplicate-classifier bug family (three
   async classifiers, two server-only-module predicates); do not extend it.
3. **Auto-await (§13.2) must survive.** #469 explicitly preserved auto-await on server-call tails.
   Re-verify it after the change.
4. **Void arms stay void.** §18.5: a block with no trailing expression yields `void`. Member/index
   assignment tails void per the #470 LOW fix. Do not regress either.
5. **If the honest answer is that route unification is bigger than the defects warrant, SAY SO and
   propose the alternative** — with the measurement that supports it. You are explicitly authorized to
   argue against this brief's approach. An agent that reports "the framing is wrong, here is why" is
   doing the job.

## STOP-IF-BIGGER

If unifying the routes turns out to require changing the parser, or to move behaviour on any position
that is correct today, **STOP and report** before building. Do not expand scope silently. A scoping
report is a successful outcome.

---

## VERIFICATION — required, and the differential is not sufficient on its own

1. **The reproducer above, all four positions**, compiled and the emitted JS inspected. Both defects gone.
2. **EXECUTE the bundle.** Do not stop at `node --check` — it passes on the TDZ case. Run the emitted
   client JS (real browser via the existing Chromium harness, or a real module execution) and assert the
   VALUES: `derivedPos` and the local-decl `r` must both be `1` with one item in `@items`, and the
   `selfRef` shape must not throw. This repo has shipped "emitted ≠ runs" three times (S265 theme-switch
   DOA, S268 value-attr ReferenceError, S278 U3 per-route DOA). Grepping emitted text is not verification.
3. **Full-corpus emit differential.** Use `scripts/corpus-emit-differential.ts` (the instrument #428
   built). Expect near-zero — **and state the expectation before you run it.** A `0 of N changed` result
   here means *the corpus does not exercise the shape*, NOT *the fix is safe*; #470's clean `0 of 7296`
   is exactly how both these defects shipped. Say which axis your differential does and does not cover.
4. **Conformance cases — this is a hard requirement, not a nicety.** Add cases pinning **both** axes
   that were unenumerated: (a) tail-shape — a tail following `for`, following `if`, and a straight-line
   tail; (b) nested-statement fidelity — a bare assignment and a self-referencing assignment inside a
   nested block. Pin them **in every one of the four value positions**, since position is precisely what
   diverged. Both halves: codes AND runtime effect.
5. **Conformance suite green** (`bun conformance/run.ts`) — 868/868 or better.
6. **Full suite** via `bun run test` (chains pretest). Report pass/fail counts.

---

## OPERATIONAL — read these, they have cost previous dispatches whole runs

- **Worktree startup (F4):** `bun install` (worktrees do NOT inherit `node_modules` — the pre-commit
  hook fails with "cannot find package 'acorn'" otherwise), then `bun run pretest` (populates the
  gitignored `samples/compilation-tests/dist/` browser fixtures; ~130 ECONNREFUSED-shaped failures
  without it). Use `bun run test`, never bare `bun test`, for baselines.
- **⚑ BACKGROUND EVERY LONG COMMAND.** The local post-commit hook re-runs the whole `compiler/tests/`
  tree after pre-commit already ran — **~9 minutes of silence per commit** — and the harness watchdog
  kills a run after 600s of no output. This killed five agent runs across three agents in S326. It
  applies to `git commit`, `bun install`, and `bun run test` alike. Background them and poll.
- **Commit after every meaningful change**, do not batch. Append to
  `docs/changes/s331-block-arm-route-unification/progress.md` (append-only, timestamped: what was just
  done, what is next, blockers). The branch + progress.md are the crash-recovery anchor.
- **NEVER `--no-verify`** without explicit authorization, and never override `core.hooksPath` to dodge
  a slow hook. That escalation was flagged as a security concern at S283. If a gate blocks you, report it.
- **Path discipline:** all writes via Edit/Write on **worktree-absolute paths**. Never `cd` into the main
  checkout. Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`. Echo `pwd` in your first
  commit message. The PreToolUse hook guards Edit/Write; it cannot see Bash writes.

## REPORT BACK

Workspace path · final commit SHA · files touched · **whether each named locus held / was refined / was
wrong** · the emitted-JS before/after for all four positions · the execution result (values, not text) ·
the differential result **with its coverage caveat stated** · the conformance cases added · suite counts ·
anything you chose NOT to do and why.

I run the S239 adversarial pass on your diff before anything lands. Findings route back to you as a fix
round — expect one.
