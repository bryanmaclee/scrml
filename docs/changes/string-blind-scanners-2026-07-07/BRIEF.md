# BRIEF — string-blind scanners: 2 MED false-positive-on-valid-code fixes (S244)

CHANGE-ID: `string-blind-scanners-2026-07-07`
BASELINE: `f817e44c` (compile + test against current main).
DISPATCHED-BY: scrml PA (S244, pre-wrap successor to live S243).
AGENT: scrml-js-codegen-engineer · isolation:worktree · background.

You are fixing TWO MED gaps of ONE class: **a raw-source scanner that pattern-matches keywords/tokens
without skipping string-literal / regex-literal / comment interiors, so it false-fires on VALID code.**
Both are confirmed reproducing on the baseline. Both fire sites are DISJOINT from a sibling session's
live work — **do NOT touch `ast-builder.js`, `type-system.ts`, `symbol-table.ts`, `emit-channel*`,
`emit-server*`, or `compiler/SPEC.md` §38.** Stay in the two named files (+ their tests).

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.

## Startup (BEFORE any other tool call)
1. `pwd` — output MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is
   under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report (the S90 CWD-routing
   failure). Save it as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` — worktrees do NOT inherit node_modules; the hook's `bun test` fails without it.
5. `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored) so the full suite's browser
   tier doesn't ECONNREFUSED.

## Path discipline (S99/S126 — enforce on EVERY edit)
- **Apply ALL file edits via Bash** (`perl`/`python3`/heredoc) on **worktree-absolute paths that include the
  `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools (they can silently target main). Echo
  the target path before each write; re-verify with `git diff` after.
- **NEVER `cd` into the main repo** (or anywhere) — use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`,
  and worktree-absolute paths exclusively.
- First commit message includes your `pwd` output verbatim (e.g. `WIP(string-blind): start at <pwd>`).

# MAPS — REQUIRED FIRST READ
Before other context, read `.claude/maps/primary.map.md` in full (~100 lines). Follow its Task-Shape Routing
for a compiler-source bug fix. Map currency: HEAD `66a3afb1` as of 2026-07-04 — files modified after that
(incl. the two fire sites) are a starting hypothesis; verify against current source via grep/Read. In your
report include a "Maps consulted: […]; load-bearing finding: …" or "Maps not load-bearing" line.

---

# Bug 1 — g-is-predicate-scanner-regex-literal-blind  (`compiler/src/expression-parser.ts`)

**Fire site:** `rewriteIsPredicates` (expression-parser.ts:1198) — the structural `is`-predicate scanner
(the char-walker described at ~line 1365 "The scanner walks the string …").

**Symptom:** a **regex literal** (or string literal) whose SOURCE contains the word `is` followed by a word
(e.g. `/there is no repo/i`) is read as an `is`-predicate; after the S237 `is <literal>` tightening it now
**false-fires `E-EQ-005`** on VALID code.

**REPRO (fires E-EQ-005 falsely on baseline — verified by PA):**
```
<program>
<result> = ""
${ function check(raw) { const m = raw.match(/there is no repo here/i); @result = m ? "yes" : "no" } }
<button onclick=check("x")>go</button>
</program>
```

**FIX:** make the `rewriteIsPredicates` char-walker **skip `is` occurrences inside regex literals
(`/…/flags`) and string literals (`"…"`, `'…'`, backtick)**. The walker already tracks some literal state —
extend it to cover regex literals; confirm string-literal skip. Regex-vs-division disambiguation must be
context-aware (a `/` opening a regex appears after `(`, `,`, `=`, `return`, `.match(`/`.replace(`/`.test(`,
`&&`, `||`, `?`, `:`, `!`, `{`, `[`, `;`, a newline, or start — NOT after a value/`)`/`]`/identifier). Mirror
the tokenizer's regex-context rule if one exists; reuse the existing string-aware scanners as reference
(`splitMarkupTextInterp` in ast-builder / `scanForeignSliceShape` in emit-logic.ts). Prefer principled
disambiguation over a narrow `.match(`-only hack, but a conservative rule is acceptable IF it removes the FP
with zero new false-negatives.

# Bug 2 — g-route-inference-signals-string-blind  (`compiler/src/route-inference.ts`)

**Fire site:** the server-only-signal pattern scan — `SERVER_SIGNAL_PATTERNS` table (~line 407-416) + the
bare-expr string scan that applies it.

**Symptom:** the signal detection matches its `Bun.*` / `process.*` / `print(` regexes over **raw source
text**, not string/comment-aware. A CLIENT function whose body merely MENTIONS a server-only token inside a
string literal or comment is **spuriously server-escalated** → cascades to `E-CPS-NONIDEM-NO-STORAGE`.

**REPRO (fires E-CPS-NONIDEM-NO-STORAGE falsely on baseline — verified by PA):**
```
<program>
<msg> = ""
${ function setClient() { @msg = "docs mention Bun.serve(x) here" } }
<button onclick=setClient()>go</button>
</program>
```

**FIX:** apply `SERVER_SIGNAL_PATTERNS` only against source whose **string/backtick/`'` literal interiors and
`//` + `/* */` comments are masked/skipped** (walk char-by-char skipping those regions, or mask them before
the regex scan). Do NOT change WHICH tokens are signals — only make the scan ignore matches inside
strings/comments. (An AST/token-node basis would be ideal but the AST may not be available at this scan; a
string/comment-aware masking pass is the acceptable minimum and closes the FP.)

# The shared invariant
A raw-source scanner that matches keywords/tokens MUST skip string-literal, regex-literal, and comment
interiors. These two are the last known instances of the class; GITI-033 (`splitMarkupTextInterp`) and the
clean-print AST-signal fix already closed sibling instances the same way.

---

# ACCEPTANCE (all must hold)
- **Bug 1:** the repro compiles CLEAN (no E-EQ-005). Controls STILL correct: `x is not`, `x is some`,
  `x is .Variant` fire/handle as before; a REAL bad `is <literal>` (`x is 0`) STILL fires E-EQ-005.
- **Bug 2:** the repro compiles as a CLIENT fn (no server escalation, no E-CPS-NONIDEM). Control: a fn that
  ACTUALLY calls `Bun.serve(...)` (a real call, not in a string) STILL escalates to server.
- **Regression tests (unit) for BOTH**, covering: FP-gone + control-still-correct + an adversarial edge (an
  `is`/signal token inside a string AND a real predicate/call on the SAME line — the mask must not eat the
  real one).
- **Full suite:** `bun run test` → 0 fail (document any pre-existing browser/env-floor fails; do not fix
  unrelated).

# MANDATORY PHASES
- **Phase 1 — repro:** compile BOTH repros at baseline, paste the E-EQ-005 + E-CPS-NONIDEM output (confirm
  both FPs fire before you touch anything).
- **Phase 2 — fix** both (Bash-edits, worktree-absolute paths).
- **Phase 3 — R26 empirical (MANDATORY before DONE):** recompile BOTH repros → confirm both FPs are GONE, AND
  run the two controls → confirm they STILL behave. Paste the grep evidence. **DO NOT mark DONE without this.**
- **Phase 4 — tests:** add the regression tests; `bun run test` 0-fail (excl. documented env-floor).
- Commit incrementally (crash-recovery); progress.md as you go.

# REPORT
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` (must be ONLY expression-parser.ts + route-inference.ts +
their test files) · deferred-items · **Phase-3 R26 evidence** (the grep proof both FPs gone + controls OK) ·
the Maps-consulted line.
