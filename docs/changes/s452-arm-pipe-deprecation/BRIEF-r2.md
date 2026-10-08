PA → arm-pipe agent: the review of f3021d9f was LAND-WITH-NITS. The fix tool is verified safe: the guard is real, idempotent, artifacts identical. Fix round on the same branch, same rules. Archive this as BRIEF-r2.md, and add "fix round r2" to progress.md.

1. MED — lint coverage. §19.4.5 says "Each `|`-led arm SHALL surface W-ARM-PIPE-LEGACY". Today it misses:
   - (a) a handler NESTED inside another arm's `{…}` body;
   - (b) a `!{}` inside an object-literal method (stdlib/store/kv.scrml:111 shape);
   - (c) the standalone `error-effect` `!{ … }` kind (samples/compilation-tests/error-005-typed.scrml). The check at type-system.ts ~12503 covers only `guarded-expr`.
   Lint every `|`-led arm wherever impl#1 parses a handler — walk all node kinds that carry handler arms. Also make `scrml fix` either rewrite or REPORT ("left for a human") every site it doesn't rewrite, never silently clean. If one of these impl#1 can't reach structurally, report it precisely and file it as a gap.
2. MED — component bodies. The lint and the fix blocker tell adopters to delete the `|` inside a component body, but the pipe-less form there gives E-CODEGEN-INVALID-LOGIC (impl#1 miscompiles multi-arm pipe-less handlers in component bodies).
   - Change both messages so neither recommends the edit there yet (say the pipe-less form is not yet supported in component bodies on impl#1; keep the `|`).
   - File a gap: sev=MED, the pipe-less `!{}` in a component body fails to compile, `locus=` traced, `prov=review:s452-armpipe-r1`. This undercuts §19.4.5's "parses identically".
   - Also file the kv.scrml object-literal-method `!{}` raw-copy miscompile you noted, if it isn't already.
3. LOW — alternation `| .Pair(a, b) | .Gone :>` gets a lint suggesting `.Pair(a, b) :>`, an arrow that isn't there. Lint only an arm whose head parsed as a single pattern; for alternation, either name both alternates in the suggestion or don't suggest a rewrite.
4. LOW — message-arm lints carry the engine's span (symbol-table.ts `engineDecl?.span`). Give each arm its own span.
5. NIT — splitting a one-line handler in a CRLF file inserts bare `\n`. Use the file's line ending.
6. NIT — `| e :>` → `_ e :>`: the §19.4.5 table doesn't name this case. Do NOT edit SPEC.md; note it in progress.md for the PA.
7. LOW (pre-existing, report only): E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE's text still says "add `| _ :>`". Change the suggestion to `_ :>`. This is message text only; adjust any test that pins the text.
Then `git merge origin/main` (resolve generated hunks only, keep both sides of any SPEC row), run the whole-corpus differential (still 0 artifact diffs), the fix tests, and the full gate, and push. Reply with FINAL_SHA, per item, and the gaps filed (≤200 words).
