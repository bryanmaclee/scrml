# Bug 68 — positional-payload enum variant not materialized at the schemaFor classify layer → misses E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1

> **S136 archival.** Verbatim `prompt:` text dispatched to `scrml-js-codegen-engineer`
> (isolation:worktree, bg, model:opus) at S157, 2026-06-02. Worktree base = session-start
> `57edc794`; brief mandates `git merge main` (→ `63fcba72`) at startup to inherit the
> landed Bug 63 (`type-system.ts`) + Bug 65 (`emit-*.js`) commits.

Change-id: `bug-68-positional-payload-enum-schemafor-2026-06-02`

You are fixing a TYPE-SYSTEM / codegen-classify bug in the scrml compiler (TypeScript source). A POSITIONAL-payload enum variant (`Ok(int)`) fed to `schemaFor` is misclassified as a bare-variant enum — it escapes the `E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1` rejection AND emits a bogus SQL CHECK. The NAMED-payload form (`Ok(value: int)`) classifies correctly and fires the rejection. Close the asymmetry.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP and report (S90 CWD-routing failure). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git status --short` clean. Then run `git rev-parse --short HEAD` and note it (it will likely be the session-start `57edc794`, which is STALE — see next step).
4. **MERGE CURRENT MAIN (S112 worktree-base-staleness fix — MANDATORY).** Your worktree branched from the session-start commit, which PREDATES two landed fixes this session (Bug 63 in `type-system.ts`, Bug 65 in `emit-*.js`). Run: `git -C "$WORKTREE_ROOT" merge main` (this is the LOCAL main branch at `63fcba72`, which carries those commits; it's a clean fast-forward — your branch has no commits yet). Confirm `git rev-parse --short HEAD` now shows `63fcba72` (or a merge commit on top). If the merge conflicts or main isn't reachable, STOP and report. **Why:** if you edit `type-system.ts` on the stale base, the PA's file-delta landing would silently REVERT Bug 63's markup-attr hookup.
5. `bun install` (worktrees don't inherit `node_modules`).
6. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`).

If ANY check fails: STOP and report.

## Path discipline (S99/S126)

- **Apply ALL file edits via Bash** (`perl -i` / `python` / heredoc) on **worktree-absolute paths including the `.claude/worktrees/agent-<id>/` segment**, NOT Edit/Write tools (they leak into MAIN). Echo the path before each write; re-verify with `git diff`/`grep` after.
- **NEVER `cd` into the main repo** or outside `WORKTREE_ROOT`. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths.
- First commit message embeds your pwd: `WIP(bug68): start at $(pwd)`. Commit after every meaningful edit; `git status` clean before reporting DONE. Update `docs/changes/bug-68-positional-payload-enum-schemafor-2026-06-02/progress.md` (append-only) per step.

---

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` in full (in your worktree — AFTER the `git merge main` so you have the refreshed S157 maps). Follow **"Task-Shape Routing"** → **"compiler-source bug fix"** + the schemaFor-relevant entries. Key maps: `domain.map.md` (L22 type-as-argument family / schemaFor concept), `error.map.md` (E-SCHEMAFOR-* family + fire-site locations), `schema.map.md` (struct/enum AST shapes).

Feedback line in your final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing".

---

# THE BUG (confirmed reproduced by PA on HEAD 63fcba72)

`schemaFor` over a struct with a POSITIONAL-payload enum field does NOT fire the v1.0 rejection and emits a meaningless CHECK; the NAMED-payload form fires correctly.

**Reproducer A — POSITIONAL payload (the bug — compiles CLEAN, SHOULD reject):**
```scrml
${
  import { schemaFor } from 'scrml:data'
  type Result:enum = { Ok(int), Err(string) }
  type Job:struct = { id: int, status: Result }
}
<program db="./db.sqlite">
  <schema>
    ${ schemaFor(Job) }
  </>
</program>
```
Compile (`bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile <tmp>/A.scrml -o <tmp>/distA`) → **exit 0, NO error** (the bug). The emitted `<schema>` body for `status` is a bogus bare-enum CHECK (`text req oneOf(['Ok','Err'])`) — payload silently dropped.

**Reproducer B — NAMED payload (the working sibling — fires correctly):**
```scrml
${
  import { schemaFor } from 'scrml:data'
  type Result:enum = { Ok(value: int), Err(reason: string) }
  type Job:struct = { id: int, status: Result }
}
<program db="./db.sqlite">
  <schema>
    ${ schemaFor(Job) }
  </>
</program>
```
→ fires `E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1: ... field 'status' typed as a payload-bearing enum 'Result' ...` (exit 1). This is the TARGET behavior Reproducer A must also reach.

**Reproducer C — genuinely BARE-variant enum (must STAY clean — non-regression):**
```scrml
${
  import { schemaFor } from 'scrml:data'
  type Role:enum = { Admin, Editor, Viewer }
  type User:struct = { id: int, role: Role }
}
<program db="./db.sqlite">
  <schema>
    ${ schemaFor(User) }
  </>
</program>
```
→ compiles CLEAN and lowers `role` to `text req oneOf(['Admin','Editor','Viewer'])` per §41.15.6. Your fix must NOT make this over-fire — a bare-variant enum is legitimately lowerable.

# DIAGNOSIS (PA hypothesis — verify it)

At the schemaFor classify layer, a POSITIONAL-payload variant (`Ok(int)`) does NOT materialize its payload Map (likely because the payload has no field NAME to key on), so the field classifies as a bare-variant enum — escaping the §41.15.6 / §41.15.7 payload-enum rejection. The NAMED form (`Ok(value: int)`) materializes the payload and is classified correctly. The schemaFor walker lives in `compiler/src/type-system.ts` (`collectSchemaForImports` + `walkAndExpandSchemaForCalls` + `_processSchemaForCallInSchemaContext`) and the emitter in `compiler/src/codegen/emit-schema-for.ts`. SURVEY where the per-field enum-payload classification reads the variant payload, and determine whether the positional payload is dropped at ENUM-PARSE time (variant materialization — `parseEnumBody` / variant struct) or at the schemaFor CLASSIFY read. Fix at the right layer so a positional-payload enum is recognized as payload-bearing.

**Scope guard (Rule 3 — right answer, but don't over-reach):** if the root is a shared enum-variant-payload-materialization gap (positional payloads dropped generally, affecting more than schemaFor), CHECK whether `tableFor` (`E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1`, `_processTableForNode` in type-system.ts) has the identical miss. If the fix is at a SHARED materialization point and naturally closes both, close both (note it). If tableFor needs a separate fix, NOTE it as a follow-up (don't expand scope unboundedly) — file it in your report, don't silently fix-or-skip. The PRIMARY deliverable is Bug 68 (schemaFor).

# Verification (compile-level canary)

Do NOT mark DONE without:
1. Reproducer A → now fires `E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1` (naming field `status` + enum `Result`). Report the exact diagnostic.
2. Reproducer B → still fires (no regression on the named form).
3. Reproducer C → still compiles CLEAN, `role` still lowers to `text req oneOf(['Admin','Editor','Viewer'])` (the rejection did NOT over-fire on a genuinely bare enum). Report the emitted CHECK.
4. A MIXED case (one bare-variant field + one positional-payload field in the same struct) → the bare field lowers, the payload field rejects.
5. Full suite `bun run test` (chains pretest) — `0 fail`, baseline 22,771 pass (post-Bug-63/65). Report the delta. Watch for any sample/example that used a positional-payload enum in a schemaFor and now legitimately errors — report it, don't suppress the check.

# Tests to author
- Unit: `compiler/tests/unit/schemafor-positional-payload-enum-bug68.test.js` — positional-payload enum field fires E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1; named-payload still fires; bare-variant enum still lowers clean (no over-fire); mixed struct. Mirror the assertion style of `compiler/tests/unit/schema-for.test.js`.

# Commit discipline
- Code + coupled test in the SAME commit. Pre-commit runs unit+integration+conformance; pre-push runs full+browser. **No `--no-verify`** on commit OR push without authorization (you don't have it). Branch name irrelevant (PA lands via S67 file-delta).

# Final report MUST include
- `WORKTREE_PATH`, `FINAL_SHA`, the post-merge HEAD (confirm the S112 merge happened — `63fcba72` in your ancestry), `FILES_TOUCHED` (exact), deferred-items list (esp. the tableFor sibling disposition).
- Root-layer finding (enum-parse materialization vs schemaFor classify read).
- Verification results verbatim (diagnostics for A/B + emitted CHECK for C + mixed case).
- Full-suite pass/fail/skip + delta + any sample/example newly-errored.
- Maps feedback line.
- Confirmation `git status` clean + all work committed.
