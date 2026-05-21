---
tags: [native-parser, charter-B, implementation-roadmap, M-ladder, front-end, s112]
status: ACTIVE
date: 2026-05-20
session-opened: S112
audience: PA (orchestration) + scrml-js-codegen-engineer dispatches
---

# Native-Parser Front-End — Implementation Roadmap

The trackable per-sub-step decomposition of the charter-B M-ladder. This is the analog
of the (now-superseded) quoted-text `IMPLEMENTATION-ROADMAP.md` — the single artifact
the PA tracks the multi-quarter native-parser arc against.

**Authority chain (read before dispatching any milestone):**
- `scrml-support/docs/deep-dives/scrml-native-parser-front-end-charter-2026-05-20.md` —
  charter dive (the master plan; M-ladder Q4.A, estimates Q4.B, retirement Q5).
- `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` — S98 DD
  (D2 JS engine graph, D3 type catalog, D5 JS subset, D7 milestones + gating criteria).
- `docs/changes/native-parser-front-end/SPIKE-markup-js-seam-2026-05-20.md` — R1 seam
  spike (the markup↔JS seam contract; punch-list §6 P1-P13).
- `compiler/native-parser/README.md` — M1 AS BUILT (M1.1-M1.4 complete).
- SPEC §4.18 (code-default body mode + display-text literal — implemented natively at MK3).

---

## §0 Overview

### §0.1 What charter B is

The scrml-native parser replaces the **entire compiler front-end** — the heuristic
block-splitter (`block-splitter.js`, 2056 LOC, 12 heuristics) AND Acorn (the JS layer)
AND BPP (`body-pre-parser.ts`) AND the two statechild re-tokenizers' scaffolding — with
ONE composed-engines scrml-native parser. Ratified S111 (user: "B"). M1 (composed-engines
lexer) is COMPLETE (S99-S103). This roadmap covers everything past M1.

### §0.2 The M-ladder (charter dive Q4.A)

```
JS layer:      M1 ✅ → M2 → M3 → M4 ─┐
                                      ├→ M5 → M6
Markup layer:        MK1 → MK2 → MK3 → MK4 ─┘
```

| Mn | Layer | Scope | Charter est. |
|---|---|---|---|
| M1 | JS | Composed-engines lexer | ✅ COMPLETE (S99-S103) |
| **M2** | JS | JS **expression** parser; `ParseMode` engine; `Expr` AST per D3 | 30-60h |
| M3 | JS | JS **statement** parser; function bodies in-line (subsumes BPP) | 35-70h |
| M4 | JS | Full bounded JS subset (all D5 MUST PARSE + MUST ADD) | 25-55h |
| **MK1** | Markup | Markup scanner — `BlockContext` engine + context-grid boundaries | 20-45h |
| MK2 | Markup | `TagFrame` engine — `<tag>` tree, 3 closer forms, `TagKind` | 25-55h |
| MK3 | Markup | `BodyMode` + `DisplayTextLiteral` — §4.18 native quoted-text | 18-38h |
| MK4 | Markup | Markup↔JS seam; re-tokenizer scaffolding deletion | 27-46h (R1-tightened) |
| M5 | Both | Pipeline swap behind `--parser=scrml-native` + canary | 16-36h |
| M6 | Both | Joint retirement — BS + Acorn + BPP deleted; flag retired | 12-28h |

Headline: **~239-518h, midpoint ~380h (~10-14 focused sessions)** past M1.

### §0.3 Critical path + parallelization

```
M2 → { M3 → M4  ‖  MK3 } → MK4 → M5 → M6      ‖ = parallel
       MK1 → MK2 slide in alongside M2/M3
```

- **M2 (JS expression parser) and MK1 (markup BlockContext engine) parallelize** — no
  shared files, both depend only on M1 (done). These are the S112 first dispatches.
- MK3 needs M2 (interpolation bodies delegate to the JS expression parser).
- MK4 (the seam) needs M3/M4. MK4 is R1-de-risked (spike landed S111).

### §0.4 The two "ParseContext" things — disambiguated (READ THIS)

The source docs use the name `ParseContext` for **two different things**. This roadmap
disambiguates them — briefs MUST use these names:

| Thing | Source | This roadmap's name | Owned by |
|---|---|---|---|
| The JS-layer statement-vs-expression context **engine** | S98 D2 | `<engine for=ParseMode>` (RENAMED from D2's `ParseContext` — parallels `LexMode`) | M2 |
| The shared context **object** (the seam substrate — cursor + tokens + node sink + brackets + recovery + errors + `delegationStack`) | R1 spike §3.1 | the **parse context object**, built by `makeParseContext` extending M1's `makeLexContext`; the variable is `ctx` | MK1 |

### §0.5 Discipline carried by every native-parser dispatch

- **`.scrml` canonical + `.js` shadow per file** (README ANOMALY-2). Every new file is a
  `.scrml` (canonical Pillar-5b SHAPE) + a 1:1 `.js` executable shadow. Tests import the
  `.js`. The shadow retires at M5 (charter Q8).
- **Pillar 5b** — every state-shape construct points to an `<engine>`; every `fn` body
  justifies its calculation classification at the file header (D1 charter two-table test).
- **Acorn is the conformance ORACLE, never the design template.**
- **Composed engines** — Mario-scale (5-15 variants/engine); §51.0.Q.1 hierarchy for
  nesting. M1's `lex-mode.scrml` is the pattern to extend.
- **One-cursor invariant** (R1 spike §3.3) — markup + JS layers share ONE `Cursor`; no
  layer copies a sub-range; no `Span` carries a base-offset. (Designs out the cross-seam
  span-bug class.) Load-bearing from MK1 forward.

### §0.6 Status at S112 OPEN

- Charter dive PA-actions: A1 (roadmap SUPERSEDED banner) ✅ S111; R3/OQ-2 (§4.18.1/§40.8
  reconcile) ✅ S111 (`78faa65`); R1 seam spike ✅ S111. OQ-1 (v0.4 manifest) + A2
  (staleness-index refresh) — open, non-blocking.
- Interim-BS posture: **Option I-B** (case-by-case patching) per charter Q6.B — do NOT
  pre-invest the ~65h I-A throw-away fix. Trigger for I-A: 2+ distinct code-bearing-body
  misclassification bugs blocking delivery within one quarter.

---

## §1 M2 — JS expression parser (DISPATCH-READY)

**Goal (S98 D7 M2 gating):** Conformance Tier 1+2 PASS on the expression subset; the
`ParseMode` engine demonstrably governs context; the 5+ `preprocessForAcorn`
Acorn-workaround failure modes demonstrably do NOT exist (regression test per class).

**Inputs:** S98 D3 (`Expr` AST shape), D5 (MUST PARSE expression rows + MUST ADD list),
D7 M2 gating. M1's `lex(source): Token[]` is the token source.

**File ownership (new files under `compiler/native-parser/`):** `parse-mode.scrml`/.js
(the `<engine for=ParseMode>` JS context engine), `ast-expr.scrml`/.js (the native
`Expr` enum + node constructors per D3), `parse-expr.scrml`/.js (the expression parser).
M2 does **not** modify `lex.scrml` and does **not** create the markup-layer files.

| Sub-step | Scope | Est. | Depends |
|---|---|---|---|
| **M2.1** | Parser substrate + `ParseMode` engine + **primary expressions**. A token cursor over M1's `Token[]`; `type ParseMode:enum` + `<engine for=ParseMode initial=.TopLevel>` (expression-relevant variants); `ast-expr.scrml` `Expr` enum per D3; parse: literals (number/string/template/regex/bool — M1 lexes, M2 builds AST), identifiers, `@`-cells, parenthesized exprs, array literals, object literals. Extend the conformance harness for the expression subset. | 8-15h | M1 ✅ |
| **M2.2** | **Operator expressions** — binary operators with full JS precedence (the precedence-climbing core), unary (prefix + postfix `++`/`--`), assignment operators (incl. `??=`/`&&=`/`\|\|=`), conditional `?:`, sequence `,`. | 7-14h | M2.1 |
| **M2.3** | **Call / member / arrow-head / function-expression** — call exprs, member access (dot + computed), optional chaining `?.`, `new`, arg spread; arrow functions + function expressions (parse the HEAD; block bodies forward-reference M3's statement parser — stub-or-defer the body, documented); tagged templates. | 8-16h | M2.2 |
| **M2.4** | **scrml-extension expression forms** (D5 MUST ADD) — bare variants `.X` (§14.10), `is`/`is not`/`is some`/`is given`/`is .Variant` (§42), `not` value form (prefix `not (expr)` is E-TYPE-045 — NOT a parse form; §42.10), `match expr {}` (§18), `~` (§32), `?{sql}` (§8), `<#id>` (§36), `render` (§14.9), `lift` (§10), `fail` (§19), `::Variant` (§14). **This closes the 5+ `preprocessForAcorn` Acorn-workaround failure modes — one regression test per fixed class** (M2 gating criterion). | 7-15h | M2.3 |

---

## §2 MK1 — markup `BlockContext` engine (DISPATCH-READY)

**Goal (charter Q4.A MK1 gating):** markup-layer block-stream output for every
conformance-corpus file is structurally equivalent to the current BS block tree (modulo
the intentional improvements — no `text` raw captures for compound/match bodies);
reviewable for D1 charter conformance.

**Scope boundary:** MK1 is the **context-grid** ("which scrml context are we in") — NOT
the `<tag>` tree. MK1 recognizes the `BlockContext.InMarkupTag` *boundary*; the `TagFrame`
engine that pairs openers with closers is **MK2**.

**Inputs:** charter Q1.C (`BlockContext` engine sketch — 9 variants), R1 spike §3.1 (the
shared parse-context object) + punch-list P1/P2/P3. M1's `lex.scrml` `makeLexContext`
is the substrate to extend.

**File ownership (new files under `compiler/native-parser/`):** `parse-ctx.scrml`/.js
(the shared parse context object — `makeParseContext` extending `makeLexContext` with a
node sink + `delegationStack`; punch-list P1), `block-context.scrml`/.js (the
`<engine for=BlockContext>`), `parse-markup.scrml`/.js (the markup trampoline, mirroring
`lex.scrml`). MK1 may **import** `makeLexContext` from `lex.scrml` but does **not** edit
`lex.scrml`, and does **not** create the JS-parser files (M2 owns those).

| Sub-step | Scope | Est. | Depends |
|---|---|---|---|
| **MK1.1** | **Shared parse-context object + `BlockContext` engine skeleton.** `parse-ctx.scrml` `makeParseContext` extending M1's `makeLexContext` — one `cursor`, one `BracketStack`, one `ErrorRecovery`, one error stream, + a node sink + `delegationStack` (punch-list P1; one-cursor invariant P2). `type BlockContext:enum` (9 variants per charter Q1.C) + `<engine for=BlockContext initial=.TopLevel>` skeleton + `rule=` contract. The trampoline `parse-markup.scrml` (loop dispatching by `BlockContext`, mirroring `lex.scrml`). | 7-15h | M1 ✅ |
| **MK1.2** | **Context-boundary recognition.** Recognize the 7 block-opener sigils (`${`/`?{`/`#{`/`!{`/`^{`/`~{`/`_{`) + brace-depth closing; recognize the `<ident` markup-tag-context boundary (entering `.InMarkupTag` — the tag TREE is MK2). `.InLogicEscape` as a §51.0.Q.1 composite state-child realized as a `DelegationFrame` push (punch-list P3); since the JS layer is not wired until MK4, the delegated body is captured as a span/stub frame at MK1. `_{}` opaque passthrough (§23). | 7-16h | MK1.1 |
| **MK1.3** | **Comments + sub-context stubs + conformance.** `//` line comments + `<!-- -->` HTML comments recognized **structurally** (not heuristically — eliminates BS heuristics #6/#7). The `.InCss`/`.InSql`/`.InErrorEffect`/`.InMeta`/`.InTest` sub-context stubs at sketch-depth (charter Q1.C). MK1 conformance: block-stream equivalence vs the current BS block tree on the conformance corpus. | 6-14h | MK1.2 |

---

## §3 Downstream milestones (decompose into sub-steps when scheduled)

Milestone-level scope only — the charter dive + S98 D7 have the detail. Each gets a
per-sub-step decomposition appended to this roadmap when its turn comes (as M2/MK1 did).

### §3.1 MK2 — `TagFrame` engine (✅ COMPLETE S113 — MK2.1 + MK2.2 + MK2.3)

**Decomposed S113** (PA, from charter dive Q1.F `TagFrame` sketch + Q1.G composite
picture + Q2.A heuristic table + Q4.A/Q4.B). MK2's turn in the markup chain — MK1 ✅.

**Goal (charter Q4.A MK2 gating):** tag-tree + closer-form output equivalent to the
current BS block tree on the conformance corpus; the 5 BS classifier heuristics
demonstrably do not exist (one regression test per Q2.A #1-5).

**Scope boundary:** MK2 is the `<tag>` TREE — opener/closer pairing, the 3 closer
forms, `TagKind`. It is NOT `BodyMode`/`DisplayTextLiteral` (§4.18 quoted-text — that
is MK3). A state-child's body MODE is carried as `TagFrame` payload but the `BodyMode`
engine itself lands at MK3.

**Inputs:** charter dive Q1.F (`TagFrame` 3-variant engine sketch + `TagKind` calc) +
Q1.G (how `BlockContext`/`BodyMode`/`TagFrame`/`DisplayTextLiteral` compose) + Q2.A
(the 12 heuristics — MK2 eliminates the 5 classifier ones) + R1 seam punch-list P4/P5.
MK1's `block-context.scrml` + `parse-markup.scrml` are the substrate to extend (MK2
wires `TagFrame` into the `.InMarkupTag` boundary MK1.2 established).

**File ownership (new files under `compiler/native-parser/`):** `tag-frame.scrml`/.js
(the `<engine for=TagFrame>` + the `TagKind` calc + the structural-element registry).
MK2 EXTENDS `block-context.scrml` + `parse-markup.scrml` (MK1's files) to dispatch into
`TagFrame` at the `.InMarkupTag` boundary. MK2 does NOT create the JS-parser files (M2
owns those) and does NOT create `body-mode.scrml` (MK3 owns it).

| Sub-step | Scope | Est. | Depends |
|---|---|---|---|
| **MK2.1** | **`TagFrame` engine skeleton + opener recognition + `TagKind` calc.** `tag-frame.scrml` — `type TagFrame:enum` (`Closed` / `OpenExpectingChildren(name, kind, depth, span)` / `OpenSelfClosed(name, kind, span)` per Q1.F — payload-bearing state-children, the `bracket-stack.scrml` `.OpenAt` pattern) + `<engine for=TagFrame initial=.Closed>` + `rule=` contract. `type TagKind:enum = {Html, Component, ScrmlStructural, StateOpener}` + the `TagKind` **calculation** — a pure `fn` of opener name + whitespace shape (`<ident` vs `< ident`) + first-char case + structural-element-registry membership (per Q1.F + D1 OQ1 negative-example rule: pure-function-of-input-bytes ⇒ calculation, NOT an engine). The structural-element registry (`<engine>`/`<match>`/`<errors>`/`<onTransition>`/`<onTimeout>`/`<onIdle>`/`<channel>`/`<page>`/`<auth>` — SPEC §4.15 / §24.4). Opener recognition: tokenize the `<ident ...>` opener (one-pass attribute tokenizer), compute `TagKind`, push the frame. Wire into `parse-markup`'s `.InMarkupTag` dispatch. | 8-18h | MK1 ✅ |
| **MK2.2** | **Closer forms + tag-tree pairing + mismatch recovery.** The 3 closer forms — `</>` (inferred), `</name>` (explicit), `/>` (self-closing) — recognized **structurally** (closed set; no `looksLikeCloser` bare-`/` guess). `TagFrame` `rule=` contract: opener pushes `.OpenExpectingChildren`, closer pops to `.Closed`; the stack IS the depth count (eliminates BS heuristic #5 `scanCompoundBlockEnd`). Mismatched `</name>` fires `E-MARKUP-002` (SPEC §4.4.1 — corrected S113 from the charter dive Q1.F's E-CTX-001 per pa.md Rule 4) and dispatches the `ErrorRecovery` engine panic-mode — the same recovery the JS layer uses, scoped to block grammar. (Unterminated tag at EOF → `E-CTX-001` per §4 closer-recovery; stray closer with nothing open → `E-CTX-003`.) Output: the `<tag>` tree via recursive-descent / stack discipline. | 9-20h | MK2.1 |
| **MK2.3** | **`TagKind`-driven classification completion + punch-list P4/P5 + conformance.** The grammar decides decl-vs-markup-vs-structural from `TagKind` + what follows the opener (eliminates BS heuristics #1 `isAfterTransitionArrow` + #4 `classifyOpenerForCompoundScan` — the recursive classifier). Punch-list **P4** — `markupValueAllowedAfter(lastKind)` discriminator (the JS layer's `InCode` dispatch consumes it). Punch-list **P5** — `TagFrame` exposes stack depth (for `CloseCondition.TagFrameBalanced`). Conformance: tag-tree + closer-form output equivalent to BS on the conformance corpus; one regression test per Q2.A #1-5 (the 5 classifier heuristics demonstrably gone). | 8-17h | MK2.2 |

---

### §3.2 M3 — JS statement parser (DECOMPOSED S113 — DISPATCH-READY)

**Decomposed S113** (PA, from S98 DD D5 MUST-PARSE statement rows + D7 M3 gating +
charter Q4.A/Q4.B). M3's turn in the JS chain — M2 (M2.1-M2.4) ✅ complete.

**Goal (S98 D7 M3 gating):** conformance Tier 1+2 PASS on the full statement subset;
the error-recovery engine demonstrably accumulates skipped tokens + re-synchronizes
(panic-mode on `;` / statement-start keywords / closing braces); function bodies
parsed IN-LINE — `body-pre-parser.ts` (BPP) deletes by construction.

**Scope boundary:** M3 is the JS STATEMENT grammar. It re-enters the `BlockStub` token
ranges M2.3 (function/arrow block bodies) + M2.4 (match-arm block bodies) left as
forward-seams. M3 does NOT touch the markup layer (MK*).

**Subset bound (S98 D5 — per pa.md Rule 4, D5 is the scope authority):** the MUST-PARSE
statement features are `let`/`const`/`var` (+ destructuring), block / `if`-`else` /
`for` / `for-in` / `for-of` / `while` / `do`-`while`, `return` / `break` / `continue`,
function + class declarations & expressions, `import`/`export`, `async`/`await`,
`yield`/`yield*`, and `try`/`catch`/`finally`+`throw` (parsed for legacy + JS-import
inputs; REJECTED from scrml source per primer §6 — scrml uses `fail`/`!{}`). A
statement form NOT in D5 (`switch`, `with`, decorators, …) is `E-PARSER-OUT-OF-SUBSET`
per D5/OQ6 — surface to PA, do NOT silently widen scope.

**Inputs:** S98 DD D5 + D7 M3 gating + D3 (AST shape) + charter dive Q4.A/Q4.B. M2's
`parse-expr.scrml`/.js (the expression parser M3 calls into) + `parse-mode.scrml`/.js
(the `ParseMode` engine M3 extends with statement-context variants) + the `BlockStub`
Expr node are the substrate.

**File ownership (new files under `compiler/native-parser/`):** `parse-stmt.scrml`/.js
(the statement parser) + `ast-stmt.scrml`/.js (the `Stmt` AST enum + constructors per
D3). M3 EXTENDS `parse-mode.scrml`/.js (statement-context `ParseMode` variants). M3
does NOT create or edit the markup-layer files.

| Sub-step | Scope | Est. | Depends |
|---|---|---|---|
| **M3.1** | **Statement-parser substrate + declarations + block/expression statements + `BlockStub` re-entry.** `ast-stmt.scrml`/.js — the `Stmt` enum + node constructors (per D3). `parse-stmt.scrml`/.js — the statement-list parser. `parse-mode` extended with statement-context `ParseMode` variants. Parse: variable declarations (`let`/`const`/`var`, incl. object/array destructuring patterns), expression statements, block statements `{}`, the empty statement `;`. **`BlockStub` re-entry** — the mechanism that takes a `BlockStub`'s captured token range (left by M2.3 function/arrow block bodies + M2.4 match-arm block bodies) and re-parses it into a real `Stmt` list. New conformance harness `parser-conformance-stmt.test.js`. | 10-18h | M2 ✅ |
| **M3.2** | **Control-flow statements.** `if`/`else`, `while`, `do`-`while`, `for` (C-style three-clause), `for-in`, `for-of`; `return`, `break`, `continue`; labels + labeled statements. D5-enumerated control flow only — `switch` is NOT in the subset; if the corpus surfaces one, it is `E-PARSER-OUT-OF-SUBSET` (report to PA). | 9-18h | M3.1 |
| **M3.3** | **Functions/classes + in-line bodies (subsumes BPP) + import/export + try/throw.** Function declarations + expressions, bodies parsed IN-LINE via M3.1's statement-list parser — THE BPP subsumption (`body-pre-parser.ts` deletes by construction). `async`/`await`; `function*` / `yield` / `yield*` generators. Class declarations + expressions. `import`/`export` (named / default / namespace / re-export). `try`/`catch`/`finally`+`throw` — parsed for legacy + JS-import inputs (a later stage rejects them in scrml source). | 10-20h | M3.1 |
| **M3.4** | **Error-recovery engine integration + full statement conformance.** Wire statement-level panic-mode recovery into M1's `ErrorRecovery` engine — accumulate skipped tokens, re-synchronize on `;` / statement-start keywords / closing braces. Conformance: Tier 1+2 PASS on the FULL statement subset of the conformance corpus. S98 D7 M3 mutual-recursion gating clause — `fn`-form parse-function mutual recursion works (SPEC §48.6.4) OR `function`-form with a documented refactor-to-`fn` TODO. | 6-14h | M3.2 + M3.3 |

---

### §3.3 MK3 — `BodyMode` + `DisplayTextLiteral` (§4.18 quoted-text) (DECOMPOSED S113 — DISPATCH-READY)

**Decomposed S113** (PA, from charter dive Q1.D `BodyMode` sketch + Q1.E
`DisplayTextLiteral` sketch + Q3 §4.18 mapping + Q4.B; SPEC §4.18). MK3's turn in the
markup chain — MK1 + MK2 ✅ complete; M2 (the JS expression parser MK3.3's interpolation
delegates to) ✅ complete.

**Goal (charter Q4.A MK3 gating):** every SPEC §4.18 worked example parses correctly;
`E-UNQUOTED-DISPLAY-TEXT` fires per §4.18.7; a display-text literal with interpolation
produces ONE AST node per §4.18.4. This is the milestone that implements §4.18 natively
— the paused quoted-text BS-retrofit becomes unnecessary.

**Scope boundary:** MK3 is §4.18 — the code-default body MODE + the `"..."` display-text
literal. It is NOT the markup↔JS seam (MK4). MK3.3's `${...}` interpolation delegates to
M2's JS expression parser via the established delegation pattern; the full seam contract
(cross-seam errors, re-tokenizer-scaffolding deletion) is MK4.

**Inputs:** charter dive Q1.D (`BodyMode` — 2-variant; `.CodeDefault` is a composite
state-child carrying `DisplayTextLiteral`) + Q1.E (`DisplayTextLiteral` — 3-variant:
Outside / InLiteralText / InInterpolation) + Q3.A (the §4.18-sub→construct mapping) +
Q3.B (worked-example trace). SPEC §4.18 (§4.18.1-§4.18.9 — the normative definition;
read IN FULL via SPEC-INDEX). R1 seam punch-list P6 (reuse the M1 template-literal
engine shape) + P7 (thread `bodyMode` into delegation frames). MK2's `tag-frame` (the
`bodyMode` payload field, currently null) + `parse-markup` + `block-context` are the
substrate. M1's template-literal engine (`lex-mode.scrml`'s `InTemplateBody`
nested-engine) is the shape MK3.3 reuses.

**File ownership (new files under `compiler/native-parser/`):** `body-mode.scrml`/.js +
`display-text-literal.scrml`/.js. MK3 EXTENDS `parse-markup` + `tag-frame` (populates the
`bodyMode` payload) + `block-context` (**K1** — the `.InMarkupTag` forward-ref to
`<engine for=BodyMode>` RESOLVES when MK3.1 lands `BodyMode`). MK3 does NOT touch the
JS-layer files (M*).

| Sub-step | Scope | Est. | Depends |
|---|---|---|---|
| **MK3.1** | **`BodyMode` engine + `DisplayTextLiteral` engine skeleton + body-mode establishment + P7.** `body-mode.scrml`/.js — `type BodyMode:enum = {FreeText, CodeDefault}` + `<engine for=BodyMode initial=.FreeText>` (`.CodeDefault` is a composite state-child per Q1.D). `display-text-literal.scrml`/.js — `type DisplayTextLiteral:enum = {Outside, InLiteralText, InInterpolation}` + the `<engine>` decl SKELETON (the literal-scanning logic is MK3.2). Body-mode ESTABLISHMENT — a body is `.CodeDefault` iff its opening tag is an `<engine>`/`<match>` state-child or a `:`-shorthand body (consult MK2's `TagKind`/`TagClass`); plain-markup bodies stay `.FreeText` (§4.18.1). Populate `tag-frame`'s `bodyMode` payload (currently null). Punch-list **P7** — thread `bodyMode` into every markup→JS `DelegationFrame`. Declare the `DisplayTextLiteral` AST node kind (distinct from `TextNode` per §4.18.8). **Resolves roadmap §4.4 K1.** | 6-13h | MK2 ✅ |
| **MK3.2** | **`DisplayTextLiteral` literal scanning (non-interpolation).** `display-text-literal`'s `Outside`/`InLiteralText` logic: `"` opens (→`.InLiteralText`) / closes (→`.Outside`); `\"`/`\\`/`\${` escapes consumed within `InLiteralText`; whitespace accumulated VERBATIM into the text segment (§4.18.5); `'` and `` ` `` are ordinary characters — no transition (§4.18.3). Emit the `DisplayTextLiteral` AST node with its text segment(s). Unterminated literal → `E-CTX-001` against the opening `"` (SPEC §4.18 recovery, lines ~1159/1237 — verify in-spec before encoding). | 6-13h | MK3.1 |
| **MK3.3** | **`${...}` interpolation + `E-UNQUOTED-DISPLAY-TEXT` + §4.18 conformance close.** `DisplayTextLiteral.InInterpolation` — a composite state-child; `${` opens an interpolation that delegates to M2's JS expression parser (punch-list **P6** — reuse the M1 template-literal engine shape; the matching `}` returns to `.InLiteralText`). A literal with interpolations produces ONE `DisplayTextLiteral` node (`{segments, exprs}` — the §4.18.4 / D3 `Template`-node shape). **`E-UNQUOTED-DISPLAY-TEXT`** (§4.18.7) — fires as a parse OUTCOME: in a `.CodeDefault` body, a bare run that is neither valid code nor a `"..."` literal fails the parse → emit `E-UNQUOTED-DISPLAY-TEXT` + the "did you mean `\"...\"`" suggestion. Conformance: every SPEC §4.18 worked example parses; a regression test for `E-UNQUOTED-DISPLAY-TEXT`. | 6-12h | MK3.2 |

---

- **M3 — JS statement parser** — ✅ DECOMPOSED S113 into M3.1 / M3.2 / M3.3 / M3.4; see §3.2 above.
- **M4 — full bounded JS subset.** All D5 MUST PARSE + MUST ADD; `preprocessForAcorn`
  regex cascades NOT NEEDED. Gating: Tier 1+2 full corpus; Tier 3 spans PASS-with-deltas.
- **MK2 — `TagFrame` engine** — ✅ DECOMPOSED S113 into MK2.1 / MK2.2 / MK2.3; see §3.1
  above. (Blocked-precondition OQ-2/R3 §4.18.1/§40.8 program-body mode was RESOLVED S111
  `78faa65` — `default-logic` is a distinct THIRD body-mode; MK2 honors all three modes.)
- **MK3 — `BodyMode` + `DisplayTextLiteral`** — ✅ DECOMPOSED S113 into MK3.1 / MK3.2 / MK3.3; see §3.3 above.
- **MK4 — markup↔JS seam.** Lift R1 spike §3 as the contract; punch-list P8/P9/P10/P11
  (incl. the deep-nesting smoke test). Re-tokenizer scaffolding deleted. Needs M3/M4.
- **M5 — pipeline swap behind `--parser=scrml-native`** + canary soak.
- **M6 — joint retirement.** Delete BS + Acorn + BPP + re-tokenizer scaffolding; retire
  the flag; native parser self-hosts its own `.scrml` source (charter Q8).

---

## §4 Cross-cutting

### §4.1 R1 seam spike punch-list (P1-P13) → milestone mapping

| P# | Item | Lands at |
|---|---|---|
| P1 | Build the markup layer on the shared `makeParseContext` (one cursor / brackets / recovery / errors / node sink + `delegationStack`) | **MK1.1** |
| P2 | State the one-cursor invariant as a hard brief constraint | **MK1.1** (every MK brief) |
| P3 | `BlockContext.InLogicEscape` as a §51.0.Q.1 composite state-child / `DelegationFrame` push | **MK1.2** |
| P4 | `markupValueAllowedAfter(lastKind)` discriminator in the JS layer's `InCode` dispatch | **MK2** |
| P5 | `TagFrame` exposes stack depth (for `CloseCondition.TagFrameBalanced`) | **MK2** |
| P6 | `DisplayTextLiteral.InInterpolation` reuses the M1 template-literal engine shape | **MK3** |
| P7 | Thread `bodyMode` into every markup→JS `DelegationFrame` | **MK3** |
| P8-P11 | Seam contract (R1 §3); cross-seam error rules; re-tokenizer-scaffolding deletion framing; deep-nesting smoke test | **MK4** |
| P12 | Anomaly A1 already reconciled (IMPLEMENTATION-ROADMAP SUPERSEDED banner) | done — no action |
| P13 | OQ-2/R3 SPEC clarification | done S111 (`78faa65`) |

### §4.2 Conformance

Acorn-as-oracle (S98 D6). JS layer: conformance test exists from M1
(`compiler/tests/parser-conformance-lexer.test.js`) — M2+ extend it to AST-level Tier
1+2. Markup layer: NEW harness diffing the markup block-stream against the current BS
block tree (charter Q4.B cross-cutting line, 8-18h — folded into MK1.3 + extended each MK).

### §4.3 Interim BS posture

**Option I-B** (case-by-case patching) per charter Q6.B. The live BS keeps its
code-bearing-body misclassification bug class for the whole arc; patch specific bugs as
they surface. **Do NOT** pre-invest the ~65h Option I-A throw-away fix. Trigger to
reconsider I-A: 2+ distinct code-bearing-body misclassification bugs block delivery
within one quarter.

### §4.4 Known issues surfaced during implementation

| # | Issue | Surfaced | Disposition |
|---|---|---|---|
| K1 | `block-context.scrml`'s `.InMarkupTag` composite state-child forward-referenced `<engine for=BodyMode>` — `BodyMode` was MK3's type, not yet declared; a single deliberate `.scrml` compile error (E-ENGINE-004). | MK1.1 | ✅ **RESOLVED S113 (MK3.1)** — `body-mode.scrml` landed; `block-context.scrml` imports `BodyMode` — 0 E-ENGINE-004 (was 1). |
| K2 | Pre-existing M1 bug: `lex-in-code.scrml` ↔ `lex-in-regex.scrml` circular import (E-IMPORT-002); `lex-in-code.scrml`'s aliased imports (`import { push as pushBracket }`) trip E-SCOPE-001 under the v0.3 compiler. Blocks ALL native-parser `.scrml` from compiling cleanly (verified identical on M1's untouched `lex.scrml`). The `.js` shadows are unaffected; the full test suite passes. | MK1.1 (pre-existing in M1) | M1 follow-up — NOT in the README ANOMALY list. Must be fixed before M6 (the native parser self-hosts its `.scrml` source at M6 — charter Q8). Non-blocking for M2-M4 / MK1-MK4 (the `.js` shadows execute). |
| K3 | M1 lexer compound-assignment maximal-munch gap: `lex-in-code` lexes only 4 compound-assign operators (`+= -= *= /=`) as single tokens; the other 11 (`%= **= <<= >>= >>>= &= \|= ^= &&= \|\|= ??=`) lex as two adjacent tokens. M2.2 re-composes the 11 at the parse layer from source-adjacent token pairs — AST-equivalent to Acorn. | M2.2 | M1.x cleanup — the canonical fix is M1's lexer doing maximal-munch for the 11 + the corresponding `token.scrml` kinds. Non-blocking (the parse-layer re-composition is correct, verified vs Acorn). Sequence alongside M1.5. |
| K4 | M1 lexer optional-chain gap: M1 lexes `.ident` after `?` as a `BareVariant`, so `a?.b` lexes as `Ident Question BareVariant`. M2.3 re-composes `?.ident` at the parse layer (same class as K3). | M2.3 | M1.x cleanup — the canonical fix is M1 lexing `?.` as a single token. Non-blocking (parse-layer re-composition is AST-equivalent to Acorn, verified). Sequence alongside K3 + M1.5. |
| K5 | M1 lexer gaps surfaced by M2.4: (a) `#` has no lex branch — it hits the "Unknown — skip" path emitting no token, so `<#id>` lexes as `LessThan Ident GreaterThan` with a 1-char span gap; (b) a standalone `~` lexes as `BitNot`; (c) `::` lexes as two adjacent `Colon` tokens. M2.4 re-composes all three at the parse layer (same class as K3/K4 — AST-equivalent, verified vs all 11 forms). | M2.4 | M1.x cleanup — canonical fix is M1 lexing `<#`-recognition + a standalone-`~` `Tilde` token + a `::` `DoubleColon` token. Non-blocking (parse-layer re-composition verified). Sequence alongside K3/K4 + M1.5. |
| K7 | M1 lexer prototype-pollution: `makeIdentOrKeyword` did a bare `JS_KEYWORDS[text]` lookup — `JS_KEYWORDS` is a plain object, so an identifier named `constructor`/`toString`/`valueOf`/`hasOwnProperty`/`__proto__` (12 Object.prototype names) resolved to the inherited member instead of `undefined`, mis-lexing it to a non-string token kind. Surfaced by M3.3 (`class C { constructor() {} }`). | M3.3 | ✅ **FIXED S113 (M3.3)** — `Object.prototype.hasOwnProperty.call(JS_KEYWORDS, text)` own-property guard in `token.scrml`/.js. Canonical lexer-side fix; no M1.x follow-up needed (unlike K3/K4/K5, which remain parse-layer re-compositions). |
| K6 | Binding-pattern vs param-pattern divergence: M2.3's `parseParamTarget` parses a function-PARAM destructuring pattern as a STAND-IN (an `ast-expr` Object/Array LITERAL node — a documented M4-deferred ESTree-divergence); M3.1's variable-declaration destructuring builds REAL binding patterns (`ast-stmt`'s `BindingKind` catalog — `ObjectPattern`/`ArrayPattern`, the ESTree left-of-`=` shape). At HEAD the native parser has two destructuring surfaces. | M3.1 | M4 cleanup — `parseParamTarget` should call `parseBinding` once a function param IS recognized as a declaration target. Non-blocking for M3.x (both surfaces are internally consistent + Acorn-verified on their own inputs). |

---

## §5 Progress tracker

| Milestone / sub-step | Status | Dispatch | Landed | Notes |
|---|---|---|---|---|
| M1 (lexer) | ✅ COMPLETE | — | S99-S103 | M1.1-M1.4; 7 LexMode state-children substantive |
| M1.5 — expr-literals.js conformance flip | ⬜ pending | — | — | regex-token normalizer (native `RegexLit` vs Acorn's regex-token surface); minor polish, non-blocking M2 |
| **M2.1** substrate + ParseMode + primary | ✅ landed S112 | scrml-js-codegen-engineer (worktree) | S112 | parse-mode + ast-expr + token-cursor + parse-expr (.scrml+.js) + parser-conformance-expr.test.js; +114 conformance tests (Tier 1+2 vs Acorn); full suite 16,327/0 |
| M2.2 operators | ✅ landed S112 | scrml-js-codegen-engineer (worktree) | S112 | precedence-climbing core — binary/logical/unary/update/assignment/conditional/sequence; +212 conformance tests (Tier 1+2 vs Acorn + Tier-4 structural); full suite 16,539/0 |
| M2.3 call/member/arrow-heads | ✅ landed S112 | scrml-js-codegen-engineer (worktree) | S112 | call/member/computed-member/optional-chain/new/tagged-template/arrow-head/function-expr; this/super atoms; block bodies → BlockStub (M3 seam); +191 conformance tests; full suite 16,775/0. M2.1-M2.3 landed; M2.4 (scrml-extension expr forms) remains. |
| **M2.4** scrml-extension exprs | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | 11 forms — bare-variant / is-family / not-value / match / ~ / ?{} / <#id> / render / lift / fail / ::; M2 gating MET (9-class preprocessForAcorn regression block); +61 conformance tests; full suite 16,901/0. **M2 ladder (M2.1-M2.4) COMPLETE.** |
| **MK1.1** shared ctx + BlockContext skeleton | ✅ landed S112 | scrml-js-codegen-engineer (worktree) | S112 | parse-ctx + block-context + parse-markup (.scrml+.js); makeParseContext (node sink + delegationStack) + 9-variant BlockContext engine + trampoline; skeleton step, full suite 16,213/0 |
| MK1.2 context-boundary recognition | ✅ landed S112 | scrml-js-codegen-engineer (worktree) | S112 | 7 block-opener sigils + brace-depth closing + `<ident` boundary + `.InLogicEscape` DelegationFrame push; nested-context stack; +45 unit tests; full suite 16,372/0 |
| MK1.3 comments + sub-context stubs + conformance | ✅ landed S112 | scrml-js-codegen-engineer (worktree) | S112 | structural `//` + `<!-- -->` comment recognition (BS heuristics #6/#7 eliminated); 5 sub-context sketch-depth dispatchers; markup block-tree conformance harness vs the block-splitter oracle (D-1..D-4 divergences documented); +65 tests; full suite 16,649/0. **MK1 ladder complete.** |
| **MK2.1** TagFrame engine + opener recognition + TagKind | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | tag-frame.scrml/.js — TagFrame 3-variant engine + TagKind calc + §4.15/§24.4 structural registry + one-pass opener tokenizer + recognizeOpener; block-context + parse-markup extended to dispatch TagFrame at .InMarkupTag. Markup conformance suite 163/0 (+~50 MK2.1 tests, 6 describe blocks). Agent stalled mid-test-write — PA crash-recovery salvage (missing `advance` import). |
| **MK2.2** closer forms + tag-tree pairing + mismatch recovery | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | 3 closer forms (`</>`/`</name>`/`/>`) recognized structurally + `TagFrame` `rule=` push/pop pairing + mismatch recovery (E-MARKUP-002); BS heuristic #5 (`scanCompoundBlockEnd`) eliminated, #12 (`looksLikeCloser`) confirmed absent; D-4 `<tag>`-tree divergence RESOLVED (full-tree-equivalence vs the BS oracle); +61 conformance tests; full suite 17,158/0. Fixed a logic-escape tag-lifetime bug in flight (`aae3b4c`). |
| **MK2.3** TagKind classification + P4/P5 + conformance | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | TagClass enum + classifyTag (eliminates BS classifier heuristics #1/#4 — recursion → typed-payload read) + P4 `markupValueAllowedAfter` + P5 `tagFrameBalancedAt`; +51 conformance tests; full suite 17,335/0. **MK2 MILESTONE COMPLETE** — all 5 BS classifier heuristics demonstrably gone (regression test per heuristic). |
| **M3.1** statement substrate + declarations + BlockStub re-entry | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | ast-stmt (Stmt AST catalog) + parse-stmt (statement-list parser) + parse-mode `.InBlock` variant; let/const/var + destructuring binding patterns + block/expr/empty statements + uniform BlockStub re-entry (M2.3+M2.4 bridge); +143 conformance tests (Acorn-oracle); full suite 17,097/0. |
| **M3.2** control-flow statements | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | if/else (+else-if, dangling-else) + while + do-while + for (C-style/in/of + for-await-of) + return/break/continue (no-LineTerminator restricted production) + labels; `forHeadKind` for-head disambiguator (parse-expr NOT touched — noIn-flag threading is M4); +126 tests; full suite 17,284/0. |
| **M3.3** functions/classes + in-line bodies (subsumes BPP) + import/export + try/throw | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | FunctionDecl/ClassDecl/Import/Export/Try/Throw constructors + parsers; function bodies parsed IN-LINE (BPP subsumable — `body-pre-parser.ts` deletes by construction at M6); async/yield at statement position; +185 tests; full suite 17,556/0. Fixed K7 (M1 lexer prototype-pollution) in flight. |
| M3.4 error-recovery integration + conformance | ⬜ pending | — | — | §3.2 — depends M3.2+M3.3 |
| **MK3.1** BodyMode + DisplayTextLiteral skeleton + body-mode establishment + P7 | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | body-mode + display-text-literal (skeleton) engine files; body-mode establishment (per §4.18.1's 3 code-bearing loci) + tag-frame `bodyMode` payload + P7 DelegationFrame threading + `DisplayTextLiteral` block kind; **K1 RESOLVED**; +36 tests; full suite 17,371/0. |
| **MK3.2** DisplayTextLiteral literal scanning (non-interpolation) | ✅ landed S113 | scrml-js-codegen-engineer (worktree) | S113 | `scanDisplayTextLiteral` — `"..."` open/close, `\"`/`\\`/`\${` escapes, verbatim whitespace, the `{segments, exprs}` AST node, unterminated → E-CTX-001; +53 tests; full suite 17,609/0. (Surfaced a SPEC §4.18.3/§4.18.4 escape-count inconsistency — implemented the 3-escape union; see hand-off.) |
| MK3.3 ${...} interpolation + E-UNQUOTED-DISPLAY-TEXT + §4.18 conformance | ⬜ pending | — | — | §3.3 — depends MK3.2 |
| M4 / MK4 / M5 / M6 | ⬜ pending | — | — | decompose when scheduled (§3) |

**Legend:** ⬜ pending · ⏳ in flight · ✅ complete · 🟥 blocked
