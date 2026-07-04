# Peter #19 — SPA _scrml_lift_target tree-shaken → ReferenceError on first <each> insert
change-id peter-19-spa-lift-target-tree-shake-2026-07-04 · agent a318c5691c5fc3bce · base d98fc988 (S112 ff-merge)
runtime-chunks.ts marker `function _scrml_lift` (~247) orphans the `let _scrml_lift_target=null` decl (runtime-template.js ~1213) to the prior chunk → tree-shaken in SPA. Fix: move the decl WITHIN the lift chunk (or extend the marker); confirm no other reader. Repro: SPA <each> insert; assert decl in lift chunk + no ReferenceError. Full brief = Agent prompt.
