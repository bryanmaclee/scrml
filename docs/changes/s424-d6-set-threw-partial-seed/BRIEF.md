# BRIEF — item 3: a genuine `set-threw` is silent whenever any OTHER seed key landed

**change-id:** `s424-d6-set-threw-partial-seed`
**dispatched:** S424-peter, 2026-09-20
**base:** `origin/main` @ `6f213495`
**gap:** item 3 of `g-d6-seed-gating-has-three-latent-paths-that-produce-a-verdict-from-a-failed-or-unmeasured-seed` (MED, open)

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

Your FIRST action is a gate. If ANY check fails, do NOT proceed — report and exit.

1. `pwd` — it MUST start with `.../scrml/.claude/worktrees/agent-`. If it is the shared checkout
   (`.../GitHub/scrml`), STOP and report wrong-root allocation.
2. `git rev-parse --show-toplevel` MUST equal that same worktree root.
3. `git status --short` MUST be clean.
4. `git merge-base HEAD origin/main` MUST equal `origin/main` — the worktree is cut from
   `origin/main`, NOT from the dispatcher's HEAD. Assert it so a wrong base fails loudly.
5. `bun install` — a worktree does NOT inherit `node_modules` (you will get "cannot find package
   'acorn'" otherwise).
6. Do NOT run `bun run pretest`; this tier does not need the browser fixtures. ⚑ If you do need it,
   run it from the worktree CWD or with `--cwd=<path>` **with the `=`** — `bun --cwd <path> run X`
   silently no-ops and **exits 0**.

**Every** Read/Write/Edit targets an ABSOLUTE path under the worktree root. Never `cd` into the shared
checkout; use `git -C "$WORKTREE_ROOT"` and `bun --cwd=...`.

⛔ **NEVER `git stash`.** `refs/stash` lives in the COMMON `.git` dir and is shared across every
worktree — a stash here can be popped into the main checkout or vice versa (witnessed, S385). Do
base-vs-build flips by FILE COPY.

⛔ **NEVER a bare `pkill -f` / `killall` on a command string.** Every checkout shares the string, so it
kills the dispatcher's suite too and leaves no trace on your side (witnessed, S376). Kill by PID
captured at launch, or filter on cwd.

⛔ **NEVER `--no-verify`.**

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first and follow its Task-Shape Routing.

⚑ **THE MAP IS STALE FOR THIS TASK AND YOU MUST FACTOR THAT IN.** Its stamp is `787d4cb4`; base is
`6f213495`, **10 commits later**, and those commits include **#993 (`bb9101ea`), which CREATED the
machinery you are changing** (`render-detectors.js` D6 region-scoped emptiness, `render-harness.js`
seed bridge, the `d6-nested-each-empty-with-data` fixture). Treat any map claim about this tier as a
hypothesis to verify against source. Report whether the map was load-bearing — "not load-bearing" is a
useful answer.

⚑ **One more in-flight change, so you are not surprised by a rebase:** a sibling branch
(`fix/s424-d6-unmeasured-gain`) changes `render-detectors.js:666` `=== null` → `== null` and adds one
test near the END of the `describe("D6 — seeded-and-empty is a RED state…")` block in
`detector-validation.test.js`. **Do not make that change yourself** and prefer adding your tests in
their own `describe` block so the two merge cleanly.

---

## THE DEFECT — traced, not searched

**`compiler/tests/e2e-render-map/render-harness.js`, the F4 loudness guard at ~`:741`:**

```js
if (seedReport && seedReport.writes.length > 0 &&
    !seedReport.writes.some((w) => w.wrote) &&
    seedReport.writes.some((w) => w.reason === "set-threw")) {
  const threw = seedReport.writes.filter((w) => w.reason === "set-threw").length;
  obs.consoleErrors.push(
    `[seed-bridge] ${threw} of ${seedReport.writes.length} seed write(s) threw and none landed — the seed cannot be live`,
  );
}
```

I read this code; the locus is traced, not inferred. The middle conjunct `!writes.some(w => w.wrote)`
means **NOTHING was delivered**. So with a ≥2-key fixture where the key driving the list **throws** and
an unrelated key **lands**:

- `seedWasDelivered` (`render-detectors.js:616`) is **true** (it is `writes.some(w => w.wrote === true)`),
- the guard above is **silent** (because something landed),
- the list renders nothing, and
- the cell reddens as `renders-empty-with-data` — **blaming the compiler for a seed write the harness
  itself failed to make.**

⚑ **Its own history:** this condition already shipped WRONG twice. Round 1 used `writes.every(...)`;
round 2 found that a `[{set-threw},{no-such-cell}]` fixture failed `every`, so nothing was pushed and
the throw vanished — the exact class F4 exists to prevent. **You are the third attempt at this
condition. Assume the obvious form is wrong and prove it is not.**

⚑ **Why it is latent today:** every corpus fixture is single-key, so "nothing landed" and "the one key
threw" coincide. The next arc on this tier rewrites those fixtures
(`g-e2e-render-map-seed-fixtures-are-wrong-in-three-of-four-entries`) and makes them multi-key — which
is what takes this live.

---

## WHAT TO DELIVER

**Requirement A (settled — build it).** A genuine `set-threw` must be surfaced **regardless of whether
a sibling key landed**. A throw is a harness failure on its own terms. The message must state the real
counts (how many threw, of how many writes) and must NOT claim "none landed" when some did — the
current wording is only true in the all-threw case.

⚑ Keep the existing carve-out: `no-such-cell` and `derived-cell` are the three KNOWN, TABLED fixture
bugs (see `SEED_OBSERVABILITY` in `e2e-render-map.test.js`) and must stay quiet. Only `set-threw` is
loud.

**Question B (NOT settled — decide it by measurement and tell me which way, with evidence).**
When the seed is only PARTIALLY delivered, should D6's verdict be **vetoed** (the way an UNMEASURED
`gainedContent` vetoes), or should it still fire?

- **The case for vetoing:** the fixture's intent was not delivered, so a `renders-empty-with-data`
  verdict is unsound and blames the compiler for the harness's miss. That is the gap's own framing.
- **⚑ The case against, and take it seriously:** `obs.set` throwing may itself be a **compiler** defect
  — a broken emitted accessor. Vetoing would then silence D6 on a real bug, which is the fail-open
  shape this whole guard exists to close. A loud console error that reddens via D2 may already be the
  right answer, making a veto both unnecessary and harmful.

**My lean is the loud-notice-without-a-veto** (requirement A alone), precisely because I cannot tell
from here whether a `set-threw` is a harness fault or a compiler fault, and the reversible direction is
to stay loud. **But I am not confident, and I would rather you overturn this with evidence than
implement it because I wrote it.** If you veto, you must show what stops it hiding a real accessor bug.

**Requirement C — the bite, both ways.** Add tests that FAIL on the unfixed harness and PASS after.
Show me both runs. A gate that has never failed is indistinguishable from one that cannot fail.

**Requirement D — measure the corpus impact, do not assert it.** Run the full tier
(`bun test compiler/tests/e2e-render-map/`) before and after and report the cell-state delta.
⚑ **Two GREEN→RED regressions are PRE-EXISTING on `origin/main`** and are NOT yours:
`benchmarks/todomvc/app.scrml#empty` (D1-MOUNT-THROW) and `examples/09-error-handling.scrml#empty`
(D0-COMPILE-ERROR). I verified both on clean `6f213495`. Report the delta against that baseline, not
against zero.

---

## YOU ARE LICENSED TO PUSH BACK

⚑ **Read this as load-bearing.** In the session that built this machinery, the dispatching PA was wrong
**three times** about a predicate in this exact file — including a "correction" that would have made
the detector dark on the only cell it exists for. All three were caught because the agent **measured
and refused** instead of complying.

So: if the traced locus above is incomplete, if requirement A's shape is wrong, or if my lean on
question B does not survive contact with the code — **say so, with the measurement**, and do not
implement what I asked for. Report whether the locus held, was refined, or was wrong.

---

## PROCESS

- **Commit after each meaningful unit** — WIP commits expected; the branch is the checkpoint.
- Maintain `docs/changes/s424-d6-set-threw-partial-seed/progress.md`, append-only, timestamped:
  what you just did, what is next, blockers.
- Report at the end: worktree path, final SHA, files touched, deferred items, and the two tier runs.
- Do NOT open a PR and do NOT merge. The PA lands this.
