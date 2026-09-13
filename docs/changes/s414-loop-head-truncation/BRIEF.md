# BRIEF — s414-loop-head-truncation

**Gap:** `g-loop-branch-head-truncated-at-first-close-paren` (MED, latent, 0 corpus sites)
**Locus (PA-located AND PA-traced by execution):** `compiler/src/ast-builder.js` → `collectIfCondition()`
**Direction of change:** `newly-rejecting` (conformance restoration toward an existing normative sentence)
**Dispatched:** S414-peter, 2026-09-13

---

> ⛑⛑ **CORRECTED AFTER DISPATCH — this brief cites §50.2.2 twice and that is WRONG.** The
> `while-stmt` / `if-stmt-logic` productions live in **§50.2.1 "Grammar Productions"**; §50.2.2 is
> "Operator Precedence and Associativity". The error is the dispatcher's, not the agent's — the agent
> propagated it faithfully into the §34 row and the user-facing diagnostic text, where it was caught at
> the file-delta review and fixed before landing. **The brief is left otherwise verbatim on purpose:** it
> is the instruction record, and what was actually dispatched is the thing it exists to preserve.

## The defect, reproduced by execution on HEAD `2f03b3c6`

`collectIfCondition()` stops the moment the outermost `(` closes:

```js
// ast-builder.js, inside collectIfCondition()
      // After closing the outermost `(`, stop
      if (depth === 0 && parts.length > 0) break;
```

So a head that **starts** with `(` and **continues past it** loses the remainder — and, because the
remainder includes the `{`, the entire body:

| source | emitted on HEAD | diagnostics |
|---|---|---|
| `while (n + 1) < 4 { n = n + 1 }` | `while (n + 1) {\n}` | **none, exit 0** — silent infinite loop |
| `if (n + 1) < 4 { n = 0 }` | `if (n + 1) {\n}` | **none, exit 0** — body silently dropped |
| `while (a) && (b) { … }` | *no artifact* | `E-CODEGEN-INVALID-LOGIC` (a confusing downstream error) |

Controls, all correct on HEAD and all of which MUST keep working:
`while (n + 1 < 4) { … }` · `while n + 1 < 4 { … }` · `if (n + 1 < 4) { … }` · the braceless
`while (n < 3) n = n + 1` form that #933 landed.

⚑ **One defect, two arrival dates.** `if` has used `collectIfCondition` all along and shows the
identical truncation on both sides of #933. Fixing the one function closes `if` **and** all three
`while` call sites — root, not position.

## The governing sentence — this is why the direction is REJECT, not ACCEPT

The gap entry's recorded *"Fix direction: collect the full condition expression"* is the **accepting**
half of a fork, and it is wrong. Quoted from the normative source:

**`compiler/SPEC.md` §50.2.2** (governs BOTH constructs):

```ebnf
condition-expr    ::= '(' assign-expr ')'            (* double-parens form — intentional *)
                    | expr                            (* any non-assignment expression *)

while-stmt        ::= 'while' '(' condition-expr ')' block
if-stmt-logic     ::= 'if' '(' condition-expr ')' block else-clause?
```

**`compiler/SPEC.md` §50.2.3**, verbatim:

> *"**`while ((x = expr))`** — double parens. The inner `(x = expr)` is the assignment expression.
> **The outer parens are the while condition's required parens.**"*

**`compiler/SPEC.md` §49.2.1:**

```ebnf
while-stmt       ::= label-prefix? 'while' '(' expression ')' loop-body
```

The condition's outer parens are REQUIRED and must wrap the WHOLE condition. `while (n + 1) < 4 { … }`
is therefore **not a legal head**; the legal spellings are `while (n + 1 < 4)` and `while ((n + 1) < 4)`.
Making it work would be a **newly-accepting** change — a one-way door — against a normative sentence
that already excludes it.

## The precedent — S308, in-tree and ratified: REJECT + RECOVER

`E-FOR-UNPARENTHESIZED-HEAD` (§17.4a / §34, `ast-builder.js:8815`, `:10893`, `:13389`) is the same class:
a malformed loop head that produced a silent-broken artifact at exit 0. It was resolved by **firing an
Error AND recovering** — parsing the head as intended so no broken loop is emitted and downstream
analysis does not cascade. Mirror it exactly.

---

## What to build

### 1. A new diagnostic — `E-CONDITION-HEAD-UNPARENTHESIZED`

Fires when, inside `collectIfCondition()`, the outermost `(` has just closed **and** the next token
begins a continuation of the condition expression rather than the body.

**Severity:** Error. **Partitions into `result.errors`.**

Message shape (mirror `E-FOR-UNPARENTHESIZED-HEAD`'s wording and include the canonical fix):

```
E-CONDITION-HEAD-UNPARENTHESIZED: an `if`/`while` condition's required parentheses must wrap the
whole condition — `while ((n + 1) < 4)` or `while (n + 1 < 4)`, not `while (n + 1) < 4`. Everything
after the closing `)` was being dropped, including the loop body. (SPEC §50.2.2, §50.2.3, §49.2.1)
```

### 2. RECOVER — do not stop at the diagnostic

After firing, **continue collecting the rest of the condition expression** so the emitted `if`/`while`
is CORRECT rather than an empty-bodied silent infinite loop. The artifact must be right even though the
build fails. This is the whole point of the S308 shape.

### 3. ⚑ The continuation set is DELIBERATELY CONSERVATIVE — do not widen it

Fire **only** when the token immediately after the closing `)` is one of:

```
<   <=   >   >=   ==   !=   ===   !==   &&   ||   ??   *   %   ?   is
```

**Excluded on purpose. Do NOT add these, and do not "improve" the set:**

- **`/`** — ⚑ **this one is load-bearing.** `while (h) /a\sb/.test(c)` is a braceless body that STARTS
  WITH A REGEX LITERAL, and it is pinned by a shipped test
  (`compiler/tests/unit/while-braceless-body-stays-in-the-loop.test.js`, *"a braceless `while` whose body
  is a regex statement compiles and keeps the regex"*). Treating `/` as a binary operator breaks it.
- **`+` / `-`** — ambiguous: they are also unary prefixes, so they can legitimately begin a braceless
  body statement.
- **`.` / `(` / `[`** — member / call / index continuation, but each can also begin a statement.
- **`:`** — label and ternary-alternate.

Every excluded token keeps **today's exact behaviour**, unchanged. The conservative set covers both
documented shapes (`< 4`, `&& (b)`) and cannot false-positive on any braceless body.

### 4. ⚑ Do NOT touch the braceless-body path

`parseOneIfStmt`'s braceless limb (`parseOneStatement()`), and the braceless `while`/`for` limbs #933
added, are **OUT OF SCOPE**. Whether a braceless loop body should be legal at all is a **language-surface
fork currently owed to the project owner and explicitly gated** — building either half of it here would
pre-empt his ruling. Your change must be invisible to every braceless-body case.

### 5. §34 catalog row + §49/§50 prose

- Add the `E-CONDITION-HEAD-UNPARENTHESIZED` row to the `compiler/SPEC.md` §34 catalog, in the style of
  the `E-FOR-UNPARENTHESIZED-HEAD` row at `:20217` (what fires it, what does NOT fire it, where it is
  emitted, which stream it partitions into).
- Add a short normative note at **§49.2.3** (condition expression) and a cross-reference at **§50.2.3**
  stating that the required parens wrap the whole condition and that a continuation after the closing
  `)` is this code.
- Carry `provenance: spec:§50.2.3-the-outer-parens-are-the-while-condition's-required-parens` inline at
  the amended sections, per Rule 4b.
- ⚑ After ANY `SPEC.md` edit, run `bun scripts/regen-spec-index.ts --check` — a stale SPEC-INDEX reds
  the cloud gate. If it fails, regenerate with `bun scripts/regen-spec-index.ts`.
  ⚑ The regen scripts are LF-only and this is a CRLF checkout — if a script fails on `\r`, strip CR
  first rather than editing the script.

### 6. Tests — `compiler/tests/unit/loop-head-truncated-at-first-close-paren.test.js`

Model the harness on the existing
`compiler/tests/unit/while-braceless-body-stays-in-the-loop.test.js` (same `build()` helper shape:
`compileScrml` with `mode:"library"`, `write:true`, read the emitted `.js` back).

Required cases:

1. `while (n + 1) < 4 { n = n + 1 }` → fires `E-CONDITION-HEAD-UNPARENTHESIZED`.
2. `if (n + 1) < 4 { n = 0 }` → fires it (**the `if` half is not optional — it is the proof the fix is
   at the root**).
3. `while (a) && (b) { … }` → fires it, and **no longer** `E-CODEGEN-INVALID-LOGIC`.
4. **RECOVERY** — for case 1, assert the emitted loop carries its body (`while ((n + 1) < 4) { n = n + 1; }`
   or equivalent), i.e. the artifact is correct even though the build errored.
5. **CONTROLS that must stay clean (exit 0, no new code):**
   - `while (n + 1 < 4) { … }`
   - `while ((n + 1) < 4) { … }`
   - `while n + 1 < 4 { … }` (unparenthesized head — unchanged by this work)
   - `if (n + 1 < 4) { … }`
   - `while ((x = f()))` — the §50.2.3 double-parens form, which MUST NOT fire
   - `while (n < 3) n = n + 1` — braceless body (#933)
   - ⚑ `while (h) /a\sb/.test(c)` — **the regex-literal braceless body.** This is the control that
     catches a widened operator set.
6. ⚑ **Prove the bite** (pa-base §8, the unproven gate): assert the diagnostic actually fires on a
   real parsed program, not on a hand-built AST. A code with no producer is this project's recurring
   failure — `E-TILDE-001/002` sat dead for the project's whole life with passing unit tests.

---

## Verification you MUST run and report (do not mark DONE without these)

1. `bun test compiler/tests/unit/` — report pass/fail counts. ⚑ A small number of pre-existing
   failures exist on this Windows clone (`node --check` subprocess co-run timeouts); if you see a
   failure, re-run that file **in isolation** before calling it yours.
2. `bun test compiler/tests/conformance/` — baseline is **905/905**. ⚑ **Measure the baseline on your
   branch point BEFORE your change**, and report both numbers. A previous dispatch on this project
   reported 906/906 when the true figure was 905/905.
3. `bun conformance/run.ts` if it differs from the above.
4. ⚑ **A corpus population count, with a control.** Grep the tracked `.scrml` corpus for the shape this
   now rejects (a `while`/`if` head whose `(` closes and is followed by one of the operators in the
   conservative set). The PA measured **0 of 2,553**; confirm or correct it, and **state the control you
   used to prove the grep can fire at all** (a bare zero from an unproven grep is not a measurement).
   If the count is non-zero, **STOP and report** — that converts this into a migration that needs a
   ruling.
5. Report the emitted JS for each of the three defect cases, **in full** — not a filtered line set. A
   line filter that drops `}` lines cannot distinguish a nested body from a hoisted one, and it cost
   this project a correct finding once already.

## Working discipline

- Commit after each meaningful unit; WIP commits expected. Keep an append-only
  `docs/changes/s414-loop-head-truncation/progress.md` (timestamped: what was just done, what's next,
  blockers). The branch + progress log are the crash-recovery anchor.
- ⚑ **NEVER use `git stash`** — `refs/stash` is shared across every worktree on this repo and a
  worktree-isolated agent stashing will collide with the main checkout. Use a file copy or a scratch
  branch for any base-vs-build flip.
- ⚑ **NEVER `pkill -f`/`killall` on a command string** (e.g. `bun test …`) — every checkout shares the
  string and you would kill a process in the main checkout with no trace. Kill by PID captured at launch.
- Run `bun install` at startup (a fresh worktree does not inherit `node_modules`; the hook fails with
  "cannot find package 'acorn'" otherwise).
- ⚑ `bun --cwd <path> run <script>` **silently no-ops and exits 0**. Use `--cwd=<path>` with the `=`,
  or run from the worktree CWD.
- Report at the end: the workspace path, the final commit SHA, files touched, whether the PA's locus
  hypothesis **held / was refined / was wrong**, and anything you deferred.

## Maps

`.claude/maps/primary.map.md` is at watermark `e74f5423` and HEAD is `2f03b3c6` — **the map is STALE**.
Read it as a hypothesis to verify against source, not as truth. The post-map landing that matters for
this file is **#933 (`4b87c1a9`)**, which added the braceless `while`/`for` limbs and switched the three
`while` sites from `collectExpr("{")` to `collectIfCondition()` — that switch is how `while` inherited
`if`'s pre-existing truncation. Report whether the map was load-bearing, including "not load-bearing."
