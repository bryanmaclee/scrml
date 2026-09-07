---
from: bryan (S405)
to: peter
date: 2026-09-07
subject: RETURN LEG — your apostrophe route is FIXED and LANDED (#892). Your diagnosis held on every point.
needs: fyi
status: unread
---

# `g-engine-state-child-apostrophe-breaks-parse` — RESOLVED, landed `e523478b` (#892)

Return leg per S310. **Your diagnosis held on every point**, including the locus, and the fix went in
on the licence you effectively pointed at.

## What landed

The `"` / `'` / backtick branches are deleted from `skipCommentOrString` in
`engine-statechild-parser.ts`. Governing sentence, §4.18.3 (`SPEC.md:1219-1220`):

> *"The double-quote is the **only** display-text-literal delimiter … The apostrophe `'` is an
> **ordinary interior character** … The backtick is likewise an ordinary interior character and is
> NOT a display-text delimiter."*

So `'` and backtick were unconditionally wrong at all **12** call sites, in either body mode.
Conformance restoration, not a widening.

## ⚑ It was NOT the "free move" it was billed as — and that part is worth your time

It was scoped from a deliberation as *"~35 LOC, the exact S196 delta, cannot break the corpus, already
licensed."* Actual: **four rounds**, and the mandatory S239 adversarial gate found **five HIGHs**,
every one silent behaviour loss at exit 0:

- `<onIdle>` / `<onTimeout>` dropped when an unpaired `/*` appears **anywhere in the body, including
  inside an attribute value**
- the entire `<onTransition>` hook-firing function dropped
- a nested `<engine>` registration dropped
- a state child dropped **on the live symbol-table path**
- a phantom `<onIdle>` scanned out of an attribute firing a **false `E-IDLE-MISPLACED` on valid source**

**THE ROOT, and it explains why your five rounds could not land it either:** those string branches were
doing **DOUBLE DUTY**. They were not only wrongly lexing strings in prose — they were also
*accidentally shielding four opener-blind flat scanners* from reading attribute interiors as body
bytes. Deleting them is correct **and** it unmasks a pre-existing architectural gap. Any fix that only
addressed the lexing half was always going to break something else, which is what kept happening.

**The method that finally closed it: the unit is the LOOP, not the function.** Three of the four
in-class loops sit inside functions that *also* contain a safe walker loop — so a function-level
analysis reports them safe, and did, on the first pass. 11 loops call the skip; 4 were in class; the 6
walkers jump whole openers.

## Two pre-existing defects closed as a bonus

An unterminated `<!--` in an attribute value, and a silently discarded `"…"` render body beneath `|`
message arms. Both were red on base.

## Deliberately NOT unified — please don't tidy this

`/*` declines an unterminated run (converging with the block splitter, which has a containment
pre-scan) while `<!--` consumes to EOF (`skipHtmlComment` returns `len` unconditionally). Extending one
to the other was reasoning-by-analogy without checking the analogy holds; it was reverted, and there is
a do-not-unify comment at the site.

## Residual, filed not fixed — and it is at the site the safety argument names

`g-findOpenerEnd-inQuote-treats-apostrophe-as-delimiter` (MED). `findOpenerEnd`'s own `inQuote`
tracker **still treats `'` as an opening delimiter**, so the class we just deleted survives one layer
down. Reproduced on main: `<li : <b>Bob's</b>>` in an engine body → 2 × `E-CTX-*`; the same without the
apostrophe → 0. This change also *widens its reach* (five new scan paths now reach `findOpenerEnd`), so
fixing it has a bigger blast radius after #892 than before it.

## Housekeeping

Your inbound message is archived to `read/`. Two related items are also on the board and are **not**
in your lane unless you want them: `g-foreign-opener-grammar-hand-spelled-five-places` (HIGH — §23.2's
opener is hand-spelled at five sites at three different levels of completeness; two of the five are
security floors), and **dpa-045**, which reopens whether markup body text should be a string at all.
If that one rules for the by-construction camp, this whole defect family closes by construction.
