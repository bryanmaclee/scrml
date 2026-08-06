# SCOPING — the async subtraction: unify the coloring predicates, and stop deciding server-call identity by regex

**Status:** `current` · **last-reviewed:** 2026-08-05 (S322-bryan)
**Authority:** bryan S322 — *"kill C, record it, scope the subtraction."* Origin: `dpa-023`
(`scrml-support/docs/deep-dives/async-boundary-as-state-lifecycle-2026-08-05.md`, ADVISORY).
**Not dispatched.** This is a scope, not a brief.

---

## ⚠ FIRST — a correction to the dpa-023 recommendation, PA-verified by reading the source

dpa-023's "ship first" recommendation was:

> collapse the three disagreeing async predicates **+ the regex-over-emitted-text `.catch` decision**
> (GITI-001 absorb = `clientCode.replace(combinedRegex,…)` in `post-server-fn-iife-wrap`,
> `emit-client.ts:2969` — **§19.6 containment IS decided by a string rewrite**)

**The second limb is FALSE as stated.** Measured:

| claim | verified |
|---|---|
| `post-server-fn-iife-wrap` decides containment by a string rewrite | **NO.** The stage spans `emit-client.ts:2975–3324` and contains **zero** `.replace(` / `RegExp(` operations. It is structural — `collectRequestBodyCells`, `emitRequestSettleMachine`, per-cell conversion sets. |
| `combinedRegex` is in that stage | **NO.** It is at `:2947–2966`, in the **preceding** stage, and it is the **fn-name mangler** (`codeSeg.replace(combinedRegex, (_match, name) => fnNameMap.get(name) ?? _match)`). |

The DD conflated two adjacent stages. **Do not scope work on "de-regexing containment" — containment
is already structural.**

**But the correction makes the finding BIGGER, not smaller.** The regex that actually matters is the
one it mislabelled: the whole-buffer **name mangler**. That is the U1 root cause, independently
re-confirmed here — the client's server-fn call is renamed to `_scrml_fetch_X_N` by a regex post-pass
that runs **after every emitter**, so *at emit time the compiler cannot see it is emitting a server
call.* Every post-hoc injector exists to retrofit a fact the emitter was denied.

That is a textbook instance of the S322 re-examination test: **a normative SHALL (§13.2, position-
invariant auto-await) delivered by RETROFIT rather than BY CONSTRUCTION.**

---

## Limb 1 — collapse the disagreeing async predicates

### Verified loci (PA-located; re-derive before editing)

| # | predicate | locus | disposition on a client server fn |
|---|---|---|---|
| 1 | `isClientServerFnCall` | `compiler/src/codegen/emit-expr.ts:1736` | **INCLUDES** |
| 2 | `combinatorIsAsyncName` | `compiler/src/codegen/emit-expr.ts:1630` | **INCLUDES** (since U1's F2) |
| 3 | `isAsyncName` | **not a function** — an injected callback param, `compiler/src/codegen/async-combinators.ts:93` | **EXCLUDES** |

**Refinement to the DD's framing:** #3 is not a third standalone predicate. It is a **parameter**, and
its source of truth is `computeAsyncFnNames` (`compiler/src/codegen/emit-library-shared.ts:148`) — per
`emit-tool.ts:378`'s own comment. So the shape is **two sibling predicates plus one injected callback
whose provider disagrees with both.** That changes the fix: you are not merging three functions, you
are giving one provider to all three consumers.

### Why they disagree

`computeAsyncFnNames` treats `serverFnNames` as a **seed trigger** — `callsServerFn(callees)` marks the
*caller* async — but **never adds the server fn itself to the result set**. So a consumer asking
*"is `loadRows` async?"* gets **no** from the drain and **yes** from the emitter.

### The unification

One exported predicate, one source of truth, all three consumers on it. **Expected to be
newly-rejecting** where the drain currently under-reports — so it needs a measured migration
(`pa-base` §8) and the corpus count before/after.

---

## Limb 2 — stop deciding server-call identity after the fact

**Locus:** `compiler/src/codegen/emit-client.ts:2947–2966` (`combinedRegex` + `fnNameMap`).

The rename is a whole-buffer regex post-pass over emitted text. Consequences already measured this
session:

- the emitter cannot know it is emitting a server call → the `emitCall` branch U1 added exists only
  because that knowledge was destroyed upstream
- **142 bare client server-fn call sites** remain in cleanly-compiling corpus sources (delta 0 across
  the U1 landing) — the injectors reach one position at a time
- **13,504 IIFEs** emitted, **96% sync**, against **9,276 injected awaits**: every one is a place the
  retrofit has to re-derive a fact the emitter had and threw away

**Direction (not a ruling):** carry server-fn identity **in the emit context** so the name is decided at
emit time, and retire the post-pass. dpa-020's explicit instruction stands: *do not build another
injector.*

**This is the expensive limb.** Scope it separately from Limb 1; Limb 1 is a prerequisite (the unified
predicate is what the emitter would consult).

---

## Sequencing

1. **Limb 1** — unify the predicates. Self-contained, measurable, prerequisite.
2. **The `pending` rung** (`dpa-023`, 5/5 panel convergence) — the source-visible stale-read class.
3. **`_scrml_reset` awaits its thunk** — the runtime class, filed HIGH this session
   (`g-reset-writes-pending-promise-when-init-thunk-calls-a-server-fn`). **Decide this WITH C's
   reasoning in hand** — making `_scrml_reset` async re-raises C's await-vs-containment question at a
   new site, and the answer is likely different there, because `reset()` is a discrete user-initiated
   act where blocking is defensible in a way a page's parallel data loads are not.
4. **Limb 2** — the structural fix. Last, and largest.

## Out of scope

Rebuilding option C (RETIRED S322 — see below). Re-opening the no-async/await ruling (§19.9.8). The
markup reconciliation (`dpa-022`, separate).

## The C retirement, recorded here because this scope replaces it

**Option C — "await the IIFE AND keep its `.catch`" — is RETIRED, superseded before it was built.**
Ruled S322, retired S322 on measured grounds:

- **it serializes what is currently parallel.** Independent server calls emit as separate
  fire-and-forget IIFEs that run concurrently *only because nothing awaits them*. Awaiting each in
  place serializes them — breaking §13.2 mandate 4 and slowing real pages.
- **it fixes a subset the `pending` rung fixes better** — at compile time, by making the bad read
  illegal, rather than at runtime by making things wait.
- **it misses the case the S322 probe found.** `reset()` re-introduces pending-ness from *runtime*
  machinery (`runtime-template.js:1168`), at a site with no source expression. C is the assignment
  lowering; the reset path never goes through it.

**The probe that decided it** (bryan: *"do the probe first"*), same cell, same thunk:

```js
// DECLARATION — <rows>: Row[] = loadRows()
(async () => _scrml_cs_reactive_set("rows", await _scrml_fetch_loadRows_4()))().catch(…)   // AWAITED
// RESET — runtime-template.js:1168
_scrml_reactive_set(name, _scrml_init_fns[name]());                                        // NOT awaited
```

Correct at mount, wrong after `reset()`. **Neither C nor the `pending` rung catches it** — which is
what falsified the PA's claim that the rung "dissolves C's case." It dissolves the *source-visible*
subset.

`provenance: ruling:user-voice-scrml.md S322 — "kill C" · supersedes: ruling:user-voice-scrml.md S322 — "C, keep the error"`
