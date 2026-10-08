# progress — s459-alias-merge-main

Append-only.

- 2026-10-08 start: base d09def0c9 (alias r3 tip), branch s459-alias-merge; bun install + pretest OK.
- merge origin/main 49b7fcc1d (96580b5e7): conflicts emit-logic.ts (thunk + emitInternalCaptureObject, both `_scrml_g.Object.freeze`), runtime-template.js (`var _scrml_g` line + main's Object.create(null) registries + alias's shortened comment), FACTS.md (regenerated). One pin re-spelled in meta-review-r3-s458.test.js. Core suite 33165/0.
- gate after merge (old R1): 0 violations. gzip SPA counter: main 16377, alias tip 16382, merged 16383 (< 16384, margin 1 B).
- N2 gate hardening: R1 author names from code via splitBlocks + tokenizer; thrown compiles counted/listed; THROWN_CEILING 119 (all reproduce on main). Hardened gate on merged tree surfaced 51 hits = 12 extractor misses (code-default body text) -> fixed -> 0. Bite: dispatcher revert full corpus old 1790/429 units vs new 1806/433; prose-only `document` probe: old 0, new 4 (R1 in 4 modes).
- Chromium: p1 (globalThis/fetch/document/Response/JSON) HEAD "13 user-location" no errors, main broken; p2 (^{} + user fetch + server call) HEAD meta x=1 s=11, main server call broken.
- corpus differential default mode: status change meta-lift-006 (E-META-001 lost) -> fixed in meta-capture-rewrite (_scrml_g.<name> judged as <name>).
