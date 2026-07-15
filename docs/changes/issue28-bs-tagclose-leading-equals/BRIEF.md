You are fixing a CONFIRMED, live compiler bug (GitHub issue #28) in `compiler/src/block-splitter.js`. This is a compiler-source (TS/JS) fix — NOT scrml authoring.

IMPORTANT — the automatic worktree isolation is broken in this session, so a worktree has ALREADY BEEN CREATED FOR YOU. Do not expect to be auto-placed in one; you must `cd` into it yourself.

═══════════════════════════════════════════════════════════════════════
STEP 0 — ENTER YOUR PRE-MADE WORKTREE (do this literally first, before anything else)
═══════════════════════════════════════════════════════════════════════
Run, as your very first action:
    cd /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-issue28-tagclose

Then VERIFY the isolation gate (all must hold; if any fails, STOP and report — do NOT edit anything):
    pwd                                → MUST be exactly `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-issue28-tagclose`
    git rev-parse --show-toplevel      → MUST equal that same path (NOT `/home/bryan-maclee/scrmlMaster/scrml`)
    git branch --show-current          → MUST be `fix/issue28-tagclose-leading-equals`
    git rev-parse --short HEAD         → MUST be `7d5fda26` (already correctly based on origin/main — do NOT `git reset`, do NOT `git fetch`, the base is already correct)

PATH DISCIPLINE (hard rules for the whole task):
- Every Bash command must run from inside this worktree. NEVER `cd` back to `/home/bryan-maclee/scrmlMaster/scrml` (the main checkout). If you must reference git, use `git -C /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-issue28-tagclose`.
- Every Edit/Write targets a worktree-absolute path under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-issue28-tagclose/`. A leaked write to the main checkout is a process violation.
- `bun install` INSIDE the worktree (it does not inherit node_modules — the pre-commit hook fails "cannot find package 'acorn'" otherwise).
- Commit after EACH meaningful change (WIP commits expected); keep an append-only timestamped `progress.md`. The branch + progress.md are your crash-recovery anchor.

═══════════════════════════════════════════════════════════════════════
THE BUG (issue #28) — confirmed live @ 7d5fda26, OS-independent
═══════════════════════════════════════════════════════════════════════
When an element's text content BEGINS WITH `=`, the tag-closing `>` gets swallowed together with the leading `=`; the opener never terminates; the parse corrupts and cascades into misleading `E-CTX-001` "tags don't match" errors on the OUTER structural tags (`</div>`/`</page>`) — far from the real site.

Minimal repro (FAILS today, must COMPILE after your fix):
    <page auth="none">
      <div>
        <span>= hi</span>
      </div>
    </page>
Real-world repro (FAILS today, must COMPILE after your fix) — a spreadsheet cell:
    <page auth="none">
      <table><tr><td>=SUM(A1:A9)</td></tr></table>
    </page>

═══════════════════════════════════════════════════════════════════════
ROOT CAUSE (already located — verify, then fix)
═══════════════════════════════════════════════════════════════════════
`compiler/src/block-splitter.js`, function `peekTopLevelStateDeclSignal` (~line 1564), specifically **line ~1595**:

    // cluster-A (S188) — g-attr-gte-tagclose: a `>=` inside an opener is a stray comparison operator...
    if (c === ">" && p + 1 < len && source[p + 1] === "=") { p += 2; continue; }

This guard (added S188, `g-attr-gte-tagclose`) was meant to keep a bare comparison attribute like `<p if=@n >= 3>` from being misread as a `<NAME> = RHS` state-decl. But it fires UNCONDITIONALLY — including at the depth-0 tag terminator. So for `<span>= hi>` it skips the closing `>` AND the body's leading `=`; the peek runs into the body, mis-classifies a downstream tag as a state-cell declaration (the tell: `E-DG-002: reactive variable @div/@span declared but never consumed`), and the tag stack corrupts.

**THE REFRAME (why the fix is clean):** the S188 case the guard protects — bare unparenthesized `<p if=@n >= 3>` — is now ITSELF ILLEGAL: it fires `E-ATTR-UNQUOTED-OPERATOR` at the TAB stage ("Parenthesize or quote"). So the ONLY legal way to carry `>=` inside an opener is **parenthesized** (`if=(@n >= 3)`) or **quoted** (`if="@n >= 3"`) — and BOTH are already handled by the peek's paren-depth / string-state tracking (they never reach line 1595 at depth 0). The blanket `>=`-skip is over-broad.

**Fix direction (you scope the exact mechanism):** narrow the guard so a `>`-immediately-followed-by-`=` is skipped-as-comparison ONLY when a comparison is genuinely in progress — i.e. inside an unquoted attribute-VALUE expression — and NOT at a bare tag terminator (where `>` must terminate the opener, falling through to `if (c === ">") { p++; break; }` at ~1596). Study how the mutating `scanAttributes` (the peek is its "non-mutating mirror"; `>=` handling ~lines 1306-1321) tracks attribute-value context and mirror that discriminator. Do NOT simply delete line 1595 — a naive deletion re-breaks the illegal `<p if=@n >= 3>` case into a WORSE error. Preserve BOTH behaviors.

═══════════════════════════════════════════════════════════════════════
ADVERSARIAL ACCEPTANCE MATRIX — every row must hold after your fix
═══════════════════════════════════════════════════════════════════════
Compile each with `bun compiler/bin/scrml.js compile <file> --output-dir /tmp/o28` (wrap each in `<page auth="none">…</page>`):

  1. `<span>= hi</span>`                        → COMPILES; text "= hi". (the bug)
  2. `<td>=SUM(A1:A9)</td>`                     → COMPILES. (real-world)
  3. `<span>=</span>`                           → COMPILES; text "=".
  4. `<div>=a=b=c</div>`                        → COMPILES; text "=a=b=c".
  5. `<p if=(@n >= 3)>ok</p>` (with `<n> = 5`)  → COMPILES (parenthesized — regression guard).
  6. `<p if="@n >= 3">ok</p>` (with `<n> = 5`)  → COMPILES (quoted — regression guard).
  7. `<p if=@n >= 3>ok</p>`  (with `<n> = 5`)   → STILL fires `E-ATTR-UNQUOTED-OPERATOR` at TAB (NOT an E-CTX-001 cascade).
  8. `<count> = 0` at top level                 → still recognized as a state decl (don't break decl recognition).
  9. `<userName req length(>=2)> = <input type="text"/>` → still recognized as a state decl (the `>=` is paren-tracked). Verify specifically.

═══════════════════════════════════════════════════════════════════════
TESTS + GATE
═══════════════════════════════════════════════════════════════════════
- Add a focused UNIT test in the block-splitter test file (grep `compiler/tests/**` for existing `peekTopLevelStateDeclSignal` / `scanOpenerBody` / block-splitter tests) covering rows 1-4 (positive) + row 7 (negative preserved).
- Add ONE conformance case (surface §4 markup/parse — the "ss77" area): element text beginning with `=` compiles + renders the literal `=`. Read `conformance/README.md` for the `expected.json` schema first. Keep it minimal + targeted to THIS bug (do NOT author the broader ss77 backlog).
- Run the FULL gate: `bun run test` — MUST be green (0 failures) before reporting DONE. Pre-commit hook runs the core subset (~2-5 min). Never `--no-verify`.

═══════════════════════════════════════════════════════════════════════
EMPIRICAL VERIFICATION (required before DONE — not "tests pass")
═══════════════════════════════════════════════════════════════════════
Compile all 9 matrix rows post-fix. Symptom checks:
  - Rows 1-6, 8, 9: `grep -c E-CTX-001` == 0 AND the compile reports success ("Compiled 1 file").
  - Row 7: output contains `E-ATTR-UNQUOTED-OPERATOR` and NOT `E-CTX-001`.
Paste the actual per-row results. Do NOT mark DONE unless every row matches.

═══════════════════════════════════════════════════════════════════════
BRIEF ARCHIVAL
═══════════════════════════════════════════════════════════════════════
Write this entire brief verbatim to `docs/changes/issue28-bs-tagclose-leading-equals/BRIEF.md` (worktree-absolute) and commit it with your fix. Put `progress.md` alongside it.

═══════════════════════════════════════════════════════════════════════
REPORT BACK (final message = structured data)
═══════════════════════════════════════════════════════════════════════
- WORKTREE_PATH (must be the pre-made one) and FINAL_SHA (branch tip after last commit).
- FILES_TOUCHED (exhaustive).
- The fix: what changed in `block-splitter.js` + the exact discriminator you used (attr-value `>=` vs bare terminator).
- The 9-row acceptance matrix results (verbatim symptom-check output).
- Full-suite result (pass/fail counts).
- Blast-radius note (adjacent shapes that also break), or "none found."
- Confirm `git status` clean + all committed on `fix/issue28-tagclose-leading-equals` before DONE.
