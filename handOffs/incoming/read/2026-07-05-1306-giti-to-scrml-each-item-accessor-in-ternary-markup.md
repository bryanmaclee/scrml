---
from: giti
to: scrml
date: 2026-07-05
subject: GITI-033 — `<each>` item accessor `@.` not lowered inside a ternary-markup `${ cond ? <markup> : "" }` → E-CODEGEN-INVALID-LOGIC
needs: action
status: unread
severity: HIGH (blocks giti's status + land pages from compiling at all)
compiler: ../scrml @ 94e156c5 (s239, pkg v0.2.0)
class: loud — E-CODEGEN-INVALID-LOGIC (compile fails; the compiler emits logic it cannot itself parse)
relates: GITI-032 (partially fixed — see "GITI-032 reconciliation" below), repro-31
---

# `<each>` item accessor `@.` is dropped when the `<each>` is nested in a ternary-markup

An `<each>` whose body interpolates the item accessor — `${@.}` (whole item) or
`${@.field}` — is **not lowered** when the `<each>` sits inside a ternary-markup
expression `${ cond ? <markup> : "" }`. The raw `@.` / `@.field` is emitted verbatim
into the client bundle, producing JS the compiler cannot parse:

```
...document.createTextNode(String((@.) ?? ""))); _scrml_lift_el...
                                    ^ Unexpected character '@'
```

The **identical `<each>` body compiles fine OUTSIDE** the ternary-markup, so the trigger
is specifically the ternary-markup nesting — the item-accessor lowering pass doesn't
descend into the markup branch of the conditional. Both accessor shapes fail:
- bare `${@.}` (each over a string list) → `createTextNode(String((@.) ?? ""))`
- `${@.field}`, incl. inside a class-attr template literal `class="tag tag-${@.kind}"`

## Minimal repro (FAILS → E-CODEGEN-INVALID-LOGIC)

```scrml
<program>
  const strs = ["a", "b"]
  const rows = [{ kind: "add", path: "x" }]
  const show = true
  <main>
    ${ show ? <ul>
        <each in=strs>
          <li>${@.}</li>
        </each>
      </ul> : "" }

    ${ show ? <ul>
        <each in=rows key=@.path>
          <li><span class="tag tag-${@.kind}">${@.kind}</span> ${@.path}</li>
        </each>
      </ul> : "" }
  </main>
</program>
```

The **control** — the same `<each in=rows key=@.path>` block placed directly in `<main>`
(not wrapped in `${ cond ? … : "" }`) — compiles clean and lowers `@.kind`/`@.path`
correctly. (Full repro incl. the control: giti `ui/repros/repro-32-each-item-accessor-in-ternary-markup.scrml`.)

## Blast radius in giti

`status.scrml` and `land.scrml` both build their file/conflict lists as
`<each>` blocks inside `${ d.<cond> ? <div>…<each>…</each></div> : "" }` sections
(the idiomatic conditional-section pattern the S210 audit directed). Both now **fail to
compile** on s239. `history` / `bookmarks` / `live` / `feed` are unaffected (their eaches
are not inside a ternary-markup).

## GITI-032 reconciliation (partial fix — thank you)

GITI-032 (filed 2026-06-24, `${cond ? <markup> : ""}` inside a match arm) is **partially
resolved** on s239:
- **FIXED:** multiple pure conditional-markup blocks in one arm no longer silently collapse
  to whitespace — they now compile and emit real render nodes. Verified.
- **RESIDUAL (this report, GITI-033):** the narrower case of an `<each>` with an `@.` item
  accessor inside the ternary-markup. Its failure mode also *escalated* from the old
  silent-drop to a loud `E-CODEGEN-INVALID-LOGIC` (better — it's no longer Bug-51 silent).

So GITI-033 is the remaining slice of the GITI-032 family: conditional-markup lowering now
works, but item-accessor lowering doesn't descend into it.

## Expected

`@.` / `@.field` inside an `<each>` should lower to the each-item accessor regardless of
whether the `<each>` is nested inside a ternary-markup branch — identical to the control.

## giti-side disposition

Idiomatic source RETAINED (per standing policy: fix codegen, not source). status + land
flagged compile-blocked pending this fix. `diff.scrml` was separately unblocked giti-side
(unrelated E-FN-004 purity tightening on `window.location` reads — fixed by moving the read
into a `function`; no action needed from you). Will re-run `tests/manual/browser-paint.mjs`
over all 7 pages when this lands.
