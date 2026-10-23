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
See the round-1 report below for the numbers and every changed set.
