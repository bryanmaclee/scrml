# AUTO questions — what bryan reads when he breaks in ("the Qs")

Newest first. One at a time (axiom floor). Each: context · options · recommendation · what it blocks.

## 2026-10-09 · is-some retirement — does `is some` retire now that `is given` is the explicit positive? (dpa-070 §10 Q4)
- S460 ruled one presence test: bare `x` on `T | not` in conditions, `x is given` / `x is not` as the explicit pair. `is some` is still accepted and narrows (ratified as the alias of `is given`). 241 corpus sites use it, 94 in stdlib.
- (a) [rec] retire through the §63 window: W-lint now + reserved E-code + a `scrml fix` rule rewriting to `is given` (mechanical — `is-some` is its own AST op). (b) pre-1.0 strike (§63.7), no window. (c) keep both as permanent aliases.
- Blocks: nothing urgent; the two-spellings-of-one-test cost grows with every new site.

## 2026-10-09 · given-as-presence — does `given x :>` (in-place guard + match arm) retire? (dpa-070 §10 Q5)
- The rebind `given c = @h :>` (§66.7.5) stays either way. In-place `given` has 9 corpus uses, all S19 gauntlet fixtures, and `given @cell :>` is currently BROKEN on impl#1 (HIGH gap, ReferenceError).
- (a) [rec] retire in-place `given` (arm becomes `not :>` + `else :>`); fix nothing in its lowering. (b) keep it and fix the lowering.
- Blocks: whether queue item 2's first HIGH gap is fixed or retired — AUTO will fix it unless this is answered (a).

## 2026-10-09 · impl1-adopt — does impl#1 adopt the S460 condition rule, or stay Nominal until the bootstrap replaces it?
- impl#1 still lowers bare `if (@x)` on an optional as JS truthiness (`""`/`0` hidden). The S460 measurement found 2 sites whose visible behaviour would flip silently (trucking `if=(l.weight_lbs)`).
- (a) [rec] stay Nominal on impl#1 (S440 Q2 "impl#1 keeps today's behaviour"); migrate the 2 sites to `is given` by hand. (b) adopt in impl#1 now (newly-rejecting + semantics-changed; measured migration first).

## Carried from S459 (dPA verdicts awaiting a ruling) — deep-dives in scrml-support/docs/deep-dives/*-2026-10-08.md
- **dpa-065** (O35): a non-literal own value needs `:T`? — rec: infer within a file from the initializer; failed inference = hard error; live fork = require `:T` where the type leaves the compilation unit.
- **dpa-068**: bare `return`/`fail`/`break`/`continue` as a match-arm body — W1 4–1, + one §18.4 sentence.
- **dpa-069** (O18): undeclared use-site attributes — R now (E-DECL-USE-ATTR + §34 row; 0 adopter sites) + X (typed opt-in forwarding) as the only widening.
