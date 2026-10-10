# BRIEF — s462-no-function-in-value

Change-id: `s462-no-function-in-value`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (quote, do not reinterpret)
bryan S462 "a" (scrml-support/user-voice-scrml.md §S462, entry "no value holds a function"): the §14.3 principle — SPEC §14.3 (grep `E-STRUCT-FUNCTION-FIELD`, ~L10771): *"A function is not value data — it has no structural equality (§45.2), is not serializable, and cannot be a map key (§59.4) — so it SHALL NOT be stored as a field on a value-shaped collection … a function may be PASSED … or CALLED …, but never STORED as value data (a struct field or a state cell)."* — EXTENDS to every value: an object literal, array literal, or spread that STORES a function value is refused. Functions still flow PASSED (call arguments, callbacks, fn props / function-typed declaration attributes = wiring per O8) and CALLED. Host-JS boundaries (`_{}`, `import:host`, `<api>` results, `^{}` meta) are out of scope (stay unknown). Provenance for SPEC: `ruling:user-voice-scrml.md S462 "a" · extends: §14.3 S174 + O8 S435`.

## PHASE 1 — MEASURE FIRST (do this before writing the refusal into the compiler you will land)
Prototype the check (scratch branch/commit is fine), then compile the FULL corpus — samples/ examples/ stdlib/ conformance/ docs snippets + `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25/*.scrml` + the bootstrap sources `compiler/self-host-v2/*.scrml` + any adopter clones present locally (flogence `/home/bryan-maclee/scrmlMaster/flogence`, giti `../giti`, 6nz `../6nz` — read-only, compile into scratch) — and list EVERY site that would be refused (file:line, the shape, what it is used for). Commit the measurement table to progress.md. **If the count is non-zero outside deliberate test fixtures, STOP after Phase 1 and report — it goes to bryan with the list and a proposed migration per shape.** Only if zero (or bryan later says go) continue.

## PHASE 2 — build (only on measured zero)
- What counts as "a function value": a function/`fn` declaration reference, a lambda/arrow, a function-typed parameter or local, an imported function, a method reference (`obj.method` unbound) — the rule is about the VALUE stored, determined structurally from the tree (overlay Rule 7: no regex over source text post-AST).
- Positions: object literal property value (incl. shorthand `{ clear }`, computed keys, getters/setters — a getter/setter IS a function stored on the object: refuse), array literal element, spread of something containing a function (where knowable), `@cell = { f: … }` already covered by the state-cell rule (verify), map literal values (§59), tuple elements.
- Code: reuse `E-STRUCT-FUNCTION-FIELD` if its row can be widened cleanly, else a sibling (e.g. `E-VALUE-FUNCTION-FIELD`) — name is a PA reading for bryan's veto; one code per concept, not one per position. Message names the fix: pass it as an argument / a `fn` prop, or use an enum tag the consumer matches on.
- impl#1 AND the bootstrap (bootstrap: where the slice parses those literals).
- SPEC: §14.3 sentence widened, §45.2/§59.4 cross-refs, §34 row(s), §7.2.1-style note if relevant.
- Conformance cases per position (neg) + the PASSED/CALLED forms (pos).
- Do NOT touch `compiler/src/narrowing-write-set.ts` / `presence-narrowing.ts` (a sibling agent owns them; the PA will simplify them after both land).

## In-flight siblings (expect merges; the PA merges)
narrowing (presence-narrowing.ts, narrowing-write-set.ts), is-some, given, channel-006, stmt-match-leave, own-value-inference, decl-use-attr-refuse, bootstrap-sink-guards. Keep hunks tight.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-no-function-in-value): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-no-function-in-value/` · ci.yml bootstrap steps + browser-tier + `bun run types:check` · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · Phase-1 measurement table (sites + shapes) · STOPPED or BUILT · code name · positions covered · bootstrap disposition · direction-setting choices for bryan's veto.
