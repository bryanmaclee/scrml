# s451-boot-else-chain — progress

## 2026-10-03 — start
- Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a95b283d15140252f, base b490f3b75 (== origin/main).
- REPRODUCED on main (bootstrap front end + slice-m1 runtime in happy-dom): the brief's chain
  (`#one if=(@step == 1)`, `#two else-if=(@step == 2)`, `#rest else`) rendered `one,two,rest` at
  step 1 and `two,rest` at steps 2 and 3. Cause: analyze classified `else` as a static attribute and
  `else-if=(…)` as a bound attribute; lower wrapped only `if=`. Relayed premise CONFIRMED.
- Adjacent fail-opens found while probing the same `if=` mechanism (reproduced, same program, `@ok = false`):
  - `<p if="@ok">` (quoted condition) → rendered (count 1): valueExpr(Quoted) = not → condWrap left it unwrapped.
  - `<p if>` (valueless) → rendered.
  - `<*card if=@ok/>` → rendered: resolveStar ignores every attribute that is not a field name.
- Baseline counter (`bun scripts/bootstrap-conformance.ts`): PASS 42 · CODES-ONLY 0 · FAIL 18 ·
  LEGACY 951 · UNSUPPORTED 277 · graded 60 (42 hold, 27 non-vacuous). control-flow: 50 LEGACY, 12 UNSUPPORTED.
  Every if-chain case in conformance/cases/control-flow is LEGACY (rhs-decl / no-program-root /
  `<session {…}` state openers) or parse-reject — none is graded on the bootstrap today.

## Governing sentences (compiler/SPEC.md §17.1, §17.1.1 — read in full, plus §17.1.2*)
- §17.1: "When `expr` evaluates to false, the element is NOT rendered. It does not exist in the DOM."
- §17.1.1 Syntax: "An `if=` chain is the maximal contiguous sequence of sibling elements beginning with an
  element carrying `if=` and followed immediately by zero or more elements carrying `else-if=` and
  optionally one final element carrying `else`. The sequence ends at the first element that carries none
  of `if=`, `else-if=`, or `else`." / "Intervening whitespace-only text nodes are not considered to break
  a chain."
- §17.1.1 Desugaring: "An if-chain desugars to a single `${ if / else if / else }` block in the
  containing markup context." / "The structural attributes are consumed during desugaring and do not
  appear on the lifted element." → ONE View.Cond, first-true-wins (runtime `cond`).
- §17.1.1 Example 1: "Only one span exists in the DOM at any time."
- E-CTRL-001: "An element carrying `else` SHALL be immediately preceded at the same parent level by an
  element carrying `if=` or `else-if=`. The compiler SHALL reject any `else` attribute that does not
  satisfy this condition (E-CTRL-001)."
- E-CTRL-002: same sentence for `else-if=`.
- E-CTRL-003: "An `else` element SHALL be the terminal element of its chain. No element carrying `if=`,
  `else-if=`, or `else` SHALL appear immediately after an `else` element at the same parent level as part
  of the same chain. The compiler SHALL reject any element that would extend a chain past an `else`."
  An `if=` element begins a NEW chain (grammar `if-chain ::= if-element …`), so it is not "part of the
  same chain" → no E-CTRL-003 for `if=` after `else` (impl#1 agrees).
- E-CTRL-004: "`else` and `else-if=` SHALL NOT appear on a state object opener." — unreachable in the
  bootstrap: no state object opener reaches markup (a declaration inside markup is refused in resolveNode;
  the whitespace opener `< x …>` does not parse). Not implemented; nothing to ignore.
- E-CTRL-005: "`else` and `else-if=` SHALL NOT appear on the same element as `if=`."

## Decisions (searched §17.1, §17.1.1, §17.1.2, §5.2 — none found → E-BOOTSTRAP-UNSUPPORTED)
- `else` + `else-if=` on one element: SPEC names no rule → refused (impl#1 silently treats it as else-if).
- `else` with a value (`else=(…)`): §17.1.1 "The `else` attribute is bare (no `=` and no value)" but names
  no code → refused.
- quoted / valueless / braced `if=` or `else-if=`: §17.1 admits a quoted condition (`if="@n >= 3"`) but
  the bootstrap has no quoted-condition reader → refused (it rendered unconditionally).
- a chain attribute on `<*x/>` / `<slot>` / any element the chain lowering does not wrap → refused.
  (`<each>` / `<errors>` already refuse unknown attributes themselves.)
- Diagnostics are LOCAL per the SPEC sentences ("immediately preceded by an element carrying …"). Where
  this differs from impl#1's cascade: after an orphan `else-if=` an `else` is preceded by an element
  carrying `else-if=`, so E-CTRL-001 does NOT fire (impl#1 fires it); after E-CTRL-005 the next `else`
  is preceded by an element carrying `if=` (impl#1 fires 001). Both programs are already rejected;
  no conformance case covers either. Past an `else`: E-CTRL-003 AND 001/002 (both sentences apply;
  impl#1 agrees — ctrl-003-extend-past-else-pos documents the co-fire).
- Narrowing: an `else-if=` branch is typed under its OWN condition's narrowing (sound); the negations of
  the earlier conditions are not applied (conservative — fewer facts, never more). `else` gets none.
- Handles declared inside an `else-if=` / `else` branch are conditional (handlesInElem), like `if=`.
- state-child bodies are now resolved one sibling list each (`stateBodyLists`), so a chain can never be
  formed across two state-children's bodies.

## 2026-10-03 — fix landed on branch (ddb7c8a70) + conformance twins
- analyze (chainCheck / chainMember / chainHost / elemFactNow / condAttrOf / isChainAttr / stateBodyLists),
  lower (chainEnd / chainView / chainTest / bareElem / htmlView / useView). slice-m4/if-chain.test.js:
  30 tests, 27 fail on the pre-fix sources (bite verified by swapping HEAD's analyze/lower back in).
- self-host-v2 suites: 1294 pass / 0 fail. Pre-commit gate: 29944 pass / 0 fail.
- Counter AFTER the fix, existing corpus: unchanged (PASS 42 · FAIL 18 · graded 60) — every existing
  chain case is LEGACY / parse-reject.
- Added 5 `<program>` + `let <x/>` twins the bootstrap grades (control-flow/ctrl-00{1,2,3,5}-…-program-pos,
  control-flow/if-chain-program-first-true-rt). Severity is not asserted in the twins (a bootstrap Diag
  carries no §34 severity — the grader reports "severity unobservable"); the legacy twins pin it on impl#1.
  impl#1: the 4 codes twins PASS; the rt twin XFAILs (impl#1 does not parse `let <x/>`: E-STATE-UNDECLARED,
  runtime "let is not defined") under the carried gap g-impl1-value-writes-state-codes-unimplemented-s449
  (whose title names the §66 opener) — PA may re-point to a dedicated impl#1 opener gap.
- Counter with the twins: PASS 47 · FAIL 18 · graded 65 · non-vacuous 32 (was 42 / 18 / 60 / 27).

## 2026-10-03 — self-review probes
- `//` line comments (trailing or own-line) and `<!-- -->` between chain members: the bootstrap parser
  drops them, so they do not break a chain (no false E-CTRL-001). Not asserted in tests (parser behaviour).
- origin/main had not moved at the end of the work (no rebase needed). FACTS.md regenerated in a separate
  final commit (conformance case count 1288 → 1293).
