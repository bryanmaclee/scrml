---
from: S412-peter (P-Tech1, Windows)
to: bryan
date: 2026-09-10
priority: high
subject: Three silent defects were live in the SHIPPED stdlib (throttle, debounce, jwt) — all fixed. And the self-host coverage hole now has a second limb that is yours.
---

# Three shipped-stdlib defects, and a coverage hole with a second limb

All six S412 PRs are merged and gate-green (#928–#933). Nothing here is asking you to authorise a
build — it is all landed. **Two things need you specifically**, both at the bottom.

## What was silently broken in the standard library

None of these was found by reading code. Each was found by an instrument disagreeing with me.

**1. `stdlib/time` — `throttle` did not throttle and `debounce` did not debounce.**

Both build a closure over an outer `let`. `emit-logic.ts`'s `case "function-decl"` built its child
scope with `declaredNames: new Set()` — a fresh EMPTY set — reasoning that *"a function body has its
own scope for declared names."* A function body owns its own **declarations**; it does not lose sight
of the bindings around it. So every **captured** binding read as undeclared, and a bare `x = expr`
emitted as a **declaration**:

```
inThrottle = true      →   const inThrottle = true;      // shadows; outer never set
timer = setTimeout(…)  →   const timer = setTimeout(…);  // outer stays `not`
```

`throttle`'s `if (!inThrottle)` guard therefore always passed, and `debounce`'s cancel-pending path
never fired. **SPEC.md:5986 is normative that the program is legal** — *"Inner `function` declarations
MAY mutate outer `let` bindings."* Fixed in #930 by seeding the child scope from the enclosing one.

⚑ I had scoped this to self-host from the gap entry's framing. **The corpus differential corrected
me** — wrong about the mode (browser and library emit identically) and wrong about the population.

**2. `stdlib/auth` — `base64urlDecode` hangs.**

`while (s.length % 4) s += "="` emitted as an **empty loop with the `s += "="` dropped entirely** —
an infinite loop for any input whose length is not a multiple of 4. All three `while` sites and both
`for` sites had only `if (peek().text === "{")` and **no braceless limb**, while `parseOneIfStmt` has
had one all along. Fixed in #933. **13 live sites in the tracked corpus**; the other 12 are in
`compiler/self-host/` (`bs.scrml` ×9, `pa.scrml` ×2, `bpp.scrml` ×1).

**3. `semdiff` neutralised ordinary author data.**

#923's generalized discovery captured the attribute **value**, and `data-scrml-key` / `-ref` / `-scope`
carry author and row data. `data-scrml-key="customer_record_1"` discovered `customer` and replaced
**every occurrence of that word across the whole artifact, page text included** — the false-COSMETIC
direction, in the instrument whose job is to catch regressions. Fixed in #931 by anchoring on the
token's own shape: `fnv1a-hash.ts` zero-pads to 8 chars and a u32 max is 7 base36 digits, so **every
chunk token begins with `0`** (verified over 200,000 tokens). The function's own doc comment already
said `0[0-9a-z]{7}`; the patterns never encoded it.

## ⚑ TWO THINGS FOR YOU

### 1. Issue #922 is still open and still unstamped

The regex-class-colon fix landed at `6951baa5` (#924, S411) and is `semantics-changed`, which
`pa-profile-pjoliver11.md` says owes a **language-surface review**. The issue carries the landing SHA
and the full corpus differential, so you are reviewing a landed, measured fix rather than authorising
a build. It stays open until you stamp it — closing it would erase the outstanding review rather than
discharge it. **No rush from me; just flagging that it has now been open two sessions.**

### 2. The self-host coverage hole has a SECOND limb, and it is `ci.yml` — your surface

You already know `compiler/tests/self-host/` is run by **neither** CI job. This session found the other
half: **`compiler/self-host/` contributes 0 sources to `corpus-emit-differential`** — its roots are
`examples,samples,conformance,stdlib,benchmarks`.

So the 12 braceless-loop sites in `bs.scrml` / `pa.scrml` / `bpp.scrml` were invisible to **both** of
the project's wide instruments simultaneously. That is the same blind spot that let the S406 82 GB
runaway rot, now measured from a second direction.

Peter's S410 sequence still stands and I have not touched it: name-set baselines for `tracking` → an
assertion-count floor → decide `self-host/`'s status **explicitly** (gated, or quarantined with a gate
asserting it is still quarantined). I would add: consider whether `compiler/self-host` belongs in the
differential's default roots. **All of it edits `ci.yml`, your active surface at the open #907** — so I
am routing rather than taking it.

## Also filed, not taken

- `g-user-fn-named-reset-emits-undefined-at-call-site` (**HIGH**) — a user fn named exactly `reset` has
  its call replaced by `/* C5: unexpected reset target shape; B22 should have rejected */ undefined` at
  exit 0. Isolated against `setCol`/`tare`/`clear`, which all compile fine. **The emitted comment shows
  the compiler knows it is in an unexpected state and emits `undefined` anyway** — a fail-OPEN on an
  internal invariant. Peter-lane and drainable; I ran out of session, not confidence.
- `g-library-mode-map-bracket-read-does-not-lower` (MED) — §59.6's read lowering is gated on
  `client || server`, so `m["k"]` at the library boundary emits a raw property access on a HAMT node.
  **Deliberately routed, not fixed:** widening `emitIndex` needs the same boundary-safety argument the
  existing branch makes, and *"what boundary is a library module?"* is a language question — the same one
  `rawFallbackReason`'s foreign-code exclusion already routed rather than decided. **Your call.**

## Gate

Conformance **905/905**. Unit tier **18,552 / 2**, both `node --check` co-run canaries passing 30/0
together in isolation. Self-host **139 / 3**, all three filed. Four corpus differentials over 1,928
sources / 7,467 artifacts; every changed artifact diffed line by line.

⚑ `tracking` was RED on all six PRs. It is the filed whole-job pre-existing failure — and this session
proved it independent of my changes by noting it fails on **#928, which is docs-only**.

— S412-peter
