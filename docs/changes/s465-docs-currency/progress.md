# s465-docs-currency — progress

- 2026-10-12T07:15Z — startup verification PASS: worktree `agent-a6ed7781f549de04f`, remote `bryanmaclee/scrml`,
  branch `s465-docs-currency` reset to `origin/main` = `41af4153a` (brief named `1c1e9eee`; main advanced),
  merge-base == origin/main. `bun install` OK; `bun run pretest` OK, `samples/compilation-tests/dist/` present.
- 2026-10-12T07:18Z — BEFORE counts (grep):
  - `docs/PA-SCRML-PRIMER.md`: `is some` = 9 occurrences (8 lines); in-place / pseudo-rebind `given` guard code
    forms = 7 (L641 table `given u = expr {}`, L655 `given u :>`, L666 match arm `given u :>`, L958 `given x :> …`
    ×2, L1088 `given seen = @visited.has(n) {…}`, L1104 `given _ = @seen[key] {…}`), plus prose naming `given` as a
    presence discriminator at L701, L720.
  - `docs/articles/llm-kickstarter-v2-2026-05-04.md`: `is some` = 15 occurrences (12 lines); in-place `given`
    guard forms = 3 (L356, L1144, L1171), plus prose at L1143.
- 2026-10-12T07:19Z — commit 1: archive BRIEF.md + this file. Docs-only diff (`docs/` only) — pre-commit suite
  skipped per the brief's docs-only allowance.
- 2026-10-12T07:22Z — commit 2 (`9d6e98243`): `docs/PA-SCRML-PRIMER.md` rewritten. Docs-only; suite skipped.
- 2026-10-12T07:27Z — commit 3: `docs/articles/llm-kickstarter-v2-2026-05-04.md` rewritten. Docs-only; suite skipped.

## Governing SPEC sentences (quoted at origin/main `41af4153a`)

- **`is some` → `is given`** — §42.2.2a: "`expr is some` is the soft-deprecated spelling of `expr is given`
  (§42.2.4). It parses IDENTICALLY … and every site SHALL surface the info-level lint **W-IS-SOME-DEPRECATED**" ·
  "The canonical spelling is `expr is given`, which stays `lang: 1.0`." (S462, #1385)
- **validator `<x is some>` → `<x is given>`** — §55.1: "`<x is some>` is the soft-deprecated spelling of
  `<x is given>`: the same predicate, the same `.NotSome` error tag (§55.9) … The `ValidationError.NotSome` tag is
  NOT renamed by this deprecation."
- **narrowing** — §42.4 statement 8: "`x is given` and `x is not` are `bool`-valued. Where `x` is a place … `x is
  given` narrows it to `T` where the test is true"; statement 2: "A bare `T | not` is a presence test." (used for
  `<p if=@user>`); statement 7: as an operand of `&&`/`||` a bare `T | not` is E-OPERATOR-OPERAND-TYPE (hence
  `@z is given` inside the and/or example).
- **in-place `given` guard retired** — §42.2.3: "The in-place presence guard this section defines — `given x :> { … }`,
  the multi-name `given x, y :> { … }`, the same guard inside a markup `${ … }`, and the `given x :>` match arm — is
  soft-deprecated." Table: `given x :> { … }` → "`if (x is given) { … }`, or the bare presence test `if (x) { … }`";
  `match x { not :> A  given x :> B }` → "`match x { not :> A  else :> B }`"; "The **rebind head** `given c = @h :> { … }`
  (§66.7.5) is a different form and is NOT in the window." (S462, #1392)
- **window** — §63.1 Stage 1: "The deprecated form **parses identically** — same AST, same emitted JS, same runtime.
  The compiler fires the `W-`lint at every site … **No removal version is set.**"

## Rewrites (doc → old → new)

| # | Doc / locus | Old | New |
|---|---|---|---|
| P-a | primer §6.5 lifecycle table | `given u = expr {}`, `if (u is not) return`, `match` | `if (u is not) return`, `if (u is given) { … }`, `match u { not :> … else :> … }` + impl#1 note |
| P-b | primer §6.5 lifecycle example | Form 1 `given u :>`, Form 3 `given u :>` arm (+ legacy `=>`) | early-return form only; block/match forms moved to a prose note naming the impl#1 gap |
| P-c | primer §6.5 asymmetry + xref | `is some` / `given`; "§42.2.3 given guard (form 1)" | `is given`; §42.2.2a/§42.4 + §42.2.3 marked soft-deprecated |
| P-d | primer §8 validator vocabulary | `is some` | `is given` (+ deprecated-spelling note) |
| P-e | primer §9.4 heading/table/loci + `given x :>` bullet | `is some`, "`given x :>` canonical narrow-to-present" | `is given`; new bullet: one presence test both branches and narrows, + snippet |
| P-f | primer §10 set idioms | `given seen = @visited.has(n) {…}`, `given _ = @seen[key] {…}` | `if (@visited.has(n)) {…}`, `if (@seen[key] is given) {…}` |
| P-g | primer L5 row | `is some` reused | `is given` (spelled `is some` until S462) |
| P-h | primer — NEW deprecated-forms note after §9.4 | — | names `is some` / `<x is some>` / `given x :>` / `given x, y :>` / markup / arm as §63 Stage 1 |
| K-a | kickstarter §3.2 lifecycle | `given u :> { const name = u.name }` | `if (u is not) return` + `const name = u.name` + impl#1 note |
| K-b | kickstarter §6.1 validator table | `is some` / `<x is some>` | `is given` / `<x is given>` |
| K-c | kickstarter §7 mistakes rows | `given` as discriminator; `given x :>` as canonical narrow-and-use | `is given` / `if (x is given) { use(x.name) }` canonical; `given x :>` soft-deprecated |
| K-d | kickstarter §7.1 and/or | `@z is some` ×2 | `@z is given` ×2 |
| K-e | kickstarter §7.1 keyword list | `is some`; `given X :> {}` narrow-AND-use | `is given` (narrows); deprecated-forms bullet |
| K-f | kickstarter §11.2 auth | `<p if=(@token is some)>` | `<p if=(@token is given)>` |
| K-g | kickstarter §12 `~`/while tokenize | `is some` + `lift` in function + `return ~` | `is given`; collects to array (old form did not compile, see below) |
| K-h | kickstarter §12 findFirstMatch | `if (m is some)` | `if (m is given)` |
| K-i | kickstarter §12 assign-as-expr | `is some` + top-level `lift`/`return ~` | `is given`; wrapped in `function readRows()` collecting to array |

## Per-snippet compile table (`bun compiler/bin/scrml.js compile`, `.tmp/snip/`)

Fragments get a minimal harness (`<program>` wrapper, declared types/cells, stub functions); the changed lines are
verbatim. "PASS" = compiled, 0 errors.

| Snippet | Content | Result |
|---|---|---|
| p1 (P-b) | lifecycle `(not to User)` + `?{}` loadUser + `if (u is not) return; u.name` (db harness) | PASS |
| p1b (P-b) | same + the doc's `u2.name` pre-transition line | 1 error, exactly the documented E-TYPE-001 — as intended |
| p1-old-blockform | `if (u is given) { u.name }` on the lifecycle binding | FAIL E-TYPE-001 — impl#1 gap (see below); kept OUT of the example |
| p1-matchform | `match u { not :> … else :> … }` (and the old `given u :>` arm) | FAIL E-TYPE-024 (struct-typed subject) — pre-existing; kept out |
| p2 (P-e) | `<user>: User | not`, `if (@user is given) { @greeting = @user.name }`, `<p if=@user>` | PASS |
| p3 (P-f) | `set[int]` `.add`/`.has` in `if`, `[string: bool]` `.insert` + `if (@seen[key] is given)`, `.union`, `<each>` | PASS (harness: `NodeId`/`K` → `int`) |
| k1 (K-a) | `server fn loadUser -> (not to User)` + early-return + `u.name` | PASS |
| k2 (K-b) | `<x is given>: string | not = not` validator + `<name req>` | PASS |
| k3 (K-d) | `const <c> = @x is .Active and @y == 1 and @z is given` (+ `&&` form) | PASS |
| k4 (K-f) | the whole §11.2 auth recipe, verbatim | PASS |
| k5 (K-g) | tokenize, verbatim from doc after fix | PASS. BEFORE the fix: FAIL — E-SCOPE-001 (`m`, `TOKEN_RE`), E-SYNTAX-002 (`lift` in a `function` body, §49.6.2) |
| k6 (K-h) | findFirstMatch, verbatim | PASS |
| k7 (K-i) | readRows (harness supplies `readLine`/`parseRow`) | PASS. BEFORE the fix: FAIL — E-STMT-RETURN-OUTSIDE-FUNCTION (`return ~` at top level) + the undeclared placeholders |

## Finding — impl#1 gap (NOT fixed here: docs-only)

`if (u is given) { u.name }` on a lifecycle `(not to User)` function-return binding fires **E-TYPE-001** on impl#1
(`is some` likewise); the deprecated `given u :> { … }` does not. §42.2.3 says "Each canonical form narrows what the
deprecated form narrows", but the §14.12.6.1 lifecycle tracker only credits `given` / `if (x is not) return` /
`match`. SPEC §14.12.6.1 / §14.12 (L2874, L13923) also still list `given` as the discrimination form, and the
E-TYPE-001 message still recommends `given u => { … }`. Both docs now teach the early-return form, which compiles.

## Gates

- `bun scripts/snippet-gate.js` — 128 passed, 0 failed. It covers the `.scrml` files public docs cite (README /
  tutorial / website), NOT these two markdown docs — so the per-snippet table above is the gate for them.
- Pre-commit suite: skipped for commits 1-3 (diff touches only `docs/`), per the brief.

## AFTER counts

- primer: `is some` 9 → 4, all 4 NAME the deprecated spelling (§8 note, deprecated-forms note ×2, L5 history row);
  teaching uses = 0. In-place `given` guard code forms 7 → 0 teaching uses; remaining mentions are the
  deprecated-forms note and the §6.5 "do not write it" note.
- kickstarter: `is some` 15 → 3, all naming the deprecated spelling (§6.1 table note, deprecated-forms bullet ×2);
  teaching uses = 0. In-place `given` guard forms 3 → 0 teaching uses; remaining mentions are the mistakes-table
  "wrong pattern" column, the deprecated-forms bullet and the §3.2 impl#1 note.
