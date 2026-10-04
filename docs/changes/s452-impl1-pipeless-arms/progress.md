# progress (append-only)

- start: base df6dad5ac; bun install + pretest ok.
- locus: ast-builder.js parseErrorTokens (error-effect buildBlock case -> tokenizeError -> parseErrorTokens). Arms opened only on `|`, `::`, or short-form `Name :>`; `.V(...)` / `else` skipped token-by-token -> arm dropped.
- fix: isPipelessErrorArmStart lookahead (arrow-anchored) routes pipe-less heads through the `|` path; depth-0 boundary break in handler loops; `else` wildcard consumed in pattern position (also fixes `| else :>`, which was E-CODEGEN-INVALID-LOGIC on base).
- tests: unit error-handler-pipeless-arms-s452 (18), conformance error/handler-pipeless-arms-rt; 2 legacy assertions (`_ :>` implicit binding e) updated to the S451 rule (binds nothing).
- differential: 2249 files / 13319 artifacts base vs head; delta = only the new conformance case.
- fix round r2
- r2: head = .V|::V|T.V|T::V [(..)] arrow, or _/else arrow; no paren-free binder; glued ./:: never a head. Differential vs df6dad5ac: 2249 files/13319 artifacts, delta = new conformance case only. Gate 30114/0. Gap g-impl1-handler-arm-foreign-variant-accepted filed.
- fix round r3
- r3: (1) stray arm-level token / depth-0 body `:>` -> E-PARSE-001 (reused); (2) pipe-less `_ err :>`; (3) E-TYPE-ARM-QUALIFIER-MISMATCH (new, needs §34 row); (4) legacy `::V m` body loop depth-0 break. Differential vs df6dad5ac: 2249 files, delta = new conformance case only (0 corpus files newly rejected). LEFT (pre-existing, not fixed): LOW-6 short-form `_ =>`/`Name =>` break inside arrow-function bodies; nested-`match`-in-block-body E-CODEGEN; COMMENT tokens absorbed into a preceding arm's handler text (statement-boundary warning).
- fix round r4
- r4 item 1: pipe-less `::V <ident> :>` measured by instrumenting the legacy `::` arm path and compiling examples/ samples/ conformance/cases/ stdlib/ (2321 files): ZERO sites. Now E-PARSE-001 (same as `.V m :>`). prov=pa-ruled:§19.4.5 paren-free binder only after | — newly-rejecting, corpus measured zero. parser-conformance-markup parity cases moved to the legacy `|` spelling.
- fix round r5
