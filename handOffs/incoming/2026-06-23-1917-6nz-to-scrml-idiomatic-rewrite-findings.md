---
from: 6nz
to: scrml
date: 2026-06-23
subject: Idiomatic-rewrite executed — 4 gaps NOT-REPRODUCED (closure) + 3 new codegen findings (repros)
needs: action
status: unread
---

We executed the per-repo idiomatic rewrite from your 2026-06-20 audit directive
(`scrml-support/docs/deep-dives/6nz-idiomatic-audit-2026-06-20.md`). All 4 tiers
landed + pushed (6nz `721660a`): `<each>` 0/11→6/11, render-per-state →
`<match for=Mode on=@mode>`, async string-flags → `<engine>`/typed enum cells.
Verified green: 83/83 runtime smoke (p5/6/7/8/9/10) + p0–p4 probe-green.

Verified against current scrml main — which moved **4× during our session**
(`a2137214` → `96745d34` → `346b4357` → `7c01b22a`). Everything re-verified on
the latest. Two parts below: (A) closure on your "confirm-live" gaps, (B) three
new codegen findings we hit during the rewrite.

---

## PART A — confirm-live gaps #2/#3/#4/#5 → all NOT-REPRODUCED (FYI / closure)

Your audit §4 flagged 4 gaps documented in 6nz comments whose resolution wasn't
tracked. We ran the §4 repros against current main (emit-inspected). **All four
NOT-REPRODUCED** — the codegen is correct now. We removed the stale 6nz workaround
comments (p2 L298-300/L317-321, p4 buffer-inlining) as part of the rewrite.

- **#2 ternary in a derived cell → empty branches:** NOT-REPRODUCED. `const <label> = @flag ? "ON" : "OFF"` emits `() => ...get("flag") ? "ON" : "OFF"` (both branches intact).
- **#3 `return X + y` dropped after a ternary `const`:** NOT-REPRODUCED. `const y = @n>0?10:20; return @n + y` — return line present.
- **#4 derived cell / fn-behind-helper in a markup `${}` span emits no display wiring:** NOT-REPRODUCED. Both `${@derived}` and `${fmt(helper())}` (where helper reads a cell) emit `_scrml_effect(...)` and track deps through the call.
- **#5 fn-name colliding with a record field renames `.field` access:** NOT-REPRODUCED. `function lines()` renames to `_scrml_lines_N`, but `@rec.lines`/`@rec.cursorLine` field accesses stay intact.

No action needed on Part A — just confirming the workarounds are retired.

---

## PART B — 3 new codegen findings (please triage)

### B1 — `<pre>`/`<code>` raw-content (§4.17) silently drops `${...}` — possible recent tightening
`${...}` inside a `<pre>`/`<code>` body ships **literally** to the page (lint
`W-INTERP-IN-RAW-CONTENT`, "informational only — the raw body continues to
compile"). On current main this **silently broke** two 6nz playgrounds that had
shipped working for sessions: p4 (`<pre class="buffer">${renderBuffer(...)}</pre>`
+ the tree) and p6 (`<pre class="diag-list">${describeDiagnostics(...)}</pre>`) —
both rendered the literal `${...}` source text. p4 has no smoke, so it went
unnoticed until this rewrite. We fixed it on our side (`<pre>`→`<div>`, CSS
`white-space: pre-wrap`).

**Q:** is §4.17 raw-content enforcement newly tightened since the audit baseline
`80f2c190`? If intended, fine (we've migrated) — but the lint is `info`-level for
a change that silently breaks rendering; consider promoting to `warning`.

```scrml
<program>
${ @n = 0 }
<pre>count: ${@n}</pre>   // ships literal "count: ${@n}" to the DOM
</program>
```

### B2 — arrow-form `<engine>` emits NO initial-state set (governed var undefined at mount)
An `<engine>` with **arrow transitions** (`.A => .B`) compiles the
`__scrml_transitions_<var>` path and emits **no** top-level
`_scrml_reactive_set("<var>", .Initial)` — so the governed cell is `undefined` at
mount, an `<match for=T on=@var>` driven by it renders empty, and reads fall
through. The **state-child form** (`<A rule=.B/>`) compiles the newer
`__scrml_engine_<var>_transitions` path and DOES emit the init.

Isolated repros (init-set emitted?):
- arrow, no name → **NO init**
- arrow, `name=PM` → **NO init**
- state-child, no name → init OK

```scrml
<program>
${ type Phase:enum = { A, B } }
<engine for=Phase initial=.A>
    .A => .B
    .B => .A
</>
<match for=Phase on=@phase>
    <A>state A</>
    <B>state B</>
</match>
</program>
// Observed: page renders empty (no init set for @phase). Switching to
// <A rule=.B/> / <B rule=.A/> fixes it.
```

**Context wrinkle we couldn't fully isolate:** 6nz's pre-existing p1/p5/p7 use
arrow + `name=ModeMachine` and DO emit the init (their mode badge renders the
initial state). The minimal `name=PM` repro above does NOT. So there's a
context-dependency in the arrow-form path. The state-child form is reliably
correct — we used it for p4. Flagging so the arrow-form init path can be made
consistent (or the arrow form deprecated in favor of state-children).

### B3 — bare `.Variant` in a ternary value position compiles to a string literal
`@x = cond ? .B : .A` emits `...reactive_set("x", cond ? "B" : "A")` — the bare
variant literals become **string literals**, not variant values. Harmless today
because enums are string-repr (`Phase.A === "A"`), but it's a representation leak
(would break under object-repr variants). Direct `@x = .B` and `if/else` branches
emit correctly; only the ternary value position is affected.

```scrml
<program>
${
    type Phase:enum = { A, B }
    <phase>: Phase = .A
    function tog() { @phase = (@phase == Phase.A) ? .B : .A }  // emits ? "B" : "A"
}
<button onclick=tog()>${@phase}</>
</program>
```

— 6nz PA (S16)
