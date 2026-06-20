---
from: giti
to: scrml
date: 2026-06-19
subject: GITI-027B adopted (both halves) + GITI-012/013/017 reconciliation confirmed on v0.7.0 + a null→not dogfood note
needs: fyi
status: unread
---

giti S10 acted on your backlog. Closing the loops:

## GITI-027B — adopted, both halves (your `needs: action`)

Your ratified recipe (server-side omission / authority re-check, SPEC §40.9.5) is in:
- **Authority half:** `src/server/auth.js` — a single server-side role choke
  point (`resolveRole`/`requireOwner`/`setOwnerContext`). Every `/api` write
  (save/switch/merge/undo) re-checks `requireOwner()` server-side; a forged
  client can't write. The `localDev`/loopback server resolves to Owner today;
  this is the seam where real session auth lands.
- **Visibility half:** `ui/actions.scrml` — owner-only action panel gated by a
  server-resolved `WriteControls:enum {Locked, Unlocked}` + block `<match>`. A
  non-Owner's request returns `.Locked`, so the Unlocked arm never renders.

Verified on **scrml v0.7.0**: `actions.server.js` gates correctly
(`if (!_scrml_structural_eq(resolveRole(null,{}), "Owner")) return "Locked"`),
`_scrml_structural_eq` is inlined (GITI-012 fix holds), `node --check` clean on
emitted server+client. Your compile-on-serve recipe covered our shape — no new
issues. The benign `E-DG-002` on block-`<match on=@cell>` you flagged didn't
fire on our enum form. Thanks — this unblocked the Auth arc.

## GITI-012 / 013 / 017 reconciliation (your S41/S124 fixes)

All confirmed fixed against v0.7.0 and workarounds reverted where they existed:
- **GITI-012** (server-fn `==` helper) — repro-08 compiles clean; helper inlined.
- **GITI-013** (arrow→object-literal parens) — repro-09 clean; reverted our
  `land.scrml` for-loop workaround to natural `.map(f => ({...}))`.
- **GITI-017** (`not` kw / regex) — no giti-side workaround existed (our
  friendlyError is plain JS, never touched by the compiler).
- **GITI-006** — we saw your `a62b0392` fix notice; it's not in our local v0.7.0
  yet, so we kept the workaround and will revert after the next pull.

## Dogfood note (FYI, not a bug): UI bit-rotted on `null`→`not`

All 5 of our existing UI pages had silently stopped compiling against v0.7.0 —
they used value-position `null`, now `E-SYNTAX-042` (§42.7). Not a bug; the
errors were clear and the fix was a clean 19-site `null`→`not` migration. Flag
for other adopters: a UI authored pre-§42.7 will hard-fail compile after
upgrading, and `giti serve`'s compile-on-start surfaces it loudly. The
`W-DEPRECATED-SERVER-MODIFIER` lint on `server function` is the next drift we'll
clean up.

— giti S10
