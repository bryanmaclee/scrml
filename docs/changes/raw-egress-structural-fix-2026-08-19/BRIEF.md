# BRIEF — raw-egress structural fix + dpa-033 (c)

**Dispatched:** S353-bryan, 2026-08-19. Base: `origin/main` @ `3b5eed44`.
**Agent:** scrml-js-codegen-engineer, `isolation: "worktree"`, model opus.
**Change-id:** `raw-egress-structural-fix-2026-08-19`

## Ruling authority (do NOT re-derive; both are ratified)

- **dpa-029 Q1** (user-voice S352, bryan verbatim: *"Fix first, re-surface after"*) — land the
  raw-egress structural fix FIRST: allowlist the Bun HTTP vocabulary so bare `new Response(...)`
  compiles as §40.3.5 documents · add the member-chain walk so `globalThis.Response` is covered ·
  demote the co-occurrence source-text regex to a real analysis.
- **dpa-033** (user-voice S352, bryan verbatim: *"Floor now, exit restored after"*) — land **(c)**:
  delete the `reveal` suppressor from the raw-egress gate. Subtractive, zero adopter migration.
  §14.8.9 (`SPEC.md:8506-8513`) already mandates VALUE-scoped declassification in four phrases
  (*at the value* · *here only* · *declassified-at-this-value* · *at the sink*), so the current
  body-wide `revealed` union is the NON-CONFORMANT state. This is **conformance restoration —
  a bug fix, not an amendment** (base §8, toward-the-contract limb of newly-rejecting).
- **(d) sink-level lowering is a SEPARATE, LATER arc.** Do NOT build it here.

## PA-VERIFIED BY EXECUTION at S353 on `3b5eed44` (not relayed — reproduce if you doubt it)

Locus: `compiler/src/codegen/protect-egress.ts`, `detectProtectedRawEgress()` (~line 274-303).
Fire site: `compiler/src/codegen/emit-server.ts:1807-1830`.
**Treat the locus as PA-LOCATED-VERIFY** (base §5): confirm it, and report whether the hypothesis
HELD / was REFINED / was WRONG.

Three defects, each reproduced:

1. **`globalThis.Response` bypasses the gate entirely.** The detector tests
   `/\bnew\s+Response\b/` — a source-text regex. `new globalThis.Response(JSON.stringify(u))`
   does not match. Compiles **exit 0, zero diagnostics**, and the emitted `.server.js` carries
   `_scrml_protect_tag(row, ["passwordHash"])` at the read and a bare
   `new globalThis.Response(JSON.stringify(u))` at the sink with **no `_scrml_protect_redact`**.
   Replaying the emitted helpers against that shape serializes
   `{"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}` — the secret ships.
2. **The trap closes on itself.** Bare `Response` fires `E-SCOPE-001` (*"Undeclared identifier
   `Response`"*) — it was never in the logic-scope allowlist. So the natural workaround an author
   reaches for IS the spelling that silences the protect gate. The compiler steers authors onto
   the leak. Fixing the allowlist is therefore part of the same fix, not a nicety.
3. **The `reveal` suppressor is BODY-WIDE, not value-scoped.** `if (/\.\s*reveal\s*\(/.test(fnSource))
   return null;` — a `.reveal("passwordHash")` applied to a *completely different query's row*
   (`WHERE id = 999`) suppresses the gate for the actually-returned, never-revealed row. Verified:
   the only diagnostic emitted was `E-SCOPE-001`; **`E-PROTECT-004` did not fire.**

## Rule 7 (S338) applies in full — this is the census's exact shape

`detectProtectedRawEgress` is a **post-AST stage asking the source text what the parsed tree already
knows**: four regexes over `fnSource` deciding a confidentiality gate. Every one of the three defects
above is a direct consequence. The dpa-029 Q1 ruling's third limb — *"demote the co-occurrence
source-text regex to a real analysis"* — is this rule applied. **Route it structurally.** A regex
here is not a shortcut you may keep with a justification comment; the ruling already decided it.

## Scope — what to build

1. **Structural detection.** Replace the `fnSource` regex scan with an analysis over the parsed tree
   for the server-fn body. The three egress kinds the gate must still recognise (`_{}` foreign block,
   manual `Response`/`handle()` body, `asIs` value) become node-kind/callee questions, not text
   questions. **Resolve the callee through a member chain** so `globalThis.Response`,
   `window.Response`, and any aliasing spelling reach the same conclusion as bare `Response`.
2. **Logic-scope allowlist.** Admit the Bun HTTP vocabulary so bare `new Response(...)` compiles as
   §40.3.5 documents, instead of firing `E-SCOPE-001`. Scope it to the documented vocabulary — do NOT
   open the allowlist wider than §40.3.5 names. **Quote the governing sentence in your report**
   (base §1 governing-sentence gate) or record the search that found none.
3. **Delete the `reveal` suppressor** from `detectProtectedRawEgress`. Nothing replaces it in this
   arc — (c) is deliberately a floor with no exit; (d) restores the exit later.

## Direction-of-change classification (base §8) — state it in your report

Deleting the suppressor is **newly-rejecting**: source that compiled now fails. Migration is MEASURED,
not assumed — `.reveal(` occurs in exactly **2** `.scrml` files corpus-wide, both dedicated conformance
cases for this mechanism (`conformance/cases/protect/reveal-suppresses-e004/`,
`conformance/cases/protect/reveal-client-visible-runtime/`); zero adopter, sample or example usage.
**Re-measure it yourself** (`grep -rl '\.reveal(' --include='*.scrml' .`) and report the count — do not
take mine. `reveal-suppresses-e004` asserts the very behaviour being deleted: it must be **re-authored
or retired**, and your report must say which and why.

Admitting bare `Response` is **newly-accepting**. It ships ONLY under the toward-the-contract limb —
i.e. only if §40.3.5 already says the form is legal. If it does not, STOP and report: that half is a
RULING, not a fix, and it is bryan's.

## Gates — non-negotiable

- **Rule 4 governing-sentence gate.** Read §14.8.9 and §40.3.5 IN FULL via `offset:`/`limit:` before
  changing behaviour. Quote the governing sentence, or record `searched §X, §Y — none found`.
- **Rule 4b `prov=`.** Every surface-moving change carries provenance. Here it is
  `provenance: ruling:user-voice-scrml.md S352` for both halves, and it goes INLINE at the amended
  SPEC section as well as on any `@gap` marker you touch.
- **Bite proof, both directions** (base §8 unproven-gate). For each of the three defects: a test that
  FAILS against the pre-fix compiler and PASSES after. A test that only passes after is not a proof.
- **Conformance.** `bun conformance/run.ts` green. Add cases pinning the new behaviour — the
  `globalThis.Response` bypass and the cross-value `reveal` suppression each need a case with BOTH
  the codes half and the runtime half.
- **R26 empirical.** Recompile real adopter `.scrml`
  (`../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`) on the post-fix baseline. The
  symptom-check is a grep on emitted output, NOT "tests pass". **Do not mark DONE without it.**
- **Population count before narrowing** (base §8 coverage-removal blind spot). You are changing what a
  fail-closed check inspects. Count the sites it will stop looking at and the sites it newly reaches;
  report both numbers. A clean differential is not an answer to that question.

## Startup — the worktree is cut from `origin/main`, NOT from the PA's checkout

1. Assert isolation: `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   `git rev-parse --show-toplevel` must equal it. Clean tree. If ANY check fails, STOP and report.
2. `git merge-base HEAD origin/main` must equal `origin/main` — assert your own base loudly.
3. `bun install` (worktrees do not inherit `node_modules`; the hook fails on `acorn` otherwise).
4. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`).
5. This BRIEF lives at `docs/changes/raw-egress-structural-fix-2026-08-19/BRIEF.md` on branch
   `feat/raw-egress-structural-fix`. If absent in your worktree:
   `git fetch origin feat/raw-egress-structural-fix && git checkout FETCH_HEAD -- docs/changes/raw-egress-structural-fix-2026-08-19/`

## Path discipline

Every Read/Write/Edit uses an absolute path UNDER your worktree root. NEVER `cd` into
`/home/bryan-maclee/scrmlMaster/scrml`. Use `--cwd "$WORKTREE_ROOT"` for `bun` and
`git -C "$WORKTREE_ROOT"`. First commit message: `WIP(raw-egress): start at $(pwd)`.

## Crash recovery

Commit after EVERY meaningful unit — do not batch. **Push after every commit.** Maintain an
append-only timestamped `docs/changes/raw-egress-structural-fix-2026-08-19/progress.md`
(what was just done · what is next · blockers). WIP commits are expected. A ~2-minute pre-commit hook
can outrun a shell timeout — **check `git log -1` before retrying a timed-out commit; it usually landed.**
NEVER `--no-verify`, and never override `core.hooksPath`.

## Report back

Workspace path · final SHA · files touched · whether the PA's locus HELD / was REFINED / was WRONG ·
the quoted governing sentences (or the recorded search) · the direction-of-change class per change ·
the measured migration count · the two population counts · the bite proofs (command + pre-fix failure
+ post-fix pass) · R26 result · anything you deferred and why.
