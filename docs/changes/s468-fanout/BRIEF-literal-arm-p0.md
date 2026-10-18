# unit-id: s468-literal-arm-block-p0 — P0: a literal-pattern match arm's BLOCK body is never parsed → unawaited server call → wrong password accepted
Policy limb: SECURITY (P0, live on main bbddfd7b9). Severity HIGH (there is no CRITICAL tier — priority, not tier).
Found by the S468 review of #1446 (relayed, executed by the reviewer — REPRODUCE FIRST). Artifacts (read-only):
$HOME/.cache/scrml-agent-tmp/s468-rev-f4fu/ — m1.scrml (repro source), drv/p3.mjs…p7.mjs (shapes), drv/ast.mjs (AST dump),
driver $HOME/.cache/scrml-agent-tmp/s468-rev-1434/drv/drive.mjs (`drive.mjs <treeRoot> <shapes>`).
Reproducer (server function body in the await-pack template):
    const n = 1
    match n {
      1 => { const g = check
        if (!g(pass, row.pw)) { return "REJECTED" }
        return "WELCOME" }
      else => { return "X" }
    }
→ emitted `const g = check; if (!g(pass, row.pw)) return "REJECTED"` (no await) → wrong password 200 "WELCOME".
Variants that FAIL the same way: matchArmInF, matchArmInFLet (`g = check` into an outer let from the arm),
matchArmInFLetDecl, matchArmInFObj (`{ g: check }`), matchArmNestedFnIf (inside a helper fn), strArm (`"bob" =>`),
strArmColon (`:>`), boolArm (`true =>`), strArmObj (`[check]`), matchNumArmIfOnly (binding nested in an `if` in the arm).
Correctly handled today: variant arms `.A =>`, `else =>`-only, `!{}` arms; literal arms with DIRECT calls.
Locus hypothesis (PA-located-verify, from the reviewer's AST dump): the parser keeps a literal arm as a `bare-expr`
whose `expr` = the whole arm TEXT and `exprNode` = only the literal; the F4 walk never sees the inner statements; the
text fallback skips text that has an `exprNode`; codegen emits the text verbatim. Related gap (same root, filed as
fail-closed MED): g-nested-match-in-string-arm-block-unlowered-s467 (docs/known-gaps.md).
ROOT FIX: a literal-pattern arm's block body is parsed into statements exactly like every other arm kind, so every
analysis (await mandate §13.2, F4 §13.9.6, E-ERROR-002, CPS tiering, E-RI/E-ROUTE checks) sees it by construction. Do
NOT add a text scan. Quote the governing sentences (§18 match arm grammar; §13.2 await mandate) in progress.md.
Also: check the CLIENT side and markup/`<match>` forms for the same arm-kind divergence; check JS-style `match` in
expression position, statement position, and `:>`/`=>`/`->` separators.
ADD every variant above (and any you find) to compiler/tests/integration/security-await-pack/shapes so the classify gate
covers literal arms; prove the pack shows them FAIL on main and PASS-REFUSED/PASS on your branch.
Direction: semantics-changed for literal-arm blocks (now actually analysed) and likely newly-rejecting where the
newly-visible code violates F4/E-ERROR-002 — measure the corpus (examples, samples, conformance/cases, stdlib +
/home/bmacs/scrmlMaster/{giti,flogence}); real sites newly refused → STOP and report. Resolve/annotate the related gap.
