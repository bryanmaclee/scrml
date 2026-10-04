# BRIEF r3 — s452-impl1-pipeless-arms fix round (archived verbatim)

PA → impl#1 pipe-less agent: FIX ROUND r3. The re-review of 39108436 was LAND-WITH-NITS with no mis-split left. This is the third round on `parseErrorTokens`, so per the S451 durable we fix the ROOT instead of positions. Same worktree, branch and rules. Archive this message as docs/changes/s452-impl1-pipeless-arms/BRIEF-r3.md, and add "fix round r3" to progress.md. Verify each claim first.

1. ROOT (the reviewer's MED-1 + LOW-5): `parseErrorTokens` silently SKIPS tokens it cannot place, token by token.
   - Repros: `.Bad m :> m` followed by `_ :> 0` (paren-free binder written without the `|`, a plausible mistake now that the `|` is deprecated) compiles clean: the `.Bad` arm is dropped and the wildcard runs. `S` then `\n  .Full(1) :> 5` silently drops `:> 5`.
   - Fix: any token between arms that is not consumed by a recognized arm head + body SHALL produce a compile error naming it. Never skip silently.
   - Pick the code: reuse an existing parse/handler diagnostic if one fits (look at what malformed `!{}` input already raises). Otherwise use E-SYNTAX-family with a clear message, e.g. "unexpected `m` in a `!{}` handler — an arm is `.V(x) :> body`; a binder without parentheses needs the legacy `|`".
   - This is newly-rejecting, so the differential must show which corpus files (if any) change. Report them; expected zero.
2. MED-2: pipe-less `_ err :>` (the §18.2 `whole-error-arm`, canonical after #1273) is dropped, while the piped `| _ err :>` works. Make the pipe-less head accept `_ <Identifier>` immediately followed by the arrow. It must behave byte-identically to `| _ err :>`. (This supersedes my earlier "leave the whole-error binder out of scope".)
3. LOW-3 (a regression from loud to silent): `| S.Empty :> 2`, with S unrelated to the handled error type, was loud on base (accidentally) and is now a silent dead arm. `F.Bad(m)` silently matches `E.Bad`. `typeQualifier` is written and never read.
   - Make a qualifier that does not name the handled error type a compile error. Prefer the type checker, where the handler's error type is known. If there is no existing code, E-TYPE-family with a message naming both types.
   - Do NOT build the general unqualified foreign-variant check (`| .Zap :>`). That stays the filed LOW gap.
4. LOW-4: the legacy paren-free `::` head path (~:17390) has no pipe-less-head break in its body loop, so a following `else :>` / `.Gone :>` is absorbed. Give it the same depth-0 break as the other paths.
LEAVE (note in progress.md only): LOW-6 (the short-form `_ =>` / `Name =>` break inside arrow-function bodies, pre-existing) and the nested-`match`-in-block E-CODEGEN (pre-existing).
Tests: each repro gets a test; the byte-identity set stays green. Re-run the full-corpus differential (base df6dad5ac vs new tip) and the full gate.
FINAL REPORT (<400 words): FINAL_SHA (== pushed tip), per item, any codes used/added (with the §34 row status — do NOT edit SPEC.md; list codes that need a §34 row), the differential counts + any changed corpus file, `git status` clean.
