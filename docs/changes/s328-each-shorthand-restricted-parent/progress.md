# S328 — `<each>` `:`-shorthand inside restricted-content parents

Dispatch progress log. Appended after every meaningful step.

## Step 0 — startup verification

- WORKTREE_ROOT: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1608436b89304904`
- `git rev-parse --show-toplevel` matches. Tree clean at dispatch. HEAD `18fc0571`.
- `bun install` OK (217 packages).
- `bun run pretest` OK (13 test samples compiled to `samples/compilation-tests/dist/`).
- BRIEF.md archived verbatim (one numbering typo in the source brief's gate list: gate "3" appeared
  twice; archived as 3/4 to keep the list readable — content otherwise verbatim).

## Step 1 — locus verification (PA-LOCATED-VERIFY)

Both PA-asserted loci **HELD, verbatim**:

- `compiler/src/codegen/emit-each.ts:1147-1152` — the shorthand mount branch
  (`if (shMarkupCapable) { emitEachInterpExprToJs(..., /*markupCapable*/ true) }`).
- `compiler/src/codegen/emit-each.ts:1110-1117` — `_rcdataValueExpr`, gated on `!isShorthand`
  (line 1112), so the shorthand branch has NO restricted-parent guard at all.

Refinement worth recording: `isRcdataElement()` (`compiler/src/html-elements.js:928`) is backed by a
single registry row — **`<textarea>` is the ONLY rcdata element**. `<option>` is NOT rcdata (its
content model is *Text*, and `option.value` is the value ATTRIBUTE, not the label text), so the
`<option>` lowering is `textContent`, not `.value`. The restricted-parent class therefore has TWO
distinct correct lowerings, not one.

## Step 2 — SPEC governing-sentence gate (pa-base §1 Rule 4)

Read IN FULL: SPEC §4.14 (`compiler/SPEC.md:978-1052`) and §17.7 (`compiler/SPEC.md:11820-12194`).

**GOVERNING SENTENCE — SPEC §4.14 line 1021:**

> **Non-void HTML elements** (`isVoid:false` — `<span>`, `<div>`, `<p>`, `<li>`, `<label>`,
> `<button>`, etc.): a `:`-shorthand body IS the element's single-expression body, **byte-identical
> to the bare-body form** `<tag>${expr}</tag>`. `<span : @label>` renders exactly as
> `<span>${@label}</span>`; `<li : @.name>` (the §17.7 `<each>` per-item form) is the same rule
> applied in iteration scope.

**Extended into `<each>` scope by SPEC §17.7.6 lines 12176-12177:**

> - The per-item element opener inside `<each>` SHALL admit §4.14 `:`-shorthand body when the
>   per-item rendering is a single expression. No `<each>`-specific extension to the §4.14 grammar
>   is introduced.
> - The §4.14 closer-presence rule, mandatory-whitespace-before-`:` rule, single-expression rule,
>   and multi-statement rejection apply IDENTICALLY inside `<each>` body scope.

So shorthand-vs-longhand parity is not a nicety — it is the normative §4.14 contract, and §17.7.6
carries it verbatim into `<each>` scope. The fix direction is decided by SPEC, not by taste.

## Step 3 — empirical reproduction + emission matrix (R26, by execution)

`bun compiler/bin/scrml.js compile <probe> --output-dir <tmp>` at base HEAD `18fc0571`.

PA reproduction **reproduced verbatim** (`repro.client.js:34-46`) — the mount `<span data-scrml-mv>`
is appended INSIDE the `<textarea>`.

Full 6-cell matrix (one file, one markup-returning `fn label`, six `<each>` blocks):

| # | Source shape | Emission at base HEAD | Verdict |
|---|---|---|---|
| a | `<textarea : label(a.name)>` | mount span inside `<textarea>` | **BUG — NEW (S327/#456)**, data loss |
| b | `<textarea>${label(b.name)}</textarea>` | `_el.value = String(...)` | no data loss (longhand already guarded) |
| c | `<option : label(c.name)>` | mount span inside `<option>` | **BUG — NEW (S327/#456)** |
| d | `<option>${label(d.name)}</option>` | mount span inside `<option>` | **BUG — PRE-EXISTING (S297/#161)** |
| e | `<span : label(e.name)>` | mount span inside `<span>` | correct (flow content admits an element child) |
| f | `<span>${label(f.name)}</span>` | mount span inside `<span>` | correct |

**The `<textarea>`-new vs `<option>`-pre-existing split the brief asked me to verify: CONFIRMED,
with one refinement.** `<textarea>` diverges (b is guarded, a is not) — that is a live §4.14
byte-identity violation. `<option>` does NOT diverge: c and d are *both* broken, identically, so
`<option>` is currently in (wrong) parity. Fixing only the shorthand half of `<option>` would
CREATE a §4.14 parity violation where none exists today — so the `<option>` longhand path must be
fixed in the same change or not at all. Fixing both is what the brief's mandated parity conformance
case requires.

Third measured tag: `<title : label(a.name)>` also mounts a span (`out-tags/tags.client.js:34-37`).
`<style>`/`<script>` do NOT reach this emission path at all (zero `createElement("style")` /
`createElement("script")` in the probe output; `<style>` is additionally ghost-linted to `#{}` per
§9), so no lowering is defined for them here.

## Step 4 — measured migration (gate 3)

Corpus scanned: `samples/`, `examples/`, `conformance/`, `docs/`, `stdlib/`, `benchmarks/`, `e2e/`,
`dashboard/` — all `*.scrml`.

Restricted-content-parent openers present: **167** (`<option` 127, `<textarea` 26, `<style` 10,
`<title` 4, `<script` 0).

Restricted-content-parent openers using the `:`-shorthand body form: **0 sites, 0 files.**

The only colon-bearing restricted-tag lines (11) are `bind:value=` — the attribute-namespace
separator, not a `:`-shorthand body. Positive control: the same regex family matches 160 `:`-bearing
tag-opener lines corpus-wide, so the zero is a measured zero, not a broken pattern.

This independently corroborates the brief's gate-5 point: the `0/7260 byte-identical` differential
#456 shipped on could not have seen this defect, because the shape it needs does not exist anywhere
in the corpus.

> ⚠ **STEPS 5-9 BELOW DESCRIBE THE FIRST ATTEMPT, WHICH WAS REJECTED `DO-NOT-LAND` BY THE S239
> ADVERSARIAL GATE.** They are kept verbatim because the round-2 rationale only makes sense against
> them. The scope was too wide (it covered `<option>`/`<title>`), and the direction-of-change label
> was wrong. **Read Step 10 for what actually landed.**

## Step 5 — the fix, FIRST ATTEMPT (commit `2c89086c` — SUPERSEDED)

ONE content-model decision, `eachBodyLowering(tagName)` (`emit-each.ts`), consumed by BOTH emission
branches. Three lowerings, because the restricted-content elements do NOT agree on what "put the
text here" means:

| lowering | elements | write | why |
|---|---|---|---|
| `"value"` | `<textarea>` (`isRcdataElement`) | `.value` | body IS the element's value; a `textContent` write sets only the DEFAULT value and stops tracking once the control is dirty |
| `"text"` | `<option>`, `<title>` | `.textContent` | content model is *Text*; an element child is invalid. NOT `.value` — `option.value` is the value ATTRIBUTE, not the label text |
| `"flow"` | everything else | MOUNT `<span data-scrml-mv>` | an element child is legal here; #456's fix is preserved intact |

`<style>` / `<script>` deliberately excluded — measured: neither reaches this emission path (zero
`createElement("style")` / `createElement("script")` in the probe; `<style>` is additionally
ghost-linted toward `#{}` per §9). `.textContent` on a `<script>` also EXECUTES, which is a separate
ruling, not a silent side effect of a data-loss fix.

The `bind:value` suppression stays RCDATA-scoped. It exists because a two-way `bind:value` and an
RCDATA body both claim the SAME property (`W-RCDATA-BIND-VALUE-CONTENT-CONFLICT`). No such conflict
exists for a text-only element, where `bind:value` claims the value ATTRIBUTE and the body claims the
element's TEXT — suppressing there would only put the forbidden element child back.

**Direction of change: semantics-changed, toward the §4.14 contract.**
> **WRONG — corrected in Step 10.** `toward the contract` is a sub-split of **`newly-accepting` ONLY**
> (pa-base.md:1128-1134, "Newly-accepting splits in two"); it is not a modifier of
> `semantics-changed`. The correct label is plain **`semantics-changed`**.

Nothing newly rejects or newly
accepts; no diagnostic added, removed, or re-scoped. Four emission sites move:

1. `<textarea : markupCapableCall(x)>` — mount → `.value` (**the data-loss fix; NEW in S327/#456**)
2. `<option : markupCapableCall(x)>` — mount → `.textContent` (**NEW in S327/#456**)
3. `<option>${markupCapableCall(x)}</option>` — mount → `.textContent` (**PRE-EXISTING since S297**;
   fixed in the same change because leaving it would create a §4.14 byte-identity violation against
   the now-fixed shorthand half)
4. `<textarea : anyExpr>` — `textContent` → `.value` (**PRE-EXISTING**; the bare-body form already
   wrote `.value`, so this is the byte-identity repair for the plain-string case)

## Step 6 — adversarial verification

Every new gate was confirmed to FAIL against the pre-fix emitter, then pass with it.

- `compiler/tests/browser/g-each-shorthand-restricted-parent.browser.test.js` — 5/5 with the fix;
  **4/5 FAIL** on the pre-fix emitter (`Expected: 0, Received: 1` element child). The 5th is the
  flow-content NEGATIVE CONTROL, which passes on BOTH — that is what proves the new guard is not
  over-broad and that #456's mount still works.
- Conformance: **860/860** with the fix; **857/860, 3 FAILED** without it.

**happy-dom masking, measured rather than assumed.** A throwaway probe run against the pre-fix
emitter reported:

```
PROBE emitted-mount?      : true
PROBE childElementCount   : 1
PROBE innerHTML           : "<span data-scrml-mv=\"\">alpha</span>"
PROBE happy-dom .value    : "alpha"
PROBE textContent         : "alpha"
```

So BOTH `.value` and `textContent` assertions PASS on the bug — only DOM shape discriminates. Every
load-bearing assertion in the new test and in the conformance cases is therefore a shape assertion
(`childElementCount`, `firstElementChild`, selector `count`). The `value:` rows in the conformance
cases are corroboration for a conformant-DOM impl and are explicitly labelled as non-discriminating
in each case's rationale.

The `innerHTML` line is also the concrete SSR hazard: `<textarea>`'s parser content model is RCDATA,
so a serialize-and-reparse of that markup makes the literal text `<span data-scrml-mv="">alpha</span>`
the textarea's value — visible garbage, not just an empty box.

## Step 7 — wide-corpus emit differential (the standing pre-land codegen gate, #428)

**First attempt was INVALID and is reported as such.** Base was captured from an rsync'd copy at a
different filesystem path; the emitted chunk-namespace hash is path-derived, so all 983 artifacts
differed for a reason that had nothing to do with the change. The harness independently refused it
(`FINDING [INCOMPARABLE] a side's revision is "<unknown>"`, exit **2**). Per primary.map.md invariant
41, exit 2 means NOT A VALID COMPARISON and must never be read as "no differences" — recorded here
rather than discarded.

**Second attempt, valid.** Both sides captured from the SAME root path, toggling only
`emit-each.ts` between captures (`--allow-same-revision`, since the git revision is necessarily
identical on both sides). Exit **1** — differences found.

```
  sources enumerated        base 1883   head 1883
  source set delta          0
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    3 of 7269 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  syntax delta (script)     0 new / 0 fixed
  syntax delta (module)     0 new / 0 fixed
  load-context changes      0
  bare server-fn sites      base 142 / head 142  (delta 0, in 0 source(s))
```

All 3 content differences are the 3 conformance cases added by this dispatch, each SHRINKING as the
mount scaffolding collapses to a single property write:

```
conformance/cases/each/shorthand-longhand-parity-restricted   7250 -> 5735 bytes
conformance/cases/each/shorthand-restricted-option            3061 -> 2595 bytes
conformance/cases/each/shorthand-restricted-textarea          3064 -> 2592 bytes
```

**WHAT THIS POPULATION COVERS AND WHAT IT CANNOT SEE** (brief gate 5). It covers 1,883 `.scrml`
sources under `examples,samples,conformance,stdlib,benchmarks` and the 7,269 artifacts they emit,
1,212 of which compile cleanly. It CANNOT see any language shape absent from that corpus — and
before this dispatch, `:`-shorthand inside a restricted-content parent was exactly such a shape
(0 sites, measured in step 4). That is why #456's `0/7260 byte-identical` was honestly clean while
shipping a data-loss defect: the differential measured a population that contained no exemplar.
**The 3 cases added here are now permanent corpus coverage for this axis**, so a future regression
on it will surface as a content diff instead of a silent zero. Note also that a corpus differential
is blind by construction to correctness — it detects CHANGE, never wrongness; the 3 diffs it reports
here would look identical whether the change were the fix or the bug.

## Step 8 — full local suite (`bun run test`, chains `pretest`)

| run | state | pass | fail | skip | todo | files |
|---|---|---|---|---|---|---|
| BEFORE | pre-dispatch baseline (emit-each at `18fc0571`, new test + 3 cases moved aside) | 29,778 | 49 | 216 | 1 | 1,342 |
| AFTER-1 | this dispatch | 29,782 | 51 | 216 | 1 | 1,343 |
| AFTER-2 | this dispatch, **identical state to AFTER-1** | 29,786 | 49 | 216 | 1 | 1,343 |

**Failure NAME SET delta, AFTER-2 vs BEFORE: 0 new, 0 fixed** (primary.map.md invariant 8 — gate on
the name set, not the count).

AFTER-1's two extra failures were run-to-run flakiness, established rather than assumed:

1. Both entries (`flagship driver/hos — <engine> under an if=` + one unnamed) are ABSENT from
   AFTER-2, which ran at a byte-identical state.
2. `flagship-hos-engine-under-if.browser.test.js` passes 7/7 in ISOLATION with the fix AND with the
   pre-fix emitter.
3. The `compiler/tests/browser` failure set is IDENTICAL (47 named) with and without the new test
   file present.

This is the known happy-dom whole-suite global-state leak: adding a browser test file shifts file
ordering, which can flip a leak-sensitive test in an unrelated directory. Not caused by this change.

## Step 9 — residuals surfaced, NOT closed

1. **A markup-ONLY-returning call in a restricted parent still stringifies** to
   `[object HTMLElement]` — e.g. `<textarea : badge(it)>` where `badge` returns markup on every
   path. This is the ESTABLISHED, already-shipped disposition (the bare-body `<textarea>` `.value`
   path has done exactly this since 6nz-F4 and was not flagged), so this change EXTENDS a ruling
   rather than inventing one — but it is a silent wrong render and the right long-term answer is a
   diagnostic ("a markup-returning call has no valid rendering in a text-only content model").
   That needs a new §34 row, so it is out of scope here.
2. **A restricted parent with an UNSUPPORTED child shape still falls through to the mounting
   recursion.** `eachRcdataValueExpr` returns null on a child shape it cannot concatenate (e.g.
   `<option>text <b>x</b> ${f(it)}</option>`), and the fallback recursion can still mount. Pre-
   existing and unchanged; the author wrote invalid HTML explicitly in that case.
3. **The three other #456 review findings are untouched, by instruction** — the expression-lowering
   asymmetry (shorthand uses `rewriteContextualSigil`, a strict SUBSET of the bare-body path's
   `lowerEachExpr`: no `@cell` → reactive-get, no §42 predicate lowering; visible in the emitted
   matrix as `_scrml_label_1(a.name)` vs `_scrml_label_1 ( b.name )`), the SPEC-contradicted
   rationale comment, and the silent `catch`. One comment was ADDED beside the false "never
   over-wraps → no restricted-parent regression" premise so a future reader is not misled by it,
   but the flagged block itself is left verbatim.
4. **`<title>` is covered by the fix but is not a registered element** in `html-elements.js` (it
   exists only as a GLOBAL_ATTRIBUTE; the registry comment at `:277-279` already notes it as "a
   cheap follow-up if a `<title>` element form is added"). It reaches this emission path and was
   mounting a span, so it is handled here; a proper registry row remains owed.


---

# Step 10 — FIX ROUND 2 (what actually landed)

The first attempt came back **DO-NOT-LAND** from the S239 adversarial gate with two blocking
findings. Both were verified independently before implementing anything, and both held.

## BLOCKER 1 — the `<option>` half REGRESSED rendered output. Confirmed.

Verified on a **conformant oracle** (real Chromium via puppeteer), because happy-dom cannot see
either half of this defect. Probe: a mixed-return `fn label(n) { if n == "" { return <i class="none">none</i> } return n }`
over rows `[{name:"alpha"}, {name:""}]`, so BOTH branches are exercised.

| shape | BASE `18fc0571` | ROUND-1 (rejected) | verdict |
|---|---|---|---|
| `<option : label(x)>` | label **"alpha"** / **"none"** | **"[object HTMLElement]"** | **REGRESSION** |
| `<option>${label(x)}</option>` | label **"alpha"** / **"none"** | **"[object HTMLElement]"** | **REGRESSION** |
| `<textarea>${label(x)}</textarea>` | `"alpha"` / `"[object HTMLElement]"` | identical | unchanged |
| `<textarea : label(x)>` | `.value` **`""`** / **`""`** | `"alpha"` / `"[object HTMLElement]"` | the real fix |

**My "extends a shipped ruling (6nz-F4)" defence splits, exactly as the gate said.** It is TRUE for
`<textarea>` — base longhand already emitted `.value = String(...)` and renders
`"[object HTMLElement]"` on the markup branch, byte-identical base↔fix. It is **FALSE for
`<option>`** — option longhand never stringified; it mounted, and the label read through correctly.
So round-1 traded an invalid-SHAPE-but-correct-LABEL for a valid-SHAPE-but-garbage-LABEL, with zero
diagnostic. That is strictly worse: the label is what the user reads.

**Both oracle divergences measured, not assumed** (happy-dom 20.8.9):

```
happy-dom  textarea.value with an element child  ->  "alpha"     (conformant: "")
happy-dom  String(<an element>)                  ->  "<i class=\"none\">none</i>"
                                                     (conformant: "[object HTMLElement]")
```

So the SAME oracle class that masked the original #456 bug also masked its first fix.

## The `<textarea>`-only scoping: VERIFIED, then implemented

The gate asked me to check the scoping before implementing, and to stop if it broke parity or
reintroduced a loss. It does neither:

- **No data loss reintroduced.** `<option>` never had one — base renders the label correctly in real
  Chromium (measured above). Only `<textarea>` lost the value, because a textarea's value IS its
  child text content.
- **No parity broken.** At base, BOTH `<option>` forms mounted, so §4.14 byte-identity already held
  for `<option>`. Restoring base behaviour restores that parity.
- **Confirmed byte-identical.** A probe containing every `<option>` form plus `<textarea>` bare-body
  compiles to output that `diff`s clean against base: **BYTE-IDENTICAL TO BASE**.

Landed shape: both `<each>` per-item branches read one local, `_isRcdataBody = isRcdataElement(tagName)`.
`eachBodyLowering` / `TEXT_ONLY_CONTENT_ELEMENT_NAMES` / the three-way `EachBodyLowering` type are
**deleted**. `_restrictedBodyExpr` is back to `_rcdataValueExpr`, writing `.value` only.

Post-fix, on the conformant oracle:

| shape | BASE | ROUND-2 |
|---|---|---|
| `<textarea : label(x)>` | `kids:1`, value **`""`**, **`""`** | `kids:0`, **`"alpha"`**, `"[object HTMLElement]"` |
| `<textarea>${label(x)}</textarea>` | `kids:0`, `"alpha"`, `"[object HTMLElement]"` | identical — **parity reached** |
| `<textarea : c.name>` | value `"alpha"` (via textContent) | value `"alpha"` (via `.value`) — parity |
| `<option>` × 4 forms | labels `"alpha"`/`"none"` | **identical to base** |
| `<li : badge(x)>` (#456) | mounts | **identical to base** |

## BLOCKER 2 — the "ONE decision, both consumers" comment. Confirmed, and corrected.

Both halves verified before rewriting the comment:

- **Inside `emit-each.ts`:** `eachRcdataValueExpr`'s null-bail IS a surviving second gate. Executed:
  `<textarea>${it.name}<b>x</b></textarea>` emits `_scrml_el_2.appendChild(_scrml_frag_3)` carrying a
  real `createElement("b")`, and real Chromium reports **`childElementCount === 1`**. Pre-existing,
  not closed here.
- **Outside it:** `emit-html.ts:1903` gates on `isRcdataElement(tag)` — so the top-level path answers
  the same question separately, and it is also where `W-RCDATA-BIND-VALUE-CONTENT-CONFLICT` fires
  while the `<each>` path stays silent. (`emit-html.ts` is REVERTED on main and out of scope; not
  touched.) A third answer lives on the Tier-0 `lift` path.

The comment now states exactly what the shared local does gate (the two `<each>` per-item branches)
and enumerates the three answers it does **NOT** gate. The overstated "the compiler now has one
content-model decision" claim is gone, along with the `[data-scrml-mv]`-count-0 whole-document
assertion in the parity conformance case that encoded the same overstatement.

## Corrected direction-of-change

**`semantics-changed`** — plain, no modifier. Same source, different behaviour, no diagnostic delta;
recoverable **"no, and SILENT — the most dangerous"** (pa-base.md:1125). `toward the contract` is a
sub-split of `newly-accepting` only (pa-base.md:1128-1134) and does not apply.

Emission sites that move, final:

1. `<textarea : markupCapableCall(x)>` — mount → `.value` (**the data-loss fix**; NEW in S327/#456)
2. `<textarea : anyOtherExpr>` — `textContent` → `.value` (PRE-EXISTING parity gap; the bare-body
   form already wrote `.value`)

Nothing else moves. `<option>`, `<title>`, flow content, and every longhand path are byte-identical
to base.

## Gates, re-run three ways

Each gate is now confirmed to fail against BOTH the original bug AND the rejected over-wide fix:

| gate | vs BASE | vs ROUND-1 (over-wide) | vs ROUND-2 (landed) |
|---|---|---|---|
| `g-each-shorthand-rcdata-parent.browser.test.js` | **3 fail** | **1 fail** (counter-gate) | **5 pass** |
| `each/shorthand-restricted-textarea` | **FAIL** | pass | **PASS** |
| `each/shorthand-longhand-parity-rcdata` | **FAIL** | pass | **PASS** |
| `each/shorthand-option-label-preserved` | pass | **FAIL** | **PASS** |

`each/shorthand-option-label-preserved` is new in round 2 and exists specifically to make the
round-1 mistake un-repeatable: it pins the `<option>` LABEL on both branches of the mixed fn, in
both body forms. Its `text:` assertions DO discriminate under happy-dom — measured: the broken
lowering yields the literal text `<i class="none">none</i>`, which is not `"none"`.

Renames, so the names stop overclaiming scope:

```
g-each-shorthand-restricted-parent.browser.test.js -> g-each-shorthand-rcdata-parent.browser.test.js
each/shorthand-longhand-parity-restricted          -> each/shorthand-longhand-parity-rcdata
each/shorthand-restricted-option                   -> each/shorthand-option-label-preserved
```

## Filed, NOT fixed (round 2)

Carried from round 1: the markup-only-return stringify in `<textarea>` (F1 — wants a §34 diagnostic,
which needs its own row and ruling; explicitly not minted here); the `eachRcdataValueExpr` null-bail
second gate (F2); the three other #456 review findings (F3).

New this round:

4. **`<title>` ordering trap.** `eachBodyLowering` is gone, but the hazard it would have carried is
   worth recording: `html-elements.js:~272-279` carries a standing invitation to register `<title>`
   with `rcdata: true`. If anyone accepts it, `isRcdataElement("title")` flips true and `<title>`
   silently starts lowering to `.value` — an expando on `HTMLTitleElement`, so the title would never
   update. Anyone taking that invitation must check this site.
5. **`<textarea>` shorthand `.textContent` → `.value` for EVERY shape** leaves `defaultValue === ""`,
   so `form.reset()` and a bfcache restore blank the field. The bare-body form has always had this;
   the change extends it to shorthand as the price of parity.
6. **`<textarea bind:value= : expr>`** emits two `.value`-surface writers. The top-level path fires
   `W-RCDATA-BIND-VALUE-CONTENT-CONFLICT` for the equivalent shape; the `<each>` path is silent.
