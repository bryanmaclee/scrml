# s469-boot-termination-rulings — progress

Branch `s469-boot-termination-rulings` (from origin/main 66fb8a18c). The BOOTSTRAP builds bryan's S469 statement-termination
follow-up rulings (user-voice-scrml.md S469 "⭐ RULED — statement termination follow-ups, §7.2.2", scrml-support ef99b4e),
SPEC §7.2.2 rules 4, 5, 9, 10. impl#1 is unchanged.

## Round 1 — the four rulings (compiler/self-host-v2/parse.scrml)

1. **Line starts attach to the line above (rule 4).** `isHandlerOpen` / `isPresenceTest` lose their same-line test:
   `x⏎!{ … }` handles `x`, `x⏎is given` / `is not` tests `x`. `isPropagate` is ADJACENCY only: a `?` glued to what it
   follows is propagation whatever follows it; a spaced `?` is the conditional (the end-of-line test is gone; `?{`
   touching stays the SQL sigil). Fail closed on the two shapes whose meaning moved:
   - a spaced `?` with nothing after it (`load(id) ?;`) — E-PARSE-EXPR naming the glued spelling (was: propagation);
   - a glued `?` followed on its line by more expression (`a == 1? 2 : 3`) — propagation, so the statement ends at the
     `?`: E-STMT-MISSING-SEMICOLON there, its message naming the spaced conditional (was: the conditional).
2. **Rule 10.** `failAhead` / `deferAhead` / the `transaction` test lose their same-line test. `fail` at statement start
   is the keyword before a variant, a name, a keyword / string / number (kept for E-ERROR-009), `.` (glued too) or `::`;
   anything else (`fail;`, `fail = 1`, `fail(x)`, `fail` before `}`) is `bareFail`: E-PARSE-EXPECTED on `fail` ("the
   name `fail` is reserved there"), the rest read past as one recovered expression — never E-SCOPE-001. `fail:` (a
   label) is now that refusal too (`:` alone cannot begin the operand).
3. **E-STMT-NO-EFFECT (rule 9).** `parseTermStmt` → `stmtChecks` (`noEffectStmt` + `armTails`). An expression statement
   whose expression holds no call, assignment or `?{}` (anywhere but a lambda body) is reported, span = the statement
   without its `;`. Not judged: a handling form at the top (`x?`, `x !{}`, a statement `match`), a parse-error
   placeholder, after a hard error in the block (cascade guard, as termAfter), beside a terminator error
   (E-STMT-MISSING-SEMICOLON / E-STMT-SPLIT-CONTINUATION at its end or just before it — one root cause, one report;
   this is what keeps the INTERIM `x [y]`, `break⏎label`, `return⏎expr` shapes' codes unchanged), an arm block's LAST
   statement (its position is the enclosing form's: judged by `armTails` only for a statement-position `match` /
   `!{}`), a one-name handler block (`onclick={ f; }` — a reference, §19.4.3), a non-handler attribute's `{ … }`
   (refused by analyze, §5.2.4), and the refused value-form `if` / `for` read-past. Two consecutive on one line are one
   report (§40.8). Non-hard for the cascade guard (`softError`). §40.8 display literals (R7) are not touched — the
   code-default body path (`parseCodeBody`) parses expressions, not statements.
4. **E-STMT-SPLIT-CONTINUATION (rule 5).** `parsePostfixFrom`: after an expression, a NEXT-line `(`, `[` or template is
   `splitContinuation` — the ruled message, the empty span at the end of the line above; the expression ends there and
   the next line is read on its own (missingSemi dedupes against it; it is soft for the cascade guard). Replaces the
   generic E-STMT-MISSING-SEMICOLON and E-PARSE-TEMPLATE for this shape. A `( … ) :>` line (a tuple arm head) is not a
   continuation (unchanged). "The line above" is the previous token's END line (`endLine`: a multi-line template
   ends on a later line than it starts) — so a call on a multi-line template's closing line is a call (refused by
   analyze), not a split.
- KEPT INTERIM (pinned unchanged, termination-rulings-s469.test.js): `return⏎expr` / `lift⏎expr` refusal, spaced
  same-line `x [y]`, `break⏎label` / `continue⏎label`, R7 display literals.

## Equivalence (OLD = origin/main 66fb8a18c, NEW = this branch)

Method: `SCRML_BOOT_SRC_LOG=<file>` (new opt-in recorder in slice-m1/harness.js `logSources`) records every source set
the slice suite hands `link.parseProgram` / `parse.parseFile`; a replay compiles each distinct set on the old and the new
bootstrap (codes, spans, messages, printed client + server artifacts or the parse tree) and diffs them.

**Result (old-suite sources, 5,826 distinct sets): 5,812 identical** in codes, spans, messages and printed artifacts
(1,669 with client/server artifacts); **14 changed, each by one of the four rulings:**

| set | old → new | reason |
|---|---|---|
| typer-s460 `const q = @o.n⏎is given }` | MISSING×2, E-SYNTAX-044, E-PARSE-EXPECTED, E-SCOPE-001 → MISSING (before `}`) | rule 4: `is given` attaches |
| defer.test `defer⏎@n = 1;` | MISSING + E-SCOPE-001 → clean | rule 10: defer across the line |
| defer.test `defer [1, 2];` (binding `defer` visible) | AMBIGUOUS-LEAD → + NO-EFFECT | rule 9: the deferred `[1, 2];` does nothing |
| error-rulings LOW-C `fn h() { "a"; }` | E-ERROR-012 → + NO-EFFECT | rule 9 |
| terminators r3 `match k {…}⏎-1;` / `(@n);` / `[1];` / `` `t`; `` (4 sets) | clean → NO-EFFECT | rule 9: the table's silent row, now loud |
| templates L1 `const t = s⏎`x${n}`` | E-PARSE-TEMPLATE → SPLIT-CONTINUATION + MISSING (after the template line) | rule 5 |
| template-slot-fuzz `` `…`()`` on the multi-line template's closing line (parse only) | E-PARSE-TEMPLATE → clean parse (a call; analyze refuses it, E-BOOTSTRAP-UNSUPPORTED) | rule 5's "line above" = the previous token's END line |
| server-await probe pack, 2 sets `let ok = false⏎[row.pw].forEach(…)` | MISSING → SPLIT-CONTINUATION | rule 5 |
| server-await probe pack `[check // c⏎(pass, row.pw), …]` | + SPLIT-CONTINUATION | rule 5 (inside brackets) |
| server-await probe pack `1 :> { ok; ok }` (value match) | + NO-EFFECT on the first `ok;` | rule 9 (a non-last arm-block statement) |

(The probe-pack sets are deliberately broken legacy shapes already carrying 20–40 errors.) The new tests' own source sets
(95 more) change by construction. Fixed during the replay before landing: a non-handler attribute `{…}` (refused by
analyze — a value, not a statement list), a one-name handler block `onclick={ f; }` (a reference), the refused value-form
`if` / `for` read-past, and a `( … ) :>` tuple arm head were each first reported, wrongly, and are now exempt; a doubled
SPLIT report on a re-read region is deduped; `fail⏎return x;` now refuses the bare `fail` instead of reading `return` as
an operand (a keyword / string / number operand is read only on `fail`'s line — the s451 E-ERROR-009 path).

## Gates
- bootstrap-conformance: PASS **218 → 218** (report regenerated: no change; `--check` current).
- snippet-gate --strict exit 0 (bootstrap ruled: 14 pass, 16 spec-ahead, 0 stale, 0 fail); claim-gate --strict 0 failed.
- gen-bootstrap-severity regenerated (E-STMT-NO-EFFECT, E-STMT-SPLIT-CONTINUATION — both §34 Error rows).
- SPEC §7.2.2 rules 5 / 9 status, the five RULED table rows, the two §34 rows, §19.16.1 (`defer` same-line clause struck).
- known-gaps: g-bootstrap-newline-sensitive-rules-remain-s469 → narrowed (+ unlisted line tests found);
  g-stmt-no-effect-language-wide-unbuilt bootstrap half built. `state.ts --write`: no count change.

## Owner questions (with recommendations)
1. A statement-position `match` / `!{}` whose every arm is a pure single expression (`match k { .A :> 1, .B :> 2 }`)
   computes and drops a value. Built: NOT reported (a block-like statement, like `if`; its arms are value positions).
   Rec: report it E-STMT-NO-EFFECT (it is `c ? 1 : 2;` in disguise) — newly-rejecting, measured 0 here.
2. `r?;` alone: built as an effect (propagation can leave the function). Rec: keep.
3. Bare `fail` code: E-PARSE-EXPECTED (generic). Rec: keep; no new code. A `fail:` label is refused by it too.
4. Glued `a == 1? 2 : 3`: propagation + E-STMT-MISSING-SEMICOLON (hint names the spaced form) and its cascade
   (E-ERROR-004, …). Rec: keep the ruled reading; optionally a dedicated message-only refinement later.

## Round 3 — review LAND-W-F/U of 147323d51 (merged origin/main 10c04ecf0)
1. **E-TYPE-043 primary again.** A body with E-STMT-NO-EFFECT is no longer "a function with a parse error" for
   analyze (`parseFile` `errs` skips the code — the statement is whole), and a declared-return (non-`void`, non-`!`)
   function's LAST statement is not also NO-EFFECT (`parseFn` → `dropTailNoEffect`): `fn hd(p: string) -> string
   { p; }`, the `function` form and `{ const q = p + 1; q; }` report exactly E-TYPE-043, as on base. The conformance
   case `endpoint/arm-body-valid-scope-clean` emits the same five codes as base (compared on both bootstraps).
2. **Glued-`?` note** (`gluedQHint`, messages only): on `expectP` (call arguments, brackets), a template slot's
   "ONE expression" refusal and the missing `;` — whenever a glued `?` is followed on its line by an expression start.
3. **Dedupe.** `parse.withoutRefusedNoEffect`, applied by the front-end driver (slice-m2/lowered.js) after
   analyze: a NO-EFFECT whose statement holds an E-BOOTSTRAP-UNSUPPORTED or E-SCOPE-* is dropped (`(x) => x;`,
   `bump;` naming a function, undeclared `y;`, `defer⏎;`). `break fail;`: `parseJump` consumes the keyword with its
   report (was a second, bare-`fail` report).
4. `AFail.split` (ast.scrml): the operand was read from a line after `fail`; E-ERROR-009 / E-ERROR-001 append "the
   operand of `fail` was read from the next line". (The replay's parse-tree hash ignores this new field.)
- Equivalence re-run after the merge: 5,826 sets, 5,812 identical, the same 14 changed (none new).
- Slices 3,191 pass, 0 fail (one expectation updated: `defer⏎;` is now E-SCOPE-001 alone). Conformance `--check`
  current (PASS 218); snippet-gate --strict and claim-gate --strict exit 0.
