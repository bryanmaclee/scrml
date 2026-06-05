# TASK — native parser: markup-as-value close-tag span under-reach (`lift <tag>…</tag>`) (native-parser-swap parity-closer)

scrml is driving `--parser=scrml-native` to default. Closing the highest-leverage clean-single-gap remaining native parse divergence (read-only triage identified + PA-verified): non-self-closing markup as a value (e.g. `lift <li>x</li>`) leaves the native token cursor short of the element's end. Blast radius ~40-50 of the 631 flip-failures across 16 files (promote-each 25 alone).

change-id: `native-lift-markup-closetag-span-2026-06-04`

## Symptom (PA-reproduced)
`lift <li/>` (self-closing) parses CLEAN under native. `lift <li>x</li>` (close tag) is DEFAULT-clean but NATIVE fails `E-STMT-MISSING-SEMICOLON` + `E-STMT-UNCLOSED-BLOCK`. Minimal:
```
<program>
<xs>: string[] = []
<ul>${ for (let c of @xs) { lift <li>x</li>; } }</ul>
</program>
```
General: ANY non-self-closing markup element used as a VALUE in expression position (lift arg, const <x> = <tag>…</tag>, match-arm markup payload) under-reaches.

## Root (triage-traced; CONFIRM in Phase 0)
`compiler/native-parser/parse-expr.js parseMarkupValue(ctx)` (~L2144; src path L2149-2194) computes `closeEnd = sliceStart + firstBlock.span.end` (~L2157-2158), firstBlock = parseMarkupViaLazyRequire(sliceTail).ctx.nodes[0], whose .span.end from `parse-markup.js parseMarkupTrace(source,{inMarkupValueSlice:true})` (~L2376) reaches only END OF THE OPENER `<li>`, not through children + `</li>`. So closeEnd too small; advancePastSourcePos (~L2192, defn L2387) parks the JS cursor at `x</li>`. Self-closing works (opener-end == element-end).

## PHASE 0 — pin the fix site (a or b)
(a) parse-markup.js parseMarkupTrace under inMarkupValueSlice:true — slice element-block span should span FULL element through `</tag>` but stops at opener; OR (b) parse-expr.js parseMarkupValue close-end derivation. Inspect parseMarkupTrace("<li>x</li>",{inMarkupValueSlice:true}).ctx.nodes[0].span.end vs full source length (8) vs self-closing. Fix at the source without breaking self-closing or other parseMarkupTrace callers. LIVE mirror = live markup-as-value parse (ast-builder.js) where the element span spans through close tag. PROCEED if localized; STOP if slice-span opener-only is deep design used by many callers (multi-stage fork).

## Implementation (if proceed)
Fix close-position so a non-self-closing markup value's cursor advances through the full element. Localized + minimal. Keep self-closing working; handle nesting (`<div><span>x</span></div>` → OUTER close), whitespace, interpolation (`<li>${c}</li>`, `<li onclick=@x.advance(.Active)>${col}</li>`). Match the OUTER `</tag>`, not the first `</`.

## TESTS
Native-path test: markup-value with close tag (single/nested/interp/attrs) parses clean + lift emits. Pre-commit subset 0-fail. Within-node parity (1005/0) — run; rebump benign SPAN-COORD/EXTRA-FIELD only; FLAG non-benign.

## PHASE 3 — R26 (byte-compare EMIT)
Write a minimal repro fixture under compiler/tests/fixtures/ + verify vs existing repo fixtures the failing tests use (lift-engine-advance-bug65 / promote-each). For each: compile default + native to /tmp, diff -r BYTE-IDENTICAL, node --check exit 0, zero E-STMT-MISSING-SEMICOLON/UNCLOSED on native. ≥3 shapes (single/nested/interp-or-attrs). DO NOT mark DONE without R26 byte-identical. If drift, report (don't claim closed).

## OPTIONAL blast-radius
Spot-run promote-each / lift-engine-advance-bug65 / each-in-tier0-lift-bug72; report pass delta.

## Startup
isolation:worktree; merge e9d1f3cb at startup (worktree base = origin/main f11db672, behind local). F4/S99/S126 path discipline; Bash-edit; no `--no-verify`; S83 commit discipline; progress.md.

# FINAL REPORT (data): WORKTREE_PATH/FINAL_SHA/BRANCH/FILES_TOUCHED/merge-confirm · Phase-0 + fix-site · what changed · test delta + within-node + flags · R26 verbatim ≥3 shapes · blast-radius delta · deferred · maps feedback
