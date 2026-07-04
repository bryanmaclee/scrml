# IMPLEMENT <foreign lang="ts" /> — Standalone-tool Surface 2 (library foreign-lang decl, §23.6)
change-id: foreign-lang-library-decl-2026-07-04 · agent a4f3a86c4304644dc · base 72a90d31 · isolation:worktree

Implements landed SPEC §23.6 (the library complement to Surface 1; independent of kind="tool").
READ FIRST (Rule 4): SPEC.md §23.6 IN FULL (~16452) + §23.2.1 (lang= resolution) + §23.2.6/E-FOREIGN-003 (fires type-system.ts:19548) + §44.7.1 module-with-db-context (the <db src> structural precedent to mirror — ast-builder.js) + §21.5.

W2 parser: recognize top-level self-closing <foreign lang="ts"/> in a no-<program> library file; mirror <db src> parsing; register the file-level foreign-lang context.
W3 typer: E-FOREIGN-003 CLOSURE (a library _{} with <foreign lang> resolves lang= — the :19548 gate consults the file's <foreign lang> like a <program lang> ancestor); E-FOREIGN-LANG-DUPLICATE (>1); E-FOREIGN-LANG-IN-PROGRAM (<foreign lang> + <program> same file). Capability/§23.2.4a unchanged.
W4 emit-library.ts: library _{} resolves+emits against <foreign lang>. NOT the g-library-mode-no-typed-payload-match type-strip (separate).
§34 rows E-FOREIGN-LANG-DUPLICATE/IN-PROGRAM.
W5 tests+R26: lanes-shaped (<foreign lang> only, no db) + fsp-core-shaped (<foreign lang>+<db src>+?{}+_{}); E-FOREIGN-LANG-* rejects; E-FOREIGN-003 closure; node --check emitted.

Blocks (verbatim in dispatch): MAPS-first; STARTUP+PATH-DISCIPLINE (F4/S88/S90/S99/S126, incremental commits); PHASE-0 (lanes-shaped lib fires E-FOREIGN-003 today = greenfield pre-state); PHASE-3 (R26 both shapes compile+node-check, E-FOREIGN-003 gone; FULL bun run test 0-fail; S215 adversarial dup/in-program/no-decl-still-E-FOREIGN-003/lang-alone+lang-with-db-compose/non-ts-sidecar + /code-review); REPORT. Repros /tmp/foreign-lang-r26/. Do NOT edit known-gaps.md (PA-owned).
