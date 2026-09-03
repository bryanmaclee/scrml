# peter → bryan — apostrophe in an `<engine>` state-child body breaks the parse (S196 fix never generalized to the engine locus)

**Status:** PA-CONFIRMED BY EXECUTION on `c91969c7`, minimal + control + mechanism. Routed, not
peter-fixed — engine/native-parser surface and you are LIVE (S397). Filed
`g-engine-state-child-apostrophe-breaks-parse` (MED). Sibling of your RESOLVED
`g-match-arm-apostrophe-bs` (S196).

## The defect
A straight apostrophe (`'`) anywhere in an `<engine>` state-child body — bare or inside a nested
plain-markup child — breaks the parse and reports the LAST variant as a missing state-child:

```scrml
<engine for=S initial=.A>
    <A rule=.B><p>go</p></>
    <B><p>it's ready, don't wait</p></>   // ← one apostrophe here...
</>
```
→ `E-ENGINE-STATE-CHILD-MISSING: <engine for=S> body is missing a state-child for variant .B …
Add the missing state-child (<B>...</>)` — **`.B` is present in source.**

## It is your S196 fix, un-generalized to the engine locus
`g-match-arm-apostrophe-bs` (RESOLVED S196) is the SAME class — "markup-text prose `'` read as a
string delimiter" — fixed at `block-splitter.js:findStructuralBodyEnd` +
`match-statechild-parser.ts:findArmCloser/findNextArmOpener`, per the S109 ruling *"markup-text body
is TEXT with no string concept."* The `<engine>` state-child parser is a DISTINCT file
(`engine-statechild-parser.ts`) with its own closer-scan, and it never got the fix. This is the same
generalize-per-locus shape as `g-shorthand-interp-engine-element-loci` (the S196 `:`-shorthand fix
also needed separate engine-locus wiring).

## Verified (all on `c91969c7`)
| case | result |
|---|---|
| `<B><p>don't</p></>` in engine (odd `'`) | **E-ENGINE-STATE-CHILD-MISSING** (false) |
| `<B><p>it's here, don't leave</p></>` (even `'`, 2) | **compiles** — proves string-lexing |
| `<B><p>do not</p></>` / `We will` (controls) | compiles clean |
| `<div><p>we'll email you.</p></div>` (normal markup, no engine) | compiles clean |

Mechanism: the closer-scan reads `'` as a string-span open; an unterminated span swallows the `</>`
closer + any following state-children, so the last variant reads as "missing." (Even count "closes"
the phantom string → compiles.)

## Two defects, not one
1. **Parse:** the apostrophe breaks the closer-scan (the S196 gap, engine locus).
2. **Diagnostic:** MORE misleading than the match sibling's `E-CTX-001 "Unclosed <match>"` — it tells
   the author to add a state-child that already exists, so the remedy is un-followable and the true
   cause (an apostrophe) appears nowhere in the message.

Contractions (don't / we'll / it's / can't) are ubiquitous in UI copy, and `<engine>` is the flagship
Tier-2 construct the tier ladder steers authors to — high-traffic.

## Locus (PA-LOCATED, not fully traced)
`compiler/src/engine-statechild-parser.ts` closer-finding scan. The "interior quote / apostrophe /
backtick … opens a phantom string" hazard is acknowledged in comments at `:1398` / `:2155`, but the
guard is incomplete for a plain-body apostrophe. Fix template: mirror the S196 match fix per the S109
"markup-text is prose" ruling.

## Severity
Filed **MED** to match the resolved match sibling (fail-LOUD, exit 1 — not silent-wrong). Aggravators
for re-tiering: the diagnostic is actively misleading, and it breaks a common input on a pillar
feature. Tier is yours.

Repro dirs (this machine): `…/scratchpad/w13` (odd), `…/scratchpad/w15` (even, compiles),
`…/scratchpad/w12` (normal markup control). — peter, S398
