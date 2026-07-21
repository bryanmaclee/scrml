# BRIEF — FIX ROUND on `outlet-collector-total-walk` (`050b934b`)

S277 · resumed on the same agent · the PA-side S239 adversarial pass found 4 defects,
**every one REPRODUCED by the PA independently** before being routed back to you.

Your walker change is CORRECT and stays. Independent PA verification confirmed: the S276 B4
over-fire did NOT re-open (a `<page>`-scoped `<main>` buried in a match arm — reachable only via a
newly-walked edge — stays silent), the outlet-placeholder case stays silent, the nested-`<program>`
`openMains` reset still fires, R26 is byte-identical on `docs/website` (295 files) + trucking (115),
and perf is flat. **No regression was found. Everything below is quality-of-the-new-work or an
overclaim to correct.**

---

## FIX 1 (BLOCKING) — case-sensitivity: the oracle shares the implementation's blind spot AGAIN

This is the **S276 failure pattern, verbatim**: a test oracle that cannot see the bug class because it
was written from the same assumption as the code.

- `mainCount` uses `/<main\b/g` — **no `i` flag**.
- `collectOutlets` compares `nodeTag === "main"`.
- `treeHasAuthorMain` (emit-html.ts:1005) compares `(n.tag ?? n.tagName ?? "") === "main"`.

**But `codegen/index.ts` — the composition stage of this same feature — is case-INSENSITIVE at five
sites** (`toLowerCase()` at :681, :725, :743, :749, :2091), and S276 deliberately made the slot regex
match `<MAIN>` in any casing (see its own comment at :2166). So one feature holds three different
answers to "is `<MAIN>` a `<main>`", and the two landmark walkers are the odd ones out.

PA-reproduced, base AND tip identical:

```scrml
<program>
<outlet/>
<MAIN>m</MAIN>
</program>
```
→ compiles **silent**; emitted body is `<main data-scrml-outlet tabindex="-1"></main> <MAIN>m</MAIN>`
→ **two live landmarks**, invalid HTML. `mainCount` reports `1` and every `§11` assertion passes.

HTML element names are ASCII case-insensitive — `html-elements.js` says so in its own header comment.

**Do:**
- Make the tag comparison case-insensitive in `collectOutlets` AND `treeHasAuthorMain`, matching the
  `toLowerCase()` convention already used in `index.ts`. `<MAIN>` alongside an `<outlet>` must then
  fire `E-OUTLET-AND-MAIN`.
- Fix `mainCount` to `/<main\b/gi`.
- Add the uppercase case as a test.
- Re-run R26. A casing change touches the emit-side predicate, so byte-identity must be re-confirmed
  on both corpora, both trees asserted non-empty first.

## FIX 2 (BLOCKING) — the new diagnostics point at the wrong node

The positions your change newly covers report a **degenerate span**. PA-reproduced on tip:

| shape | reported | offending node actually at |
|---|---|---|
| `<main>` in a match arm | **L1:C1** | L8 |
| `<main>` in a top-level `<each>` | **L1:C1** | L4 |
| bare sibling `<main>` (pre-existing path) | L3:C1 — correct | L3 |

L1:C1 is the `<program>` open tag. The author gets a diagnostic that names the file and not the
element — and `E-OUTLET-AND-MAIN`'s message tells them to "wrap the outlet / remove the `<main>` /
move it into the `<page>`" without saying *which* `<main>`. A diagnostic that cannot name its own
root cause is itself a defect.

Find why the span collapses for nodes reached through `armBodyChildren` / `bodyChildren` (likely the
node carries no `span`, or carries the container's) and make the fire report the offending element.
If a synthesized node genuinely has no span, say so in your report and fall back to the nearest
enclosing node that has one — but do not leave it at 1:1.

## FIX 3 (BLOCKING, honesty) — the new comment makes a claim that is FALSE

Your descent comment states: *"one walk with one rule cannot drift from its twin"* and *"Any shape one
sees and the other does not is a silent correctness hole."*

PA-reproduced counter-example — a `<main>` inside an `<each>` **nested inside a match arm**:

```scrml
type Phase:enum = { A, B }
<program>
  <phase>: Phase = .A
  <rows> = ["a"]
  <outlet/>
  <match for=Phase on=@phase>
    <A><p>a</p></>
    <B><each in=@rows><main>m</main></each></>
  </>
</program>
```
→ **silent on tip**, slot stays `<main data-scrml-outlet>`. Both walkers miss it and therefore
AGREE — on a wrong answer. Totality of the walk is not totality of coverage: that subtree is absent
from the AST at PASS 15.5 (your own isolation matrix showed `<each>`-in-arm is the sole miss;
`<each>` at top level, `<each>` in an engine state-child, and `<each>` in `<each>` all fire).

Rewrite the claim to what is actually true: the two walkers can no longer disagree **about nodes
present in the AST at this stage**, and note the `<each>`-in-match-arm subtree as a known AST-
completeness limitation with a pointer, not a silent omission. Do not overclaim — a future reader
must not trust this comment the way it currently reads.

## FIX 4 — assertion strength

Every new diagnostic test is `expect(errors.some(e => e.code === "…")).toBe(true)`. That is one bit
wide: it passes if the code fires twice, or on the wrong node — which is exactly why FIX 2 shipped
undetected. Upgrade the new diagnostic assertions to pin **the count** and **the line**.

---

## EXPLICITLY OUT OF SCOPE — do NOT fix, do NOT pin with a test

Two PRE-EXISTING bugs (identical on base and tip). The PA is filing them as known-gaps.

1. **`<each>` nested in a match arm is absent from the AST at PASS 15.5** (the FIX-3 counter-example).
   A pass-ordering / AST-completeness problem, not a walker problem.
2. **`if=`-guarded `<main>` yields ZERO rendered landmarks.** `<main if=@show><outlet/></main>`
   compiles silent and emits an **entirely empty body** — the whole subtree including the slot is
   entombed in a `<template>`, so there is no addressable `[data-scrml-outlet]` in live DOM at all.
   `<page>` + `<main if=>` likewise demotes the slot and renders zero landmarks.

**Do not add passing tests asserting today's behaviour for either** — pinning a known-broken output
turns the eventual fix red. That is the S276 lesson (a test titled "…(nested) ALSO fires" locked in an
overreach and made it read as intent). If you want them visible, a `test.skip` with a comment naming
the gap is acceptable; a green assertion is not.

## VERIFY BEFORE REPORTING

- Full suite; report before/after and diff the failure SET, as you did last round.
- R26 on both corpora — **re-run, do not reuse the prior result** (FIX 1 touches the emit predicate).
  Assert both trees non-empty BEFORE comparing: the PA's first R26 attempt silently produced 0 files
  from a bad path, which without that assertion reads as a false-green `DIFF: NONE`.
- Adversarial self-check: revert your `symbol-table.ts` change and confirm the new tests go red.

## REPORT BACK

Final SHA · what each of FIX 1-4 changed · the R26 re-run result · suite numbers · whether the span
fix required a fallback and why · anything you disagree with (say so — the PA reproduced all four but
you know this code).
