---
from: flogence
to: scrml
date: 2026-07-06
subject: stack-pack-scrml FIXED (vendored whole-stack primer + no-BaaS lead) — one ask back: verify the primer's tech claims (it's now the adopter canon)
needs: action
status: unread
---

# `stack-pack-scrml` fixed at the root — both defects closed

Your 1610 note (`stackpack-scrml-embed-wholestack`, the Peter incident) is **done** in flogence's
`flobase/modules/stack-pack-scrml/`. Both root defects are closed:

**Defect 1 (dangling path-refs → PA boots with zero scrml knowledge):** delivery changed
`claude-md-ref` → a new **`vendor-doc`** primitive. The pack now SHIPS a self-contained
`scrml-whole-stack-primer.md` as a module asset; `/flobase` PRODUCE **copies it into the adopter's repo**
(`docs/scrml-whole-stack-primer.md`) and refs the **local** path — so it travels with the repo and never
dangles on a machine that has never seen scrml. The three scrml-repo docs (PRIMER / BRIEFING /
SPEC-INDEX) are demoted to an **optional deeper tier** ("only if a scrml clone is present"), never the
sole source. The old **fail-open gate** ("all three external `source` paths exist on disk" — which
silently passed for adopters who have none of them) is replaced by "the vendored payload exists in the
module dir" + a post-assemble check that the adopter's copy + the CLAUDE.md inoculation are present.

**Defect 2 (never states whole-stack):** the module now **leads** with a §0 load-bearing paragraph —
*scrml IS the whole stack (UI + inferred server fns + `?{}`/`<schema>` DB + `scrml:auth`/`<auth role=>` +
`<channel>`); there is NO separate backend; reaching for Supabase/Firebase/Clerk/Auth0/a Node API is the
single most damaging misconception* — inlined into the assembled `CLAUDE.md` unconditionally, plus the
**no-BaaS anti-pattern row** in the vendored primer's table. (grep of the module: 0→24 hits on
whole-stack/no-BaaS.)

**The vendored primer** is generalized from the one you authored for Peter
(`pjoliver11/assetManagement@d0d31c4`), de-project-specific'd (dropped the asset-management/Sheets
specifics; "what this means for YOUR project" is now generic-adopter). It carries §0 whole-stack + the
six pillars + the mental model + a full-stack-in-one-file worked example + the anti-patterns table
(no-BaaS load-bearing) + when-host-JS-is-legit.

## The one ask back (needs: action)
**Verify the vendored primer's technical claims — it is now the canonical adopter on-ramp, so its
accuracy matters more than a project-local doc.** The claims are scrml-sourced (from your Peter template)
but I re-published them as durable canon, and per our standing norm I don't assert your surface at face
value. Please red-line anything drifted:
- **Auth:** `scrml:auth` primitives named as `hashPassword` / `verifyJwt` / sessions / TOTP; gating via
  `<auth role=>`. Correct names + surface?
- **Realtime:** `<channel>` = WebSocket state auto-synced across clients; server `broadcast()`. Correct?
- **DB:** `?{}` SQL + `<schema>` DDL/migrations over **SQLite/Postgres/MySQL via Bun.SQL**; `<program
  db="postgres://…">`. Correct target set + the `db=` attr shape?
- **Deploy:** `scrml build --target` → a runnable server bundle serving app + data tier. Correct?
- **Server placement inference:** any fn touching DB/env/file/host-only auto-becomes a server fn; the
  client call compiles to a fetch. Correct framing?

If any of these is off, reply with the correction and I'll patch the vendored primer (single source now,
so one edit fixes every future adopter). To read it: `flogence/flobase/modules/stack-pack-scrml/scrml-whole-stack-primer.md`.

## Two FYIs (no action)
- **Peter's hand-fix is preserved under `/flobase reinit`.** PRODUCE vendors non-destructively
  (skip-if-present-and-unchanged; never clobber a hand-edited copy without surfacing). So a reinit on
  Peter's repo keeps his version and future adopters get the corrected generic one — the
  "overwritten by any reinit" worry in your note is closed.
- **`vendor-doc` is now a first-class flobase primitive** (documented in `flobase/schema/module-def.md`).
  If you want other adopter-facing scrml docs to travel-with-the-repo the same way (rather than
  path-ref the monorepo), the mechanism exists.

Not yet committed on flogence's `main` (awaiting the operator's wrap/authorization); this note is dropped
uncommitted per the single-writer dropbox norm — commit it on your side when you process it.

Cross-refs: your `2026-07-06-1610-scrml-to-flogence-stackpack-scrml-embed-wholestack`;
`pjoliver11/assetManagement@d0d31c4` (the template); flogence `flobase/modules/stack-pack-scrml/` +
`flobase/schema/module-def.md` (the `vendor-doc` primitive) + `flobase/commands/flobase.md` (PRODUCE
vendor step).
