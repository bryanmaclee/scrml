---
from: S429-peter (P-Tech1)
to: bryan
date: 2026-09-23
subject: "your #996 note acted on; three language questions from the S429 landings"
needs: ruling
status: unread
---

# Reply to your S428 note, and two questions that are yours

## Your note: done
- **The H1 inversion.** The lift-body fix merged #996 in its round 3 and dropped the "fall back to base's loud
  failure" design. `E-ASSIGN-004` now reports the `const` writes, and the codegen no longer double-reports them.
  It landed as **#1032** (`069ade68`).
- **r2/r3/r3b/r3c.** Agreed, these are true positives. #1032's tests assert `E-ASSIGN-004` on those shapes. The
  repro files stay as the round-1 record.
- **Your top-level HIGH** (`g-top-level-logic-reassignment-lowers-as-a-fresh-const-so-the-let-escape-fails-there`)
  is **fixed for its `let` form by #1032**. I checked it by running it: `${ let n = 1 }` then `${ n = 2 }`
  fails the compile on `87c2df3e` and renders `2` on the branch. **I left it OPEN** for the
  function-parameter half, which #1032 does not touch.
- **More `E-ASSIGN-004` holes** turned up and are filed as `g-e-assign-004-position-and-binder-coverage`
  (MED, your lane), de-duplicated against your #1031 entries:
  - a write inside `${…}` logic in lifted markup;
  - a `const` loop binder written in a function body;
  - expression form `const g = (t = 3)`;
  - a false positive on a destructured `let` loop binder that shadows an outer `const`.

## ⚑ Question 1 — is a keywordless loop binder mutable?
`for (it of @items) { it = it + "!"; lift … }`
- §17.4a makes the keywordless head canonical.
- §50.8.5 says a binding "created WITHOUT `let`" is `const`, and "`let` is the only form that produces a mutable
  binding".

Read literally, the binder is `const`. **#1032 keeps it compile-loud** (E-CODEGEN-INVALID-LOGIC, which names the
binder) until you rule; main also failed it, by accident. Only `for (let x …)` makes a binder write take effect.
If you rule it mutable, the predicate to flip is recorded in
`docs/changes/s427-lift-body-lowering/progress.md`.

## ⚑ Question 2 — should the two click contracts converge?
The spec defines neither (§5.2.1 says only "SHALL wire `fn` as an event listener"):
- **Page markup** is document-delegated, and only the INNERMOST handler runs. With
  `<div onclick=outer><button onclick=inner>`, clicking the button logs `inner;` only.
- **`<each>`-row handlers** are element listeners with native bubbling: inner first, both fire,
  `stopPropagation` is honoured.

**#1033** (`c8eb9cd9`, `<match>` inside an `<each>` row) makes each match arm follow the same contract as the
markup around it, without picking one. One visible effect: a row-arm button that reads no arm name now bubbles
to a page-level delegated ancestor (`del;outer;`), exactly as a plain row button already did on main. Should
there be one contract, and if so which?

## ⚑ Question 3 — an `<engine>` inside an `<each>` row: refuse it, or render one shared engine per row?
`<each in=@groups as g><li>${g.name}<engine for=Phase initial=.Active>…</></li></each>` compiles at exit 0 and
the engine body is **silently dropped**: `emit-each.ts:1999` `renderTemplateChildToJs` emits only
`// each: unhandled template child kind="engine-decl"`. This is filed as
`g-engine-inside-each-row-renders-nothing` (HIGH), and a PA trace found the locus.
- §51.0.A trait 1 makes an engine a SINGLETON.
- §51.0.D makes the declaration the mount.
- §51.0.K / `SPEC.md:10869` forbids an engine in a component body because "every component instance would need
  its own engine instance". That reasoning applies word for word to an `<each>` row, but no sentence covers
  iteration.

The two coherent answers:
- (a) **refuse it:** a compile-time error, reusing or siblinging `E-COMPONENT-ENGINE-SCOPE`, since the
  multiplicity argument is the same;
- (b) **render the ONE singleton's body in every row,** all rows sharing one state.

Either one picks semantics, so I have not built it. My lean is (a): it matches the component precedent, and
(b) would make a transition in one row visibly change every row, which no author writing it per-row expects.
