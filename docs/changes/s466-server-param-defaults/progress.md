# progress s466-server-param-defaults

- 2026-10-13 start; branch created off origin/main f28b58a31; bun install + pretest ok
- 2026-10-13 governing sentences: §7.3.2 "When a parameter with a default is omitted at the call site, the default value expression is evaluated at call time. Default values are arbitrary expressions and may reference earlier parameters in the same parameter list." + "Default parameters compile directly to JavaScript default parameter syntax." §6.6.9 "Every read position counts (S464)" (param default of a wholly server-escalated fn → E-REACTIVE-003). §34 E-SERVER-FN-IN-SYNC-CALLBACK / E-ASYNC-STDLIB-IN-SYNC-CALLBACK rows list "a parameter default" as a non-awaitable position.
- HTTP decision: "omitted at the call site" = MISSING key (client stub JSON.stringify drops undefined). Passed `not` = present null → stays `not`. SSE GET wire cannot distinguish (stub skips null too) → missing ⇒ default; flagged.
- locus refined: emit-server CSRF + non-CSRF handler bindings, SSE query binding, peer callable signature, onserver:* WS handler signature, pure-fn/endpoint helper (raw splice → lowered), CPS client wrapper (emit-functions), RI call graph (route-inference: default callees were not callees → `k = rd()` missed E-REACTIVE-003 + W-DEAD-FUNCTION false positive).
- helpers: at-refs `parsedParamDefault` (one parse; spans dropped — offset-0 spans pointed at file line 1); emit-logic `emitParamDefault`; emit-server `serverParamDefaults` / `serverBodyParamLine` / `serverParamSignature`; utils `paramSignature(p, i, loweredDefault?)`.
- tests: compiler/tests/integration/s466-server-param-defaults.test.js 14 pass on branch; 13/14 FAIL on base f28b58a31 (the direct `@n` E-REACTIVE-003 case is a regression guard).
- full unit+integration+conformance on branch (before adding the new test file): 33479 pass / 0 fail.
- 2026-10-13 committed a8d879cf6 (fix + tests + gaps + FACTS). Pre-commit hook suite: 35732 pass / 0 fail.
- base f28b58a31 unit+integration+conformance (detached tree, no pretest): 33478 pass / 1 fail (env; not investigated). Branch before new tests: 33479 / 0.
- R26: 333 sources (examples 32, samples/compilation-tests 297, gauntlet-r25 dev-* 4) compiled on base + branch: 0 status changes, 0 artifact diffs (32 server bundles; no corpus server fn declares a default — blast radius only, not demand evidence).
- gates: types-gate OK (unchanged); bootstrap slice 2280/0 + lint 0 violations; lsp+commands 726/0; facts/state/spec-index PASS; corpus-compile-floor PASS.
- extra probes: CPS default `= @n` → wrapper `qty = _scrml_cs_reactive_get("n")`; peer call in default → 1x E-SERVER-FN-IN-SYNC-CALLBACK; `not` default → `(null)`; SSE `from = 3` → `return 3` for missing key.
