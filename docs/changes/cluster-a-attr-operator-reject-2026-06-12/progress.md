# cluster-A — unquoted-attr-condition operator reject

Worktree: agent-ae5a14fba65a18aba (pwd verified under .claude/worktrees/agent-)
Ruling (S188): bare operator in unquoted attr-condition → ONE clean E-ATTR-UNQUOTED-OPERATOR
steering to parens/quotes. Paren `if=(expr)` + quote `if="expr"` stay canonical operator forms.

## Empirical findings (verified on this worktree, pre-fix)
- Tokenizer unquoted value-reader stops at first non-valueIdent char.
- `>= > < <= == != + - * /` (spaced or jammed): operator + RHS DROPPED at TOKEN level — NO
  residual stray attribute. Only `ATTR_IDENT:@n` + TAG_CLOSE_GT survive.
- `&& || ?:`: RHS operand (starts with @ or ident) survives as a STRAY ATTR_NAME (DOM leak / E-DG-002).
- `>=` (and spaced `>`): the `>` closes the tag → misleading E-CTX-001 cascade (LOUD-FAIL).
- jammed `@n>3`: silent-drop (`>` tag-close, `3` leaks as content).
- Markup condition attrs per emit-html.ts:146 = `if`/`show`/`else-if`. `while=` is NOT a markup
  attribute (SPEC §17 has no while=; "while condition" in §42.10 means ${while(...)}). Scope to if/show/else-if.

## Plan
P1 tokenizer: condition-attr predicate + operator-run capture → new ATTR_OP_REJECT token.
P1 ast-builder: ATTR_OP_REJECT → fire E-ATTR-UNQUOTED-OPERATOR once, recover value as absent.
P2 fn() misroute: assess; defer if deep routing change.
P3 SPEC: §17.1 + §5.1/§5.2 + §34 row + §42.10 reconcile note.
P4 tests: new unit test full matrix.
P5 gaps: flip g-attr-gte-tagclose + g-attr-unquoted-compound-silent-drop → resolved.
P6 R26 empirical.

## Log
- [start] startup verified, base contains 2678e8a9, install+pretest OK, empirical probes done.

## P1 DONE (commit 7b4f743b)
tokenizer ATTR_OP_REJECT + ast-builder fire + BS >= guard (scanAttributes +
peekTopLevelStateDeclSignal) + BS ternary ?-depth tracking. Full operator matrix
fires E-ATTR-UNQUOTED-OPERATOR once, 0 E-CTX. Preserve cases (atomic/!/member/
fn()/quoted/paren/show=) green. Precedence: binary-op reject wins over inner not;
paren form then E-TYPE-045. e-type-045 test updated for new precedence (32 pass).
Unit 14214/0, integration+conformance 2560/0.
Scope note: while= is NOT a markup attr (§17 has only if=/show=); condition attrs
= if/show/else-if.

## P2 fn() misroute — DEFERRED
if=check() emits addEventListener("if", ...) (call-ref branch emit-html.ts:1761
unconditionally event-binds). Routing it as a CONDITIONAL needs inter-procedural
reactive analysis of the fn body (condExpr refs are empty for a bare call → would
render-once, not reactively update). Deeper than the scanner. Filing
g-attr-if-fn-call-misroute (MED). Per brief: defer.

## P3 SPEC — staged
§34 +E-ATTR-UNQUOTED-OPERATOR row; §5.2 atomic-only-unquoted-condition normative
bullet; §17.1 if= bullet refined; §42.10 reconcile note (operand positions are
quoted/paren, not authorizing bare ops). SPEC-INDEX regenerated (line ranges).

## P5 DONE — known-gaps
g-attr-gte-tagclose → resolved; g-attr-unquoted-compound-silent-drop → resolved
(both rewritten: broader ~14-op class, reject+parens ruling, E-ATTR-UNQUOTED-OPERATOR,
SPEC-§5.5.2-misread correction). Filed g-attr-if-fn-call-misroute (MED, open) for
the deferred Phase-2 fn() misroute.

## REGRESSION FIX (full-suite within-node gate) — 2026-06-12
Worktree: agent-a1bf3daad918becd2 (pwd verified under .claude/worktrees/agent-)
Base merged main; contains abc742e5 (cluster-A + wrap + regression).

### Phase 1 — corpus migration (the coupled migration cluster-A missed)
Detector: live pipeline (splitBlocks+buildAST) over samples/** + examples/**, grep
E-ATTR-UNQUOTED-OPERATOR. Found 10 sites across 4 files (all `==`):
  - gauntlet-r10-rails-blog.scrml (5): if=@currentView == "list|show|new|edit", if=@posts.length == 0
  - gauntlet-r10-svelte-dashboard.scrml (1): if=@history.length == 0 (class= follows → wrapped only the condition)
  - phase2-if-else-attr-chain-017.scrml (2): if=@step == 1, else-if=@step == 2
  - phase4-if-attr-else-043.scrml (2): if=@n == 0, else if=@n == 1
Migrated EACH to parenthesized form `if=(…)`. Re-ran detector: 0 sites across 0 files.
Broad corpus grep confirmed completeness (remaining matches are comments or legal `if=${...}` interp form).
Verified: rails-blog compiles clean, emits valid JS (node --check OK on client/server/runtime),
`==` lowers correctly into client conditional. svelte/phase4 have PRE-EXISTING orthogonal
errors (interval=1000 E-SCOPE-001 / else-if chain E-CTRL) confirmed present in HEAD originals —
NOT introduced by the paren migration.
[next] Phase 2 — within-node allowlist re-baseline for residual fixtures.

### Phase 2 — within-node allowlist re-baseline
After Phase 1, only 3 fixtures remained over-budget (the 4 migrated fixtures
dropped OUT of over-budget — their paren-form AST now matches native, a clean
improvement, no baseline change needed). Remaining 3 are valid-but-shifted from
cluster-A's BS ternary-?-depth / >= guard:
  - combined-020-calculator.scrml — compiles clean; FIELD-SHAPE 18->20, EXTRA-FIELD 28->29, +COUNT-LENGTH 1
  - gauntlet-s79-calculator.scrml — compiles clean; FIELD-SHAPE 23->25, EXTRA-FIELD 40->41, COUNT-LENGTH 1->2
  - file-manager-r11.scrml — SPAN-COORD 230->248 (ternary ?: at L76/95/96/131/196 → BS span shift)
All 3 have classifier parseFailed=FALSE → NO parse break. Re-baselined each to the
EXACT current raw per-class counts (captures upward shifts AND downward improvements
e.g. file-manager MISSING-FIELD 288->260, EXTRA-FIELD 76->66; combined MISSING-FIELD 128->114).
NOT-A-BREAK NOTE: file-manager-r11 ALSO emits a PRE-EXISTING E-CODEGEN-INVALID-JS
(`(bytes/1024).toFixed` paren-drop) documented in
docs/changes/gate-found-invalid-js-fix-wave-2026-05-29/progress.md (2026-05-29,
weeks before cluster-A). Source byte-identical to 1ad740b4~1. That is a separate
codegen long-tail, ORTHOGONAL to the within-node AST gate, NOT introduced by cluster-A.
within-node test: 1008 pass / 0 fail.
[next] Phase 3 — full suite (bun run test) MUST be 0 fail.

### Phase 3 — VERIFY (full suite, the actual gate)
`bun run test` (full suite incl. browser/within-node tier the pre-commit subset excludes):
  24036 pass / 0 fail / 223 skip / 1 todo  (24260 tests across 986 files, exit 0).
Within-node per-fixture gate: 0 over-budget. node --check on rails-blog emitted
client/server/runtime: all OK; `==` lowers correctly into the client conditional.
REGRESSION RESOLVED. No real parse-break found (the only E-CODEGEN, file-manager-r11,
is pre-existing + orthogonal to the within-node AST gate).
