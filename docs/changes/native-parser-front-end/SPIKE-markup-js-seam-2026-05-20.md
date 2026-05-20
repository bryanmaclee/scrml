---
tags: [spike, compiler, native-parser, charter-b, markup-js-seam, mk4, scrml-native, s111]
status: draft-for-PA-review
date: 2026-05-20
session: S111
authored_by: scrml native-parser charter-B R1 seam scoping spike (agent dispatch from PA)
audience: PA (reviews + commits) + the MK-milestone implementation briefs
charter: native-parser whole-front-end (charter B, ratified S111)
de_risks: Q9 R1 (the markup↔JS seam — the dive's single highest-risk design area) + MK4
predecessors:
  - scrml-native-parser-front-end-charter-2026-05-20.md (the charter dive — Q1.A architecture verdict, Q9 R1/R5/R6, OQ-3, Q4 MK-ladder)
  - scrml-native-parser-design-2026-05-17.md (S98 DD — D2 JS-layer engine graph, D4 P3/P5/P6 primitive inventory)
feeds_into: MK4 implementation brief; the MK1/MK2/MK3 briefs (punch-list items)
---

# SPIKE — the markup↔JS seam contract

**A READ-ONLY pre-implementation scoping spike.** No compiler source was modified.
This spike scopes the **markup↔JS seam** — the delegation boundary between the markup
engine-graph and the JS engine-graph in the charter-B separate-graph architecture —
which the charter dive (Q9 R1) flagged as the single highest-risk design area, and
which is the least-confident line item of the MK4 estimate.

**Scope (the brief's 5 questions):**
1. The seam contract — both directions (markup→JS and JS→markup), and the handoff data shape.
2. Is §51.0.Q.1 sufficient for the deep, mutually-recursive nesting the seam needs?
3. Define the seam contract precisely enough to de-risk MK4.
4. Language-primitive gap? Flag it if found (escalates to a sub-deep-dive per the charter dive).
5. Tighten the MK4 estimate (the dive's 22-48h; the seam is its least-confident part).

**Out of scope:** relitigating the Q1.A separate-graph verdict (settled — prior-art-unanimous);
the S98 JS-layer design; writing source. The spike takes the charter dive as the locked input.

---

## 0. The thing being scoped — what the seam IS

Charter-B architecture (dive Q1.A): **two composed-engine graphs.** A markup-layer
graph (`BlockContext` / `BodyMode` / `TagFrame` / `DisplayTextLiteral` — dive Q1.B-F)
sitting ABOVE the JS-layer graph (`LexMode` / `ParseContext` / `BracketStack` /
`ErrorRecovery` — S98 D2; M1 lexer complete). The markup layer delegates JS-bearing
bodies DOWN to the JS layer.

The **seam** is the delegation boundary. It is **bidirectional**:

- **markup → JS** — the markup parser hits a JS-bearing body (a `${...}` logic escape,
  a function/`fn`/`pure` body, an attribute expression `onclick=${...}`, a
  `:`-shorthand body, a `^{}` meta body, a `${...}` interpolation inside a `"..."`
  display-text literal). It hands that body to the JS layer.
- **JS → markup** — markup-as-value (Pillar 1). A `<div>` literal can appear *inside*
  a JS expression: `const card = <div class="x">...</div>`, `renders <p>${email}</p>`,
  `lift <wrapper><Component/></wrapper>`. When the JS layer, parsing an expression,
  hits a `<` that opens a markup element, it must delegate BACK UP to the markup layer.

So the seam is **mutually recursive**: markup → JS → markup-as-value → JS → markup → …
The §4.18.4 case (`${...}` interpolation inside a `"..."` literal, inside an engine
state-child body) stacks it the deepest the dive names — markup → `${}` logic → (the
literal is markup-layer) → `${}` interpolation → JS — and a markup-as-value inside that
interpolation re-enters the markup layer again.

**Why this is the highest-risk area** (dive R1): a separate-graph architecture puts a
*contract* at this boundary. If the contract is under-specified, the two graphs drift:
span-attribution bugs across the seam (the classic layered-parser failure), error-stream
ownership ambiguity, AST-shape mismatches at the handback. M1 validated the §51.0.Q.1
nested-engine *mechanism* at ONE level (template-literal interpolation, JS→JS). The seam
is a NEW boundary (markup↔JS), nested deep and mutually. This spike's job is to make the
contract concrete before MK4 reaches it.

---

## 1. The seam contract — both directions

### 1.0 The decisive precedent: M1's `lex-in-template.scrml` already IS a seam

The brief says study M1's nested-engine mechanism as "the existing precedent for
cross-layer delegation." It is more than a precedent — it is a *working seam*, just
JS→JS instead of markup↔JS. The contract below is **generalized directly from it**, so
the seam is not a green-field design — it is the M1 mechanism lifted one layer up.

M1's template-interpolation seam (verified in `lex-in-template.scrml` +
`lex-in-code.scrml` + `lex.scrml`), restated as a contract:

| M1 seam element | What it does | Source |
|---|---|---|
| `ctx` — the single shared context object | `{ tokens, currentMode, brackets, recovery, templateStack }`. Cursor passed alongside. BOTH the outer and inner LexMode dispatch over the **same `ctx` and the same `cursor`**. | `lex.scrml:56` `makeLexContext` |
| `templateStack` — a frame stack | Each `${` open pushes a frame; each matching `}` pops. The stack IS the §51.0.Q.1 inner-engine instance hierarchy materialized. | `lex-in-template.scrml:88` `pushTemplateFrame` |
| frame payload = `{ bracketDepthAtOpen }` | The single datum that lets the inner scan know where it ends: the `BracketStack` depth recorded AT THE OPEN. | `lex-in-template.scrml:88-91` |
| `isTemplateInterpClose(cursor, ctx)` — the boundary predicate | "Is the `}` under the cursor the close of this delegation?" — true iff mode is `InCode`, a frame exists, AND `depth(ctx.brackets) == frame.bracketDepthAtOpen`. | `lex-in-template.scrml:119-126` |
| mode-switch on cross | `${` → `setMode(InCode)` (delegate down); matching `}` → `setMode(InTemplateBody)` (return up). | `lex-in-template.scrml:146`, `:252` |
| no copying — one cursor advances | The inner scan advances the *same cursor*; positions stay in one coordinate space; spans never need translation. | `lex.scrml:74` `cursor` is created once |

**The load-bearing observation:** M1's seam does **not** hand the inner engine a
sub-range or a sub-stream. It hands it **the same cursor and the same `ctx`**, plus a
**depth marker** (`bracketDepthAtOpen`) that tells the inner scan when it has reached
its own end. The "sub-range" is *implicit* — it is "from here until the close-predicate
fires." This is the answer to the brief's "cursor sub-range? token sub-stream? character
span?" question, and §1.1 below adopts it.

### 1.1 markup → JS — what the markup parser hands the JS layer

**Decision: hand the JS layer the shared cursor + the shared parser context + a
delegation frame. NOT a copied sub-range, NOT a sliced token sub-stream, NOT a detached
character span.** This is M1's mechanism, generalized.

The handoff is an in-place, same-buffer delegation:

```
SEAM HANDOFF — markup → JS  (the "delegate down" direction)

  delegateToJs(cursor, ctx, frame) :
    inputs handed across the seam:
      cursor   — the SAME character cursor the markup layer was advancing.
                 Already positioned just past the opener ( ${ / { / : / etc. ).
                 The JS layer advances this same cursor.
      ctx      — the SAME shared parser context. Carries: the token sink,
                 the BracketStack engine, the ErrorRecovery engine, the
                 markup-layer frame stacks, AND a new jsDelegationStack.
      frame    — a JsDelegationFrame pushed onto ctx.jsDelegationStack:
                 {
                   kind        : .LogicEscape | .FunctionBody | .AttrExpr
                                 | .ShorthandBody | .MetaBody | .Interpolation
                   closeOn     : the close condition for THIS delegation —
                                 a CloseCondition value (see below)
                   openSpan    : Span of the opener token (${ / { / : / ^{ )
                   bodyMode    : the §4.18 BodyMode in effect at the open
                                 (code-default vs free-text) — threaded so the
                                 JS layer knows display-text rules
                 }

  CloseCondition — the datum that says "this delegation ends HERE":
    .BraceDepth(depthAtOpen: int)   — for ${} / ^{} / function-body / interp:
                                       close when BracketStack depth returns to
                                       depthAtOpen AND the cursor is at `}`.
                                       (This IS M1's bracketDepthAtOpen, named.)
    .AttrTerminator                  — for onclick=${...} the .BraceDepth form
                                       applies; for a bare-call attr value the
                                       close is the attribute boundary (ws / >).
    .ShorthandEol                    — for `: <expr>>` the close is the opener's
                                       closing `>` at tag-attr-depth 0.
```

**What comes back — the handback shape.** When the close condition fires, the JS layer
returns control to the markup layer with:

```
SEAM HANDBACK — JS → markup  (control returns up)

  the JS layer does NOT "return an AST subtree" as a copied value.
  It returns by:
    1. having appended its produced nodes (expression / statement AST) into
       the shared ctx — the SAME sink the markup layer reads from. The markup
       layer's current open node (the LogicBlock / FunctionDecl / AttrNode)
       adopts those nodes as its body/children.
    2. leaving the cursor positioned just past the close token (the `}` / `>`).
    3. popping its JsDelegationFrame off ctx.jsDelegationStack.
    4. the consumed Span is span(frame.openSpan.start .. cursor.pos) — the
       markup layer reads cursor.pos to close its own enclosing node's span.
```

So the handback is: **(a) nodes already in the shared sink, (b) a cursor advanced
past the close, (c) a frame popped.** The "span + node" the brief asks about is
exactly this — the node is in the sink, the span is `[openSpan.start, cursor.pos)`.

**Why same-cursor / shared-ctx and not a copied sub-range** — four reasons, each
grounded:

1. **It is what M1 does and M1 ships.** `lex-in-template.scrml` proves the shared-cursor
   delegation works. A copied-sub-range design would be a *new* mechanism the project
   has no precedent for — exactly the risk R1 warns against. Reuse the proven shape.
2. **Spans compose for free.** The dive's R1 names "span-attribution bugs across the
   seam" as the classic failure. With one cursor over one buffer, every Span the JS
   layer produces is *already* in the file's coordinate space — there is no offset to
   add, no translation step, hence no translation bug. A copied sub-range would force
   every inner Span to carry a base-offset and every diagnostic to un-translate it;
   that is the bug class, designed in. **One cursor eliminates the R1 span-bug class by
   construction** — the same way M1's one-cursor design did.
3. **The BracketStack is shared, so the close predicate is trivial.** The close of a
   `${...}` is "BracketStack depth back to the open depth at a `}`." That predicate
   (`isTemplateInterpClose`, M1) only works because the *same* BracketStack counts
   braces across the seam. A sub-stream with its own bracket counter would re-derive
   depth and risk drift.
4. **Markup-as-value (§1.2) needs it.** The JS→markup direction re-enters the markup
   layer mid-expression; the markup layer must continue on the *same* cursor where the
   JS layer left off. A copied-sub-range model would have to copy *back* — incoherent.

### 1.2 JS → markup — markup-as-value, the delegate-BACK-UP direction

When the JS layer is parsing an expression and the cursor hits a `<` that opens a markup
element (Pillar 1 markup-as-value: `const c = <div/>`, `renders <p>...</p>`,
`lift <wrapper>...</wrapper>`, `<x/>` render-by-tag in expression position), the JS
layer delegates **back up** to the markup layer.

This is the mirror of §1.1, same mechanism:

```
SEAM HANDOFF — JS → markup  (the "delegate up" direction)

  delegateToMarkup(cursor, ctx, frame) :
    cursor   — the SAME cursor; positioned AT the `<` of the element opener.
    ctx      — the SAME shared ctx.
    frame    — a MarkupDelegationFrame pushed onto ctx.markupDelegationStack:
                 {
                   kind     : .ElementValue   — a <tag>...</> as an expression
                   closeOn  : .TagFrameBalanced(tagDepthAtOpen: int)
                              — close when the TagFrame stack returns to the
                              depth recorded at the open (the markup element
                              and all its children are consumed).
                   openSpan : Span of the `<`.
                 }

  HANDBACK (markup → JS, control returns down):
    1. the markup layer has appended the MarkupElement node into the shared
       ctx sink — the JS layer's current expression node adopts it as a
       markup-typed operand.
    2. cursor positioned just past the element's close ( </> / </name> / /> ).
    3. MarkupDelegationFrame popped.
    4. consumed Span = [openSpan.start, cursor.pos).
```

**The discriminator — when does `<` open a markup element vs. mean less-than?** This is
a JS-layer-internal decision, NOT a seam decision, and it is already a solved shape: it
is the same class as M1's regex-vs-division decision (`regexAllowedAfter(lastKind)` —
S98 D4 P3, live in `lex-in-code.scrml`). A `<` is a markup-element opener when the
previous token is one after which a *value* is expected (`=`, `(`, `,`, `return`,
`renders`, `lift`, `=>`, `[`, a binary operator, start-of-body) AND the character after
`<` is an ASCII letter/`_` with no whitespace (the markup-opener shape, BS line 1618) or
whitespace-then-letter (the state-opener shape). Otherwise `<` is `LessThan`. This is
`markupValueAllowedAfter(lastKind)` — a bounded, prev-token calculation, the exact twin
of `regexAllowedAfter`. **It is bounded lookahead, not backtracking** — so S98 OQ3's
verdict holds (see §3.4). It belongs in the JS layer's `InCode` dispatch, parallel to
the regex decision; the spike flags it for the MK4 brief but it is not a seam-contract
obligation.

### 1.3 The unified seam contract — one mechanism, two directions

Both directions are the SAME mechanism with the role of "host" and "guest" swapped:

| Contract element | markup→JS | JS→markup |
|---|---|---|
| What crosses | shared `cursor` + shared `ctx` + a delegation frame | identical |
| The frame's payload | `kind`, `closeOn` (CloseCondition), `openSpan`, `bodyMode` | `kind`, `closeOn`, `openSpan` |
| The close-condition datum | `.BraceDepth(depthAtOpen)` (= M1's `bracketDepthAtOpen`) | `.TagFrameBalanced(tagDepthAtOpen)` |
| Where produced nodes go | the shared `ctx` node sink | the shared `ctx` node sink |
| The handback Span | `[frame.openSpan.start, cursor.pos)` | identical |
| Cleanup on cross-back | pop the delegation frame | pop the delegation frame |

**Stated as one paragraph (the brief's requested one-paragraph summary):**

> The markup↔JS seam is an in-place, single-buffer, mutually-recursive delegation —
> not a copied sub-range. Whichever layer hits a body governed by the other layer
> pushes a typed delegation frame onto a shared context, then dispatches the other
> layer's engine graph over the *same cursor* and *same context*; the frame carries a
> close-condition datum (a `BracketStack`-depth marker for `${}`-shaped bodies, a
> `TagFrame`-depth marker for markup-as-value) that tells the guest layer exactly when
> its body ends; the guest layer appends its produced AST nodes into the shared sink,
> advances the shared cursor past its close token, and pops its frame, at which point
> the host layer resumes — the consumed span being `[openSpan.start, cursor.pos)`.
> This is M1's `lex-in-template.scrml` template-interpolation mechanism (a working
> JS→JS seam) generalized one layer up; because there is one cursor over one buffer,
> every span the guest produces is already in the file's coordinate space, which
> eliminates the cross-seam span-attribution bug class (the dive's R1 worst case) by
> construction.

### 1.4 Error propagation across the seam

The dive's R1 names "the error-propagation-across-the-seam rule" as part of what the
spike must nail. The rule, grounded on the existing diagnostic-stream partition (the
memory note on `result.warnings` vs `result.errors`) and M1's design:

- **One ErrorRecovery engine, shared.** Per S98 D2 the JS layer has an `ErrorRecovery`
  engine. The markup layer (dive Q1.B) reuses the *same* `ErrorRecovery` engine pattern
  — and per this spike it is the **same instance**, carried in the shared `ctx`
  alongside `BracketStack`. Errors from either layer accumulate into one stream. There
  is no "JS error stream" vs "markup error stream" to reconcile — the shared-ctx design
  makes this a non-issue, the same way the shared `BracketStack` makes brace-counting a
  non-issue.
- **Error codes stay layer-namespaced, stream is shared.** A markup-layer error is
  `E-CTX-*` / `E-UNQUOTED-DISPLAY-TEXT` / `E-CLOSER-001`; a JS-layer error is
  `E-PARSE-*`. They land in the same `ctx`-held error array. Severity partition
  (W-/I- → non-fatal; everything else → fatal) is unchanged and orthogonal to the seam.
- **A delegation that hits EOF unterminated** — the guest layer's close condition never
  fires. The guest layer must, on EOF, emit its unterminated diagnostic (`E-CTX-001`
  for an unterminated `${}` per the dive's §4.18.3 `E-CTX-001`; the markup layer's
  unterminated-element `E-CTX-001`/`E-CTX-003`) against `frame.openSpan` — the opener
  is the right blame locus — and return control with the frame still flagged
  unterminated so the host layer does not mis-resume. M1's `terminator == "eof"` branch
  in `dispatchInTemplateBody` is the precedent: it leaves mode as-is and lets the
  EOF sentinel close the stream. The seam generalizes that: **on EOF inside a
  delegation, blame `frame.openSpan`, do not let the host layer treat the body as
  closed.**
- **ErrorRecovery panic-mode sync tokens are layer-specific.** When the JS layer is in
  `.AccumulatingSkipped`, its sync tokens are JS sync points (`;`, statement keywords,
  `}`). When the markup layer panics, its sync tokens are block-grammar sync points
  (the next closer, the next `<` opener). The shared `ErrorRecovery` engine's
  *current variant* is shared; *which tokens count as sync* is a function of which
  layer's dispatch is running — exactly as `LexMode` dispatch is layer-routed today.
  This is the one place the seam adds a small obligation on the MK4 brief: the
  re-sync sync-token set must be selected by the active delegation frame's owning
  layer. Bounded; noted in the punch-list.

---

## 2. Is §51.0.Q.1 sufficient? — the sufficiency verdict

**Verdict: §51.0.Q.1 is SUFFICIENT for the markup↔JS seam. No language-primitive gap.
The deep, mutually-recursive nesting the seam needs is exactly the composition
§51.0.Q.1 already defines — with two caveats that are MK-brief obligations, not
language gaps.**

### 2.1 The sufficiency argument — three grounds

**Ground 1 — the SPEC text grants nested engines FULL, identical semantics, with no
depth limit.** SPEC §51.0.Q.1 (read in full, lines 23578-23639): a composite
state-child's nested `<engine>` "has FULL engine semantics (own `for=` enum binding,
own `initial=`, own state-children … own auto-declared variable … own `.advance()`)."
SPEC-INDEX line 23137 verbatim: "nested engines have IDENTICAL semantics to file-scope
engines." Nothing in §51.0.Q.1, §51.0.Q.2, §51.0.Q.3, or §51.0.Q.4 states a nesting
depth limit. A markup `BlockContext.InLogicEscape` composite state-child whose body
contains the JS `LexMode` engine is *the literal §51.0.Q.1 form* — the only difference
from M1's `lex-mode.scrml` (where the inner engine shares the outer's `LexMode` enum)
is that the inner engine binds a *different* enum (`LexMode` inside `BlockContext`).
§51.0.Q.1's "own `for=` enum binding" explicitly sanctions a different inner enum — the
AppMode/PlayMode worked example (§51.0.Q.1 lines 23588-23611) nests `PlayMode` inside
`AppMode`, two different enums. So the markup→JS nesting is *more* canonical than M1's
(M1 nests the same enum; the seam nests different enums, which is the worked example's
exact shape).

**Ground 2 — "mutually recursive" reduces to "deeply nested," which §51.0.Q.1
covers.** The seam looks alarming because it is *mutually* recursive (markup → JS →
markup → JS …). But §51.0.Q.1 nesting is structural, not nominal: a composite
state-child's body is just a body, and a body can contain any `<engine>`. There is no
rule "engine A may not appear inside engine B if B already appears inside A." The
mutual recursion is just: the markup graph's `InLogicEscape` body contains the JS
graph; the JS graph's (new) `InMarkupValue` `LexMode`/`ParseContext` state-child body
contains the markup graph. Each nesting is an independent, well-formed §51.0.Q.1
composite. The *instances* stack at runtime (markup-instance → JS-instance →
markup-instance), and §51.0.Q.1's "outer × 1 = 1 inner instance" invariant means each
level is a clean single inner instance — the stack is well-defined, not a tangle.
**The runtime materialization of that instance stack is exactly M1's `templateStack`** —
generalized in §1.1 to `ctx.jsDelegationStack` + `ctx.markupDelegationStack` (or one
unified `delegationStack` of tagged frames). M1 proves a one-deep instance stack works;
§51.0.Q.1 grants the same semantics at every depth; the spike finds no reason the
proof fails to generalize.

**Ground 3 — M1 already runs a 2-level instance stack and the dive's "4-5 levels" is
the SAME mechanism iterated.** The dive's R5 worry is "4-5 levels is untested." Correct
— but the spike's finding is that depth is not a *new mechanism*, it is the *same*
mechanism (push a frame, dispatch the guest, pop on close-predicate) iterated. M1's
`lex-in-template.scrml` explicitly supports *nested templates* (`lex-in-template.scrml`
header: "nested templates produce stacked frames") — i.e. M1 *already* runs a
template-inside-template instance stack deeper than 2 when the source nests template
literals. The mechanism is depth-agnostic by construction (a stack). §51.0.Q.1 is
sufficient because the seam is "the M1 mechanism, on a stack, with two frame kinds
instead of one."

### 2.2 The two caveats — MK-brief obligations, NOT language gaps

The spike is obligated (brief Q4) to flag anything that *looks* like a gap. Two things
do, and both resolve to "specify it in the MK brief," not "spec a new primitive":

**Caveat A — the LIVE SURFACE, not the language, is what M1 actually nests.** Read
honestly: `lex-mode.scrml` declares the canonical nested `<engine>`, but the *executing*
code is the `.js` shadow + the `ctx.templateStack` array (per `native-parser/README.md`
ANOMALY-2 — the compiler v0.3 strips function bodies from `${...}`-escape SPA-shape
`.scrml` files, so the `.js` shadow is what runs). So at M1 the §51.0.Q.1 nesting is
*validated as a design shape and hand-realized as a frame stack* — the canonical
`<engine>`-nested-`<engine>` source is not itself executed until the M4+ self-host
swap. **This does NOT weaken the sufficiency verdict** — it means the seam, like M1,
will be *built as a frame-stack live surface* (`ctx.delegationStack`) carrying the
canonical §51.0.Q.1 SHAPE, and the deep-nesting question is therefore a question about
*a stack data structure*, which has no depth limit, rather than about an unproven
compiler feature. The caveat for the MK briefs: **MK1-MK4 build the seam as a
frame-stack live surface mirroring §51.0.Q.1, exactly as M1 built the
template-interp seam.** This is already the project's established pattern; the MK
briefs just need to say so explicitly so no one tries to land executable
deeply-nested `<engine>` source before the self-host swap.

**Caveat B — `E-CELL-OUT-OF-SCOPE` and inner-variable visibility are runtime-guard
concerns the seam never triggers.** §51.0.Q.1 says the inner engine's auto-declared
variable is reachable "only while the outer is in the composite state-child," and
`E-CELL-OUT-OF-SCOPE` (§34) polices that — but it is explicitly "deferred follow-on —
not fired in v0.next P1." The seam's frame-stack live surface side-steps this
entirely: the seam does not read inner-engine variables by canonical `@` access across
the boundary; it reads `ctx.delegationStack` frames, plain data. So the one
half-implemented corner of §51.0.Q.1 (`E-CELL-OUT-OF-SCOPE` runtime guard) is **not on
the seam's path**. No obligation; noted for completeness so the MK4 brief's author
does not go looking for a guard that the live-surface design makes moot.

### 2.3 What WOULD have been a gap — and why it is not

For the record (brief Q4 asks the spike to be explicit about the gap analysis): a
language-primitive gap *would* exist if the seam needed either of —

- **a spec'd parser-delegation contract / a "call another grammar here" primitive** —
  the thing tree-sitter's "language injection" is. The dive's R1 sub-dive trigger names
  exactly this ("if the seam needs a *language* primitive e.g. a spec'd
  parser-delegation contract, escalate"). **It does not.** §51.0.Q.1's composite
  state-child *is* scrml's "delegate to another engine graph here" construct. The seam
  is not a missing primitive; it is an *application* of the hierarchy primitive that
  S67 ratified and M1 proved. tree-sitter needs an injection primitive because its
  grammars are otherwise closed; scrml's engines compose by §51.0.Q.1 natively.
- **true backtracking** — if the markup↔JS handoff required speculative parse with
  rollback. **It does not** (see §3.4): every seam-cross decision is a bounded,
  prev-token or single-char calculation. S98 D4 P3's verdict ("bounded lookahead
  suffices; promote to a `lin`-typed snapshot only if a real need surfaces") holds, now
  re-confirmed for the markup layer.

Both candidate gaps resolve to "already covered." **The spike's Q4 finding: NO
language-primitive gap. No escalation to a sub-deep-dive is warranted.** The dive's R1
sub-dive trigger is not met.

---

## 3. The seam contract, specified to MK4 fidelity

This section is the deliverable the dive's OQ-3 asked for ("the exact hand-off data
shape, span-composition rule, cross-seam error-propagation rule"). MK4's brief can lift
this section directly.

### 3.1 The shared context — the seam's substrate

The seam is carried by ONE shared context object, extending M1's `makeLexContext`
(`lex.scrml:56`). The MK4 brief specifies it as:

```
ParseContext (the shared seam substrate — extends M1's lex ctx):
  tokens            : Token[]            — the shared token sink (M1)
  nodes / nodeSink  : the shared AST-node sink — whichever layer is active
                      appends produced nodes here; the host layer's open
                      node adopts them (NEW — M1 had only tokens; the
                      whole-front-end parser produces AST, so a node sink
                      is added)
  cursor            : Cursor             — the single shared cursor (M1; one
                      buffer, one coordinate space — §1.1 ground 2)
  brackets          : BracketStack       — the shared brace counter (M1) —
                      load-bearing for .BraceDepth close conditions
  recovery          : ErrorRecovery      — ONE shared instance (§1.4)
  errors            : Diagnostic[]       — the shared error stream (§1.4)
  delegationStack   : DelegationFrame[]  — NEW. The seam's instance stack —
                      the §51.0.Q.1 inner-instance hierarchy materialized,
                      generalizing M1's templateStack. Tagged frames:
                      JsDelegationFrame | MarkupDelegationFrame.
  // markup-layer engine state (BlockContext / BodyMode / TagFrame /
  //   DisplayTextLiteral current variants + their own frame stacks)
  // JS-layer engine state (LexMode / ParseContext current variants)
```

`delegationStack` replaces and generalizes M1's `templateStack`: a `templateStack`
frame was `{ bracketDepthAtOpen }`; a `DelegationFrame` is `{ kind, closeOn, openSpan,
bodyMode? }`. M1's template-interp frame becomes one `DelegationFrame` kind
(`kind: .Interpolation`, `closeOn: .BraceDepth(...)`). **This means MK4 does not add a
parallel structure — it widens an existing one.**

### 3.2 The handoff data shape — the two frame types

```
type DelegationKind:enum = {
  // markup → JS delegations
  LogicEscape,      // ${ ... }            §7
  FunctionBody,     // function/fn/pure body { ... }   subsumes BPP
  AttrExpr,         // onclick=${...} / attr=fn()      §5.2
  ShorthandBody,    //  : <expr>>          §4.14
  MetaBody,         // ^{ ... }            §22
  Interpolation,    // ${ ... } inside a "..." literal  §4.18.4
  // JS → markup delegation
  ElementValue,     // <tag>...</>  as an expression operand  Pillar 1
}

type CloseCondition:enum = {
  BraceDepth(depthAtOpen: int),     // close at `}` when BracketStack depth
                                    //   returns to depthAtOpen (M1's mechanism)
  TagFrameBalanced(tagDepthAtOpen: int),  // close when TagFrame stack returns
                                    //   to tagDepthAtOpen (markup element +
                                    //   children fully consumed)
  AttrTerminator,                   // close at the attribute-value boundary
  ShorthandEol,                     // close at the opener's `>` at attr-depth 0
}

type DelegationFrame:struct = {
  kind     : DelegationKind,
  closeOn  : CloseCondition,
  openSpan : Span,                  // the opener token's span — the blame
                                    //   locus for an unterminated-body error
  bodyMode : BodyMode,              // §4.18 body mode at the open (only
                                    //   meaningful for markup→JS frames;
                                    //   the JS layer threads it so display-
                                    //   text rules are known)
}
```

`DelegationKind` / `CloseCondition` / `DelegationFrame` are pure-data types — calculation
classification per S98 D4 P6 (the same classification `Span` and `Token` carry). No
state-shape; no `<engine>` required for these types themselves. The *stack* of them
(`ctx.delegationStack`) is the §51.0.Q.1 instance hierarchy; the *frames* are data.

### 3.3 The span-composition rule

**Rule: there is no span composition. One cursor over one buffer means every Span any
layer produces is already file-absolute.** The "rule" is the *absence* of a
translation step:

- Every `Span` is `{ start, end, line, col }` in the post-PP source coordinate space
  (per `span.scrml` + the BS contract — byte offsets into the preprocessed source).
- A delegation frame's `openSpan` is captured in that space.
- The guest layer advances the *shared* cursor; every token/node Span it makes is in
  that space.
- The host layer's enclosing node closes its span with `cursor.pos` after the guest
  returns: `enclosingNode.span = [enclosingNode.span.start, cursor.pos)`.
- The consumed span of the delegation is `[frame.openSpan.start, cursor.pos)`.

The dive's R1 worst case — "span-attribution bugs across the seam" — is *designed out*:
there is no offset arithmetic, so there is no offset bug. This is the single biggest
de-risking finding of the spike, and it is free — it falls out of reusing M1's
one-cursor design instead of inventing a sub-range design. **MK4's brief must state the
one-cursor invariant as a hard constraint** ("the JS layer and the markup layer share
one Cursor; no layer copies a sub-range; no Span carries a base-offset") so that an
implementer does not, for a perceived encapsulation benefit, introduce a sub-range and
reintroduce the bug class.

### 3.4 Backtracking across the seam — none needed (S98 OQ3 re-confirmed)

The dive's R2 flags that the markup layer widens the S98 OQ3 backtracking surface. The
spike confirms, for the *seam specifically*, that no seam-cross decision needs
backtracking:

| Seam-cross decision | How resolved | Bounded? |
|---|---|---|
| Does `<` in a JS expression open a markup element? | `markupValueAllowedAfter(lastKind)` + next-char letter/ws check (§1.2) — prev-token calculation, the twin of M1's `regexAllowedAfter` | Yes — 1 token back, 1 char forward |
| Is `${` a logic escape or (inside a `"..."`) an interpolation? | The active `BodyMode` / `DisplayTextLiteral` engine variant already says which context the cursor is in — no peek | Yes — zero lookahead (engine state answers it) |
| Does a `}` close the current delegation? | `BracketStack` depth == `frame.closeOn.depthAtOpen` — M1's `isTemplateInterpClose`, a depth compare | Yes — zero lookahead |
| Is an opener a `:`-shorthand body or a full body? | the dive's R2 / SPIKE-bs-mode-flag ML-4 — a single-token post-`>` peek | Yes — 1 token |

Every seam-cross decision is zero-or-bounded lookahead. **S98 D4 P3's verdict survives
the seam unchanged**: bounded lookahead suffices; the `lin`-typed parser-state-snapshot
promotion path remains the escalation route *if* MK2/MK3 surface a non-seam decision
that needs it (re-evaluate at MK2 per dive R2 — but that is not a seam concern and not
this spike's scope to resolve).

### 3.5 The seam vs the CURRENT de-facto seam — what MK4 deletes

For grounding (and because the brief asked the spike to study the current block-splitter
handoff), here is what the seam *replaces*. The current de-facto markup↔JS seam is the
`BareExpr` raw-body deferral + BPP:

- **Today (verified `block-splitter.js` + `body-pre-parser.ts`):** the BS, on hitting a
  `${`, pushes a `logic` brace-context and captures the body; on hitting a
  function/`fn`/`pure` body it captures the brace content as a *raw string*. TAB stores
  function bodies as `[{ kind: "bare-expr", expr: rawBodyString, span }]` (PIPELINE.md
  Stage 3 Amendment 4). BPP (`body-pre-parser.ts:138` `parseBody`) then **re-tokenizes**
  that raw string (`tokenizeLogic`) and **re-parses** it (`parseLogicBody` → Acorn).
  The seam today is therefore: *capture text → hand a detached string to a separate
  stage → re-tokenize from scratch → re-parse*. The handoff datum is a **raw string**;
  the span is carried separately and the re-tokenizer must re-derive positions from
  `bodySpan.start` (`body-pre-parser.ts:148-154` passes `bodySpan.start/line/col` as
  base offsets — *this is exactly the base-offset translation step* §3.3 says the
  native seam eliminates).
- **Under the native seam:** no capture, no detached string, no separate stage, no
  re-tokenization, no base-offset threading. The markup layer hits the `${` / the
  function-body `{`, pushes a `DelegationFrame`, and the JS layer parses the body *in
  place on the same cursor*. Function bodies are parsed in-line by the JS-layer
  statement parser (M3) — which is why the charter dive (Q2.B #4, Q7) says BPP
  "deletes by construction." **The seam contract IS the deletion of BPP**: BPP exists
  *only* because the old BS produces a detached raw string instead of delegating; the
  native seam delegates, so the BPP re-parse stage has nothing to do and is removed at
  M6 (dive Q5.A).

The MK4 brief should frame it this way: *MK4 does not "build a new seam" — it replaces a
capture-and-re-parse seam (BS `BareExpr` + BPP) with an in-place delegation seam. The
re-tokenization that BPP and the two statechild re-tokenizers perform IS the
"re-tokenizer scaffolding" MK4 deletes (dive MK4 line). The seam and the scaffolding
deletion are the same milestone because the seam's existence is what makes the
scaffolding dead code.*

---

## 4. Tightened MK4 estimate

**The dive's MK4 estimate: 22-48h** ("markup↔JS seam + re-tokenizer scaffolding
deletion"). The dive itself names MK4 as "the estimate's least-confident line item"
and the seam as "the seam is its least-confident part."

### 4.1 What the spike changes about the estimate's confidence

The spike's findings move MK4 from *least-confident* to *well-bounded*, for four
concrete reasons:

1. **The seam mechanism is not green-field — it is M1's, generalized.** §1.0 / §2.1
   ground 3. The dive priced MK4's high end (48h) partly for "the seam needs iteration
   (two-graph coordination is genuinely the riskiest part)." The spike finds the
   coordination mechanism is *already built and shipping* (`lex-in-template.scrml`'s
   `templateStack` + `isTemplateInterpClose` + the shared-`ctx` dispatch). MK4 widens
   `templateStack` into `delegationStack` and adds a second frame kind — it does not
   design a coordination mechanism from scratch. That retires most of the
   "iteration" risk the 48h high end was pricing.
2. **The span-bug class is designed out (§3.3), not debugged out.** The dive's R1
   worst case is cross-seam span-attribution bugs. The spike's one-cursor finding means
   those bugs *cannot occur* — there is no offset arithmetic to get wrong. A meaningful
   chunk of the 22-48h spread was implicit "span-bug debugging contingency"; the
   one-cursor invariant removes it.
3. **§51.0.Q.1 sufficiency is confirmed (§2) — no language-primitive gap, no
   sub-deep-dive.** The dive's MK4 high end carried the tail risk that the seam surfaces
   a gap forcing a sub-dive (which would blow the estimate entirely). The spike closes
   that: §51.0.Q.1 is sufficient; the sub-dive trigger is not met. The catastrophic
   tail is removed from the estimate.
4. **The re-tokenizer scaffolding deletion half is unchanged and already well-grounded.**
   The dive priced the scaffolding deletion on DD-3's ~900-1200 LOC survey of the two
   statechild re-tokenizers + BPP — that half of MK4 was always the *confident* half.
   The spike does not move it.

### 4.2 The tightened number

The spike does NOT widen MK4 and does NOT find hidden work — it *narrows* the spread by
removing the two tail risks (span-bug debugging contingency; sub-dive catastrophe) that
inflated the 48h high end.

| MK4 component | Dive (implied) | Spike-tightened | Basis |
|---|---|---|---|
| Seam mechanism — `delegationStack`, the two frame kinds, the close-condition predicates, both delegate directions | ~12-28h | **12-22h** | M1's `templateStack` mechanism generalized; no green-field coordination design (§4.1.1). High end drops — the "iteration" risk is largely retired. |
| `markupValueAllowedAfter` (the JS-layer `<`-vs-`LessThan` discriminator) | (folded in) | **2-4h** | Twin of the shipping `regexAllowedAfter`; bounded prev-token calc (§1.2, §3.4). |
| Cross-seam error propagation — shared `ErrorRecovery`/error stream, EOF-in-delegation blame rule, layer-specific sync-token selection | (folded in) | **3-6h** | §1.4. Shared-ctx makes most of it free; the one real task is layer-routed sync-token sets. |
| Re-tokenizer scaffolding deletion + semantic-remainder re-homing onto the markup-layer AST | ~10-20h | **10-18h** | Unchanged from the dive — DD-3-grounded, the confident half. Mild top-end trim: the seam's node-sink shape (§3.1) gives the semantic remainders a clean AST to consume (addresses dive R6). |
| **MK4 total** | **22-48h** | **~27-50h band; planning midpoint ~34h** | |

**Recommendation for the MK4 line of the charter estimate:** keep MK4 at a **~27-46h**
working band with a **planning midpoint of ~34-36h** (vs the dive's 22-48h /
implied-midpoint ~35h). The midpoint barely moves — the spike's value is **confidence,
not a different number**: the spread tightens because the two tail risks that justified
the 48h high end (cross-seam span bugs; a forced sub-deep-dive) are eliminated by
findings, and the low end firms up because the seam mechanism is confirmed to be a
generalization of shipping M1 code rather than new design. The dive's headline
whole-front-end estimate (~239-518h, midpoint ~380h) does **not** need revision — MK4's
tightening is within the noise of that range; the spike confirms MK4 is not a
estimate-blowing risk.

### 4.3 One honest caveat on the estimate

The spike is read-only and pre-MK1/MK2/MK3. The MK4 numbers assume MK1 (`BlockContext`),
MK2 (`TagFrame`), and MK3 (`BodyMode`/`DisplayTextLiteral`) deliver the markup-layer
engines with the frame-stack live-surface shape §3.1 specifies. If MK1-MK3 diverge from
that shape (e.g. build the markup layer without a shared `ctx`), MK4 inherits a
reconciliation cost not in the above. **Mitigation: the punch-list (§6) pushes the
shared-`ctx` / one-cursor / `delegationStack` design into the MK1-MK3 briefs so MK4
inherits the right substrate.** This is the same "design the AST shape with the
downstream consumer's needs as a requirement" discipline the dive's R6 mitigation
names — applied one milestone earlier.

---

## 5. Findings summary

| Brief question | Finding |
|---|---|
| **Q1 — the seam contract, both directions + handoff shape** | An in-place, single-buffer, mutually-recursive delegation: shared `cursor` + shared `ctx` + a typed `DelegationFrame` carrying a close-condition datum. NOT a copied sub-range / sliced token sub-stream. Both directions are one mechanism (host/guest roles swap). markup→JS close datum = `BracketStack`-depth marker; JS→markup close datum = `TagFrame`-depth marker. Handback = nodes already in the shared sink + cursor advanced past close + frame popped; consumed span = `[openSpan.start, cursor.pos)`. (§1) |
| **Q2 — is §51.0.Q.1 sufficient?** | **SUFFICIENT. No language-primitive gap.** The seam is the literal §51.0.Q.1 composite-state-child form (different inner enum — the AppMode/PlayMode worked-example shape). "Mutually recursive" reduces to "deeply nested," which §51.0.Q.1 covers structurally with no depth limit. The runtime instance stack is M1's `templateStack` generalized. Two caveats are MK-brief obligations (build as a frame-stack live surface per the M1/ANOMALY-2 pattern; `E-CELL-OUT-OF-SCOPE` is off the seam path), NOT language gaps. (§2) |
| **Q3 — the seam contract to MK4 fidelity** | Specified in §3: the shared `ParseContext` substrate (§3.1); `DelegationKind`/`CloseCondition`/`DelegationFrame` types (§3.2); the span-composition rule = *no composition, one cursor, file-absolute spans* (§3.3); no backtracking needed (§3.4); and the relationship to the current BS-`BareExpr`+BPP de-facto seam that MK4 deletes (§3.5). MK4's brief can lift §3 directly. |
| **Q4 — language-primitive gap?** | **NONE.** The two candidate gaps — a spec'd parser-delegation/grammar-injection primitive, and true backtracking — both resolve to "already covered" (§51.0.Q.1 composite state-children; S98 D4 P3 bounded-lookahead verdict). The dive's R1 sub-deep-dive trigger is **not met**. No escalation. (§2.3) |
| **Q5 — tightened MK4 estimate** | Working band **~27-46h, planning midpoint ~34-36h** (dive: 22-48h). The midpoint barely moves; the spike's value is **confidence** — the spread tightens because the two tail risks inflating the 48h high end (cross-seam span bugs; a forced sub-dive) are eliminated by findings, and the low end firms because the seam mechanism is confirmed to be a generalization of shipping M1 code. The dive's ~380h whole-front-end midpoint needs no revision. (§4) |
| **Blocker?** | **None.** No blocker surfaced. The seam is tractable, the mechanism precedented (M1), the language sufficient (§51.0.Q.1). One dependency to manage: MK1-MK3 must build the markup layer on the shared-`ctx`/one-cursor substrate so MK4 inherits it (§4.3) — handled by the §6 punch-list. |

---

## 6. Punch-list for the MK-milestone briefs

Concrete items the MK1-MK4 briefs must carry, derived from this spike. Ordered by
milestone.

**For MK1 (`BlockContext` engine):**
- P1. Build the markup layer on the **shared `ParseContext`** (§3.1), extending M1's
  `makeLexContext` — one `cursor`, one `BracketStack`, one `ErrorRecovery`, one error
  stream, one node sink, plus `delegationStack`. Do NOT give the markup layer its own
  cursor or its own bracket counter. (Substrate for the whole seam; §3.1, §4.3.)
- P2. State the **one-cursor invariant** as a hard constraint in the brief: the markup
  and JS layers share one `Cursor`; no layer copies a sub-range; no `Span` carries a
  base-offset. (Designs out the dive's R1 span-bug class; §3.3.)
- P3. `BlockContext.InLogicEscape` is a §51.0.Q.1 composite state-child whose body is
  the JS-layer engine graph — realized as the frame-stack live surface (push a
  `DelegationFrame` of `kind: .LogicEscape`), mirroring M1's `lex-in-template.scrml`.
  Carry the canonical nested-`<engine>` SHAPE in the `.scrml`; the `.js` shadow runs.
  (§2.2 caveat A.)

**For MK2 (`TagFrame` engine):**
- P4. The `markupValueAllowedAfter(lastKind)` discriminator (the JS-layer
  `<`-opens-element vs `<`-means-`LessThan` decision) lives in the JS layer's `InCode`
  dispatch, parallel to the shipping `regexAllowedAfter`. Spec the prev-token set
  (`=`, `(`, `,`, `return`, `renders`, `lift`, `=>`, `[`, binary operators,
  start-of-body) in the MK2 brief. It is a bounded prev-token calculation, NOT a
  heuristic and NOT backtracking. (§1.2, §3.4.)
- P5. `TagFrame` must expose its stack **depth** (for the `CloseCondition.TagFrameBalanced(tagDepthAtOpen)`
  close datum the JS→markup direction needs). Mirror how M1's `BracketStack` exposes
  `depth(ctx.brackets)`. (§1.2, §3.2.)

**For MK3 (`BodyMode` / `DisplayTextLiteral`):**
- P6. `DisplayTextLiteral.InInterpolation` is the §4.18.4 case — a §51.0.Q.1 composite
  state-child delegating to the JS layer via a `DelegationFrame` of
  `kind: .Interpolation, closeOn: .BraceDepth(...)`. This is the *same* frame kind M1's
  template-interp uses — confirm MK3 reuses the M1 template-literal engine shape rather
  than building a second one (the dive's Q3 / MK3 basis already says reuse; the seam
  contract depends on it). (§1.1, §2.1 ground 3.)
- P7. Thread `bodyMode` (the §4.18 code-default-vs-free-text mode at the open) into
  every markup→JS `DelegationFrame` so the JS layer knows the display-text rules in
  force. (§3.2.)

**For MK4 (the seam milestone — this spike's primary target):**
- P8. Lift §3 of this spike as the seam contract: the `ParseContext` substrate, the
  `DelegationKind`/`CloseCondition`/`DelegationFrame` types, the no-composition span
  rule, the no-backtracking finding.
- P9. Implement the cross-seam error rules (§1.4): one shared `ErrorRecovery`; on EOF
  inside a delegation, blame `frame.openSpan` and return the frame flagged unterminated
  (do NOT let the host layer treat the body as closed — M1's `terminator=="eof"`
  precedent); select panic-mode re-sync sync-token sets by the active delegation
  frame's owning layer.
- P10. Frame MK4 as *replacing* the BS-`BareExpr`+BPP capture-and-re-parse seam with an
  in-place delegation seam — the re-tokenization BPP and the two statechild
  re-tokenizers perform IS the "re-tokenizer scaffolding" MK4 deletes; the seam's
  existence is what makes that scaffolding dead code. Specify the markup-layer
  engine-body / match-arm **AST node-sink shape** with the two statechild
  re-tokenizers' surviving *semantic* passes' input needs as an explicit requirement
  (the dive's R6 mitigation; §3.5, §4.2). 
- P11. Deep-nesting smoke test (the dive's R5 mitigation, pulled into MK4's gate): a
  `.scrml` fixture nesting markup → `${}` → `"..."` literal → `${}` interpolation → a
  markup-as-value `<tag>` → `${}` again (5+ delegation frames on `ctx.delegationStack`)
  must parse end-to-end. This is the use-at-scale check for the frame-stack live
  surface; M1 only exercises 2 frames.

**Cross-cutting (PA / brief authors):**
- P12. The dive's Anomaly A1 is already reconciled — `docs/changes/quoted-text-model/IMPLEMENTATION-ROADMAP.md`
  now carries a "STATUS SUPERSEDED — S111 charter-B pivot" banner (verified). No action;
  noted so the MK-brief authors do not re-flag it.
- P13. OQ-2 (the dive's R3 — §4.18.1 vs §40.8 program/page body mode) is **not** a seam
  question and is **out of this spike's scope**, but it blocks MK2's detailed design of
  top-level declaration recognition (dive R3). It remains a SPEC clarification the PA
  must surface before MK2. Flagged here only so it is not lost between the dive and the
  MK2 brief.

---

## 7. Anomalies / notes for the PA

- **N1.** The spike found the charter dive's Anomaly A1 already actioned: the
  quoted-text `IMPLEMENTATION-ROADMAP.md` carries the SUPERSEDED banner (lines 3-5,
  21-22 verified). The dive's A1 can be marked closed.
- **N2.** `native-parser/README.md` ANOMALY-2 (compiler v0.3 strips function bodies
  from `${...}`-escape SPA-shape `.scrml` files → the project ships `.js` shadows) is
  load-bearing for the seam's *implementation form*: the seam, like M1, is built as a
  frame-stack live surface, not as executable deeply-nested `<engine>` source. This is
  a property of the *current compiler*, not the language — the M4+ self-host swap
  retires the shadows. Not a spike blocker; recorded because the MK-brief authors must
  understand the seam is built the way M1 was built (canonical SHAPE in `.scrml`, live
  surface in `.js`).
- **N3.** The spike treated SPEC §51.0.Q.1 (read in full, SPEC.md:23578-23707) and the
  live `native-parser/` source as authoritative over the stale `.claude/maps/` and the
  stale staleness-index (dive Anomaly A2), per the global Rule-4 discipline.
