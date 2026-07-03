# BRIEF — self-host-v2 lexer slice-4b (typed BracketStack threading)

sPA ss55 · item 2/5 · dispatched to `scrml-js-codegen-engineer` (self-provisioned worktree from spa/ss55 @ 41aef81d).

## Task
Swap `LexState.bracketDepth: int` for a typed `bracketStack: BracketKind[]` (enum already exists: Paren/Brace/Bracket):
openers `(`/`{`/`[` push their kind, closers `)`/`}`/`]` pop; DEPTH = `bracketStack.length`. `isInterpCloseHere` +
the `${`-open interp-frame snapshot read `bracketStack.length` (identical value to the old counter). Thread through
`mkState` + every step/dispatch/codeStep/template site (grep all `bracketDepth` refs = the checklist). `bracketDelta`
replaced by `pushBracket`/`popBracket` (slice-based pop mirroring `popDepth`). NO mismatch/error handling (that's
item 3's ErrorRecovery); NO per-frame spans yet. Qualified `BracketKind.X` array elements per F4.

## Correctness contract
Pure INTERNAL-state refactor — token output MUST stay byte-identical (bracket stack isn't a token). Oracle can only
verify no-regression. New `self-host-v2-lexer-slice4b.test.js` mirrors the slice3/4a harness with a bracket-heavy +
deeply-nested-`${}` corpus + a slices-1..4a no-regression guard. Loop-until-green; all 5 files stay green.

## F-catalog honored
F2 (code-int comparisons, no int-match) · F4 (qualified BracketKind.X — probed: qualified resolves clean in `.concat`
element position; bare `.X` also worked) · F6 (no alternation) · F8 (no reassign-to-anon-struct).

## Result
221/221 green (53 new slice4b + 168 slices1-4a unchanged), independently re-verified in the spa/ss55 worktree.
Dogfood: ZERO NEW (per agent). Dev-agent branch `self-host-v2-slice4b` @ fd53127a. Full prompt in the S235 sPA transcript.
