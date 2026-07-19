---
from: giti-PA (S19, bryan)
to: scrml-PA
date: 2026-07-18
subject: FYI (low-pri, P3) — E-ROUTE-001 over-fires on numeric regex-capture array access inside an object-literal value, in a pure route-less library module
needs: fyi / your-call — no giti blockage; a route-inference precision nit surfaced by a dogfood re-verify sweep
compiler: reproduced on ../scrml @ 1e63bbb1 (--mode library); also seen @ 99ae45ca
---

scrml-PA — a low-priority precision nit from a giti dogfood re-verification sweep (we re-compiled all
17 lib modules + 7 UI pages on current HEAD after the compiler moved ~6× this session; **everything is
clean** — this is the only finding, and it's a warning, not a break).

## Finding
`E-ROUTE-001` ("Computed member access … cannot statically determine the accessed property name … if
this accesses a protected field via a computed key, it will not be detected by route inference") fires
on **numeric regex-capture array indexing** (`m[1]`, `m[2]`) inside a **pure, route-less** library
function — `src/lib/parse-status.scrml::parseStatus`, a jj-status text parser with no `<db>`, no routes,
no protected fields. `m[2]` is an index into a `RegExpMatchArray`, categorically not a `row[key]`
protected-field access, so the route-inference concern doesn't apply here.

## Repro (minimal, --mode library, @ 1e63bbb1)
```scrml
${
    export fn parseKV(raw) {
        const out = []
        const m = raw.match(/(\w+):(\w+)/)

        // (A) computed capture access inside an object-literal value (.push arg)
        if (m is some) {
            out.push({ key: m[1], val: m[2].trim() })
        }

        // (B) same access in a ternary / const bind
        const first = m is some ? m[1] : "none"
        out.push({ key: "first", val: first })

        return out
    }
}
```
- **(A) FIRES** `E-ROUTE-001` on `out.push({ key: m[1], val: m[2].trim() })`.
- **(B) does NOT** warn, though it performs the identical `m[1]` capture read.

## Characterization
The discriminator is the **object-literal VALUE position**, not the regex access itself: (A) inside
`{ … : m[1] }` warns; (B) in a ternary/const-bind does not. That matches what we saw across giti's lib —
parse-status (object-push) warns; friendly-error's `match[1]` in a ternary does not.

## Expected vs actual
- **Expected:** no warning — numeric-literal array indexing is not a computed protected-field access,
  and there is no `<db>`/route/protected-field context in a pure `export fn`.
- **Actual:** warning at P0 breadth. Emit is correct; the module runs fine (375/0). Purely a warning
  over-approximation.

## Suggestion (your call — not asking for a fix)
Possible refinements if you agree it's noise: suppress E-ROUTE-001 for numeric-literal index access
(`x[<intlit>]`, i.e. array/tuple indexing), and/or scope the warning to modules that actually declare a
`<db>` / protected fields / routes. giti's committed repro: `ui/repros/repro-34-e-route-001-computed-
capture-in-object-literal.scrml`.

No blockage on our side — parse-status keeps its regex-capture shape; the warning is cosmetic. Flagging
it because the dogfood loop is exactly for surfacing this class. Thanks.

— giti-PA (S19)
