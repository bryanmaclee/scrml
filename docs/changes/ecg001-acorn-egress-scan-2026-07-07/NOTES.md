# NOTES — class-check verdict + residuals

## Class-check verdict: computed + destructuring CLOSED FOR FREE (no sibling gap remains)

The filed HIGH was the DOT-access regex-division evasion. S244 noted two sibling evasions it
did NOT file: computed `row["ssn"]` and destructuring `const {ssn} = row`. The current
`/\.field\b/` regex catches neither.

The acorn AST walk closes BOTH for free, precisely (no over-fire):
- Computed member with a constant string key: `row["ssn"]` AND `` row[`ssn`] `` (single-quasi
  template) FIRE.
- Object-pattern destructuring: `const {ssn} = row`, renamed `const {ssn: masked} = row`,
  and constant-string-key `const {"ssn": x} = row` FIRE.
- Object-LITERAL construction `{ ssn: value }` correctly does NOT fire — the key is a name
  being WRITTEN (like a string label), not the protected column being read. This was the
  over-fire risk called out; the AST distinguishes ObjectPattern (read) from ObjectExpression
  (construct), so it is safe.
- Import/export specifier bindings of the same name do NOT fire (not a column read).

Rationale for including them: E-CG-001 is a backstop that assumes protected field names are
distinctive enough that ANY code-position ACCESS is a leak — the existing member-access scan
already fires on any `.field` regardless of the object. Computed + destructuring are the SAME
assumption applied to two more access FORMS, so this completes coverage rather than introducing
a new over-fire class. All covered by tests.

## Residual (theoretical, NOT filed — very exotic, lower priority than the filed HIGH)

- Fully-DYNAMIC computed access `row[someVar]` where `someVar` resolves to the field name at
  runtime is not statically detectable by ANY static scan (the key is not a constant). This is
  out of reach for a compile-time backstop and is not a regression — the prior regex never
  caught it either. Left as-is; no gap filed (unactionable statically).
