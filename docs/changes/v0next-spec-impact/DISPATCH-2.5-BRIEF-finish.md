# Stage 0b — Dispatch 2.5 Brief: engines + match + validators FINISH

**Target agent:** `scrml-dev-pipeline` (T3, worktree-isolated, **MUST run on Opus**)
**Scope:** Pick up Dispatch 2 from where the Sonnet attempt failed. §17 Tier 0 framing already landed on main (`af86fc2`); this dispatch covers the rest.
**Output:** §18 match major rewrite + §51 engines major rewrite + §54 substates partial + §55 NEW validators + §34 additions + INDEX regen + cross-ref sweep.
**Authorization:** scoped to this brief; "no holds barred" carries forward from S57.
**Date drafted:** 2026-05-04 (S57)

---

## §0 Why this brief exists

Dispatch 2 was launched once and FAILED. Two contributing causes:

1. **Wrong model.** The default Sonnet 4.6 lacked the coherence to recover when its preferred tool path (writing patch files + `git apply`) was gated by the Bash permission system. The agent spent hours debugging hunk-header line counts instead of pivoting to the Edit tool. Per pa.md (S4 2026-04-11): *"All agents run on Opus. Pass `model: 'opus'` on every Agent dispatch."* This dispatch MUST run on Opus.

2. **Brief didn't ban patch files explicitly.** The original D2 brief said "no python/sed/awk/node-script via Bash for file modification." Sonnet found a loophole: write a patch file, then `git apply` via Bash. `git apply` is gated, the agent gets stuck. This brief explicitly bans the patch-file workflow.

D2's lone real commit (§17 Tier 0 framing) is already cherry-picked to main as `af86fc2`. D2.5 picks up from there.

---

## §1 ABSOLUTELY NON-NEGOTIABLE — TOOL-USE MANDATE (REVISED FOR D2.6)

This dispatch is `scrml-dev-pipeline` whose tool set is `Read / Write / Glob / Bash / Agent`. **`Edit` is NOT available.** A previous attempt halted on this realization (correctly, given the prior brief's wording). This revision specifies the brief-compliant pattern using the tools you actually have.

### What you MUST do — the Read+Write pattern

To modify `compiler/SPEC.md`:

1. **Read the full current SPEC.md** at the start of the dispatch. You may Read in chunks (it is ~22k lines) but you must Read every chunk that bounds your edits before making any changes.
2. **Plan one atomic change at a time** (one subsection insertion, one error-code row added, one cross-ref fix).
3. **Construct the new full-file content** in your working memory by mentally substituting the change into the file you read. Do NOT write a patch file; do NOT generate a diff; just plan the new full content.
4. **Use the `Write` tool ONCE per atomic change** to write the entire updated SPEC.md back. Yes, full-file overwrite — that is the supported pattern when Edit is unavailable.
5. **Immediately after each Write, verify by grep:** run `grep -n '<your new section header>' compiler/SPEC.md` to confirm the change persisted. If grep fails, re-Read the file and try again.
6. **Commit immediately after the verified Write.** Don't batch.
7. **Re-Read the file before the NEXT change.** Don't trust your in-memory copy across multiple Writes — Read fresh each time. This is critical: small in-memory drift on a 22k-line file becomes an invisible regression.

This is exactly how D1.5 successfully landed §6 / §11 fold / §34 / INDEX regen. It works. It is brief-compliant.

### What you MUST NOT do

- **DO NOT write patch files.** No `*.patch`, no `*.diff`, no temporary files intended to be applied later. The original D2 attempt wasted hours on malformed patches.
- **DO NOT use `git apply`** in any form. Gated.
- **DO NOT use `python3`, `sed`, `awk`, `node -e`, `perl -e`, heredoc shell scripts**, or any other tool that invokes a script to modify files. Gated.
- **DO NOT use `>>` or `>` redirects** in Bash to modify SPEC.md.
- **DO NOT skip the post-Write grep verification.** It catches in-memory drift before it accumulates.
- **DO NOT batch multiple subsection insertions into a single Write** (write one logical change, commit, re-Read, then write the next). Each Write must correspond to ONE atomic logical change so commits are reviewable.

### What Bash IS for

Bash is for: `git` (status/log/show/diff/commit/checkout/cherry-pick), `grep`, `head`, `tail`, `wc`, `cat`, `find` (read-only), `bun test`, `bun run`, and `bash scripts/update-spec-index.sh` (SPEC-INDEX regeneration script).

Bash is NOT a substitute for Read+Write. Anytime you find yourself thinking "I'll just do this with sed / python / a patch file," STOP.

### If Write loses content (in-memory drift)

If the post-Write grep finds an EXISTING section was lost (e.g., §6 is now missing because you forgot a chunk when constructing the in-memory copy):
1. Run `git diff HEAD compiler/SPEC.md | head -200` to see what changed.
2. If the change is unintended, run `git checkout -- compiler/SPEC.md` to revert the working tree.
3. Re-Read the file in full or in larger chunks.
4. Try again with more careful chunk handling.
5. Do NOT commit a Write that lost content. The pre-commit hook may not catch silent deletions in a markdown spec file.

---

## §2 STARTUP VERIFICATION + PATH DISCIPLINE

You are running with `isolation: "worktree"` on **Opus**.

### Startup verification (BEFORE any other tool call)

1. Run `pwd` via Bash. Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — clean tree.
4. `git log --oneline -5` — confirm HEAD is at or after `af86fc2` (the §17 partial cherry-pick).
5. Confirm SPEC.md has §17.0 + §17.1 already: `grep -n '^### 17.0\|^### 17.1' compiler/SPEC.md` — both present. Also confirm the D1 work: `grep -c '^### 1.4\|^### 1.5\|^### 1.6\|^### 3.4\|^### 6.1\|^### 6.8\|^### 6.12' compiler/SPEC.md` ≥ 7.

If any check fails: STOP and report.

### Path discipline (every Read/Write/Edit)

- Write/Edit paths under WORKTREE_ROOT (relative paths preferred).
- Cross-repo Reads (`../scrml-support/...`) — absolute paths OK for Reads only.
- NEVER write to `.claire/...` (typo path leak — common model error).
- NEVER write to `/home/bryan-maclee/scrmlMaster/scrmlTS/...` directly — that's main, not your worktree.

---

## §3 CRASH RECOVERY — INCREMENTAL COMMITS + PROGRESS REPORTS

This dispatch will take 25-40 hours. Crashes happen.

1. **Commit after each meaningful change.** Each subsection landed → commit. Each error code added → commit. Don't batch. WIP commits are EXPECTED.
2. **Update `docs/changes/v0next-spec-impact/progress-dispatch-2.5.md` after each step.** Append-only, timestamped:
   ```
   ## YYYY-MM-DD HH:MM — <one-line summary>
   Just done: <what concretely changed in SPEC.md, with line numbers>
   Next: <what>
   Blockers: <any>
   ```
3. **Report only what is in SPEC.md, not what you've planned.** The previous D2 attempt's progress.md claimed §51, §54, §55, §34 were "done" while only §17 was actually committed. DO NOT claim work as done unless it has been committed.
4. **Verify each commit landed correctly:** after each commit, run `git log --oneline -1` to confirm SHA, then `grep -n '<your new section header>' compiler/SPEC.md` to confirm the change is in the file. If the grep fails, the Edit didn't actually land — investigate and re-do.
5. **Pre-commit hook:** Do NOT bypass with `--no-verify`. If it fails, fix the underlying issue.
6. **Do NOT push.** Main-PA handles integration.

---

## §4 SOURCES TO READ (load-bearing — read in full before editing)

In this order:

1. **This brief** in full.
2. **`docs/changes/v0next-spec-impact/DISPATCH-2-BRIEF-engines-match-validators.md`** — the original 801-line brief. **This is your PRIMARY content reference.** Section-by-section content sketches for §18 + §51 + §54 + §55 + §34 are there. Treat the original brief as authoritative for content; this 2.5 brief is the wrapper that fixes the tool-use issue.
3. **`docs/changes/v0next-spec-impact/IMPACT-ASSESSMENT.md`** — master plan.
4. **`docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md`** — Phase A1+ context (S57 addition).
5. **`../scrml-support/docs/deep-dives/v0next-s56-deliberation-outcomes-2026-05-04.md`** — locks L1-L20.
6. **`../scrml-support/docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md`** — moves M1-M20.
7. **`../scrml-support/docs/deep-dives/state-as-primitive-redesign-synthesis-2026-05-03.md`** — narrative context.
8. **`docs/articles/llm-kickstarter-v2-2026-05-04.md`** — LOCKED kickstarter; authoritative tiebreaker. §4 (engines), §6 (validators), §11 recipes are particularly load-bearing for D2.5.
9. **`compiler/SPEC.md`** — your target. Already has D1 (§1+§3+§6+§11 fold+§34 +9 codes) and D2 partial (§17.0+§17.1) landed. Your additions go on top.
10. **`compiler/SPEC-INDEX.md`** — regenerate at end.
11. **`pa.md`** — repo conventions.
12. **`../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`** — mandatory before any scrml code example.

---

## §5 SCOPE — what to do, in order

Detailed content sketches live in **DISPATCH-2-BRIEF-engines-match-validators.md** §3.2-§3.6. This section enumerates the work order and assigns Edit-call discipline.

### §5.1 §18 Pattern Matching — major rewrite

Per original D2 brief §3.2. Cover:
- §18.0 Two match shapes (block-form for markup, JS-style for value-return) — NEW
- Update existing §18 subsections to acknowledge Tier 1 framing, rules-inert in match, `for=Type [on=expr]` standardization
- W-MATCH-RULE-INERT lint reference

**Edit discipline:** ONE Edit call per subsection (§18.0 NEW, then any modifications to existing §18.1-§18.18 individually as needed).

### §5.2 §51 Engines — MAJOR REWRITE (largest piece)

Per original D2 brief §3.3 (the bulk of the brief — ~200 lines of content guidance). Cover:
- §51.0 Overview (north star, singleton, Tier 2)
- §51.A Engine declaration syntax
- §51.B Auto-declared engine variable (Move 16)
- §51.C State-children
- §51.D Mount position rules (decl IS mount; cross-file mount via `<EngineName/>`)
- §51.E `initial=` attribute (lint default-to-first if omitted; forbidden on derived engines)
- §51.F `rule=` contract — three forms (event-driven, predicate, wildcard)
- §51.G `.advance()` method
- §51.H `effect=` attribute + `<onTransition>` element
- §51.I `:` shorthand for inline state-child rendering
- §51.J Derived engines (`derived=expr` — L20)
- §51.K Components vs engines (Move 20 — distinct, do not collapse)
- §51.L Pre-existing audit / validation content — preserve, renumber as needed

**Edit discipline:** ONE Edit per subsection. Big section — pace yourself, commit between every subsection.

### §5.3 §54 Substates — partial rewrite

Per original D2 brief §3.4. Verify §54 composes with the new §51, update terminology (`machine` → `engine` references), note any broken interactions in progress.md.

**Edit discipline:** Surgical Edits where needed.

### §5.4 §55 NEW Validators — biggest new content

Per original D2 brief §3.5 (~250 lines of content guidance). NEW section. Cover:
- §55.1 The shared validator vocabulary (universal-core: req, length, pattern, min, max, gte, lte, etc.)
- §55.2 Per-locus firing semantics (state vs refinement-type vs schema)
- §55.3 Auto-synthesized validity surface (compound + per-field; isValid, errors, touched, submitted)
- §55.4 ValidationError enum tags (NOT strings — L11)
- §55.5 The 4-level error message resolution chain (L12)
- §55.6 `<errors of=expr/>` first-class element (L13)
- §55.7 `all` attribute toggle on `<errors>`
- §55.8 Cross-field validation via predicate args (L14)
- §55.9 Custom validators
- §55.10 Validator firing on derived cells (open Q from brief §7.9 — resolve)
- §55.11 Touched / submitted lifecycle
- §55.12 Read-only synthesized properties (E-SYNTHESIZED-WRITE)
- §55.13 The interplay with §51 engine validation
- §55.14 Migration / legacy `validate()` references
- §55.15 Cross-references summary

**Edit discipline:** ONE Edit per subsection. Prepend §55 right before §56 (or wherever fits per the section ordering). Use the natural break in current SPEC.md as the anchor.

### §5.5 §34 — additional error codes

Per original D2 brief §3.6. ONE Edit per error code added. Coverage from the brief — 17+ new codes.

### §5.6 SPEC-INDEX.md regeneration

Run `bash scripts/update-spec-index.sh` once. Then ONE Edit per new Quick Lookup entry (or one Edit for a contiguous block of new entries).

### §5.7 Cross-reference sweep

Grep + Edit. Any old framings (`machine` where `engine` is now correct, etc.). Verify no references to deleted §11 or `@ Sigil` framings.

---

## §6 DO NOT

- **DO NOT** modify §38 (channels), §39 (schema), §53 (predicates), `not` keyword — those are Dispatch 3.
- **DO NOT** modify compiler source code (`compiler/src/`).
- **DO NOT** modify tests.
- **DO NOT** modify kickstarter v2.
- **DO NOT** modify `pa.md`, `master-list.md`, `hand-off.md`.
- **DO NOT** push.
- **DO NOT** write patch files. (See §1.)

---

## §7 SUCCESS CRITERIA

The dispatch is DONE when:

1. §18 has §18.0 NEW + relevant updates to existing subsections.
2. §51 has all 12 new subsections (§51.0, §51.A through §51.L) + preserved existing audit content.
3. §54 verified + terminology updated.
4. §55 NEW with §55.1-§55.15 (or close — sub-section count is approximate; content coverage is what matters).
5. §34 has 17+ new error codes from the original D2 brief.
6. SPEC-INDEX.md regenerated with new Quick Lookup entries.
7. Cross-reference sweep complete.
8. Each subsection committed independently per the crash-recovery directive.
9. Each commit verified to actually land in SPEC.md before claiming done in progress.md.
10. Final commit message: `spec(dispatch-2.5): finish — §18 match, §51 engines, §54 substates, §55 NEW validators, §34 +codes, INDEX regen` or close variant.

The dispatch is NOT required to make `bun test` pass — the compiler doesn't yet implement §51/§55. Spec-vs-code drift is expected.

---

## §8 ESTIMATED WALL-TIME

- §18 partial rewrite: 2-4 hours
- §51 major rewrite (largest piece): 10-18 hours
- §54 partial: 1-2 hours
- §55 NEW (biggest new content): 8-14 hours
- §34 +N codes: 2-3 hours
- SPEC-INDEX regen + cross-ref sweep: 2-3 hours

**Total: 25-44 hours focused work** (down from 29-50 since §17 is done).

---

## §9 WHAT TO REPORT BACK

When done (or if you crash):
- Branch name (`git rev-parse --abbrev-ref HEAD`)
- Final commit SHA
- Subsection-by-subsection completeness vs success criteria, **verified by grep** (e.g., "§55.1 present at line N — verified")
- Any open questions encountered (especially §7.x list in original D2 brief §7)
- Pointer to `progress-dispatch-2.5.md`

---

## §10 Cross-references

- **Original D2 brief (primary content reference):** `DISPATCH-2-BRIEF-engines-match-validators.md`
- **D1 brief:** `DISPATCH-1-BRIEF-foundation.md`
- **D1.5 brief (precedent for narrower-finish brief structure):** `DISPATCH-1.5-BRIEF-finish.md`
- **Master plan:** `IMPACT-ASSESSMENT.md`
- **Implementation roadmap:** `IMPLEMENTATION-ROADMAP.md`
- **S56 + S55 outcomes ledgers:** `../scrml-support/docs/deep-dives/v0next-s5{5,6}-*.md`
- **Kickstarter v2:** `docs/articles/llm-kickstarter-v2-2026-05-04.md`
- **Anti-patterns brief:** `../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`
- **PA directives:** `pa.md`

---

## §11 Tags

#stage-0b #dispatch-2-5 #engines-match-validators-finish #spec-major #§18-match-tier1 #§51-engines-major #§55-validators-NEW #§34-error-codes #scrml-dev-pipeline-T3 #worktree-isolated #opus-mandated #edit-tool-strict #no-patch-files
