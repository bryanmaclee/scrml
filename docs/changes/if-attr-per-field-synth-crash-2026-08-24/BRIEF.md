# BRIEF — `if=@compound.field.<synthProp>` must resolve the flat synth key, not root-get-then-navigate

change-id: if-attr-per-field-synth-crash-2026-08-24
dispatched: S372-bryan, 2026-08-24, base origin/main @ b0abcbc6
gap: g-if-attr-per-field-synth-cell-crashes-boot (HIGH)
DONE-PROBE: compile `<span if=@signup.name.touched>` and EXECUTE the shipped artifact — a sibling `${@flag}` interpolation on the same page must render, and no TypeError may reach `_scrml_boot`

## The symptom — PA-VERIFIED BY EXECUTION on `b0abcbc6`, reproduce it FIRST

Source (whole file; `<flag>` is the control):

```scrml
<program>

<flag> = true

<signup>
    <name req length(>=2)> = <input type="text"/>
</>

<span if=@signup.name.touched>GATED</span>
<p id="ctl">${@flag}</p>

</program>
```

Compiles **exit 0, zero relevant diagnostics**. Loading the shipped pair the way the emitted
HTML does gives:

```
TypeError: null is not an object (evaluating '_scrml_cs_reactive_get("signup").name.touched')
    at _scrml_nav_rewire
    at _scrml_boot
```

and **`#ctl` renders empty** — the throw is inside boot, so *every* `${…}` interpolation on the
page never wires. This is not a broken element; it is a dead page.

## ⚑ THE DETECTOR — "no throw" is NOT the discriminator

happy-dom **swallows exceptions thrown inside a listener**, so a harness that wraps
`dispatchEvent(DOMContentLoaded)` in try/catch reports "no throw" for the broken case. I hit
this and it cost a probe round. **The observable is: did the sibling control interpolation
wire?** Boot completed → `#ctl` is `"true"`. Boot died → `#ctl` is `""`. Add a `console.error`
capture and a `window.addEventListener("error", …)` if you want the message too.

## ⚑ AND: mount the SHIPPED runtime CHUNK, never `runtime-template.js`

`compiler/tests/browser/browser-conditionals.test.js` evals the full `SCRML_RUNTIME` template.
That template defines everything the pruned `scrml-runtime.<hash>.js` chunk omits and therefore
**masks a whole defect class** (S371 method correction). Read `result.runtimeFilename` and load
THAT file. `compiler/tests/browser/browser-theme-switch.test.js` is the correct pattern; use
`compiler/tests/helpers/chunk-scope.js` `captureInsideChunkScope` to reach chunk-local accessors.

## The four-way discriminator — PA-EXECUTED, all five rows, on `b0abcbc6`

| `if=` bound to | `#ctl` control | verdict |
|---|---|---|
| `@flag` — plain Shape-1 cell | `"true"` | ✅ |
| `@signup.name` — 2-level compound field | `"true"` | ✅ |
| `@signup.isValid` — **compound-level** synth | `"true"` | ✅ |
| `@signup.name.touched` — **per-field** synth, 3-level | `""` | ✗ TypeError |
| `@signup.name.isValid` — **per-field** synth, 3-level | `""` | ✗ TypeError |

So the trigger is **the three-level path to a PER-FIELD synth cell** — not synth cells generally
(compound-level works), not compound-nav generally (2-level works). Consistent with PRIMER §13.7
B12: per-field synth records live in a distinct `kind:"field"` scope reached only through
`lookupQualifiedStateCell`'s extended descent.

`${@signup.name.touched}` in an **interpolation** works correctly (renders `false` → `true` on
interaction). The cells are sound. This is `if=` lowering specifically.

## Locus — TRACED, not searched. Report held / refined / wrong.

I can state the path from entry point to decision:

1. **`compiler/src/codegen/emit-html.ts:1403` and `:1468`** (§17.1 mount/unmount gate) and
   `:3160` (the display-toggle path) record the binding with `varName` = the BASE segment
   (`signup`) plus `dotPath` = the full dotted string (`signup.name.touched`).
2. **`compiler/src/codegen/emit-event-wiring.ts:474-518`,
   `computeDisplayToggleCondition`** — the decision site. It has two branches:
   - `b.condExpr` (line ~476-506): calls `emitExprField(condNode, b.condExpr, { mode: "client",
     derivedNames: ctx.derivedNames, **synthCellKeys: ctx.synthCellKeys**, requestIds })`.
     Its own comment at `:501` says: *"Bug 61 — thread synthCellKeys + derivedNames so
     `if=@form.isValid` conditional-display reads route to the dotted synth cell."*
   - `b.varName` + `b.dotPath` (lines **508-518**): consults **nothing**, and emits
     ```js
     conditionCode = `(_scrml_reactive_get(${JSON.stringify(encodedCondVar)}).${b.dotPath.slice(condVarName.length + 1)})`;
     ```
     — a root-segment reactive read plus a **literal JS member chain**. That is byte-for-byte
     the crashing string.
3. `computeMountToggleCondition` (`:540-556`) delegates to the same function, so the mount path
   inherits the same lowering — which is deliberate and correct (the §17.1 Phase 2 comment at
   `:520-533` explains the two were unified precisely because they had silently diverged on the
   GH #262 / #275 defect class).

**Why the runtime object cannot satisfy the chain:** the compound parent is a namespace, not a
value (§6.3 Variant C). `get("signup")` returns an object whose `.name` is `null` — hence
`.name` alone is merely falsy (no throw), `.isValid` resolves, and only `.name.touched`
dereferences null.

## The fix direction — EXTEND the existing mechanism, do not add a second path

⚑ **The machinery already exists and is already used one branch away.** The flat keys are
registered in the same artifact:

```js
_scrml_cs_reactive_set("signup.name.touched", false)
_scrml_cs_derived_declare("signup.name.isValid", …)
```

and `ctx.synthCellKeys` (built by `collectSynthCellKeys`, consumed via
`collapseSynthSurfaceRefsInRaw` — see `compiler/src/codegen/emit-expr.ts:950-956`, which carries
the identical `#262` comment) is exactly the set that knows them.

So: in the `b.varName` + `b.dotPath` branch, **when the full dotted path is a registered synth
key, lower to `_scrml_reactive_get("signup.name.touched")`** and subscribe to that key — reusing
the existing helper rather than writing a parallel resolver. A near-duplicate predicate beside an
existing one is this repo's standing hazard (it is what #688 deliberately avoided, and what Rule 7
and the S337 "hand-maintained parallel walker" class are both about).

⚑ **DO NOT "fix" it with optional chaining (`?.`).** That stops the crash while leaving the
condition permanently false — trading a loud failure for a silent-wrong one. This project has
ruled against that direction repeatedly.

⚑ **Do not narrow any existing check without counting what it stops inspecting** (pa-base §8,
the coverage-removal blind spot). If your change makes the `dotPath` branch fire on fewer shapes,
report the population it no longer covers.

## Direction of change (pa-base §8 — classify it and PROVE the classification)

Expected **inert for every currently-working shape** and **newly-working** for the crashing one:
a program that produced a dead page now produces a live one. That is not a language widening —
nothing newly COMPILES that did not compile before; the emitted lowering changes. State the
classification in your report and back it with the corpus emit differential.

## What you owe

1. **Reproduce first**, with the corrected detector + shipped-chunk mount. If it does not
   reproduce, STOP and report — do not build a fix for a ghost.
2. The fix at the traced decision site, extending `synthCellKeys` consultation into the
   `dotPath` branch.
3. **Verify the trace and report held / refined / wrong.** My locus is traced, but trust it only
   as far as you can re-derive it.
4. Tests: a **merge-blocker browser test** that EXECUTES the shipped artifact and asserts the
   control interpolation wires, covering all five discriminator rows above. Put it beside the
   existing browser tier.
5. **The corpus emit differential** (`scripts/corpus-emit-differential.ts`) — capture BOTH sides
   at the same-shaped path (`git worktree add`, NOT `git archive` into an arbitrary dir: the
   chunk-namespace token is `fnv1aHash` of the source path, so a path change manufactures
   phantom same-length different-hash diffs). **Treat exit 2 as NOT-A-VALID-COMPARISON, never as
   "no differences."**
6. **Bite proof**: revert your fix hunk on a COMMITTED state and show the new test goes red.
   ⚑ **Do NOT `git stash` to do this** — a mid-flight stash destroyed real work at S365. Revert a
   committed hunk instead.
7. Flip the gap entry in `docs/known-gaps.md` only if the empirical check passes.

## Write-set — HARD BOUNDARY, two sibling branches hold unlanded work

**You MAY write:**
- `compiler/src/codegen/emit-event-wiring.ts`
- `compiler/src/codegen/emit-html.ts` (only if the trace proves the binding record is wrong)
- `compiler/src/codegen/emit-expr.ts` (only to REUSE/export an existing helper)
- new test files under `compiler/tests/`
- `docs/known-gaps.md`, and `docs/changes/if-attr-per-field-synth-crash-2026-08-24/progress.md`

**You MUST NOT write** (unlanded sibling work — a collision here loses someone's day):
- `compiler/src/codegen/emit-client.ts` · `compiler/src/codegen/emit-each.ts` ·
  `compiler/src/validators/attribute-allowlist.ts`  ← held branch `0e836a70` (each-alias)
- `compiler/SPEC.md` · `compiler/src/type-system.ts` · `compiler/src/api.js`
  ← held branch `2514a84c` (match-arity)

If the real fix lands inside a forbidden file, **STOP and report** rather than writing it.

## Crash-recovery (non-negotiable)

Commit after every meaningful unit — WIP commits are expected and are your only anchor. Keep
`progress.md` appended with timestamped lines. An agent that dies with a complete fix uncommitted
loses all of it; that happened at S371 and cost a salvage round.
