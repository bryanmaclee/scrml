# progress — s458-declared-props-d1

## 2026-10-07 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae6f33d76a517d33c`, branch `worktree-agent-ae6f33d76a517d33c`, base `46ed1f8ff` == origin/main.
- Read: DD `declared-props-reach-root-2026-10-07.md` (full), gap `g-declared-prop-reaches-expanded-root-s457` (on `land/s457-rename-handler`, not on main), SPEC §15.1–§15.10.1, §66.6, §66.14, §66.15.

### Governing sentences (quoted)
- §66.14 rule 4: "**Use-site attributes are CONSTRUCTION** — always allowed, from any file".
- §66.6.1: "A plain markup use `<x …/>` … is a **NEW INSTANCE** everywhere. Its attributes are that instance's values (construction, §66.14)".
- §15.10 (current E-COMPONENT-012 sentence): "the same prop name SHALL NOT appear in both the `props` block and as a bare attribute on the root element (E-COMPONENT-012: duplicate prop declaration)."
- §15.5: "Adding `id=` at a call site is allowed." vs §15.10: "Extra props provided at the call site that are not declared in the `props` block SHALL be a compile error (E-COMPONENT-011)."
- §66.6.7 O18 (OPEN): "whether `class=` / `style=` / `key=` on a plain use are markup attributes or construction (§66.14), is not ruled."

### Base probe (`.tmp/probe/four.scrml`, base 46ed1f8ff)
Every position leaks: top `title="Top" … id="c-top"` + bool disabled binding; lit adds `href="/lit"`;
`<each>` `setAttribute("title"|"href"|"disabled"|"id")`; `lift` the same; match arm `title="Arm" … id="c-arm"`.

## 2026-10-07 — step 1: the change (code + tests + SPEC + conformance, one commit)
- Locus hypothesis (emit-html `isDeclaredPropAttr` + emit-each + emit-lift) REFINED: the leak is created at ONE
  place, the CE merge in `expandComponentNode` (component-expander.ts, "caller wins" merge of every caller attr onto
  the root). Every expansion path (top-level walk, `<each>` bodies, `lift` targets, bare markup in logic, match/engine
  arms re-parsed later still came through CE) calls `expandComponentNode` (5 call sites, 1 function; the only
  `_expandedFrom:` writers are its primary + secondary-root returns). Declared caller props now leave `attrs` there
  (kept on `_callSiteProps` for TS only), so no emitter can see them — agreement by construction, not per-emitter.
- emit-html `isDeclaredPropAttr`: with the stamp present it now returns false (a declared-prop-named attr left on the
  root is the body's own write). Without it this dropped `href=${href}` written at the root.
- type-system: visits `_callSiteProps` exactly as `attrs` (E-SCOPE-001 on a caller value still fires — measured
  `disabled=false` on base); E-ERROR-002 call-site span lookup reads `_callSiteProps`.
- E-COMPONENT-012 narrowed to a valueless root attribute.
- Explicit-write miscompiles fixed (CE `registerAttrTextPropMaps`): (1) `href=${href}` / inner `<a href=${href}>` with
  an `${expr}` caller left `href` unbound (`const _scrml_v = (href)`); (2) quoted `href="/p/${href}"` with an `${expr}`
  caller left `${href}` unbound. Same root cause: expression-valued callers were absent from the string prop map.
  The quoted fix also closes g-component-prop-in-quoted-attr-substitutes-source-text-s456 (`/p/@u`, `/p/r.url`): a
  reactive value now stays a `${…}` interpolation instead of being spliced as source text.
- Tests: unit E-012 pins moved to the bare form + 4 valued-root-attr negatives; trucking baseline +3 E-DG-002
  (honest: the junk root write was the cells' only consumer; the each-in-lifted-component drop is the open gap);
  conformance dup-reject moved to bare form; 2 new cases (declared-prop-not-root-attr, declared-prop-explicit-root-write).
- Gate: unit+integration+conformance 29907 pass / 0 fail.

## 2026-10-07 — step 2: corpus measurement + gates
- `scripts/corpus-emit-differential.ts`, base = this worktree with the 3 compiler files flipped back to 46ed1f8ff by
  file copy (same corpus both sides), head = f81b341ca. 2427 sources; compile outcome 0 newly failing / 2 newly passing
  (bind-non-bindable-prop-clean: spurious E-ATTR-011 gone; declared-prop-explicit-root-write: new case);
  artifacts 7056/7089 byte-identical, 33 differing; syntax-failing 0/0; server-fn call sites unchanged.
- Every differing artifact classified "accidental leak removed" (title tooltips on Card roots, label/status/items/load/
  customerName/role/name/currentDriverId/… junk writes, a bogus `Save` event listener from `onSave`); the rest are
  renumbered ids (`_scrml_risky_5`→`_3`, `_lift_el_108`→`_107`). ZERO "intended attribute" deltas — no source migration.
- Diagnostic deltas: E-ATTR-011 → E-DG-002 on bind-non-bindable-prop-{clean,reject}; trucking +3 E-DG-002 (load-detail).
- Gates: e2e-render-map 259/0, root 2239/0, corpus-compile-floor PASS, browser-baseline PASS, conformance/run.ts
  1348/1398 + 50 xfail (no new xfail), types-gate OK, s34-census PASS, snippet-gate PASS, delta-lint PASS.
  STALE (PA-owned, not edited): compiler/SPEC-INDEX.md (regen-spec-index --check), docs/FACTS.md facts-table.

## 2026-10-07 — step 3: PA fix round — wire the `bind:` component-prop write-back (option 1)
Governing (§15.11.1): "The compiler SHALL generate bidirectional synchronisation for `bind:` component props.
Changes to `@var` in the parent SHALL propagate into the component. Changes to the bindable prop inside the component
SHALL propagate back to `@var` in the parent." Worked example: "When the user clicks "Close" inside the modal,
`visible = false` writes back through the bind channel to `@showModal`, which the parent owns."
- Fix (CE): `bind:propName=@var` is now keyed by the PROP name in the substitution map, so every body read AND write
  of `propName` becomes `@var` — reads reactive, writes `_scrml_cs_reactive_set("showModal", …)` in every form
  (`=`, `+=`, `++`, inside handlers, body functions, `if` bodies) and every position (top, `<each>`, `lift`, match arm).
- Removed the `_bindProps` stamp. Its codegen mirrored the caller cell into a GLOBAL cell named after the prop
  (`visible`), shared by every instance: measured before the removal, two Modals bound to `@showModal` / `@other`
  cross-wrote each other (conformance bind-prop-write-back failed: closing #m2 set `@showModal` false). The
  emit-reactive-wiring / emit-client `_bindProps` consumers are now dormant (no producer).
- A body `<input bind:value=value>` forwarding the bind prop stays a `bind:` to the caller cell (`@text`), not an
  expression (which `bind:` rejects with E-ATTR-010).
- Not reachable: §15.11.1's Modal example verbatim — its `${...}` children spread fails every component with
  E-COMPONENT-021 (pre-existing, also on base; G-COMPONENT-CHILDREN-SPREAD-SYNTAX-REJECTED-E-COMPONENT-021). The
  executed case is the example minus the spread.
- Tests: callback-props §H/§I rewritten (no `_bindProps`; write-back lowers to the caller cell; a grep for a bare JS
  write to the prop name / a cell keyed by it); conformance bind-prop-write-back (Modal, two independent instances),
  bind-prop-write-back-positions (4 positions × 3 write forms), bind-prop-forwarded-to-input — all executed in happy-dom.

## 2026-10-07 — step 4: merge origin/main (S457 sinks #1351) + reconcile the sinks pins with D1
- `git merge origin/main` (08adefc4c): clean auto-merge of SPEC.md / emit-html.ts / component-expander.ts.
- The two sinks conformance cases encoded the leak (a DECLARED prop reaching the root). Retargeted, renamed, noted:
  `declared-prop-srcdoc-each-lift-neg` → `undeclared-attr-srcdoc-each-lift-neg` (propless `Fr`; still E-ATTR-INTERP-
  EXECUTABLE in lift AND each); `declared-prop-on-attr-lift-listener-pos` → `undeclared-attr-on-attr-lift-listener-pos`
  (propless Btn/Link/Tip keep the listener / guarded href / title pins; declared DBtn/DLink/DTip assert ABSENCE).
  The sink is still reachable through the undeclared fallthrough (O18 carry), so the coverage is kept, not dropped.
- s457 integration §8 split: §8 (undeclared fallthrough — every original sink assertion, propless defs) + §8b (declared:
  not written, not refused, no listener; trucking load-new: no `addressinput` listener, no `addressValue` write).
  Browser test: the three "declared" tests now use propless components (same assertions). Unit file untouched (passes).
- SPEC §5.2 rule 2: the two "component prop written onto an expanded root" parentheticals now say UNDECLARED call-site
  attribute, and that a declared prop never reaches the root (§15.10).
- docs/bootstrap-conformance.md regenerated (`bootstrap-conformance.ts --write`; generated file, renamed/new cases).
- The S457 declared-`on…` lift listener wiring is not dead code: it still serves the undeclared fallthrough.

## 2026-10-08 — step 5: PA review fix round F1–F6 (base 08adefc4c vs b4994a7fc)
Resumed after a network-outage kill (tip b4994a7fc + 1 uncommitted edit, expression-parser.ts — reviewed, kept).
- F1 (structural substitution): new `substituteExprText` — parse with scrml's parser, replace identifier NODES
  (shadow-aware) with the caller's expression node in ONE pass (a substituted node is never re-scanned), never
  touch string/template literal content, re-emit from the tree (precedence structural); unchanged text returned
  verbatim. Every attribute-text site now uses it: quoted `${…}` segments (`substituteInterpSegments` →
  `rewriteTemplateInterpolations` → per segment), unquoted `expr` raws without an exprNode, the variable-ref
  member path, `<each>`/`<match>` `in`/`of`/`key`/`on` fields, and template-literal segments in logic.
  TEXT-ONLY fallback, and why: `rewriteIdentsInRawExpr`, used only when the text does not parse to a structured
  expression (the parser's escape hatch — a block-bodied arrow, an `@.field is some` sigil raw); it is single
  pass, skips string literals, and now PARENTHESIZES a compound substituted value. `asName` (a binder name, not
  an expression) keeps the legacy rewrite.
  - emitStringFromTree (expression-parser.ts): a unary operator now keeps a compound operand grouped —
    `not (x is not)` used to round-trip as `!x is not`.
- F2: only a prop the CALLER bound with `bind:` may be written (§15.11.1 "A bindable prop declares that the
  component may write back to the caller's reactive variable through this channel"; §15.13.2 "Not reactive
  (captured once at mount): Non-`bind` props passed by value at the call site"). Writes (`=`, compound, `++`/`--`,
  in handlers, functions, block arrows, a forwarded `bind:value=value`) are recorded during substitution
  (`_propWriteCtx`) and refused: E-ASSIGN-004 — SPEC names no code; its §34 text ("`const` variable as assignment
  target") is the closest. ROUTED FOR A RULING. Forwarding `bind:value=value` stays a bind only for a bound prop.
- F3: `bind:n=@d` of a `const <d>` derived cell → E-DERIVED-WRITE at the bind site (CE collects the file's
  derived cells as SYM does: `state-decl` isConst + shape "derived").
- F4: block-bodied arrows (escape-hatch `ArrowFunctionExpression`) are substituted in `raw`, with the arrow's own
  parameters shadowing same-named props — `() => { n = 200 }`, `.forEach(x => { n = n + x })`, `.map(x => { return label + x })`.
- F5: a write to an unbound bindable prop (with or without a default) → E-ASSIGN-004 (no per-instance cell in
  impl#1, §66.15.1 carried divergence) — ROUTED with F2. `bind:n=@v.k` → E-ATTR-010 (§15.11.1 grammar
  `'@' identifier`).
- F6: SPEC E-COMPONENT-012 rows cite `component-expander.ts`, `expandComponentNode` (no line number); the dormant
  `_bindProps` consumers in emit-reactive-wiring.ts / emit-client.ts deleted.
- Tests: unit s458-prop-write-and-substitution (13); conformance prop-substitution-structural (title 8 / v=8 / literal
  content / no capture, executed) and bind-prop-write-back-block-arrows (executed). Gate 30203 pass / 0 fail.
- Found, not fixed (pre-existing): a component whose body declares `const`s cannot be instantiated twice (module-scope
  `const` redeclared → SyntaxError at load) and cannot be used inside `<each>` (E-EACH-BODY-DECL-UNSUPPORTED).

## 2026-10-08 — step 6: review round 3 (89dd1278d DO-NOT-LAND) — the text fallback is gone
- Boundary changed: `rewriteIdentsInRawExpr` (the scanner) is DELETED. Text the expression tree does not structure
  — a block-bodied arrow / function expression (an escape hatch codegen emits from `raw`; emit-expr has no
  block-lambda path: it prints `/* block body */`), a `when …` handler `bodyRaw`, a `!{}` arm `handler`, a statement
  handler value (`if (@r > 0) act()`) — is substituted on its PARSED tree: new leaf module
  `compiler/src/component-prop-js-substitute.ts` (`substitutePropsInJsSource`) parses with the expression parser's
  own acorn + `@`/`::` plugins, builds a scope model (let/const/var/function/class declarations, params incl.
  destructured and defaulted, `for (let …)` / `for (const … of)` binders, catch params, switch-case blocks) and
  replaces only Identifier REFERENCES at their exact node offsets. Object keys, member names, labels, string /
  template / regex / comment content are never references; a shorthand `{ label }` becomes `{ label: <value> }`;
  writes (assignment / update / destructuring-assignment targets) are reported. Text that does not parse is never
  rewritten: a prop it references is refused (E-SCOPE-001 — ROUTED; detection reads the acorn token stream).
- Structured paths: a destructured lambda param now records `boundNames` (expression-parser `convertParams`,
  `LambdaParam.boundNames`); function-decl string params are parsed for every bound name; a C-style for header's
  binder shadows in header + body.
- N3 root cause (pre-CE): `collectExpr` cooked every STRING token's escapes then re-quoted it, so a component
  definition's raw markup lost `\'` (and doubled `\d`) BEFORE the expander re-parsed it. The tokenizer now records a
  quoted STRING's delimiter; `collectExpr` returns `exprSource` (strings as written) and the component-def uses it.
- Substituted values keep their precedence: a primary (ident / member / call / index / array / non-number literal)
  is spliced as-is, anything else parenthesized.
- `substituteExprText`: a parse that LOST trailing content (`n + 'it's'` → `n + 'it'`) is treated as unparsed.
- F5 residual: `bind:n=${@w + 1}` / `bind:n=f()` → E-ATTR-010 naming the expression.
- Remaining text rewrites of a prop name in the expander (grep): `applyPropSubstitutions` — a WHOLE `${name}`
  segment whose entire content is the prop identifier, spliced with the prop's LITERAL text only (quoted attrs and
  text nodes; literal props only — justified: the segment IS the identifier); `substitutePropsInRawExpr` for the
  `<each as x>` BINDER NAME only (non-expression text, byte-identical). `rewriteTemplateInterpolations` only
  SEGMENTS `${…}`; each segment is substituted structurally.
- Found, pre-existing, not fixed: a declaration-form C-style `for (let n = 0; …)` statement in a component-body
  function drops its init in the native re-parse (translate-stmt.js `makeForStmtCStyle`, documented there) → the
  loop variable is unresolved (E-SCOPE-001 on main too); a block arrow containing one becomes a structured lambda
  whose body emits as `/* block body */` — an EMPTY callback, silently (main too).
- Tests: conformance prop-substitution-scope-in-block-arrows (N1, executed), prop-substitution-loop-binder-shadows
  (N2 for-of shapes, executed), prop-substitution-string-escapes (N3, executed); unit +7 (JS-substitute scope cases,
  bind expr E-ATTR-010, C-style never writes the caller cell). Gate 30213 pass / 0 fail.
