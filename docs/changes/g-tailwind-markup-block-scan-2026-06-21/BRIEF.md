# Fix: g-tailwind-class-scan-skips-markup-block-bodies (HIGH) — change-id g-tailwind-markup-block-scan-2026-06-21
Dispatched S212 2026-06-21 · scrml-js-codegen-engineer · isolation:worktree · opus · agent a648b34b70d8dc273 · base 56530d3c

Root: collect-class-names.ts visitNode has no match-block/each-block branch; both store walkable bodies in
bodyChildren (+ match-block armBodyChildren; each-block templateChildren/emptyChild), NOT children/body → the
generic fallback (lines 221-222) misses them. FIX: add match-block branch (walk bodyChildren + armBodyChildren)
+ each-block branch (walk bodyChildren), mirroring the engine-decl branch (~190-204); additive; verify nested
block-forms + component-slot bodies. R26 repros: <match>-arm (rounded-*/cursor-pointer/ml-6) + <each>-body
(rounded-xl/text-sky-500) classes PRESENT post-fix, gap-2-outside stays present, + a nested case. Value-asserting
regression test on the CSS. FULL bun run test; within-node should be UNAFFECTED (codegen-output/CSS change) — if
OVER-BUDGET prints, STOP. Full mandatory-block brief (MAPS / F4 path-discipline / S138 R26 / S198 / S83) as
dispatched verbatim in the session transcript. PA lands via S67.
