---
from: S428-bryan (XPS-8950)
to: peter
date: 2026-09-23
subject: "#996 landed, so your round-2 instruction INVERTS — and four of your own s427 repro files no longer compile, by design"
needs: action
status: unread
---

# Two consequences of `E-ASSIGN-004` landing today, both yours, both measured

`#996` merged as `db800e6e` — `E-ASSIGN-004` now fires at **statement position**, implementing the
S422 ruling: *a binding created without `let` is `const`; reassigning or mutating it is an error;
`let` is the only escape.*

## 1. ⚑ YOUR HELD ROUND-2 INSTRUCTION INVERTS. This was flagged as conditional and the condition fired.

The S425 hand-off carried this verbatim, as a sequencing interaction to tell you about **if** #996
landed first:

> S427's H1 finding instructs their held round-2 fix to **NOT mint or wire `E-ASSIGN-004`**, on the
> grounds that it lives in the open #996. **If #996 lands first, that instruction inverts** — tell
> peter.

It landed first. So: your hold ref `origin/hold/s427-lift-body-lowering` @ `089c0414` carries an H1
that told you to fall back to base's LOUD failure for a `const`/`lin`-declared name because
`E-ASSIGN-004` was bryan's and unlanded. **It is landed.** `E-ASSIGN-004` exists, is wired, and fires
in `function` bodies and at top-level `${}`. Re-read H1 against that before you resume the arc — the
reason for the fallback is gone.

⛑ **But check the position before you rely on it**, because the coverage is not uniform. Filed today,
all PA-reproduced by execution on the landing itself:

| position | does `E-ASSIGN-004` fire? |
|---|---|
| `function` body | **yes** |
| top-level `${}` default-logic | **yes** |
| **event-handler attribute** (`onclick=${a = 2}`) | **NO** — compiles at exit 0, `node --check` passes, throws `TypeError` on first click (`g-e-assign-004-never-fires-in-event-handler-attribute-position`, HIGH) |
| `++` / `--` on a `const` | **NO** (`g-e-assign-004-never-fires-on-increment-decrement-of-a-const-binding`, MED; `-=` fires correctly) |
| `lin` reassignment | **NO** — still `E-CODEGEN-INVALID-LOGIC` "this is a compiler defect, please report it", though §50.9 says `E-LIN-004` SHALL fire (`g-lin-reassignment-reports-a-compiler-defect-instead-of-e-lin-004`, MED) |

The `lin` row is the one that bites your H1 directly: if your fallback was going to lean on a loud
failure for a `lin`-declared name, the loud failure it gets today **blames the compiler for the
adopter's error**. That is filed, not fixed.

## 2. Four of your own s427 repro files no longer compile — and that is correct behaviour

A measured migration over the corpus was run before landing. Headline: **0 real corpus files newly
rejected** (519 compiled per side, 2,149 emitted artifacts byte-identical). A wider 2,396-file sweep
found exactly **5** files whose diagnostics changed:

- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-to-const-081.scrml` —
  a negative sample whose own first line reads `// assigning to a const — E-ASSIGN-004`. It had been
  passing silently. **This is the fix working.**
- **`docs/changes/s427-lift-body-lowering/review-round1/r2.scrml`, `r3.scrml`, `r3b.scrml`,
  `r3c.scrml`** — your repro artifacts for the open lift-body arc. All four use `${ count = 10 }` …
  `${ count = count + 1 }`, which is now `E-ASSIGN-004` by the ruling.

**They are true positives, not collateral.** But you cannot compile your own repros any more without
changing them, and nobody should discover that mid-arc. The mechanical fix is `let count = 10`; note
that at **top-level `${}`** the `let` escape is itself half-broken — `let x = 1; x = 2` and
`x = x + 1` fail `E-CODEGEN-INVALID-LOGIC` while `x += 1`, `x++` and the state-cell form `<x> = 1` /
`@x = @x + 1` all work (`g-top-level-logic-reassignment-lowers-as-a-fresh-const-so-the-let-escape-fails-there`,
HIGH, pre-existing and unchanged by #996). So prefer `+=` or a state cell in those four files rather
than a bare `let` reassignment.

⚑ One correction to that gap entry landed today too: it claimed the function-parameter case *"emits
`function _scrml_f_1(p) { const p = 3; … }`"*. It does not emit at all — it hard-fails
`E-CODEGEN-INVALID-LOGIC`. If you read that entry while scoping, re-read it.

---

Both items are in `docs/known-gaps.md` on the `ledger/s428-triage` branch (PR #1031) rather than on
`main` yet — the PR is open and green but this session's merge step is gated by its own harness
config, so it is waiting on bryan. The SHAs and repros above are all from execution on `db800e6e`,
which **is** on main.

— S428-bryan
