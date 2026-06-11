# BRIEF — g-display-text-overquote (S181)

Change-id: `g-display-text-overquote-2026-06-11`

# Task: build the `W-DISPLAY-TEXT-OVERQUOTE` info-lint (user-ratified S179: "a lint is the right move there")

## The ergonomic footgun (user-ratified to fix as a LINT)
The §4.18 code-default-body model: in an engine state-child / match-arm / `:`-shorthand body, a bare run is CODE and display text needs `"..."` quoting. BUT text inside a NESTED plain-markup element (`<p>`, `<span>`, any HTML element) is FREE-TEXT (verbatim). An adopter who carries the code-default `"..."` habit into a nested plain-markup element writes `<p>"On the way."</p>` and gets **literal quote marks in the output, with NO diagnostic.** Spec-CORRECT (free-text is verbatim) but surprising.

## VERIFIED REPRODUCER (PA-confirmed at HEAD this session)
```
<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>
            <p>"loading..."</p>
        </Loading>
        <Ready rule=.Loading>
            <p>ready now</p>
        </Ready>
    </engine>
</program>
```
Compiling this at HEAD `b81fe03f` emits (CONFIRMED):
- `repro.html`: `<div data-scrml-engine-mount="phase"><p>"loading..."</p></div>` — literal quotes
- `repro.client.js`: `return "<p>\"loading...\"</p>";` — literal quotes
- ZERO diagnostic. The bare-text control `<p>ready now</p>` is clean.

(A copy is at `/tmp/s181-overquote/repro.scrml`.)

## The lint (the ratified design — DO NOT redesign)
- **Code:** `W-DISPLAY-TEXT-OVERQUOTE`, **Info** severity (info-level; rides `result.warnings` per the W-/I- partition — write the test with the cross-stream `[...errors, ...warnings]` collector, NOT `result.errors.filter`, to avoid the S92 false-negative class).
- **Fire condition (precise):** a `"..."`-wrapped string literal is the **SOLE content** of a **plain-markup element** (`<p>`/`<span>`/HTML element — NOT a scrml structural element, NOT a code-default body directly) that is **nested inside a code-default-body context** (engine state-child body / match-arm body / `:`-shorthand body per §4.18 / §4.15). The over-quote happens because the plain-markup child's body is free-text, so the adopter's `"..."` (correct in the enclosing code-default body) renders literally here.
- **Message:** "the quotes will render literally; did you mean bare text (`<p>On the way.</p>`)?" (cite §4.18).
- **Does NOT fire on:** a `"..."` literal that IS directly in a code-default body (that's the CORRECT display-text literal, §4.18.3); bare text inside plain-markup (correct free-text); a quoted string that is NOT the sole content (e.g. `<p>"a" and "b"</p>` — adopter clearly intends literal quotes); a `"..."` inside a non-plain-markup locus.

## Candidate fire-site loci (verify, then pick — you are the compiler-source expert)
- `compiler/src/ast-builder.js:12752` — the §4.18 code-default-body grammar interpretation (has body-mode context; the natural place to detect a nested plain-markup element with a sole quoted-string child).
- `compiler/src/lint-ghost-patterns.js` — where the W-LINT-* / info-lints live (has `buildSkipRanges` machinery), IF the detection is better done as a post-parse lint pass with body-mode awareness.
Pick whichever locus cleanly has BOTH (a) the code-default-body-context signal AND (b) the nested-plain-markup-sole-quoted-child structure. Do not fire from a locus that lacks the code-default-body context (it would false-fire on quoted text in ordinary plain markup outside any code-default body).

## SPEC (Rule 4 — normative; new code lands in §34 in the same change)
- Add a `W-DISPLAY-TEXT-OVERQUOTE` row to SPEC §34 (Info; arm/state-child/`:`-shorthand-scoped; cross-ref §4.18).
- Add a short §4.18 note (near §4.18.3 the display-text literal, or §4.18.7 alongside E-UNQUOTED-DISPLAY-TEXT) describing the INVERSE footgun: over-quoting in a nested plain-markup free-text body inside a code-default context, and that `W-DISPLAY-TEXT-OVERQUOTE` surfaces it. Note this is the mirror of E-UNQUOTED-DISPLAY-TEXT (which is the UNDER-quoting case in the code-default body itself, currently spec-ahead/unwired — do NOT wire E-UNQUOTED here; that's a separate item).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full. Task-Shape: compiler-source new-lint + spec-text edit. Maps were refreshed THIS session to HEAD (watermark `b81fe03f`, current). Treat as starting hypothesis; verify fire-site via grep/Read. Report the maps-consulted note.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git merge main --no-edit` (sync to current main — it carries the g-server-keyword-error-msg SPEC.md edits you must build on). Then `git status --short` clean.
4. `bun install` (worktrees don't inherit node_modules).
5. `bun run pretest` (populate samples/compilation-tests/dist/).

## Path discipline (EVERY edit)
- Apply ALL edits via **Bash** (`perl -i`/`python3`/heredoc) on **worktree-absolute paths including the `.claude/worktrees/agent-<id>/` segment** — NOT Edit/Write tools (S99/S126 leak class). Echo the path before each write; re-verify with `git diff`/`grep`.
- NEVER `cd` into the main repo or anywhere outside WORKTREE_ROOT. Use `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"`.
- FIRST commit message includes verbatim `pwd`: `WIP(display-text-overquote): start at <pwd>`.

# COMMIT DISCIPLINE
- Commit after each edit; don't batch. `git status` clean before reporting DONE. Update `docs/changes/g-display-text-overquote-2026-06-11/progress.md` each step. NO `--no-verify`.

# VERIFY
- Compile the reproducer above → `W-DISPLAY-TEXT-OVERQUOTE` fires (info) on the `<p>"loading..."</p>` site; the bare `<p>ready now</p>` control stays SILENT.
- Add a match-arm reproducer and a `:`-shorthand reproducer (the other two code-default loci) → lint fires in each.
- Negative controls (MUST stay silent): a `"..."` literal directly in a code-default body (correct display-text); bare free-text in plain markup; a quoted string in plain markup OUTSIDE any code-default body; a non-sole-content quoted string.
- **Emit must be byte-IDENTICAL** (lint-only; no codegen change) — confirm the emitted HTML/JS for the reproducer is unchanged vs pre-fix (the literal quotes still render; we only ADD the info diagnostic). Run an R26-style before/after emit diff on the reproducer to prove zero codegen change.
- `bun --cwd "$WORKTREE_ROOT" test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` green.

# REPORT
WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, the fire-site locus chosen + why, the exact fire-condition predicate, byte-identity emit proof, test result, maps-consulted note.
