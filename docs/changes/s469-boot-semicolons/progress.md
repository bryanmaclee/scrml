# s469-boot-semicolons — progress

Branch `s469-boot-semicolons`. The BOOTSTRAP enforces dpa-073 F1 (a) / F2 / F3 (i) by construction (F5 (4)):
E-STMT-MISSING-SEMICOLON for a missing `;`, E-MATCH-ARM-SEPARATOR for a missing arm `,`, each with the empty span
where the terminator goes (the fix-it). impl#1 is unchanged (it keeps reading newline-terminated code).

## Round 1 (151366efc) — enforcement + migration
- parse.scrml: parseTermStmt / termAfter / needsSemi / blockLikeExpr; parseArms comma rule; import `;`; `lift` `;`;
  block-scoped cascade guard (hardErrors); a line break no longer ends an arm; split `return` refused fail closed.
- Migrated every bootstrap input (slice sources, fixtures, acceptance, inline test sources) by a codemod at the
  bootstrap's own fix-its; conformance/cases got `;` only (no commas — impl#1 refuses them), kept only where impl#1's
  output was identical. Bootstrap conformance PASS 252 → 218 (33 lost to arm commas, 1 to a `;` impl#1 reads differently).

## Round 2 (review LAND-W-F/U of 151366efc)
1. Codemod inserts in deliberately malformed inputs reverted to the original shapes, each re-pinned:
   typer.test.js nested function-over-param; typer-s460 split `is given`; server-await-probes-review defaultParam /
   fnArg (`-> boolean;`); error-rulings bitwise `|` arm body; defer.test lone `defer⏎`; conformance
   s462-else-without-if-pos, s437-r4-dangling-else-function-body-neg, try-not-in-scrml, ctrl-switch-forbidden-fn-body-pos,
   invalid-prop-decl-syntax-reject; the `<match for=Phase; on=@phase>` insert in bind-prop-write-back-positions and
   declared-prop-not-root-attr. Sweep: every insert before `{`, after a keyword, inside a tag/attribute list, or in an
   input the old bootstrap already refused, reviewed by hand (the rest were real statement ends).
   Gap filed: g-impl1-semicolon-in-attribute-list-accepted-s469.
2. armStartsAt reads qualified heads `E.V` / `E::V` (match and `!{}`): one E-MATCH-ARM-SEPARATOR right after the arm before.
3. impl#1-only newline-shape guards kept UNMIGRATED: markup-handler/s437-handler-shape-{comment-only-line,
   const-then-use, if-else-braced, if-else-braceless, loop-in-block, trailing-line-comments} (not twinned — the bootstrap
   never runs them; the other ten s437-handler-shape cases were never touched) and markup-handler/s462-handler-
   {if-else-template-cell-false, if-else-template-cell-true, nested-if-else, while-body-if-else} (twinned, so excluded
   from the bootstrap with `dialect.s66`).
4. Newline-sensitive rules still in the bootstrap — gap g-bootstrap-newline-sensitive-rules-remain-s469:
   - `x⏎(y)` (call only on the same line), `x⏎[y]` (index only when touching), `x⏎!{` (handler only same line),
     `x⏎is given` (presence test only same line), `x⏎?` (propagation partly by end of line) — all fail closed;
   - `return⏎expr` and (r2) `lift⏎expr` — refused fail closed (E-STMT-MISSING-SEMICOLON after the keyword);
     F6's ruled reading (returns / lifts `expr`) waits for the newline-terminated corpus migration;
   - `fail⏎.E` → E-STMT-MISSING-SEMICOLON + a misleading E-SCOPE-001; `defer⏎`, `transaction⏎{` likewise (R8);
   - `break⏎label` / `continue⏎label` — label only on the same line (fails closed);
   - (fixed in r3, below) a statement `match`'s `}` was not a statement boundary — `match k {…}⏎-1;` glued.
5. SPEC.md untouched. To a SPEC lane after #1501 lands: the §19.4.5 wording, and the E-PARSE-ARM vs E-PARSE-001 code
   question.

## Round 3 — the statement-`match` boundary
- parse.scrml parseStmt: a `match` that starts a statement is parsed by parseMatch and ends at its `}` (F3 (i)):
  `match k {…}⏎-1;`, ⏎`.A;`, ⏎`(x);`, ⏎`[1];`, ⏎a template — each a separate statement, never glued. On the SAME
  line a token that would continue an expression (binary / assignment operator, `.`, `?.`, `(`, `[`, `?`, `!`, a
  template) is REFUSED with E-PARSE-TRAILING, not split: the writer plainly meant one expression, and splitting
  would silently run `+ 2` as a statement of its own; the message names the value form `(match … { … }) + 2`.
  A value match (`const v = match …`, `@x = match …`, inside an expression) is unchanged and keeps its `;`.
- Equivalence: OLD (HEAD before r3) vs NEW bootstrap over 4,481 recorded slice source sets — all identical
  (codes and printed client/server artifacts; 1,601 with artifacts). bootstrap-conformance --check unchanged.

