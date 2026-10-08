# BRIEF — s457-meta-allow-list (S457) — security, conformance to §22.12 Approach C

CHANGE-ID: `s457-meta-allow-list`. Agent: scrml-js-codegen-engineer, isolation worktree.

bryan (S457): "On ^{} blocks … I don't want JS there. I would prefer scrml." The SPEC already ratifies it (S114 Approach C):
§22.2 `meta-body ::= (any sequence of scrml statements and expressions)`; §22.12 "The general-developer `^{}` body parser SHALL
accept only scrml-native + this enumerated primitive set; JS-host ambient globals … trigger `E-META-001`" and "`^{}` parses as
scrml-native, full stop." Primitive set: compile-time `emit` / `emit.raw` / `reflect` (§22.4) + the 12 runtime `meta.*`
primitives (§22.5.1). Read §22 IN FULL (SPEC ~:22758-:23500).
impl#1 today: `compiler/src/meta-eval.ts` lowers the body to JS and runs `new Function(...)` in the compiler process;
`compiler/src/meta-checker.ts` enforces Approach C with a DENY list of names (META_BUILTINS + banned globals). A deny list fails
open (an S457 review reached `process` and patched built-in prototypes via `"".constructor.prototype`; same shape as the S456
`on…` name-list mistake). Fix = make it CLOSED:
1. An ALLOW-LIST check over the PARSED meta body (on the tree, both compile-time and runtime classification): a meta body may
   reference only (a) scrml constructs, (b) its own local bindings, (c) the bindings captured from the enclosing scope per §22.3,
   (d) the closed primitive set. Any other free identifier, and any member access that reaches a host object through a
   constructor/prototype chain (`.constructor`, `__proto__`, `prototype`, `Object.getPrototypeOf`, `Reflect`, `Function`,
   `globalThis`, `this` at body top level, `import(…)`, `require`), is `E-META-001` with a message naming the identifier and the
   allowed set. Decide whether member names `constructor`/`__proto__`/`prototype` are refused outright in meta bodies (recommended:
   yes — fail closed) and record it.
2. Defence in depth (secondary, keep small): compile-time evaluation runs with a minimal global surface (e.g. a fresh realm /
   `ShadowRealm` if available in Bun, or a frozen scope object + strict mode) — but the allow-list is the authority; do not
   build a sandbox you then rely on.
3. `^{ emit("…") }` output re-enters the block splitter: confirm the emitted markup then gets every check ordinary source gets
   (reserved prefixes `_scrml_` / `__scrml_`, E-ATTR-INTERP-EXECUTABLE, SQL rules) — if not, route it through them.
MEASURE FIRST: compile every corpus `^{}` user (grep `\^\{` across samples/ examples/ conformance/ stdlib/ — stdlib's own
compiler meta is exempt only if a SPEC sentence exempts it; quote it or treat it like any other source) on base and head; any
newly refused file → STOP and report the list with the offending identifiers before landing (bryan rules on non-zero). Direction:
newly-rejecting (conformance restoration toward §22.12). Amend §22.12 with the closed-allow-list wording + provenance
(`ruling:user-voice-scrml.md S457 "I don't want JS there. I would prefer scrml." + S114 Approach C`).
Verification: escape attempts refused (`"".constructor.constructor("return process")()`, `[].map.constructor`, `this`, `globalThis`,
`Reflect`, `import()`, `eval`, `Function`, `Symbol.for` tricks, getters via `Object.defineProperty`); every legitimate corpus meta
body still compiles with byte-identical output; conformance cases; full suite incl. the browser-tier gate step in ci.yml run exactly.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457d && git checkout FETCH_HEAD -- docs/changes/s457-meta-allow-list/` then commit it as your first commit:
   `WIP(s457-meta-allow-list): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-meta-allow-list/progress.md` (append-only, timestamped).
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it. (Brief 3 is the one exception, named there.)
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `ba2712973`, 2026-10-07; HEAD since then adds only the S456 wrap + maps PRs —
no source change), follow its Task-Shape Routing to the 2-4 maps for your task, treat map content as a hypothesis to verify
against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: run `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract)
  plus `bun conformance/run.ts`, and the empirical check named in your brief (an emitted-artifact check, not "tests pass").
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class (inert / newly-rejecting / newly-accepting / semantics-changed) with the measurement ·
  gap-entry text for the PA · anything deferred.
