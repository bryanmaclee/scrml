# progress — s455-scrml-fix-r11-sql-failable (append-only)

- startup: worktree verified (pwd == toplevel, clean), base bade5cb9d == origin/main; bun install + pretest OK.
- BRIEF archived (first commit).
- Maps read: primary.map.md header (S454 stamp f38697900) — the #1305 block names the impl#1 surfaces for a
  handled `?{}` in expressions (`extractHandledOperands`, `codegen/sql-attempt.ts`, `emitSqlQueryShape`); the S452
  block names fix-s66 chaining / IMPL1_SAFE_RULES / TWIN_RULES.

## Governing sentences (quoted from compiler/SPEC.md at bade5cb9d)

- §19.8.3: "A `?{}` query is a **failable expression everywhere**. Outside a `!` function it is treated exactly like
  a call to a `!` function whose error type is `SqlError` (§19.4.3): its result SHALL NOT be ignored, and an unhandled
  `?{}` SHALL be a compile error, **E-ERROR-002**. "Outside a `!` function" means that no enclosing function is
  declared `!` (§19.4.1) — including a `?{}` at a body top or in a function without `!`."
- §19.8.3: "**"No row" is not a failure.** A query that runs and matches nothing succeeds: `.get()` on zero rows
  returns `not`, and `.all()` on zero rows returns `[]`, in every context …"
- §19.8.3: "**A `<x server>` hydration load is exempt (S451).** A §52.6.5 Pattern C declaration RHS
  (`<driver server> : Driver = ?{…}.get()`) … SHALL NOT be E-ERROR-002 and needs no handler. … A `?{}` inside that
  load function's own body is author code and follows this section."
- §19.8.3: "**Migrating R11 code (tooling, not language).** The R11 migration route is a `scrml fix` rule that writes
  the struck silent behaviour out explicitly at each site — `.get() !{ _ :> not }`, `.all() !{ _ :> [] }`, and the
  matching shape for `.run()` — so the meaning is preserved and the silence becomes visible. The rule is owed; it is a
  tool behaviour with no normative weight here."
- §19.8.3 (direction): "**impl#1 divergence (Nominal for impl#1, §34.0):** impl#1 emits no E-ERROR-002 for a `?{}` …
  impl#1 never implemented the struck silent mode at run time either — a failed query throws on the server
  (`g-sql-error-surface-unwired`)."
- §19.8.4: "A `?{}` query SHALL be a failable expression in every context. Outside a `!` function it SHALL be handled
  at the site with a `!{}` handler or a `match` (§19.8.3); an unhandled `?{}` there SHALL be E-ERROR-002." ·
  "*(Informative.)* The migration for code the R11 bullet above newly rejects is a `scrml fix` rule (owed; tooling,
  not language — §19.8.3)."
- §19.4.3: "**A `?{}` query is a failable expression too (S451 R11).** Outside a `!` function, a `?{}` query is
  handled like a call to a `!` function whose error type is `SqlError` — with `!{}` or `match` at the site — and an
  unhandled one is E-ERROR-002 (§19.8.3 …)." · value position: "For a `?{}` the success type is the terminator's
  (§44.3): `.get()` yields `Row | not`, so `_ :> not` yields a value; `.all()` yields `Row[]`, so `_ :> []` does." ·
  "In a statement position an arm MAY fall through".
- §8.7: "Outside a `!` function: the query SHALL be handled at the site — a `!{}` handler or a `match` — exactly like
  a call to a `!` function; an unhandled `?{}` there is **E-ERROR-002** (§19.8.3)."
- §44.3: "`.all()` (or bare `?{}`) → `Row[]` · `.get()` → `Row | not` · `.run()` → `void`" and "A query that fails to
  run is not `not` and not `[]` — it is a `SqlError` variant".
- §63.2: "A deprecation is well-formed only if, at Stage-1 landing, it co-lands {a `W-`lint …} + {a reserved `E-`code
  …} + {a `--fix`/`scrml fix` rule, or a designer-card waiver}."
- §63.4: "At Stage 2 (schedule) / Stage 3 (remove): auto-migratability is a **HARD GATE**. A reserved-E MUST NOT be
  scheduled or fired for a form that has no **verified-landed** `scrml fix` rule".
- User voice S451 item 5(a) (read-only, user-voice-scrml.md:20147): "R11 migration = a `scrml fix` rule that writes
  the old silent behaviour out explicitly (`?{…}.get() !{ | _ :> not }`, `.all() !{ | _ :> [] }`,
  `.run() !{ | _ :> {} }`-shape) — meaning-preserving, silence made visible". (Arms written without `|` per S452.)
- S454 freeze exception (user-voice-scrml.md:20329) → #1305.

Note on "meaning-preserving": the struck SPEC text said a failed query returns `not` / `[]`; impl#1 never did that at
run time (a failed query throws on the server). The brief's test is "executes identically to the unhandled form" on
impl#1 — so Phase 0 measures the impl#1 observable value of BOTH forms.
