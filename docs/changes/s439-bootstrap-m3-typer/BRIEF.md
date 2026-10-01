# BRIEF — s439-bootstrap-m3-typer (bootstrap slice M3 item 1: the TYPER)

Dispatched S439-bryan, 2026-09-27. Base: `origin/main` @ `c65f54b45`. Agent: scrml-js-codegen-engineer, opus,
isolation: worktree. Branch this brief lives on: `brief/s439-bootstrap-m3-typer`.

## 0. STARTUP — CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE incidents to date: several; keep it at that)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP, report, exit.
2. `git rev-parse --show-toplevel` == that pwd. `git status --short` clean.
3. Assert your base: `git fetch origin && git merge-base HEAD origin/main` == `git rev-parse origin/main`
   (the worktree is cut from origin/main). If origin/main has moved past `c65f54b45`, that is fine — note it.
4. Fetch this brief: `git fetch origin brief/s439-bootstrap-m3-typer && git checkout FETCH_HEAD -- docs/changes/s439-bootstrap-m3-typer/`
5. `bun install` then `bun run pretest` (plainly, from the worktree CWD — `bun --cwd <path> run …` SILENTLY NO-OPS).
6. First commit: `WIP(s439-bootstrap-m3-typer): start at $(pwd)` — include the BRIEF + an empty `progress.md` in
   `docs/changes/s439-bootstrap-m3-typer/`.

Path discipline, every edit: Edit/Write ONLY on absolute paths UNDER your worktree root. NEVER a path under
`/home/bryan-maclee/scrmlMaster/scrml/` that is not inside `.claude/worktrees/agent-…`. NEVER `cd` into the main
checkout. Use `git -C "$WT"` / `--cwd="$WT"` (with the `=`). **NEVER `git stash`** (the stash is shared across
every worktree — S385 incident; do base-vs-build flips by FILE COPY). **NEVER `pkill -f` / `killall` on a
command string** (it kills suites in other checkouts); kill by captured PID only. **NEVER `--no-verify`**, never
override `core.hooksPath` or disable any hook. If the pre-commit hook is slow, run the commit in the foreground
with a long timeout; if it fails, fix the cause.

Commit discipline: commit after EVERY meaningful unit (WIP commits expected), append a timestamped line to
`docs/changes/s439-bootstrap-m3-typer/progress.md` each time (done / next / blockers). Code + its tests are ONE
commit (never a transiently-red split). Clean `git status` before reporting DONE.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first (stamp `9941a504c`, 2026-09-27) and follow its Task-Shape Routing;
then `structure.map.md`, `dependencies.map.md`, `test.map.md` for `compiler/self-host-v2/`. ⚑ The maps PREDATE
#1109 (bootstrap M2 — `parse.scrml`, `analyze.scrml`, `lower.scrml`, `ast.scrml`, `slice-m2/` are newer than
the stamp; line 24 of primary.map notes the delta in outline only). Treat map content as a verify-against-source
hypothesis. Report in your final report whether the maps were load-bearing ("not load-bearing" is a valid
answer).

## 1. The task

The bootstrap (impl#2, `compiler/self-host-v2/`, the dpa-051 four-phase re-cut: lex · parse · analyze ·
lower+emit, each phase handing the next its own clean IR) has NO value-type checker and NO redeclaration check
in `analyze`. Eleven shapes compile SILENTLY and run wrong. They are pinned in
`compiler/self-host-v2/slice-m2/typer-gap.test.js` (a "today: silent" test + a `test.failing` stating the
required code). Read `compiler/self-host-v2/slice-m2/progress.md` §"F-A (MED) — NOT YET CHECKED" — the M2
agent's own statement of this item.

Build the TYPER as a pass in the bootstrap's analyze phase, in the dpa-051 §3.5 discipline:
- a type per expression node, held in ONE immutable side-table keyed by NodeId (part of the single `Tables`
  record — no option bags, no module state, the pass's signature names the tables it consumes);
- checks at: assignment/write targets, call arity + argument types, conditions (`if=`, ternary, `if`/loops
  where applicable), `<each in=…>` iterables, use-site construction values (attributes → declaration fields);
- a scope/binding pass for redeclaration (cells/declarations, `as=` handles, functions, handle-vs-cell names,
  block-level `let`/`const` per §7.3.3).
Design reference: `../scrml-support/docs/deep-dives/bootstrap-codegen-architecture-dpa-051-2026-09-26.md`
(§3 IR + pass discipline, §3.4 totality over enums, §3.5, §6 values/writes). Bootstrap source is
HUMAN-QUALITY scrml (self-host is a from-scratch rewrite showcasing scrml, not a TS port) — follow the idioms
already in `analyze.scrml` / `check.scrml`; `lint-no-default-arm.js` forbids a default arm in an enum `match`.

## 2. ⚑ The governing-sentence gate — the pins' codes are a HYPOTHESIS, not the spec

The `want:` codes in typer-gap.test.js were written by the M2 agent. They are PA-located-verify. For EACH of
the 11 shapes, before implementing its check, record in progress.md one of:
  (1) the governing sentence QUOTED from `compiler/SPEC.md` with its § reference, and the code it names; or
  (2) "searched §X, §Y, §Z — no governing sentence found."

Things the PA already found (verify, don't trust):
- §7.3.3 (SPEC ~line 6129): E-SCOPE-REDECLARE is a BLOCK rule inside a function body; "Two `function`
  declarations of one name in one block are outside this rule"; "File-scope duplicates are E-SCOPE-010 (§7.6),
  not this code." ⇒ the pins for a duplicate top-level `<let x>` and duplicate top-level functions may be the
  WRONG code. Resolve it from the SPEC, including whether §66 (declarations; SPEC ~38624–40348) says anything
  more specific for declarations, `as=` handles and handle-vs-cell collisions.
- §7.5.1 (SPEC ~6301): assignability — the provable domain; E-TYPE-031 is "inference succeeded and it does not
  fit". E-TYPE-001 is the LIFECYCLE / pre-transition read code (§14.12) and is probably NOT the right code for a
  plain type mismatch. The pins only require the `E-TYPE-` prefix; pick the SPEC-named code.
- A non-bool `if=` / ternary condition: check §17.1 and §45 / §42 for whether scrml conditions admit truthiness.
  If the SPEC permits a non-bool condition, that pin is WRONG — do not make the bootstrap reject a legal
  program; report it and change the pin (with the quoted sentence in the test comment).

Outcome rules:
- Outcome (1): implement exactly what the sentence says, with the code it names.
- Outcome (2) (SPEC silent): the bootstrap MAY still reject (it is Nominal/spec-ahead, not shipped to adopters,
  and rejecting is the reversible direction), using a bootstrap-local code in the existing bootstrap-local
  style (`E-BOOTSTRAP-*` / the pattern already in analyze.scrml), and the shape goes on an "OWES A RULING /
  §34 ROW" list in your final report. Do NOT edit SPEC.md.
- Never make the bootstrap ACCEPT something the SPEC rejects, and never reject something the SPEC accepts.

## 3. Scope limits

- Do NOT touch impl#1 (`compiler/src/**`, `compiler/native-parser/**`) or the frozen `compiler/self-host/`.
- Do NOT grow the front end to new syntax (that is M3 item 4). Do NOT split the analyze tables by fact family
  (item 2) beyond what the typer's own table needs — but do not make item 2 harder: keep the typer's facts in
  their own table.
- No text scanning of source in any post-parse phase (Rule 7): the typer reads the tree, never re-scans text.
- Every enum `match` total (no default arm).

## 4. Tests + verification (do not mark DONE without all of these)

1. typer-gap.test.js: each "today: silent" test is REMOVED and each `test.failing` becomes a plain `test`
   asserting the (SPEC-resolved) code. A pin whose shape you proved legal becomes a "stays silent" test.
2. POSITIVE controls: for every check, a well-typed twin that must stay silent (int into int, right arity,
   bool condition, `<each>` over a sequence, distinct names, legal shadowing in a nested block). A checker
   that fires on everything passes the negative tests — the controls are what make them mean anything.
3. The whole existing bootstrap suite stays green, byte-for-byte on the Core oracles:
   `bun test ./compiler/self-host-v2/slice-m1/` · `bun test ./compiler/self-host-v2/slice-m2/` ·
   `SLICE_CORE=lowered bun test ./compiler/self-host-v2/slice-m1/` · `bun test compiler/tests/integration/self-host-v2-lexer`
   · `node scripts/lint-no-default-arm.js` (or however CI invokes it — read `.github/workflows/ci.yml` step
   "Bootstrap slice"). The six §66.19 oracle programs and the M2 fixtures MUST produce zero typer diagnostics.
4. Mutation proof: add the typer to `slice-m2/bench/mutations.js` (or the M1 one — whichever the M2 agent's
   harness uses; it mutates a COPY) — at least one mutation per check family (disable the assignment check /
   arity / condition / each-iterable / construction value / redeclare) and show each goes RED.
5. Adversarial self-probe: list the adjacent shapes your checks could false-fire on (optional `T | not`
   values, `not`, enum variants `.X`, instance handles, sequence permission types, spread-with-overrides field
   edits, `given` bindings, function-typed attributes (O8 wiring), seeded `let` with reactive initializer) and
   add a silent-control test for each one the current front end can parse.
6. Report exit codes directly (never `$?` of a `tail`); prove each probe can see a difference.

## 5. Final report (to the PA)

WORKTREE_PATH · FINAL_SHA (== branch tip) · files touched · the 11-row governing-sentence table (shape →
quoted sentence or "searched…" → code used) · OWES-A-RULING / §34-ROW list · mutation results · test counts
per suite with exit codes · whether the locus hypotheses above (§7.3.3 / §7.5.1 / condition truthiness) held,
were refined, or were wrong · maps load-bearing? · anything surfaced but not done.
