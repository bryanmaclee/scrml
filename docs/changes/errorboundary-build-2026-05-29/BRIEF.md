# errorBoundary build (§19.6 + C-hybrid) — BRIEF (archived per pa.md S136)

Dispatched S142 (2026-05-29) to `scrml-js-codegen-engineer`, isolation:worktree, opus, background.
change-id: `errorboundary-build-2026-05-29`. Baseline HEAD: `db9dba55` (v0.6.11; emitted-JS parse gate DEFAULT-ON).

Write `$WORKTREE_ROOT/docs/changes/errorboundary-build-2026-05-29/progress.md`, update per step (append-only, timestamped). Commit per meaningful unit — don't batch. If you crash, commits + progress.md are the recovery anchor.

---

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (~100 lines) + §"Task-Shape Routing" → **compiler-source NEW FEATURE / codegen + typer + SPEC + canon**: consult `structure.map.md`, `dependencies.map.md`, `error.map.md`. Maps watermark `9ab7aa38` (committed `942d62e7`); baseline `db9dba55` adds the S142 gate work — treat post-`9ab7aa38` content as hypothesis-to-verify. Final-report maps feedback (load-bearing or not).

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
**S99 has had 20 path-discipline leaks; this would be #21 — do not be it.**
Worktree path: harness-assigned — capture via `pwd` step 1, use as `WORKTREE_ROOT`.
## Startup (BEFORE any other tool call)
1. `pwd` MUST start `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else (e.g. under another repo) STOP + report (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel`==WORKTREE_ROOT. 3. `git rev-parse HEAD`; `git status --short` clean. 4. `git merge main` (or up-to-date). 5. `bun install`. 6. `bun run pretest`.
If ANY fails: STOP + report.
## Path discipline (EVERY edit)
- **Apply ALL edits via Bash** (perl/python/heredoc/cp) on worktree-absolute paths INCLUDING the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write tools. Echo path before; re-verify `git diff`/`grep` after. (S126 — Edit/Write twice leaked to MAIN.)
- **NEVER `cd` into main (or anywhere).** `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.
- First commit msg embeds verbatim `pwd`: `WIP(errorboundary): start at $(pwd)`.

---

# CONTEXT — what's ratified, what exists today

errorBoundary is **effectively UNIMPLEMENTED**. `compiler/src/codegen/emit-html.ts:750` emits ONLY an inert `<div data-scrml-error-boundary="...">` marker + renders children straight: `fallback=` is ignored, per-error-variant `renders` dispatch is absent, the runtime catch is absent, and **E-ERROR-005 has ZERO impl hits** (spec'd at SPEC §19.6.6 but never fired). This is a from-scratch feature build, NOT a wire-up of existing code.

**RATIFIED design (S142 — do NOT redesign; build to this):**
1. **SPEC §19.6 is the canonical model:** `<errorBoundary fallback={<markup/>}>` catches errors from **`!`-function calls** in its markup subtree. Per the §19.1 *Renderable Enum Variants* model, each error variant MAY carry its own `renders` clause; the boundary's `fallback=` is the default for variants without one. Priority (§19.6.5): variant `renders` > boundary `fallback` > E-ERROR-005.
2. **Catch-scope = C-HYBRID:** the §19.6 typed `!`-error model (with E-ERROR-005 static exhaustiveness) is the PRIMARY documented behavior, PLUS a **compiler-emitted host-JS backstop** so an unexpected NON-`!` throw in the subtree degrades to `fallback=` (logged loudly, NOT swallowed). The backstop is emitted host-JS — NOT a scrml-source `try`/`catch` (the no-try/catch rule §19.9.8 is unaffected; the backstop is invisible at source, like the §2.2.1 parse gate + the bootstrap localStorage guard). Runtime sibling of the parse gate; Pillar-6 bullet-proof apps.

**The PRIMER §6 + kickstarter `renders=.Fallback` + auto-synth `.Ok`/`.Fallback` form is DRIFT** — it is NOT in SPEC, cites a wrong §19.11 (=@reactive), and doesn't compile. Correct it to the §19.6 form (the PRIMER's *intent* — "catch render errors → fallback" — is preserved by the C-hybrid backstop; only the SYNTAX changes to `fallback=`).

---

# PHASE 0 — SURVEY-FIRST (mandatory; depth-of-survey discount — PRIMER §12)

Before building OR estimating, survey what existing infra partially covers this, and report it + a revised estimate + the build plan in `progress.md`. Likely-relevant existing surfaces to assess:
- `emit-html.ts` `<errors of=expr/>` element (§55.8) — already wires reactive error DISPLAY + a re-render hookpoint anchor; its emit shape may template the boundary's fallback rendering.
- `emit-logic.ts` `!{}` handler codegen (`emitArmBody` / guarded-expr) — the LOGIC-context counterpart to errorBoundary; how it routes `!`-error variants to arm bodies may template the markup-context typed dispatch.
- How `!`-function calls in MARKUP context (`${ loadUser(42) }` inside a boundary) are currently detected/emitted (is there a markup-`!`-call node, or does it go through `${}` interpolation?).
- The §19.2 `renders`-clause on enum variants — is the per-variant `renders` markup stored on the variant anywhere in the AST/type-system, or unimplemented too?
- Engine arm-body render (`emit-engine.ts` / `emit-variant-guard.ts`) — the variant→markup dispatch pattern (the boundary's variant→renders dispatch may reuse it).

**If the survey reveals the typed-catch wiring needs deeper infra than you can land cleanly in one dispatch (e.g. markup-`!`-call detection doesn't exist + is a large pre-req): STOP after the survey and report the re-scope** (PA will split it). Do not build blind. A partial build (e.g. the backstop + fallback rendering WITHOUT the full per-variant renders dispatch) reported clearly is acceptable if the full typed path proves too large — but say so explicitly.

---

# PHASE 1 — SPEC §19.6 amendment (NEW §19.6.8, C-hybrid backstop)

Add a NEW sub-section (suggest §19.6.8 "Runtime backstop for non-`!` errors (C-hybrid)" — renumber the existing §19.6.7 Multi-Batch-CPS if needed, or append as §19.6.8). **PA-DECISION-FLAGGED — draft the normative text to encode EXACTLY these semantics; if any clause's wording is non-obvious, STOP-and-ask rather than overclaim (Rule 4):**
1. The typed `!`-error model (§19.6.3) is the PRIMARY behavior; E-ERROR-005 static exhaustiveness (§19.6.6) stands UNCHANGED.
2. The compiler ADDITIONALLY emits the boundary's subtree render inside a host-JS try/catch backstop. A non-`!`-error thrown during the subtree's render/effect execution is caught and displayed via the boundary's `fallback=` markup.
3. Precedence: a typed `!`-error variant is routed per §19.6.3/§19.6.5 (variant `renders` > boundary `fallback`) — the backstop catches only throws the typed path does NOT (non-`!` host/runtime errors).
4. If a non-`!` throw is caught but the boundary has no `fallback=`: the error propagates to the nearest enclosing `<errorBoundary>` (§19.6.4 nesting); if none, to the host.
5. The backstop is COMPILER-EMITTED host-JS — NOT a scrml-source `try`/`catch`. The no-try/catch rule (§19.9.8) is unaffected; the backstop is invisible at source, like the §2.2.1 parse gate / bootstrap guards.
6. The backstop SHALL NOT silently swallow: the diagnostic + stack trace SHALL route to scrml's logging surface (loud in dev). Defense-in-depth, NOT a substitute for typed `!`-coverage (E-ERROR-005 still required).
7. Cross-refs: Pillar 6 (bullet-proof apps); §2.2.1 (compile-time sibling). §34: add any new code only if a new diagnostic is introduced (E-ERROR-005 already exists in §34? verify — if it's spec-only and you implement it, no NEW row needed, it's a fire-site for the existing code).

---

# PHASE 2 — codegen (the runtime; emit-html.ts errorBoundary handler at ~750)

Replace the inert marker with the real implementation:
- **Typed `!`-error catch:** for each `!`-call in the boundary's subtree, route its error variant → the variant's `renders` clause markup (if present) ELSE the boundary's `fallback=` markup. (Survey Phase 0 for the existing `!`-call-in-markup + renders mechanism; reuse where it exists.)
- **Host-JS backstop:** wrap the subtree render (+ its reactive effect execution) in a host-JS try/catch; a caught NON-`!` throw → render `fallback=` markup + route the error to scrml's logging surface (loud). Backstop is emitted JS (NOT scrml try/catch).
- **`fallback=` rendering:** the `fallback={<markup/>}` attribute markup must actually render (today ignored). Reuse the markup-value emit path.
- **§19.6.4 nesting:** inner boundary catches before outer (inner try/catch nested inside outer; inner `fallback` used first).
- The emitted JS MUST pass the now-default-ON parse gate (`validateEmit` is default-ON as of v0.6.11 — invalid emitted JS = E-CODEGEN-INVALID-JS hard error). `node --check` clean.

---

# PHASE 3 — typer E-ERROR-005 (static exhaustiveness)

Fire E-ERROR-005 (already cataloged at SPEC §19.6.3/§34 — verify it has a §34 row; it's a fire-site for the existing code, likely no new row) when an error variant reachable inside an `<errorBoundary>` has neither a `renders` clause NOR is covered by the boundary's `fallback=`. (Survey: the `!`-call-reachability + variant-enumeration may reuse existing error-handling typer passes.)

---

# PHASE 4 — canon correction (the drift)

- **PRIMER §6** (`docs/PA-SCRML-PRIMER.md`, the `<errorBoundary>` subsection ~lines 165-178): rewrite the `<errorBoundary renders=.Fallback>` + `<errorBoundary.Fallback>` + auto-synth-enum form → the §19.6 `<errorBoundary fallback={<markup/>}>` + per-variant `renders` form. Fix the **wrong §19.11 cite → §19.6**. Keep the "catch render errors → fallback" INTENT (now delivered by the C-hybrid backstop) but with the correct syntax.
- **kickstarter** (`docs/articles/llm-kickstarter-v2-2026-05-04.md`): if it teaches `renders=.Fallback`, migrate to the §19.6 `fallback=` form.

---

# TESTS + ACCEPTANCE
- **Unit** (codegen shapes): the boundary emits valid JS for `fallback=` + per-variant `renders` + nesting + the backstop wrapper.
- **happy-dom (REQUIRED — the empirical runtime proof, S140 acceptance-gate precedent):** drive BOTH paths at runtime — (a) a `!`-call inside a boundary fails → the variant's `renders`/the boundary's `fallback=` actually appears in the DOM; (b) a NON-`!` throw in the subtree → the backstop renders `fallback=` + logs (assert the fallback DOM + that sibling content outside the boundary survives, per §19.6.4); (c) nesting — inner catches, outer's other children survive.
- **R26** (S138): re-compile adopter sources that use errorBoundary (grep examples/ + samples/ for `<errorBoundary`) under the (now default-ON) gate → exit-0 + `node --check` clean.
- **ACCEPTANCE:** full `bun run test` GREEN (gate is default-ON — emitted errorBoundary JS must pass it) + the happy-dom runtime proofs pass. If you can't land the FULL typed+backstop surface cleanly, land what you can + STOP-and-report the remainder precisely (partial OK if reported; do NOT fake-pass).

# COMMIT DISCIPLINE
Commit per phase/unit (crash-recovery). `git -C "$WORKTREE_ROOT" diff` before add. `git status` clean before DONE (S83). **NEVER `--no-verify`** — pretest race → STOP + report.

# FINAL REPORT
WORKTREE_PATH · FINAL_SHA · per-commit list · FILES_TOUCHED · **Phase-0 SURVEY findings + revised estimate + what existing infra you reused** · per-phase disposition (built / STOP-blocked-rescope) · SPEC §19.6.8 text you drafted (+ PA-decisions w/ rationale) · happy-dom proof results (both paths) · R26 table · full-suite result (gate default-ON) · maps feedback · deferred items.
