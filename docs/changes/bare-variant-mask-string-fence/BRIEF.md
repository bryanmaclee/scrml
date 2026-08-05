# BRIEF — fence the bare-variant mask (g-bare-variant-mask-leaks-into-string-literals, HIGH)

**Thread-id:** `bare-variant-mask-string-fence`
**Gap:** `g-bare-variant-mask-leaks-into-string-literals` (HIGH, open). PA-root-caused + reproduced on `c8fc93bc` (S320).
**Lane:** codegen/parser (Peter). Disjoint from the held auto-await #405.
**DONE-PROBE:** a string literal containing `.Uppercase` after any char (`"/a/.Beta"`, `"(.Beta)"`, `",.Beta"`) compiles to the VERBATIM string (no `__scrml_bare_variant_*__` leak); match-arm alternation `.A | .B | .C` still works; a conformance/unit case pins both.

## The bug (PA-verified by compilation, `c8fc93bc`)
`<path> = "/a/.Beta"` compiles clean (zero diagnostics) to `_scrml_cs_reactive_set("path", "/a/__scrml_bare_variant_Beta__")` — the mask placeholder LEAKS into the runtime string value. Silent data corruption. Any string with `.` + an uppercase-initial word after a non-word char is exposed (paths, regex sources, prose, file names).

## Root cause (this is the CLASS, not the `/a/.Beta` instance)
`compiler/src/expression-parser.ts:1604-1607` — the bare-variant mask is a **bare global `s.replace(/(?<![A-Za-z0-9_$)\]"'`|]\s*)\.\s*([A-Z][A-Za-z0-9_]*)/g, '__scrml_bare_variant_$1__')`** run over the WHOLE string with **NO string/regex/comment fence**. Placeholders that land inside a string literal are never unmasked (the unmask at `:2247-2260` walks Identifier AST nodes; a placeholder inside a parsed string literal is string content, unreachable).
- **This is the identical GITI-017/S125 class the sibling `not`-lowering directly below already fixed** — the comment at `:1611-1622` documents that the `not` substitutions "previously ran over the WHOLE string with no literal/comment fence, corrupting the INTERIOR of regex literals" and were fixed by routing through **`rewriteCodeSegments`** (used at `:1623`). The bare-variant mask was never given that fence.
- **Why case (1) `"see .Note below"` escapes but (2) `"/a/.Beta"` corrupts:** pure accident of the lookbehind — `.Note` is preceded by `e` (looks like member access, excluded); `.Beta` is preceded by `/` (not excluded, masked). Fix the CLASS (fence string/regex/comment interiors), not just the `/`-preceded instance.

## Fix direction
Route the bare-variant mask (`:1604`) through **`rewriteCodeSegments`**, mirroring the sibling `not`-lowering at `:1623` — so the mask applies to code regions only and string/regex/comment interiors pass through verbatim. Keep the `is .Variant` / `is TypeName.Variant` rules that run FIRST (`:1585`) unchanged.

## ⚑ THE KEY RISK — match-arm alternation (STOP-IF-BIGGER candidate)
The comment at `:1595-1603` says the mask's negation class includes `|` so that `.A | .B | .C` inside an **"already-preprocessed `__scrml_match__` quoted arm"** stays correctly maskable. If match-arm content is represented as a QUOTED STRING at preprocessForAcorn time, then naively fencing string interiors would SKIP masking inside match arms and **break alternation**. Your FIRST task: determine whether `.A | .B | .C` match alternation still masks correctly under the fence. There IS a conformance case for pipe-alternation arms (grep `alternation` / `.A | .B` in `conformance/cases`). If the fence breaks alternation, **STOP and report** — the fix may need to exempt the synthetic `__scrml_match__` quoting from the fence, or mask before the match-arm quoting runs.

## Method
1. Reproduce with the existing harness `C:\Users\pjoli\AppData\Local\Temp\claude\C--Users-pjoli-Documents-GitHub-scrml\fd70df1b-2221-491b-9999-a2b7948c6070\scratchpad\repro-mask.mjs` (copy/point at YOUR worktree api.js). Confirm `"/a/.Beta"` leaks pre-fix, verbatim post-fix.
2. Apply the fence. R26: verify by EXECUTION (emit the string, read it), not by inspection alone.

## Gate (all must pass)
- New conformance or unit case: a string literal with `.Uppercase` after a non-word char emits VERBATIM (test `"/a/.Beta"`, `"(.Beta)"`, and the accidental-escape `"see .Note"`); plus a genuine bare-variant in code position (`= .Alpha`, `[.A, .B]`, `cond ? .A : .B`, `is .Idle`) STILL masks+unmasks correctly.
- **Match alternation `.A | .B | .C` conformance case stays green** (the load-bearing regression check).
- Full suite from repo ROOT: `bun test compiler/tests/{unit,integration,conformance}`; report pass/fail, subtract the ~6 Windows-local baseline.
- Corpus sweep (`samples/`+`examples/`, ~948) → expect ~0 emit-delta (the corrupting shape is corpus-rare; report any delta and explain).
- Do NOT run @generated regen (PA owns it at land).
