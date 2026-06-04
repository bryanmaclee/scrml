# progress — native-each-contextual-sigil-2026-06-04 (#2f unit C)

Goal: native lexer recognizes the `@.` contextual sigil so `<each>` per-item
bodies (`${@.name}`, `${@.}`, `${@.foo.bar}`) compile identically under
`--parser=scrml-native` as under the default live pipeline.

## 2026-06-04
- startup: pwd worktree OK; ff-merged main -> HEAD 178cc5dc (each-codegen base); bun install; pretest OK.
- root-cause confirmed empirically: `${@.name}` under native -> exprNode ident{name:".name"} (the `@` dropped to "Unknown — skip" fallback); default -> `_scrml_each_item.name`. Native compile of `@.name` each = E-CODEGEN-INVALID-JS.
- FIX (lex-in-code.js + .scrml in lockstep): new `@`-followed-by-`.` branch BEFORE the `@ident` branch. Consumes `@.` + optional dotted-ident chain as ONE ScrmlAt token; name = raw.substring(1) (".name" / "." / ".foo.bar"). Existing parsePrimary ScrmlAt arm -> makeAtCell(name); translate-expr AtCell arm prepends `@` -> ident{name:"@.name"}. NO bridge change needed.
- post-fix probe: `@.name`->ident{name:"@.name"}; `@.`->ident{name:"@."}; `@.foo.bar`->ident{name:"@.foo.bar"}; `.Idle` (no @)->BareVariant UNCHANGED; `@count`->ident{name:"@count"} UNCHANGED.
- emitStringFromTree round-trips ident{name:"@.name"}->"@.name"; rewriteContextualSigil "@.name"->"_scrml_each_item.name" (verified).
- NEXT: full native compile parity (Phase 3 — all 8 #2f shapes), within-node parity, conformance test, happy-dom canary, full gate.

## 2026-06-04 (cont.)
- Phase 3 parity ALL PASS: 9 shapes byte-identical native-vs-default (mod id offsets), node --check OK each.
  C1-empty(@.name+<empty>), C2-of-count(@.), C3-chain(@.foo.bar), C4-name-plain, C5-barevariant-control(.Idle+@.name), P1-in-plain, P2-of-count-plain, P3-as-name, P4-key.
  C5 control proves NO regression: .Idle->"Idle" enum string AND @.name->_scrml_each_item.name in native client.js.
- conformance test parser-conformance-each-contextual-sigil.test.js: 15 pass / 0 fail (lexer-token + bridge-exprNode + bare-variant regression guard + end-to-end parity).
- NEXT: happy-dom render canary, within-node parity, full gate.

## 2026-06-04 (cont. 2)
- happy-dom render canary each-contextual-sigil-native.browser.test.js: 2 pass / 0 fail. `<li>${@.label}</li>` under --parser=scrml-native renders per-item field value in real DOM (NOT dropped-@ artifact); re-set updates text. Closes the S140/S152 emit-string blind-spot.
- NEXT: within-node parity allowlist check; full pre-commit gate.

## 2026-06-04 (FINAL)
- within-node parity GREEN: 1005 pass / 0 fail / 0 PARSE-FAILURE; allowlist json UNCHANGED (no rebump needed — corpus each-blocks don't exercise `@.` at within-node level / reduction stays under per-file caps). Direction: no INCREASE.
- full pre-commit gate (unit+integration+conformance --bail): 15829 pass / 89 skip / 1 todo / 0 fail (841 files).
- native-parser conformance + each-promotion suites: 2083 pass / 0 fail (lexer/expr/markup/parse-file/stmt/each-promotion) — no regression.
- FILES TOUCHED: lex-in-code.js, lex-in-code.scrml (lockstep), parser-conformance-each-contextual-sigil.test.js (15 pass), each-contextual-sigil-native.browser.test.js (2 pass), progress.md.
- exprNode produced: ident{name:"@.name"} / ident{name:"@."} / ident{name:"@.foo.bar"} — round-trips via emitStringFromTree -> rewriteContextualSigil -> iterVar.name. NO codegen/emit-each/bridge/SPEC change. ScrmlAt->AtCell->ident bridge reused as-is.
- DONE.
