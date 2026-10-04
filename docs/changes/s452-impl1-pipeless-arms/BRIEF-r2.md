# BRIEF r2 — s452-impl1-pipeless-arms fix round (archived verbatim)

PA → impl#1 pipe-less agent: FIX ROUND. The S239 review returned FIX. The HIGH below is PA-REPRODUCED on your tip 98e0c463c. Same worktree and branch `fix/s452-impl1-pipeless-arms`, same rules (no stash, no pkill -f, no --no-verify, code+test in one commit, normal push). First archive this message as docs/changes/s452-impl1-pipeless-arms/BRIEF-r2.md, and append "fix round r2" to progress.md.

HIGH (silent miscompile, also a REGRESSION on code base compiled correctly): an arm body ending in `X.V` or `X::V`, followed by an arm starting with `_` or a bare name, is mis-split. Repro, with `E{Bad(msg),Pair(a,b),Gone}` and `S{Empty,Unknown,Full}`:
```
const r = risky(n) !{
    .Pair(a, b) :> S.Full
    .Gone :> S.Full
    .Bad(m) :> S.Empty
    _ :> S.Unknown
}
```
This gives zero diagnostics:
- the emitted `.Bad` arm assigns `_result = S;`;
- a fake arm `else if (variant === "Empty")` appears;
- the wildcard becomes `else { return _result; }`.
`isPipelessErrorArmStart` (~:17089) reads `.Empty _ :>` as head `.Empty` + binder `_`. The same happens with `| .Bad(m) :> S.Empty` followed by the old short-form `_ :> …` (correct on base), with `E::Gone` followed by `_ :> 0`, and with `S.Empty` followed by `Gone :> …`.

Fix it at the ROOT, not by position:
1. A pipe-less head NEVER takes a paren-free binder. The S452 SPEC amendment (#1273, §19.4.5) allows the paren-free binder only after a `|`. So a pipe-less head is exactly `.V` | `::V` | `T.V` | `T::V`, optionally followed by `( … )`, and then IMMEDIATELY an arm arrow; or `_ <ident>`? NO — leave the whole-error binder out of scope. So: `_` or `else`, immediately followed by the arrow. Anything else is not a pipe-less head.
2. Belt and braces: a `.` or `::` glued to the preceding token (no whitespace or newline between them) is member access and can never start a pipe-less head.
3. Do not change the old short-form `Name :>` behaviour, and do not add diagnostics.
Tests: add every repro above, pipe-less and mixed, each asserting the correct JS (`_result = S.Empty`, no fake arm, the wildcard catches). Keep the byte-identical pipe-less ≡ piped equivalence set green. Re-run the full-corpus differential (base vs your new tip; the expected delta is still only your conformance case) and the full gate.
Also file a gap in docs/known-gaps.md: impl#1 accepts an arm pattern naming a variant that is not in the handled error type (`| .Empty :>` on E compiles clean). It is LOW, pre-existing, and what made this HIGH silent. Give it `locus=` traced and `prov=review:s452-pipeless-r1`, in the existing @gap format.
FINAL REPORT (<400 words): FINAL_SHA (== pushed tip), the fix + why it closes the class, tests, the differential counts, `git status` clean.
