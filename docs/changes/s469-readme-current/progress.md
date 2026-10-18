# s469-readme-current — progress

Brief: README.md stops teaching retired spellings and unconstrained tapes. Docs only; no
compiler/src or compiler/self-host-v2 change. Base: origin/s469-bootstrap-cli (#1467).

Sources: user-voice S447 (keywords outside the opener), S469 (dpa-073 `;` + arm commas; NO
unconstrained sequence behaviour; O62–O64); workability today-scrml-distance-2026-10-18 §6;
SPEC §66.2.5, §66.12.4, §66.12.6, §66.19.1/.4/.5, §66.21 (on main since #1466).

## Bootstrap verdicts (bun run boot:compile, scratchpad files)
- item 1 counter `let <count:int=0/>` + `<step=1/>` + derived + `;` function: compiles.
  Old `<let count:int=0/>` → E-DECL-LET-IN-OPENER. `@step = 2;` → E-WRITE-NOT-GRANTED.
- item 2 `single` engine: compiles (unchanged block).
- item 3 swatch `:struct` with `let` children: compiles only without `style="…${hex}"`
  (E-BOOTSTRAP-UNSUPPORTED, reactive quoted template) and without `<*accent/>` render
  (E-BOOTSTRAP-UNSUPPORTED, O51). Old `<swatch let label…/>` → E-DECL-LET-IN-OPENER.
- item 4 `<audit:Entry[free, append]=[]/>` + push: compiles. `@audit = [];`, `@audit.shift();`,
  `@audit[0].action = "edited";` → E-WRITE-NOT-GRANTED (last: field edit of fixed Entry.action).
- §2 tasks cell: `<tasks:Task[free, append, writable, replace]=[]/>` with spread-append, map
  and `= []` compiles (no channel). Legacy `<tasks>: Task[] = []` → parse errors, NOT
  E-DECL-LEGACY-RHS (bootstrap doesn't recognise the legacy form yet).

## Done
- [x] branch + progress.md
