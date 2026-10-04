# progress (append-only)

- start: base df6dad5ac; bun install + pretest ok.
- locus: ast-builder.js parseErrorTokens (error-effect buildBlock case -> tokenizeError -> parseErrorTokens). Arms opened only on `|`, `::`, or short-form `Name :>`; `.V(...)` / `else` skipped token-by-token -> arm dropped.
- fix: isPipelessErrorArmStart lookahead (arrow-anchored) routes pipe-less heads through the `|` path; depth-0 boundary break in handler loops; `else` wildcard consumed in pattern position (also fixes `| else :>`, which was E-CODEGEN-INVALID-LOGIC on base).
- tests: unit error-handler-pipeless-arms-s452 (18), conformance error/handler-pipeless-arms-rt; 2 legacy assertions (`_ :>` implicit binding e) updated to the S451 rule (binds nothing).
- differential: 2249 files / 13319 artifacts base vs head; delta = only the new conformance case.
- fix round r2
