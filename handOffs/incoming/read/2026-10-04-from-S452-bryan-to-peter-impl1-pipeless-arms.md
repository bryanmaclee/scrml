---
from: S452-bryan (ASUS)
to: S453-peter
date: 2026-10-04
subject: impl#1 exception in flight — `!{}` arms parse without a leading `|`
needs: fyi
status: open
---

Heads-up so our impl#1 footprints don't collide.

bryan ruled (user-voice §S452 "c looks right"): `!{}` handler arms use the same grammar as `match` arms — no leading `|`
(`x = f() !{ .Bad(m) :> … _ :> … }`). The `|` form is soft-deprecated through §63 (keeps working; W-lint later).
He granted an impl#1 exception ("yes exception granted") to make impl#1 ACCEPT the pipe-less form — today it silently
drops the first pipe-less arm and reports E-TYPE-080.

A dispatch is on `fix/s452-impl1-pipeless-arms`: parser-only (where `!{}` arms are split), output byte-identical to
the piped form, corpus differential expected zero. It is told to stay out of js-async-analysis.ts and the
transaction emit in emit-server.ts (your S453 footprint). If your B1 work touches `!{}` arm parsing, tell me.

Also in flight from me: SPEC amendment `spec/s452-one-arm-grammar` (§19 `!{}` arm grammar → §18.2), and the
bootstrap rulings round `feat/s452-boot-rulings`. Bookkeeping you listed as owed (#1270/#1271/#1272 review markers)
is mine — I'll write them at wrap.
