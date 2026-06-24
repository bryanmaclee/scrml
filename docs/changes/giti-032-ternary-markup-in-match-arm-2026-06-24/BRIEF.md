# DISPATCH BRIEF — GITI-032 (HIGH): ternary-returning-markup dropped inside `<match>` arm body

change-id: `giti-032-ternary-markup-in-match-arm-2026-06-24`
agent: scrml-js-codegen-engineer · model: opus · isolation: worktree · background
dispatched by PA, S218, 2026-06-24, against main HEAD `ca12a295` (v0.7.0)

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (read + execute BEFORE any other tool call)

S99 had FOUR path-discipline leaks in one session; S126 added two more (Edit/Bash filesystem divergence). Do NOT become the next incident.

## Startup verification (do this FIRST, in order)
1. `pwd` via Bash. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 CWD-routing failure. Save the output as your WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git merge main` (or confirm your base is `ca12a295` / its descendant) — your base should be current main; this is a no-op if so. Report if it conflicts.
4. `git status --short` — confirm clean.
5. `bun install` — worktrees do NOT inherit node_modules; the pre-commit hook's `bun test` fails with "cannot find package 'acorn'" otherwise.
6. `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored; ~130 ECONNREFUSED browser-test failures without it). Use `bun run test` (chains pretest) for full-suite baselines, NOT `bun test` directly.

If ANY check fails: STOP, report, exit. Do NOT proceed.

## Path discipline (EVERY write)
- Apply ALL file edits via **Bash** (`perl`/`python3`/heredoc/`cp`) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools (S126: Edit/Write wrote to MAIN while Bash/git saw the worktree, two consecutive dispatches). Echo the target path before each write; re-verify with `git diff`/`grep` after.
- NEVER `cd` into the main repo (or anywhere) from this worktree. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively (S126 incident #14/#15 — `cd` leaks `bun add` + compile/run commands into MAIN).
- If an intake/path reference points at `/home/bryan-maclee/scrmlMaster/scrml/foo` (main), translate to `$WORKTREE_ROOT/foo`.
- Your FIRST commit message MUST embed the verbatim startup `pwd`: e.g. `WIP(giti-032): start at $(pwd)`.

---

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines), then follow its §"File Routing" to the relevant maps for a **compiler-source codegen bug fix** (structure.map.md "Key S217 Source Changes" + domain.map.md "Codegen each/match/engine Emit Map" + the S201 "markup-as-value in EXPRESSION position" concept row + schema.map.md `match-block.armBodyChildren`).

Map currency: maps reflect HEAD **062165a5** as of **2026-06-23**, ~15 commits behind current HEAD `ca12a295`. The codegen files you will touch (`emit-match.ts`, `emit-variant-guard.ts`, `emit-expr.ts`) were modified AFTER that watermark. **Treat all map content as a starting hypothesis to verify against current source via grep/Read — NOT ground truth.**

Feedback (in your final report): "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing." The second is fine and valuable.

---

# THE BUG (HIGH — blocks giti's "Current status" panel; first external-adopter report GITI-032)

A `${ cond ? <markup> : "" }` interpolation (a ternary whose CONSEQUENT is markup-as-value) works at TOP LEVEL but is BROKEN inside a `<match>` arm body. PA has reproduced it empirically against current HEAD `ca12a295`:

- **single block in an arm → `E-CODEGEN-INVALID-JS`.** The emitted JS shows the smoking gun:
  ```js
  _scrml_structural_eq(d, "yes") ? : ""    // ← the ternary CONSEQUENT is GONE; empty between ? and :
  ```
  The markup-as-value consequent (`<p>SHOWN</p>`) was DROPPED, leaving malformed `cond ? : ""`.
- **multiple blocks in one arm → also `E-CODEGEN-INVALID-JS`** on current HEAD (same dropped-consequent root). NOTE: giti reported the multi-block form as a SILENT exit-0 whitespace-only render — that was on their older SHA `7c01b22a`; the GITI-031 match-dispatch fix `078c2f58` likely shifted multi from silent to loud. Same root either way.
- **the same ternary at TOP LEVEL compiles + wires correctly** (markup-as-value pillar L1 / §1.4 / §7.4 expression-position lowering — landed S201, `g-markup-value-ternary-fnreturn-codegen RESOLVED`).

## PA's empirical repros (already written — re-create in your worktree under /tmp or a scratch dir)

`single-loud.scrml` (→ E-CODEGEN-INVALID-JS):
```scrml
<program>
type P:enum = { Loading  Loaded(d: string) }
<x> = P.Loading
<div>
  <match for=P on=@x>
    <Loading><p>loading…</p></Loading>
    <Loaded(d)>${ d == "yes" ? <p>SHOWN</p> : "" }</Loaded>
  </match>
</div>
</program>
```

`multi-silent.scrml` (three `${ cond ? <markup> : "" }` blocks in one arm):
```scrml
<program>
type P:enum = { Loading  Loaded(d: string) }
<x> = P.Loading
<div>
  <match for=P on=@x>
    <Loading><p>loading…</p></Loading>
    <Loaded(d)>
      ${ d == "a" ? <p>A</p> : "" }
      ${ d == "b" ? <p>B</p> : "" }
      ${ d == "c" ? <p>C</p> : "" }
    </Loaded>
  </match>
</div>
</program>
```

`toplevel-control.scrml` (CONTROL — compiles fine today; must STAY working):
```scrml
<program>
<x> = "yes"
<div>
  ${ @x == "yes" ? <p>SHOWN</p> : "" }
</div>
</program>
```

Compile: `bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile <file> --output-dir <dir>`.

## ROOT-CAUSE HYPOTHESIS (verify — you may correct the locus; depth-of-survey-discount applies)

In `compiler/src/codegen/emit-match.ts` the arm-body lowering classifies the body (`bodyForm`: self-closing / bare-body / shorthand) and re-parses it. Our arm body `${ d == "yes" ? <p>SHOWN</p> : "" }` is a **bare-body** (full `<Loaded(d)>...</Loaded>` opener+closer). It routes through the bare-body re-parse path (~L876+, `nativeParseFile` markup-fragment), which lowers the `${...}` interpolation's inner expression. The inner expr `d == "yes" ? <p>SHOWN</p> : ""` is a ternary whose consequent is markup-as-value — and that markup is being DROPPED (parsed JS-only, `<p>` is not valid JS so it vanishes), yielding `cond ? : ""`.

**The likely fix seam:** S201 landed markup-as-value-in-EXPRESSION-position lowering (the top-level path that makes `toplevel-control.scrml` work — see tests `compiler/tests/**/g-markup-value-in-expression.test.js` + `markup-value-render.browser.test.js`, concept row "markup-as-value Pillar 1 §1.4/§7.4 in EXPRESSION position"). The `<match>` arm-body `${...}` interpolation inner-expr lowering does NOT route through that working lowering. **Route it through the same markup-value-aware expression lowering** rather than the JS-only `parseExprToNode` path. This is the same CLASS the S138 Bug-53 fix addressed (markup-as-value as a WHOLE `:`-shorthand body, ~L811 `looksLikeMarkupStart`), but the markup is NESTED inside a ternary/expression rather than the whole body — so the `looksLikeMarkupStart` start-anchored check does not catch it.

**Shared-helper alert:** `emit-variant-guard.ts` is the variant-source-agnostic helper that BOTH `<match>` and `<engine>` state-children reuse. Verify whether an `<engine>` state-child arm body with `${ cond ? <markup> : "" }` has the SAME bug, and fix at the shared mechanism so both surfaces are covered.

## OUT OF SCOPE (do NOT touch)
- The secondary design note in GITI-032 about arm payload binding by DECLARED param name vs positional (`render_X(_data && _data["<paramname>"])`). That is a SEPARATE design question parked by PA as a DD-candidate. Your repros use matching param names (`Loaded(d: string)` + `<Loaded(d)>`) precisely so this confound is absent. Do not change payload-binding semantics.

## SPEC authority (Rule 4 — verify against SPEC text, do not trust derived docs)
- §18 / §18.0.1 — match block-form; arm bodies are code-default bodies. (SPEC §18 lines ~11102-12526; §18.0.1.)
- §4.18 — code-default body mode + `${...}` interpolation inside it.
- §1.4 / §7.4 — markup-as-value pillar (L1): markup may appear anywhere an expression appears, including a ternary branch.
- §19 — markup-as-value / renderable.

---

# PHASE 3 — EMPIRICAL R26 VERIFICATION (MANDATORY — do NOT mark DONE without this passing)

After the fix, re-compile and check:
1. `single-loud.scrml` → compiles exit-0, NO E-CODEGEN-INVALID-JS, emitted client.js has the consequent present (`... ? _scrml_*markup*... : ""`), and `node --check` the emitted `*.client.js` passes.
2. `multi-silent.scrml` → compiles exit-0; the `render_Loaded(d)` fn body contains the three markup consequents (NOT whitespace-only); `node --check` passes.
3. `toplevel-control.scrml` → STILL compiles + wires (no regression).
4. A clean engine-state-child analogue if you confirmed the shared-helper bug (e.g. an `<engine>` with a state-child arm body `${ cond ? <p>X</p> : "" }`).
5. State the exact grep/shape checks you ran and their results in the report.

# S215 ADVERSARIAL GATE (MANDATORY for the diff — enumerate the BLAST RADIUS, construct edge repros, run a review)

The fix changes how markup-as-value nested in an arm-body interpolation lowers. Where else can markup-as-value nest? Construct + compile repros for the adjacent shapes and confirm they emit valid JS that `node --check` passes:
- markup in a logical-OR alternate: `${ @x == "yes" ? "" : <p>FALLBACK</p> }` (consequent string, alternate markup).
- markup in BOTH branches: `${ cond ? <p>A</p> : <p>B</p> }`.
- nested ternary with markup: `${ a ? <p>A</p> : b ? <p>B</p> : "" }`.
- markup in `&&` / `||` short-circuit: `${ @show && <p>X</p> }`.
- the same shapes inside an `<engine>` state-child arm (shared helper).
- the same shapes inside `<each>` per-item body if that path also re-parses interpolations (verify; report).
Then run `/code-review` (high) on your final diff, or a self-adversarial pass enumerating what the change could break. Land only if clean.

---

# WITHIN-NODE PARITY + FULL SUITE (S198 brief-template — MANDATORY)

This is a codegen change that shifts emitted JS for `${markup-ternary}` in arm bodies. If any within-node corpus fixture (`examples/`+`samples/` .scrml) exercises that shape, the M6.5.b.0 within-node parity test may go OVER-BUDGET. In the SAME landing:
- If the over-budget test prints `[within-node] OVER-BUDGET <relpath>: {CLASS:{raw,allow,residual}}`, set that allowlist entry's per-class values to the printed `raw`, IN-PLACE (preserve key order — NOT a whole-file json re-dump).
- Run the **FULL** `bun run test` (NOT just the pre-commit subset — the parity canary + browser/lsp live only in the full suite) and confirm GREEN before reporting DONE. Report the final pass/skip/fail counts.

---

# COMMIT DISCIPLINE (crash-recovery — commit per meaningful unit, do NOT batch)
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` to verify; `git -C "$WORKTREE_ROOT" add <file>`; commit immediately. WIP commits expected (`WIP(giti-032): <what>`). The branch is the checkpoint.
- Code + its coupled test land in ONE commit (no transiently-red window).
- Update `docs/changes/giti-032-ternary-markup-in-match-arm-2026-06-24/progress.md` after each step (append-only: timestamp · what done · what next · blockers).
- Before reporting DONE: `git -C "$WORKTREE_ROOT" status --short` MUST be clean. "work in worktree, no commits" is NOT an acceptable terminal report.

# FINAL REPORT (return as your final message — this IS the data PA consumes)
- WORKTREE_PATH · BRANCH · FINAL_SHA
- FILES_TOUCHED (list)
- Root cause (confirmed/corrected) + the fix in 2-3 sentences
- Phase-3 R26 results (the 4-5 checks + grep outputs + node --check)
- S215 adversarial results (the edge repros + review outcome)
- Within-node allowlist: touched? which fixtures? Full-suite final counts.
- Maps feedback (load-bearing finding or not)
- Deferred items / anything out of scope you noticed

If you hit a wall on the root cause after a genuine survey, you may request a deep-dive from PA (the supervisor) rather than guessing.
