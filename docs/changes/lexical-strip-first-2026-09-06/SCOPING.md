---
status: current
last-reviewed: 2026-09-06
tags: [lexer, comments, strip-first, dpa-044, simplify-to-ship, s402]
---

# Strip-first + unterminated-as-diagnostic — a scoped arc

**Banked S402 on bryan's instruction ("bank the strip-first proposal"). NOT ratified as a build.**
This is the synthesis of bryan's architecture proposal, dpa-044's Call 1, and the PA's collision
measurement. dpa-044 answered the *question*; this is the *arc* that falls out of it.

## The proposal, in one line

**One front pass that (a) strips comments before any other stage sees them, and (b) reports an
unterminated delimiter as a diagnostic.** Both halves in one place, run once.

## bryan's framing — recorded precisely, because the PA got it wrong once

> *"I wasnt suggesting that removal woulf fix the bug. My point is that if there is less surface to
> confuse the compiler, it might be easier to harden the compiler."*

and the architecture question:

> *"with `//` to end of line only, do we need any scanner at all. Does the scrml compiler use a
> comment EVER as code? If not, throw them out as the very first step and don't let the rest of the
> compiler ever see them."*

⚑ **The PA initially relayed this as "would the restriction fix the HIGH", which is the narrower
question, and dpa-044 partly answered that narrower one.** The real claim is about HARDENING COST,
not about closing one defect. Everything below is scoped to the real claim.

## What is MEASURED, and by whom

**Comments are never load-bearing** (PA, `2d6f0ef8`): no pragma, no directive, no preserve-path.
Searched `compiler/src` for directive/pragma/annotation/preserve uses — nothing. **bryan's premise
holds**, and it is the precondition for a strip pass being legal at all.

**The collision set is small, bounded, and enumerable** (PA, crude detector — naive backtick parity
and element depth, so treat as approximate). Over 1920 `.scrml`, **9,779 lines whose FIRST SIGNIFICANT
CHAR is `//`**, of which **295 (3.0%)** must NOT be stripped:

| context | count | why it survives |
|---|---|---|
| inside `<pre>` / `<code>` | **182** | §4.17 raw content — a comment displayed AS CONTENT |
| inside a template literal | **113** | string data |
| inside a `_{}` foreign block | **0** | expected to bite; does not |

⚑ **So a strip pass needs exactly TWO state bits** — *am I in raw content* and *am I in a
string/template* — computed ONCE at the front and discarded. That is not "no scanner", which is what
bryan asked for, but it is categorically different from the ~10 scanners each re-deriving full
context today.

**The URL objection is answered by construction, not mitigated.** The case that broke rounds 4 and 5
of the S402 apostrophe arc was `href="//cdn.example.com/x"` — the `//` is inside an attribute value
and therefore NOT at first significant char, so under the rule it is not a comment at all. dpa-044
independently confirms the rule lets `urlSlashesAt` be deleted outright.

**dpa-044's Call 1, which outranks the banked question:** silent consume-to-EOF is UNIVERSAL — the
tokenizer does it too (`readBlockComment`, `tokenizer.ts:1366`) — and **`grep -oE
"E-[A-Z-]*UNTERM[A-Z-]*"` returns ZERO: no unterminated-delimiter diagnostic exists anywhere in the
compiler.** Making it one **removes no surface, costs no migration, closes all four members of the
run-to-EOF class**, and is priced at **6-14h**.

**dpa-044's corrections to the PA's own numbers, carried so they are not quietly dropped:** the
banked item's headline "22 source files hand-roll comment scanning" **does not reproduce — it is 10**;
the PA's discriminator (*"stateful scanning is expensive, parse rules are cheap"*) is **FALSE as
framed** because strings force identical state and nobody proposes banning apostrophes; and the hazard
is a **FOUR-member class** — `/* */` · `<!-- -->` (**§27.2, a THIRD comment form the banked item never
mentions, 35 corpus files**) · strings · backticks. Measured unpaired openers: `/*` **0** · `<!--`
**0** · string **7** · backtick **1**.

## ⚑ THE DESIGN CONSTRAINT THAT DECIDES WHETHER THIS IS WORTH BUILDING

dpa-044's honest half: under the *strongest* comment proposal, what survives is **the ~20-re-scan
replication factor itself** — *"Removing one opaque region shrinks each scanner's branch count; it
retires no scanner."*

**So the arc is only worth its cost if the strip pass RETIRES scanners rather than shrinking them.**
A strip pass that leaves ten downstream scanners still tracking comment state has bought a smaller
branch count and nothing structural. **The acceptance test is a COUNT: how many of the 10 comment-
scanning sites can delete their comment handling entirely once the front pass guarantees no comment
survives?** If that number is not most of them, the arc should not be built as scoped.

## What it does NOT buy — carried verbatim from dpa-044 §6 so nobody re-derives the optimistic version

- ❌ **The sole HIGH survives.** `g-line-comment-truncates-the-rest-of-a-default-logic-body` is
  triggered by `//` at first significant char — **the surviving form** — and its second shape drops a
  statement with no comment present at all. Root cause is §40.8 `default-logic`, untouched by any of
  this.
- ❌ **The S402 apostrophe arc survives.** Strings are not comments; 8 corpus files carry the live
  instance.
- ❌ **`skipDollarBrace` backtick-unawareness survives** (rounds 4/5).
- ❌ **All 8 `~` gaps survive.** Orthogonal.

## Sequencing

**Call 1 first, alone.** It removes no surface, needs no migration, needs no ruling, and closes the
four-member class — the best ratio on the board. It is also the natural home for the strip pass later:
one front pass that strips comments AND reports unterminated delimiters.

**Then the strip-first restriction**, gated on the retirement count above, and carrying a measured
migration (≤3.6% per dpa-044; the PA's independent collision figure is 3.0%, and the two were measured
differently — reconcile before quoting either).

**Not scoped here:** the novel-delimiter idea (`&*(…)`). ⚑ It does not help — a novel delimiter inside
a `<pre>` or a template literal has the identical problem, because **the state requirement comes from
MULTI-LINE CONSTRUCTS, not from the delimiter's ambiguity.** Changing the delimiter reduces
collision-with-URLs, which first-significant-char already solves for free.
