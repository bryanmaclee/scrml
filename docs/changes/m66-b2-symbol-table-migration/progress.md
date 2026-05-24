# Progress: m66-b2-symbol-table-migration

- [START] /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a6a2c5cec7681c793
  - baseline pretest: 19937 pass / 0 fail / 171 skip / 1 todo across 756 files
  - HEAD: 329101db (brief expected d570341d; main moved ~7 commits; not load-bearing)

## Step 1 finding — bridge survey

Native pipeline (`compiler/native-parser/collect-hoisted.js:385+ synthEngineDecl`):
- Already stamps `bodyChildren` = the native engine block's `children[]` (an
  array of native Markup/Text/Logic blocks with `.attrs`, `.span`,
  `.colonShorthandBody`, `.tagClass`, `.closerForm` payloads).
- Also stamps `rulesRaw`, `span`, etc.

Live pipeline (`compiler/src/ast-builder.js:11301+`):
- ALSO stamps `bodyChildren` BUT these are LIVE ASTNodes (`kind: "markup"`
  lowercase, no `.attrs.value.kind` shape, no `.colonShorthandBody` —
  fundamentally different shape from native blocks).

CONCLUSION: finding (β) — the native pipeline's `bodyChildren` is shape-correct
for the walker but cannot be distinguished from the live pipeline's
shape-incompatible `bodyChildren` without an explicit discriminator. Threaded
a `_nativeEngineBlock` + `_source` reference on the native side ONLY — its
presence becomes the walker-applicability gate.

Threading scope (files touched):
- `compiler/native-parser/collect-hoisted.js` — `synthEngineDecl` (1 site,
  additive 2-field stamp at `aa745540`).

## Step 2 — STOP — additional (c)-class fields surface

While probing the native attribute tokenizer against the cookbook's claimed
recipes, I empirically verified that the b.1 SURVEY's "1 (c)-class field"
claim is **INCORRECT**. Multiple additional (c)-class gaps exist beyond
`isColonShorthand` (which b.1 landed):

### Gap 1 — `rule=.X` (unquoted dotted-variant) NOT recoverable via cookbook recipe

Cookbook line 226-229 claims:
> the native attribute tokenizer admits `rule=.X` as a `variable-ref` value
> (the `.X` is read as a one-symbol ident).

Empirical: `.` is NOT in `isAttrUnquotedValueStart` (tag-frame.js:714). For
`rule=.X`, the native tokenizer produces:
- `rule` attr with `{kind: "absent"}` value
- `X` as the NEXT bare attribute (adjacency, same as `readInitial` pattern)

The cookbook's `readAttrName(attrs, "rule")` returns null for absent. The
`.X` value is LOST without an adjacency-style recovery (which only
`readInitial` in collect-hoisted.js currently implements, for `initial=` only).

**Verified test:**
```scrml
<A rule=.B>x()</>
```
Legacy: `{kind: "single", target: "B"}`
Cookbook recipe: `{kind: "absent"}` (silently wrong)

### Gap 2 — `rule=*` (wildcard) silently dropped

`*` is neither `isAttrUnquotedValueStart` nor `isAttrNameStart`. For
`rule=*`, the native tokenizer produces:
- `rule` attr with `{kind: "absent"}` value
- The `*` falls through the "unexpected char — skip it" branch
  (tag-frame.js:1291) — NO attr or token recorded

The `*` is completely invisible from `child.attrs`. Recovery requires
raw-text scan of the opener slice. **Verified test:**
```scrml
<C rule=* effect=${cleanup()}>z()</>
```
Legacy: `{kind: "wildcard"}`
Cookbook recipe: `{kind: "absent"}` (silently wrong)

Multiple existing unit tests exercise `rule=*`:
- `engine-rule-boolean-attr-boundary.test.js` (§2.3)
- `c14-derived-engines.test.js` (multiple)
- `dg-engine-cell-self-credit.test.js` (multiple)

### Gap 3 — `rule=(.A | .B)` parens-form returns `expr` kind

For `rule=(.A | .B)`, the native tokenizer produces:
- `rule` attr with `{kind: "expr", raw: "(.A | .B)"}` value

The cookbook's `readAttrName` does NOT handle `expr` kind — returns null.
The recipe would silently produce `{kind: "absent"}` for the parens form.

**Verified test (paren-form):** native attrs is `{kind: "expr", raw: "(.A | .C)"}`
when source is `rule=(.A | .C)`; `readAttrName` returns null; recipe silently
produces absent. The QUOTED form `rule="(.A | .C)"` IS recoverable (string-
literal kind) — verified yielding `{kind: "multi", targets: ["A","C"]}`.

### Gap 4 — `<Done(rows)>` parenthesized payload form silently consumed

For `<Done(rows) rule=.Admin>` opener, the native attr tokenizer produces:
- `rows` attr with `{kind: "absent"}` value (bareword)
- `rule` attr with `{kind: "absent"}` value
- `Admin` attr with `{kind: "absent"}` value (adjacency)

The `(` and `)` are silently skipped by the unexpected-char branch. The
fact that `rows` was specifically the PARENTHESIZED form (vs the bare-
attribute form `<Done rows>`) is LOST. Both forms collapse to the same
native attr shape.

For `payloadBindings`, this happens to be RECOVERABLE because both forms
produce the same `PayloadBinding` shape (`{kind: "positional", name: "rows"}`).
But for legacy error-reporting that distinguishes the source form, the
discriminator is gone.

### Gap 5 — `if="..."` quote preservation diverges

For `if="@a == b"`, the native tokenizer produces:
- `if` attr with `{kind: "expr", raw: "@a == b"}` value (quotes stripped)

The legacy parser preserves the quotes: `ifExprRaw = "\"@a == b\""` (verbatim
via `attrs.slice(valStart, j)`).

This divergence is invisible TODAY (no B17.3 typer consumer yet reads
`ifExprRaw` for validation) but breaks legacy parity by definition. If the
walker silently strips quotes, downstream B17.3 typer (when authored)
would need to know which pipeline produced the entry.

### Gap 6 — `if=${...}` wrapper preservation diverges

For `if=${@a == b}`, the native tokenizer produces:
- `if` attr with `{kind: "expr", raw: "@a == b"}` value (`${}` stripped)

The legacy parser preserves the wrapper: `ifExprRaw = "${@a == b}"`.

Same severity as Gap 5: invisible today, breaks definitional parity.

## Summary of (c)-class gaps

| Field/form               | Cookbook claim | Empirical |
|--------------------------|----------------|-----------|
| `isColonShorthand`       | (c) — landed b.1 | ✓ landed |
| `rule=.X` (unquoted)     | (b) — recipe wrong | (c) — needs tokenizer ext OR adjacency-recovery helper |
| `rule=*` (wildcard)      | (b) — recipe wrong | (c) — `*` silently dropped, needs tokenizer ext OR raw-text scan |
| `rule=(.A \| .B)` parens | (b) — recipe wrong | (c) — `expr` kind, needs walker to handle `expr` value AND call parseRuleAttrValue with its `raw` |
| `internal:rule=.X`       | (b) — same as rule= | Same gap as Gap 1 |
| `<Done(rows)>` parens    | (b) — note acknowledges form-loss | (b)/(c) — form-distinction lost but PayloadBinding shape recoverable |
| `if="..."` quote preserve| not addressed | (b)/divergence — silent shape change |
| `if=${...}` wrap preserve| not addressed | (b)/divergence — silent shape change |

**Net count:** at least 4 additional (c)-class gaps beyond b.1's
`isColonShorthand`. The b.1 SURVEY's "1 (c)-class field only" verdict
was an under-count.

## STOP — escalation per dispatch brief §STOP-conditions

> If you find a second [(c)-class field], the adapter approach may be
> wrong and PA needs to re-decompose.

Per the brief: STOP and surface.

## Options for PA

**Option A — extend native attr tokenizer (true (c)-class scope expansion).**
- Add `.X` as a value-continue (so `rule=.X` → `{kind: "dotted-ident", text: ".X"}`)
- Add `*` as a value-start (so `rule=*` → `{kind: "wildcard"}` or similar)
- Add a `quote-preserve` flag for `if=` (so the raw quotes/wrapper survive)
- Estimated scope: ~150-200 LOC across tag-frame.js + .scrml mirror + tests.
- This makes the cookbook recipes actually work.

**Option B — hybrid walker (use native for STRUCTURE, raw-text scan for ATTRIBUTES).**
- Walker iterates `engineBlock.children[]` for state-child discovery
  (no rulesRaw outer scan — the migration WIN)
- For each child, slice `source.slice(child.span.start, openerEnd)` to
  recover the verbatim opener text
- Run the EXISTING `parseRuleAttrValue` / `parseOpenerAttributes` /
  `parsePayloadBindings` helpers on the opener text
- For bodies: use `colonShorthandBody` (native) for `:`-form, span-slice
  for bare-body
- Estimated scope: ~200-300 LOC for walker + tests. Legacy parser's
  attribute helpers stay in place; legacy `parseEngineStateChildren`
  outer-loop is the only thing retired
- Migration WIN: no rulesRaw outer-loop text-scanning; legacy parser
  shrinks; M6.8 deletion target shifts (only the outer scan loop deletes,
  helpers stay)

**Option C — defer M6.6.b.2 until Option A lands as M6.6.b.1.5.**
- Run a separate dispatch to extend native attr tokenizer per Option A
- Then return to b.2 with the cookbook recipes that actually work

**My recommendation:** Option B (hybrid walker). It preserves the migration's
real win (no outer-loop text-scan, no sibling-swallow class of bugs) without
the speculative scope of extending the native attr tokenizer. The legacy
parser's attribute helpers are battle-tested and the simplest path to
parity. M6.6.b.1.5 (Option A) can land later if/when the native attr
tokenizer naturally needs the extensions for other reasons.

## Commits

- 4004ef4b — WIP(M6.6.b.2): start at /home/bryan-maclee/...
- aa745540 — WIP(M6.6.b.2 Step A): stamp _nativeEngineBlock + _source on engine-decl

The Step A commit is forward-compatible with any of the three options:
all three need a way to get the native block + source into the consumer
site. The threading itself is correct; only the walker implementation
strategy is what PA needs to decide.

## Files touched this dispatch

- `compiler/native-parser/collect-hoisted.js` — Step A (additive 2-field
  stamp on engineDecl)
- `docs/changes/m66-b2-symbol-table-migration/progress.md` — this file

NO walker landed. NO symbol-table call-site swap landed.
