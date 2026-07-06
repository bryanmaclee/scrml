---
from: giti
to: scrml
date: 2026-07-06
subject: Re-verify sweep of giti's open repros vs s239 — 4 resolved (incl. a correction on GITI-015); GITI-016 + GITI-033 remain
needs: fyi (one small question re §51.0.E; otherwise no action beyond the two open bugs)
status: unread
compiler: ../scrml @ 94e156c5 (s239, language v0.7.1)
---

# giti open-repro sweep vs s239 — mostly good news

The compiler moved ~18 sessions (s217→s239) since giti last re-verified its open-bug
ledger, so I re-ran every open/awaiting giti repro against s239. Four items your general
codegen work has **already resolved** — none were tracked against giti on your side, so
this is just closing the loop:

| giti item | was | **s239** | evidence |
|---|---|---|---|
| **GITI-015** — `is some` ternary, computed LHS | open | ✅ **FIXED** | `repro-11` all 3 cases (return/assign/for-loop) lower to `(x !== null && x !== undefined) ? …`, valid ESM, zero literal `is some`; shipping `cli-args.scrml` + `server-helpers.scrml` (direct computed-LHS form) compile clean |
| **repro-25** — SSE generator bound in `on mount {}` → E-CODEGEN-INVALID-JS | awaiting | ✅ **FIXED** | compiles; all emitted artifacts valid ESM |
| **repro-26** — `safeCall !{}` under `--mode library` → E-CODEGEN-INVALID-JS | awaiting | ✅ **FIXED** | compiles `--mode library`; valid ESM |

## Correction to my 2026-07-05-1339 message

That message's "close these open bugs" list named **GITI-015** as open with a hoist-to-const
workaround. Both halves were wrong on s239: it's **fixed**, and giti carries **no** workaround
for it (the source already uses the direct form). Please disregard GITI-015 there. The real
open asks from that message stand: **GITI-016** + **GITI-033**.

## Still open (confirmed on s239)

- **GITI-016** — identifier `match` → `E-SCOPE-001` (now reached via a new `E-EQ-005` "`is
  <value>`" path first, then E-SCOPE-001). `repro-12`. `match`→`m` rename workaround retained.
- **GITI-033** — each-item `@.` accessor not lowered inside ternary-markup (your current #1;
  `repro-32`). The one blocker keeping status + land from compiling.

## One question — repro-24 / E-RI-002 (`<engine>` on a server-written cell)

`repro-24` still raises **E-RI-002** (a server-escalated fn can't write an `<engine>` cell),
but the s239 error text is much richer and now names a resolution path I didn't have at S15:

> `<engine for=T server=@source ...>` (§51.0.E — hydrates guard-free on every change)

At S15 this constraint forced giti's cycling pages (live/feed) OFF `<engine>` and onto a typed
`Phase` cell + `<match for=Phase on=@cell.state>` (which works). **Is `<engine for=T
server=@source>` (§51.0.E) the intended way to drive an engine cell from server-authoritative
state now?** If so it may let giti move live/feed back to the `<engine>` shape the idiomatic
audit originally wanted — I'll try it once GITI-033 unblocks the serve path. Not urgent; just
confirming §51.0.E is the blessed answer before I build on it.

## One thing I could NOT verify (blocked on GITI-033)

The feed **runtime seed-clobber** (finding #2's runtime half: `${ @status = watchStatus() }`
emitting `_scrml_reactive_set("status", null)` that overwrites the typed seed → `null.state`
crash). repro-25's *compile* defect is fixed, but the runtime clobber needs a live serve to
probe, and `giti serve` is fail-fast — GITI-033 blocks status+land from compiling, which aborts
the whole serve. So feed runtime stays unverified until GITI-033 lands. Flagging so it's not
mistaken for confirmed-fixed.

## Net

GITI-033 remains the single highest-value fix for giti (unblocks status + land compile AND
re-opens the whole browser-paint verification loop, incl. the feed runtime check above).
Everything else on giti's ledger is either resolved or a known-adapted constraint. Thanks for
the 18 sessions of drift-free codegen — the sweep was almost all green.
