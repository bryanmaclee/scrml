# PROBLEM STATEMENT — `E-CONTROL-FLOW-IN-MARKUP` needs a grammar-derived recognizer

**change-id:** `ruling3-grammar-derived` · **opened:** S383, 2026-08-28 · **status:** OPEN, unbuilt.

> **This document is SPECIFICATION for whoever builds the grammar version. It is not a design
> proposal, not a plan, and it deliberately ships NO code.**
>
> bryan's ruling, S383, verbatim: the problem statement is *"worth more than the code"* —
> **"Land those as SPECIFICATION for whoever builds the grammar version, never as a dormant
> gate."** So there are no `.skip`'d tests here and no dead code behind a flag. A skipped test that
> asserts unbuilt behaviour reads as coverage, cannot fail, and forces the next session to re-derive
> whether it is aspirational or broken.

---

## 0. WHAT THIS IS THE RECORD OF

Ruling 3 (ratified S375) directed two things: correct a false `SPEC §34` claim, and extend
`E-CONTROL-FLOW-IN-MARKUP` to the §40.8 default-logic body-top. An implementation reached
`worktree-agent-a84d38ac3c1c30a4b` @ `79894418` after **four adversarial review rounds**. At S383
bryan ruled **"land the stable half"**: the parts true regardless of ruling 3 landed
(`docs/changes/ruling3-stable-half-2026-08-28/`), and **the new arms were HELD** — not rejected on
quality, but because the approach has a hole that no amount of further patching closes.

**The hole is not in the extension. It is in the recognizer the extension inherited**, and it has
been there since S203.

---

## 1. ⚑ THE HOLE — the `{` is the entire discriminator, and that is permanent

`E-CONTROL-FLOW-IN-MARKUP`'s recognizer is:

```js
const BARE_CONTROL_FLOW_IN_MARKUP_RE = /^\s*(for|while|if)\b\s*\([^]*?\)\s*\{/;
```

It requires **a keyword, a parenthesised head, and an opening brace.** Ruling 3 extended its
**LOCUS**, never its **COVERAGE**.

### MEASURED at S383 on the carved compiler (`origin/main` behaviour + the stable half)

Each row is a real compile; `SHIPPED-INTO-BODY` is read out of the emitted `dist/x.html`, not
inferred from a diagnostic count.

```
################ LOCUS: §40.8 <program> body-top
  braceless if       E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  switch             E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  labelled for       E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  do-while           E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  braced if (CTRL)   E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true

################ LOCUS: S203 markup <div> body
  braceless if       E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  switch             E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  labelled for       E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  do-while           E-CONTROL-FLOW-IN-MARKUP=0  errorCodes=[none]  SHIPPED-INTO-BODY=true
  braced if (CTRL)   E-CONTROL-FLOW-IN-MARKUP=1  errorCodes=[E-CONTROL-FLOW-IN-MARKUP]  SHIPPED-INTO-BODY=false
```

Sources used (each wrapped at the stated locus):

| shape | statement |
|---|---|
| braceless if | `if (1) log(2)` |
| switch | `switch (1) { }` |
| labelled for | `outer: for (const x of [1]) { }` |
| do-while | `do { log(1) } while (0)` |
| braced if (control) | `if (1) { log(2) }` |

**Read the markup-locus block, which is the gate that has been shipping since S203: FOUR real
control-flow statements ship raw into the DOM at exit 0 with zero diagnostics, and only the braced
`if` is caught.** The extension inherits that hole exactly.

### ⚑ Why it cannot be closed by widening the regex

```
if (@a) log(1)          ← code. must be refused.
if (you ask) we deliver ← prose. must render.
```

These two differ **only in whether the tail is code or prose.** The `{` is what tells them apart —
which is precisely why the recognizer demands it, and precisely why prose survives today. Drop the
`{` requirement and the gate starts refusing English. Keep it and braceless control flow ships
forever.

**A braceless control-flow statement at a body-top cannot be diagnosed by any regex without also
refusing prose.** That is a permanent hole, *inside the class the diagnostic exists to close*. It
needs the grammar, not another pattern.

`switch` and `do`/`while` are a second, softer instance of the same thing: they are absent from the
keyword alternation, and adding them is easy — but `switch (x) { }` next to `Items for sale (all of
them) ship on Friday.` puts you back on the same knife. **Widening the keyword list without a
grammar just moves the false-positive risk around.**

### ⚑ AND THE ANSWER DEPENDS ON THE NEIGHBOURS — measured, S383

Whether a construct is even *seen* depends on whether an unrelated adjacent line happened to trip a
different lift gate:

```
switch ALONE at body-top                       codes=[]                    shipped=true
switch PRECEDED by a decl at body-top          codes=[E-SWITCH-FORBIDDEN]  shipped=false
```

Adding `const k = 1` above the statement makes the declaration lift claim the whole run; the
`switch` is then lexed and `E-SWITCH-FORBIDDEN` fires. Alone, the identical statement is inert page
text. **The verdict is a function of the run's accidental composition, not of the construct.** No
recognizer over a block-splitter text run can fix that, because the run boundary is the problem.

---

## 2. THE MEASUREMENT DISCIPLINE THIS ARC OWES — a 52-fixture CROSS-AXIS corpus

Carried forward verbatim from `79894418` round 4, because it is the artifact that finally made the
split visible and because **the three preceding corpora each measured one axis and each certified a
regression.**

The round-3 corpus varied *is-it-prose* and held *is-it-multi-line-real-control-flow* **fixed** —
which is exactly why round 3 passed while re-opening the S203 markup gate. The round-4 corpus
crosses **both** axes at **both** loci:

```
group                              n   main   r3   r4
mk-   markup, REAL control flow    6     6     2    6
dl-   §40.8,  REAL control flow    6     0     2    2
pr-mk markup, PROSE               16     4     0    4
pr-dl §40.8,  PROSE               16     0     0    0
```

`r4 == main` on both MARKUP axes; `r4 == r3` on both §40.8 axes. **That is the split stated as a
measurement rather than as an intention, and any future implementation owes the same table.**

⚑ **The `pr-mk` row is the uncomfortable one and must not be lost.** `main` fires on 4 markup-locus
PROSE fixtures. Round 3 fired on 0 and this was reported as a bonus — *"also closes a pre-existing
multi-line false fire at the S203 markup locus"*. It was not a bonus: those 4 were **the same
regression wearing a friendly face**, inseparable from it, and restoring main's markup behaviour
brings them back. **There are 4 known false fires at the S203 markup locus on `main` today.** They
are a pre-existing S203 issue, surfaced rather than silently re-introduced or silently "fixed", and
a grammar-derived recognizer should close them as a matter of course.

### ⚑ The methodological rule, which is the durable half

**Corpus-zero was never safety here.** The "ZERO corpus instances" figure that underwrote ruling 3's
landing was measured against a SINGLE-LINE prose shape — so it was blind to the multi-line shape
that then shipped a HIGH. Re-measured over a purpose-built 78-fixture multi-line-prose corpus (8
prose openers × 9 followers plus residual and control shapes), the pre-fix build fired **13** times
and DELETED a declaration in **8** fixtures that the prior compiler kept.

**A corpus that varies one axis certifies one axis.** Before the next implementation claims a
migration cost, enumerate the axes first and cross them.

---

## 3. ⚑ TWO RECOGNIZERS FOR TWO DOMAINS — the DO-NOT-MERGE note, with the history in both directions

Carried forward because merging is the tempting move and **it has now been made twice, in opposite
directions, and each time it shipped a defect.**

The two loci are not a duplicate. They are one recognition applied to two domains whose **RUN-SHAPES
differ**, and the difference is load-bearing:

- **MARKUP body** (`parentType === "markup"`, S203). A text run is delimited by the surrounding
  ELEMENTS, so a run genuinely holds one construct and a multi-line control-flow statement is REAL
  code that must be refused. `if (@a &&\n @b) {`, and an Allman `{` on the next line, are ordinary
  formatting here. **An UNBOUNDED head is correct.**

- **§40.8 DEFAULT-LOGIC body-top.** A text run is EVERY contiguous non-markup line, so an unbounded
  head reaches ACROSS statements: `if (you get stuck) contact support.` followed by
  `function greet() { … }` matched as ONE construct and the recovery **DELETED the function**.
  **A SINGLE-LINE bound is correct.**

**The history:**

| round | move | consequence |
|---|---|---|
| S378 | reused the markup recognizer at the new locus without re-deriving it for the new run-shape | shipped the deleted-declaration HIGH |
| S379 r3 | NARROWED the shared recognizer to fix that | correct for §40.8; **silently RE-OPENED the S203 markup gate** — multi-line and Allman control flow compiled clean and shipped `if (` into `<body>`, at a locus ruling 3 never touched |
| S379 r4 | split into two recognizers, one per domain | `r4 == main` on markup, `r4 == r3` on §40.8 |

⚑ **Converge-don't-enumerate is a rule about a shared DOMAIN, not a shared code SHAPE.** These two
share a shape and not a domain. If a future implementation is about to unify them because they "look
like the same regex": **that reasoning produced BOTH defects above.**

A grammar-derived implementation may well dissolve this note — if the grammar decides
control-flow-ness, the run-shape difference stops being the recognizer's problem and becomes the
segmenter's. **That would be the right outcome. It is not licence to merge two regexes.**

---

## 4. THE FOUR-GUARD STRUCTURE OF `findControlFlowStatementEnd` — the safety property to keep

`79894418` needed to answer "where does the offending statement END?" so the recovery could drop the
statement without taking the innocent declarations sharing its run. Its four-guard structure is
recorded here **not as an implementation to copy but as a SAFETY PROPERTY any successor owes**,
because the property was arrived at by shipping its violation.

### The property

> **The scan MAY consume MORE than the statement. It MAY NEVER consume LESS.**

The two directions are not two grades of one error:

| direction | consequence |
|---|---|
| **OVER**-consume | a too-wide span and possibly a spurious secondary diagnostic. **Loud, visible, cosmetic.** |
| **UNDER**-consume | the tail of the statement is handed back to the lift and **SHIPPED INTO THE ADOPTER'S PAGE AS TEXT** — silently, at whatever exit code the rest of the file earns. |

The second is the exact defect class the diagnostic exists to close. ⚑ **This is not hypothetical.**
The scan was added to fix a MEDIUM diagnostic-quality problem (a spurious secondary) and it CAUSED
control flow to ship into the DOM at the S203 markup locus: `<div>` +
`for (const {id} of @items) { <span>x</span> }` emitted
`<div> of @items) { <span>x</span> }</div>` where `main` emits `<div></div>`. **A fix for a gate's
diagnostic quality broke the thing the gate is for.**

### The four moves — three of which do not depend on the lexing being right

1. **ANCHOR from the recognizer's own match, never by searching for a `{`.** `indexOf("{", from)`
   finds the brace in the LOOP HEAD (`for (const {id} of …)`). The recognizer's match already ends
   at the body brace; hand its answer forward rather than asking a second, weaker question.
2. **DECLINE on any token the scan cannot lex with certainty.** Today: a bare `/` (regex-vs-division
   needs previous-significant-token state, and a regex can carry a brace — `/[}]/`), and a `${`
   interpolation inside a template. Declining is FREE: it is the documented whole-run fallback.
3. **POST-CONDITION, lower bound:** the end must reach at least the head the recognizer matched.
   Any anchor-class error lands short of it by construction.
4. **POST-CONDITION, surplus close:** if the REMAINDER closes a brace it never opened, the scan cut
   early — decline. Naive brace counting is exactly right for this test: it needs no lexing, and its
   errors run toward declining.

**(3) and (4) test the ANSWER, so they hold against a brace-bearing construct nobody has
enumerated.** That is the difference between *"I lexed this correctly"* and *"I cannot be wrong in
the dangerous direction"*. ⚑ **If a successor adds a case here, add it as a DECLINE first and only
then, if it is worth it, as lexing.**

### ⚑ The first hole was found in the DESIGN, not the lexing

A trailing `else` defeats it, and **post-condition (4) structurally cannot catch that**: an `else`
block is brace-BALANCED, so the remainder never closes a brace it did not open. A net that only sees
unbalanced braces is blind to a well-formed trailing clause. MEASURED: `if (1) { } else { }` +
`<count> = 0` + a read emitted the real diagnostic PLUS a bogus `E-STATE-UNDECLARED`, and shipped
` else { }` into the page as text. The resolution was to DECLINE on a trailing `else` — because
finding where an `else`/`else if` chain ENDS is statement parsing (the chain can be braceless, can
nest, and can carry its own trailing clauses), and **building that would have been the third
consecutive round of hand-rolled parsing in one function.** That is the signal that retired the S368
gate, and it is the signal that held this one.

### ⚑ A performance guard that a correctness-only test cannot see

The first cut of the `else` guard was a regex with three consecutive ambiguous whitespace
quantifiers in front of a literal that usually FAILS. Every failure re-partitions the whitespace
run, so cost is superlinear in its length. MEASURED on the bare pattern: 200 ws chars 1.5 ms, 400
11.2 ms, 800 87.8 ms, 1600 691 ms. At a §40.8 body-top the remainder is EVERY contiguous non-markup
line, so blank and indented lines feed it directly: `if (1) { }` followed by 3000 blank lines
compiled in 0.20 s on the prior compiler and took 5.2 s with the pattern; a reviewer's larger
fixture did not finish in 120 s. **A source file of ordinary blank lines could hang the compiler.**
It was replaced with an index walk that visits each character at most once. **A successor owes a
TIMING pin, not only a correctness pin — a correctness-only test passes at six seconds.**

---

## 5. RESIDUALS AND KNOWN GAPS THAT BELONG TO THIS ARC

Recorded so the next implementation sizes the class from measurements rather than from the shape of
the last patch.

1. **The run-LEADING bound.** The recognizer is `^`-anchored against `block.raw`. At a default-logic
   body-top a run is EVERY contiguous non-markup line, so a statement on a LATER line of the run is
   never examined. MEASURED: `<program>` + `Welcome here.` + `if (1) { }` exits 0 with `if (1)` in
   the emitted `<body>`; deleting the prose line makes the same file exit 1. **One line of prose is
   the whole difference between exit 1 and exit 0.**
2. **The IMPLICIT default-logic body** (`parentType === null`, a file with no `<program>` wrapper)
   was never in scope. Widening to it added ZERO corpus files when measured at S378 — but see §2:
   corpus-zero is blast radius, not demand evidence.
3. **A `//` LINE comment severs a run upstream.** The block splitter flushes a contiguous text run at
   a `//` comment, so a following `else { }` arrives as a SEPARATE run and no scan over `raw` can
   see it. Filed as `g-default-logic-comment-flushes-a-run-severing-a-statement-from-its-declaration`
   (HIGH, open on `main`). It reaches this code rather than originating in it, and **it is another
   instance of §1's last finding: the run boundary is the problem.**
4. **Four false fires at the S203 markup locus on `main`** — the `pr-mk` row in §2.
5. **The per-file exemption branch is untestable as built.** `compiler/src/unit-cc-exemption-list.json`
   is `[]` and `default-logic-exemption.ts` loads it ONCE at module init, so a test cannot inject
   entries without writing to compiler source mid-run. Exercising the `/`-boundary suffix rule needs
   an **injectable loader**. (A first cut guarded the assertions behind `if (list.length > 0)` — a
   check that can never fail, which is worse than no check because it reads as coverage. It was
   removed rather than left in.)

---

## 6. WHAT LANDED INSTEAD, SO THIS DOCUMENT IS NOT MISREAD AS A REVERT

The S383 carve kept everything on `79894418` that is true regardless of the arms:

- `compiler/src/default-logic-exemption.ts` — the leaf-module extraction. Its justification is the
  DEPENDENCY DIRECTION (TAB runs before SYM, so `ast-builder.js` must not import from
  `symbol-table.ts`), which does not depend on which gates consume it. **Both TAB-stage consumers
  are now held; the module still stands.**
- The **F5 `col` fix** at both sibling scanners in `ast-builder.js`
  (`scanStateBlockBareWriteDecls`, `scanMarkupBodyConstAtDecls`).
- The **`maskCommentRegions` DO-NOT-SHARE banners** and their tripwire test.

`E-CONTROL-FLOW-IN-MARKUP` itself is byte-for-byte the `origin/main` gate: markup locus only, braced
`for`/`if`/`while` only.

**⚑ SPEC is untouched by the carve.** `compiler/SPEC.md` §34's `E-CONTROL-FLOW-IN-MARKUP` row still
lists a `<program>`/`<page>`/`<channel>` default-logic root under **"Does NOT fire"** with the reason
*"the §40.8 auto-lift handles it"*. **The "does not fire" half now matches the compiler again; the
REASON is still false** — §40.8's own S123 amendment says the auto-lift covers DECLARATIONS only, so
the locus is covered by neither the lift nor the error and the construct ships as page text. Same
conflation at `SPEC.md:11765` (§17.4 prose). Correcting that text is the PA's, in parallel with this
carve.
