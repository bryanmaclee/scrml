# unit-id: s468-bang-arm-block-value
Gap: `g-block-bodied-bang-arm-drops-value-s467` (HIGH, security — a wrong password is accepted). Read its full entry in
docs/known-gaps.md. Symptom: a value-position call with a `!{}` handler whose arm is BLOCK-bodied emits the arm's last
expression as a bare statement, then assigns `var ok = _scrml__scrml_result_N` — the arm's value is dropped.
Locus hypothesis (verify): compiler/src/codegen, the `!{}` guard emission for a value-position handler.
Cited sentence (re-read it yourself): §19.4.3 "the block's last expression is the arm's value".
Cover: block arms that end in an expression, in `if`/`match`, in a nested block, ending in a call, `return` inside the
arm, every `!{}` value position (const/let init, assignment, argument, return, cell init).
