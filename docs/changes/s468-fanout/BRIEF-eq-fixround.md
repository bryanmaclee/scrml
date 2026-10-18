# unit-id: s468-structural-eq-everywhere — FIX ROUND 1 (from the S239 review of frozen 149e62ad5)
Work ON the existing branch (PR #1443): `git fetch origin s468-structural-eq-everywhere && git checkout -B
s468-structural-eq-everywhere origin/s468-structural-eq-everywhere`; assert HEAD == 149e62ad5217c4136f19abf958d4865a2ffabc2e.
(COMMON step 6 overridden.) Read the branch's docs/changes/s468-structural-eq-everywhere/progress.md first. Policy:
owner-granted TS-policy exception (user-voice S468). Reviewer probes (read-only): $HOME/.cache/scrml-agent-tmp/s468-rev-eq/probes/
(p6.scrml F1, lib/models.scrml F2, p2.scrml F4, p8.scrml F3); corpus hunks real-hunks.json. Reproduce each first.
FIX (introduced by this branch — must land with it):
F1 MED: `renderEq` (compiler/src/codegen/string-equality-lowering.ts) finds the operator with `gap.indexOf(n.operator)`;
   an operator inside a COMMENT between the operands splits there → `!_scrml_structural_eq(get("a") /* is it, ? */ != get("b"))`
   (base "eq", head "ne"). Find the operator TOKEN skipping comments (e.g. the tokenizer over the gap) — Rule 7: no new
   source-text regex in a post-AST stage without justification.
F2 MED: the gratuitous `(l === r)` paren-wrap creates an ASI hazard (`export const TAG = makeTag()⏎typeof LABEL ==
   "string" && …` → `TypeError: makeTag() is not a function`). Drop the parens (node-for-node swap keeps precedence);
   prove no other new-`(` site exists.
F4 MED (pre-existing helper defect that THIS branch newly routes inline handlers through): `_scrml_structural_eq`
   (compiler/src/runtime-template.js) compares host objects by own enumerable keys, so two same-tag DOM elements are
   equal (backdrop click: base "stay", head "close"). Make the helper fall back to IDENTITY for anything that is not a
   scrml value (DOM nodes / host-class instances / functions / non-plain prototypes) — read SPEC §45 for what IS a
   structural value and quote it; the fix applies to typed-fn-body comparisons too (they were already wrong on base).
FILE as gaps (locus= + prov=), do not fix: F3 MED — `isStaticallyPrimitiveEstree` and emit-expr's twin treat any
   member named `.name/.size/.length/.byteLength` as primitive, so struct-valued fields with those names compare by
   `===` (executed: false on equal structs); decide by type, not name. Also F5 items: E-EQ-001 misses number-vs-string
   literal; `and` in `<each>` per-item attribute → E-CODEGEN-INVALID-LOGIC; §45.2 `asIs` operands should lower to `===`
   with W-EQ-001; server raw-text residual loose `==` (now only described inside the resolved gap's text) as its own gap.
   Correct the resolved gap's wording so it does not claim `==` is structural everywhere (F3 is still open).
Tests for F1/F2/F4 (executed); re-run the 11 touched test files, conformance, security-await-pack classify (0 new FAIL),
and the corpus differential (expect the same 53 real hunks minus the paren-wrap form). Push after every commit.
