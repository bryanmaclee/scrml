# s469-value-form-followups — progress

Security follow-up to #1464 (§19.4.3, E-ERROR-002). Base: `origin/s469-value-form-if-for-failable`
(#1464 head `c7a5fecf6`). impl#1 change under the security exception.

## Fixed

- **F1 — unreadable `lift` operand (MED, fail-open in #1464).** `liftOperand` returned silently when
  the operand text parsed neither as an expression nor as statements (a `lift if` nested two deep:
  `parseStatementText` refuses the inner `lift if`). Now: every failable function (or alias) the
  text names is an unhandled call (E-ERROR-002); text naming none is refused as unreadable.
  - **Code choice:** the unreadable refusal REUSES `E-CODEGEN-INVALID-LOGIC` (no new code) — it is
    the code codegen already gives the same construct, so the user sees one consistent code. It is
    emitted from the type system with its own message ("this 'lift' operand could not be read").
  - The same fail-closed read (`Walker.unreadText`, names via the compiler's logic tokenizer —
    `mentionedNames`) now covers EVERY text the walk failed to parse: `!{}` arms (statement and
    expression position), raw inline-`match` arms, parameter defaults, C-style `for` initializers,
    `on mount` / `when` bodies, function-value bodies, a declaration's `init` text, a statement whose
    only expression is a parse-error hatch. A parse-error root NEXT TO a structured reading (a
    `match-arm-inline`'s `check(p)?` + `propagateOperandExpr`) is not read twice (first cut did;
    gate caught it: `e-error-002-value-position-s467` B).
- **F1b — lifted markup (`g-lift-markup-failable-call-unchecked-s468`, HIGH) — CLOSED.** Contained:
  `liftOperand` reads a markup operand with `Walker.liftedMarkup` (interpolation statements and
  attribute values = value positions; event handlers = handler bodies; nested markup; any other
  operand shape = `opaque`). Inside an `<errorBoundary>` such a call is refused (no catch site).
  - **Scope note (surfaced):** the SAME reader closes the sibling
    `g-markup-in-interp-ternary-failable-call-unchecked-s468` (HIGH; `markup-value` was a leaf in
    `expr()`): one `case`, same machinery, executed (wrong password logged in on #1464 head; now
    refused; the handled form renders correctly). Not named in the brief — done because it is the
    same reader and the same fix direction both entries recorded. Easy to split out if the PA prefers.
- **F2 — tagged templates (HIGH, logged in on main/#1464).** A `TaggedTemplateExpression` hatch whose
  tag is a name is read as a CALL of the tag (interpolations = values): `check\`…\`` is E-ERROR-002,
  `check\`…\` !{…}` / `check\`…\`?` are handled like a call (executed: wrong rejected, right logged
  in), a `match` subject on it is refused (not lowered as a failable match — it logged in on base).
  Every other hatch (sequence, class, meta-property, an interpolation the parser dropped — new
  `templateInterpolationNodesAll`) is read to refuse. Regex / BigInt literal hatches hold no code.
- **F7.** `_handlerParamPrelude`, `_cellKind`, `_formForSynth` classified (inert). A `__` key holding
  a structure is read (`opaque`), never skipped (corpus probe, 1006 files: no `__` key holds an
  object on any walked statement today). Test D now also follows assignments through LOOP variables
  (with a reviewed list of loop-written keys that never land on a declaration) and scans the
  declarations codegen synthesizes (`emit-form-for.ts`, via Bun.Transpiler + acorn).
- **F9.** Test A's header corrected (the value-form `if` inside a value-form `for` is
  E-CODEGEN-INVALID-LOGIC on main, not a login).

## Filed (docs/known-gaps.md)
- `g-failable-call-in-tagged-template-unchecked-s469` (HIGH, resolved) — F2.
- `g-value-form-lift-operand-unreadable-skipped-s469` (MED, resolved/refused) — F1.
- `g-route-inference-value-form-body-server-signal-s469` (MED, open, fails closed at runtime) — F4.
- `g-value-form-guard-arm-lift-not-defined-s469` (LOW, open, fails closed) — F9 codegen bug.
- `g-failable-function-used-as-value-unchecked-s468` (HIGH, open) — F5. NOTE: the brief said this
  entry existed; it did not (on this branch or origin/main). The S467 entry recorded it only as
  residue; filed it under the id the brief named, with the repros and the head inconsistency.
- F3 folded into `g-value-form-body-not-visited-by-type-system-s469` (E-SCOPE-001, E-TYPE-031,
  E-TYPE-025, E-ERROR-003 — the last marked security-relevant).
- `g-lift-markup-failable-call-unchecked-s468`, `g-markup-in-interp-ternary-failable-call-unchecked-s468`
  → resolved.

## Measured
- Corpus (examples / samples / conformance/cases / stdlib / benchmarks — 2858 sources), per-file
  error codes, base = #1464 head compiler swapped into the same worktree path vs this branch:
  **0 diagnostic changes, 0 newly refused.**
- Gate (pre-commit hook): 37711 pass / 0 fail after the last code commit.

## Not closed (observed, out of scope)
- `${ for (x of [@pw]) { const v = check(x) !{ | _ :> false }⏎ lift <li>${v ? …}</li> } }` renders
  "rejected" for the RIGHT password too (same on #1464 head) — fails closed, a codegen/reactivity
  issue with a guarded declaration in a rendered `for` body. Not filed (not verified beyond one shape).
