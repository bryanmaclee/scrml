---
from: S438-peter (P-Tech1 — PA)
to: bryan
date: 2026-09-27
subject: "S438: five landed, three hold refs for you, three new codes to review, one SPEC line to confirm"
needs: action
status: unread
---

Every item below went through adversarial S239 review; each gift-wrap is pre-built on a hold ref so your answer is one word.

## 1. Hold refs waiting on you
- **`hold/s438-1109-review-fixes` @ `eb3de63d` — your bootstrap (slice M2).** My second S239 pass on #1109 found:
  F1 HIGH (PA re-executed) spread overrides write in sequence — `@p = { ...@p, x: @p.y, y: @p.x }` gives 2,2 not 2,1
  (§66.11.3 item 1); F2 MED direct `@h` read/write inside its own `given` refused (§66.7.5 O56); F3 LOW the §66.19 drift
  guard fails on CRLF. Fixes + red-on-base tests on the ref (slice-m2 89/0, lowered m1 73/0, PA re-ran). **Merge? (yes/no)**
  Open question the fix does not answer: a spread's writes are separate — if a later field write is refused at runtime,
  earlier ones stay applied. **All-or-nothing? (yes/no)**
- **`hold/s438-refusal-writes-no-dist` @ `074f1630` — `g-session-config-refusal-still-writes-dist`.** Q: when a build is
  refused with E-MW-007/008, should `build`/`compile` write nothing?
  (a) status quo — exit 1 but a full dist lands; on a REBUILD the previous `_server.js` stays beside the new split units and
  serves 200 on the split; (b) **narrow fail-closed (recommended)** — decided before any write, E-MW-007 judged over the
  post-write unit set, output dir untouched, success byte-identical, three review rounds; (c) fail-closed on ALL hard errors —
  same hook, wider test; brings §6.6.10 into conformance (filed `g-derived-circular-dep-still-writes-output`) but reverses the
  §34 E-CG-TILDE-UNRESOLVED deferral; unmeasured. Declared by (b): a refused build no longer surfaces write-phase-only
  diagnostics; `beforeWrite` receives pre-redaction errors (new API surface). **(a/b/c)**
- **`hold/s438-impl1-imported-enum-match` @ `5bea376e` — impl#1 F11/F15/F16/F17 (bootstrap blockers).** NOT for you to
  merge yet: held by me because the branch turns one loud crash silent (cross-file bare-dot argument, see the gap). FYI only —
  it makes your named-binding / binding-forcing workarounds revertible once it lands.

## 2. New diagnostics (built, landed; review of the built thing per S313)
- **E-SCHEMA-012 / E-SCHEMA-013** (#1116, your S435 "1 both" ruling): a qualified `<schema>` `CREATE TABLE` head /
  an unreadable one. Newly-rejecting at corpus zero. Known fail-closed false positives are listed on the gaps.
- **E-MATCH-ALT-BINDING** (#1119): an alternation arm may carry only POSITIONAL `_` inside payload parens; bindings, named
  fields (even `a: _`) and nested/literal payload patterns are rejected — before, they compiled clean and silently dropped the arm.
  Newly-rejecting at corpus zero. (Lowering binding alternation under the §51 E-ENGINE-016 aligned-binding rule is the
  alternative, if you want it.)
- **E-MW-008 narrowed** (#1112): a `kind="tool"` FILE is not an application — folded into the E-MW-008 review you are owed.

## 3. One SPEC line to confirm
- #1114 replaced §20.5.1's "Step 1 is stronger than it looks" paragraph: S433 left open whether an inferred default outranks a
  program's declaration; it now says **does not** (the gap's filed fix direction). **Confirm? (yes/no)**

## 4. Filed, directions yours
`g-page-session-secure-three-way-disagreement` (lean: strike from SPEC) · `g-two-programs-one-file-session-attr-last-wins`
(MED proposed — a file whose FIRST program is `auth="optional"` and a later program holds a `protect=` db never escalates,
so that db's routes carry no auth check) · `g-schema-create-temp-table-silently-not-a-declaration` (HIGH) ·
`g-schema-dsl-qualified-table-head-silently-stripped` (HIGH) · `g-schema-commented-out-declaration-shadows-live-table` (HIGH) ·
`g-schema-no-column-list-heads-declare-nothing` (MED) · `g-clientjs-skips-relative-import-rebasing…` browser half re-opened
(copy helpers into dist vs a diagnostic).

## 5. Bootstrap workarounds revertible now (#1119 landed; not edited by me)
F12: `lex.scrml:912`, `slice-m1/lint.test.js:95`, notes `print.scrml:24`, `parse.scrml:32`. F13: `check.scrml:91/101`,
`print.scrml:431/439/656`, notes in `ast.scrml:21`, lower, analyze. F14: `LB()`/`RB()` in `js.scrml:69`, `parse.scrml:43`,
`analyze.scrml:171`.

— S438-peter
