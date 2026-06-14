You are implementing a compiler-source arc in scrmlTS. Change-id: `engine-varname-canonical-vkill-readside-2026-06-13`. Three coupled parts: (1) amend SPEC §51.0.C to the acronym-run var-name rule, (2) collapse FOUR divergent engine var-name derivation rules into ONE canonical function used at every site, (3) land the deferred `bug-12-vkill` READ-side `E-STATE-UNDECLARED` fire on top. User-ratified this session: "A-amend, amend §51.0.C and dispatch."

# MAPS — REQUIRED FIRST READ

Before consuming any other context (SPEC sections / source files), read `.claude/maps/primary.map.md` in full (~100 lines). The §"Task-Shape Routing" section tells you which additional maps to consult; this is a **compiler-source bug fix** touching SYM (symbol-table.ts), the type-system, and codegen — follow that routing.

Map currency: maps reflect HEAD 7f2092cf as of 2026-06-13. HEAD is currently 1b207e6e (the S191 wrap/maps commit — no source changed between 7f2092cf and HEAD). Treat map content as current for source; if your work touches anything that looks map-stale, grep/Read against current source to confirm.

In your final report include either:
- "Maps consulted: [list]; load-bearing finding: <one sentence>"
- "Maps consulted but not load-bearing — [which map you expected to help but didn't]"
The second answer is fine and valuable.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

**S99 leak-history: this dispatch class has had path-discipline leaks before. Do NOT be the next one.**

Your worktree was allocated by the harness. Discover + verify it BEFORE any other tool call:

1. Run `pwd` via Bash. Output MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If it is under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 CWD-routing failure. Save the output as WORKTREE_ROOT.
2. Run `git rev-parse --show-toplevel` — MUST equal WORKTREE_ROOT.
3. Run `git status --short` — confirm clean.
4. Run `bun install` — worktrees do NOT inherit node_modules; the pre-commit hook's `bun test` fails with "cannot find package 'acorn'" otherwise.
5. Run `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored; browser tests need it). Use `bun run test` (chains pretest) for any full-suite baseline, NOT `bun test` directly.
If ANY check fails: DO NOT proceed. Report and exit.

## Path discipline (enforce on EVERY edit)
- **Apply ALL file edits via Bash** (`perl -0pi`, `python3`, heredoc `cat >`) on WORKTREE_ROOT-absolute paths that INCLUDE the `.claude/worktrees/agent-<id>/` segment — NOT the Edit/Write tools (S126 interim mitigation: Edit/Write have leaked into MAIN). Echo the target path before each write; re-verify via `git -C "$WORKTREE_ROOT" diff` / `grep` after.
- **NEVER `cd` into the main repo** (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT" ...`, `bun --cwd "$WORKTREE_ROOT" ...`, and worktree-absolute paths exclusively. A `cd` into main leaks installs/compiles/edits into MAIN (S126 incidents #12-#15).
- If an anchor below references `/home/bryan-maclee/scrmlMaster/scrmlTS/foo`, translate to `$WORKTREE_ROOT/foo` before touching it.
- Your FIRST commit message MUST include the verbatim `pwd` output, e.g. `WIP(engine-varname): start at <pwd-output>`.

# COMMIT DISCIPLINE (crash-recovery)
Commit after EACH meaningful unit — don't batch. WIP commits expected. After every edit: `git -C "$WORKTREE_ROOT" diff <file>` to verify, `git add`, commit immediately. Before reporting DONE: `git status` MUST be clean. "work in worktree, no commits" is NOT an acceptable terminal report. Update `docs/changes/engine-varname-canonical-vkill-readside-2026-06-13/progress.md` (append-only, timestamped) after each phase. Coupled code+test+SPEC edits land in the SAME commit (transiently-red windows are forbidden).

---

# BACKGROUND — what is broken

An `<engine for=Type>` auto-declares a reactive cell whose name is derived from `Type` (SPEC §51.0.C). That derivation is implemented FOUR different ways that DISAGREE on acronym-leading / multi-word type names:

| # | Site | Current rule | `MarioState`→ | `URL`→ |
|---|------|------|---|---|
| 1 | `autoDeriveEngineVarName` — `compiler/src/symbol-table.ts:5146` | lowercase FIRST char only | `marioState` | `uRL` |
| 2 | legacy `engineName` registration fallback — `compiler/src/symbol-table.ts:5383` | VERBATIM (no lowercase) | — | `URL` |
| 3 | `engineNameToProjectedVar` — `compiler/src/type-system.ts:5261` | acronym-run regex | `marioState` | `url` |
| 4 | codegen fallback — `compiler/src/codegen/emit-machines.ts:278` (`machine.projectedVarName ?? machine.name.toLowerCase()`) | full `.toLowerCase()` | `mariostate` | `url` |

Rules 1 and 3 agree on single-leading-capital names (`MarioState`→`marioState`) — which is why the live corpus (all single-cap type names) works and this has stayed latent. They diverge on acronym-leading names (`URL`/`HTTPClient`/`UIState`) and on the legacy `<machine name=X>` form. The SYM register/read mismatch (rule 2 registers `UI` verbatim while reads resolve `@ui`) is the exact false-positive that has BLOCKED the `bug-12-vkill` read-side fire (see `docs/known-gaps.md` `bug-12-vkill`, line ~995; SPEC §34 `E-STATE-UNDECLARED` row).

**Empirical scope (PA-verified):** legacy `<machine name=X>` in ALL `.scrml` corpus = 0; modern `<engine var=X>` = 0; 64 modern `<engine for=Type>` files, all single-leading-capital. So Part 2 has ~zero blast radius on existing corpus — it is a latent-correctness cleanup. Part 3 (read-side fire) is the higher-risk piece (a NEW hard error on reads).

# THE CANONICAL RULE (ratified A-amend)

ONE rule everywhere — the acronym-run rule (rule 3's regex is the SoT base): `name.replace(/^[A-Z]+(?=[A-Z][a-z])|^[A-Z]+$|^[A-Z]/, m => m.toLowerCase())`. Behavior:
- single leading capital → lowercase it: `MarioState`→`marioState`, `Health`→`health`, `LoadPhase`→`loadPhase`, `MarioMachine`→`marioMachine`
- whole name all-caps → lowercase all: `URL`→`url`, `ID`→`id`
- acronym RUN before a CamelCase word → lowercase the run except the letter that begins the next word: `UIState`→`uiState`, `HTTPClient`→`httpClient`

# PHASE 0 — SURVEY (STOP-gate)

Before editing, survey and report (in progress.md + a brief STOP only if materially different from this brief's assumptions):
1. Confirm the four sites + exact current line numbers (they may have drifted from the anchors above).
2. Decide the single canonical home for ONE shared function. Candidates: promote into a small shared util (e.g. `compiler/src/engine-varname.ts`) importable by symbol-table.ts + type-system.ts + codegen; OR make `autoDeriveEngineVarName` the SoT and have `engineNameToProjectedVar` + codegen delegate. Pick the lowest-coupling option; you may correct the touchpoint if survey shows a better home (depth-of-survey discount — you are authorized to correct the brief's named loci).
3. **Read-side false-positive census (load-bearing — this is why Part 3 was deferred).** Enumerate, across the full corpus + test fixtures, the `@name` READS that currently resolve to nothing (`_resolvedStateCell: null`) in `walkResolveAtNames`. For each, classify: genuine-undeclared (typo — SHOULD fire) vs legit-but-unresolved (cross-scope channel read, engine auto-cell, import binding, meta `^{}` body, default-logic auto-lift — MUST NOT fire). The write-side fire (S123) exempts default-logic body-top auto-lift at `<program>`/`<page>`/`<channel>` (§40.8) and meta `^{...}` bodies. Determine whether the read-side needs the SAME exemption set or a different one. If the census surfaces a legit-but-unresolved class NOT covered by canonicalization + the known exemptions, STOP and report before landing Part 3.

# PHASE 1 — SPEC §51.0.C amendment + §34 currency

Per pa.md Rule 4 (SPEC is normative). Read §51.0.C IN FULL first (≈ SPEC.md line 25080).
- Amend the §51.0.C auto-derived-var-name table + normative prose to specify the acronym-run rule. Add rows for the acronym cases (`URL`→`url`, `HTTPClient`→`httpClient` or `UIState`→`uiState`) and state the rule in prose ("lowercase the leading run of uppercase letters; if that run is immediately followed by a lowercase letter, the run's final uppercase letter begins the next CamelCase word and stays uppercase; an all-uppercase name lowercases entirely"). Keep the existing single-cap rows.
- **Same-landing doc-currency:** update the SPEC §34 `E-STATE-UNDECLARED` row (≈ line 17030) — its "Read-side fire ... is DEFERRED ... pending SYM engine var-name canonicalisation" clause becomes "wired S192" (or your landing-session reference) once Part 3 lands. Check §6.1.1/§6.1.2/§6.1.3 for whether the read-side undeclared rule needs an explicit normative SHALL statement; if so, add it (Rule 4 — the spec is normative for the new diagnostic).

# PHASE 2 — canonicalization (4 rules → 1)

- Implement the ONE canonical function (Phase-0 home). Update `autoDeriveEngineVarName` (symbol-table.ts:5146) to the canonical rule (or delegate). Keep the EXPORTED name(s) stable — other code + tests import `autoDeriveEngineVarName` and `engineNameToProjectedVar`; both must keep resolving to the one canonical behavior.
- Fix site 2 (symbol-table.ts:5383 legacy-`engineName` fallback): canonicalize via the shared fn instead of using `engineName` verbatim. THIS is the V-kill-unblocking register-side fix.
- Fix site 4 (emit-machines.ts:278 fallback): use the canonical fn instead of `machine.name.toLowerCase()`.
- Make site 3 (`engineNameToProjectedVar`) the canonical fn or a delegator.
- Update the existing tests that asserted the old divergent outputs — the PRIMER §13.7 B14 notes `URL → uRL (literal)` was tested under `autoDeriveEngineVarName`; that expectation flips to `URL → url`. Find + update all such assertions (coupled test change, SAME commit as the code).
- **Gate:** run the FULL suite (`bun --cwd "$WORKTREE_ROOT" run test`). Part 2 changes NO behavior for the existing corpus (all single-cap), so the suite MUST be green here BEFORE you touch Part 3. If anything regresses, the canonicalization is wrong — fix before proceeding.

# PHASE 3 — bug-12-vkill READ-side fire (the risky part)

- Land `E-STATE-UNDECLARED` on a bare `@name` READ that resolves to neither a registered state cell nor an import binding, in `walkResolveAtNames` (the `if (!resolved)` block ≈ symbol-table.ts:2274, after the pinned-import fallback fails). Mirror the write-side message/severity (Error). Apply the exemption set Phase-0 determined (at minimum the write-side exemptions: default-logic body-top auto-lift §40.8 + meta `^{}` bodies — both deferred for the read-side too unless your census proves otherwise).
- Add tests: positive (bare `@typo` read with no decl fires) + negative (legit cross-scope channel read, engine auto-cell read incl. an ACRONYM-leading engine `<engine for=URLState>` reading `@urlState`, import-binding read, compound-nav `@form.field` where `@form` resolves, meta-block read — all silent).
- **MANDATORY empirical R26 gate (do NOT mark DONE without it).** After landing, on the post-fix baseline:
  - run the FULL suite — `bun --cwd "$WORKTREE_ROOT" run test`. 0 NEW failures.
  - compile a representative sweep of the engine corpus + mario + a SYNTHETIC acronym-leading engine (`<engine for=URLState initial=.X>` reading `@urlState`). Command shape: `bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile <file> --output-dir /tmp/r26-varname/<name> 2>&1`. Confirm ZERO new false `E-STATE-UNDECLARED` across the corpus, and `node --check` exit 0 on emitted JS for the acronym engine (verify `@urlState` resolves + emits, proving register==read==codegen are all canonical now).
  - If ANY corpus file newly fires a false `E-STATE-UNDECLARED`, STOP — the canonicalization or exemption set is incomplete. Report the file + the read; do NOT ship a false-positive (that is the exact reason this was deferred).
  - End your DONE report with the R26 numbers (suite pass/skip/fail; corpus files swept; acronym-engine `node --check` result; new-false-positive count = 0).

# PHASE 4 — known-gaps + docs

- `docs/known-gaps.md`: flip `bug-12-vkill` — update the detail entry (the deferred-reason prose is now CLOSED; describe the canonicalization + read-side fire) AND the `<!-- @gap id=bug-12-vkill sev=MED status=open -->` token to `status=resolved`. (Do NOT regenerate the §0 count table — PA runs `bun scripts/state.ts --write` at wrap.)
- Leave `docs/changes/engine-varname-canonical-vkill-readside-2026-06-13/progress.md` complete + final.

# REPORT FORMAT (final message)
- WORKTREE_PATH (your `pwd`), FINAL_SHA, branch name.
- FILES_TOUCHED (every file).
- Per-phase status; the Phase-0 census summary (legit-but-unresolved classes + exemption decision); the Phase-2 green-gate confirmation; the Phase-3 R26 numbers (suite + corpus sweep + acronym-engine node --check + 0 false-positives).
- Maps-consulted feedback line.
- Any deferred items.

You are on Opus. Commit incrementally, edits via Bash on worktree-absolute paths, never `cd` into main, full-suite-green before Part 3, R26-empirical before DONE.
