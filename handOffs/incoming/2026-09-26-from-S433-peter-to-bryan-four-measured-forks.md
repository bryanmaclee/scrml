---
from: S433-peter (AdiPDesk — second peter box, parallel to S432-peter on the laptop)
to: bryan
date: 2026-09-26
subject: "four routed forks, each pre-measured so the answer is two words — and one of them reframes your own question"
needs: reply
status: unread
---

Four items that need you. **Every one is measured, so none of them needs you to investigate anything** — each
ends in a single sentence you can answer in two words. Where a measurement changes the shape of the
question you already asked, I say so rather than burying it.

**Provenance discipline, so you know what to trust:** items marked **PA-VERIFIED BY EXECUTION** I ran
myself, this session, at `280ecbdd`. Items marked **INSTRUMENT** were measured by a purpose-built scanner
that carries a self-test it must pass before scanning — two of its scanners FAILED their first self-test
and would have reported a confident ZERO, which is why they carry one. Unmeasured things are listed at the
bottom as unmeasured, not estimated.

---

## 1. `g-tenant-floor-inert-for-a-two-qualifier-create-table` (HIGH, security) — ⚑ the fork collapses, and your suspicion was UNDERSTATED

You filed this asking what a two-qualifier table's IDENTITY is. **The measurement says the interesting
damage is already happening at ONE qualifier, and it fails OPEN.**

**PA-VERIFIED BY EXECUTION** (I imported `schema-differ.js` directly and ran it):

```
two qualifiers  (CREATE TABLE db.public.assets …)   -> harvestRawCreateTableDecls returns []   [inert floor, reproduced]

a.assets(id,tenant_id) THEN b.assets(id)  -> keys ["assets"]  stored: CREATE TABLE assets (id TEXT, tenant_id TEXT)
b.assets(id) THEN a.assets(id,tenant_id)  -> keys ["assets"]  stored: CREATE TABLE assets (id TEXT)
```

**Two different tables collapse into ONE bare key, and SOURCE ORDER decides which column set survives.**
Declare the non-tenant one first and the §14.8.10 tenant floor goes inert **for a table that does carry
`tenant_id`** — a fail-open, order-dependent hole, not a missing-capability gap.

**Why widening the regex is the wrong move (INSTRUMENT, read by symbol across five stages).** The bare name
is not merely what the key happens to be — the qualifier is **actively stripped** from the stored statement
(`scanCreateTables` replaces it out, because `resolveDb` replays the DDL into in-memory SQLite, which has no
such namespace). `harvestRawCreateTableDecls` has **no qualifier field on the record at all**;
`extractDesiredSchema` dedups first-wins on the lowercased bare name; `buildTenantContext` stores it in a
`Set<string>`. And the READ side cannot carry one either: `parseFromClause` uses
`IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/` and bails, so `FROM public.assets` makes the whole projection
unresolvable and `resolveTenantScoping` degrades to the fail-closed strip-all branch. Widening the head
regex would not add a capability — **it would enlarge that silent merge.**

**Corpus cost of rejecting, measured (INSTRUMENT, 2,709 files incl. both adopter apps):** `CREATE TABLE` in
93 `.scrml`, 62 inside a `<schema>`. **Qualified heads: ZERO — at one qualifier and at two.** The
one-qualifier form exists only in `compiler/tests/unit/tenant-floor-raw-ddl-schema.test.js` and a
doc-comment. So rejecting costs **zero authored files**.

> **⚑ Your call, one sentence:** approve rejecting a `<schema>` `CREATE TABLE` head with ≥2 qualifiers via a
> diagnostic — **and do you want the existing ONE-qualifier form rejected alongside it**, given it already
> collapses `a.assets` and `b.assets` into one key with order deciding whether the tenant floor engages?

---

## 2. `g-failable-cell-load-fire-and-forget-stale-read-dead-return` (HIGH, adopter flogenceP) — you did the verification at S391; this is the count and the second target you may not have seen

**Population (INSTRUMENT + compiled ground truth):** 86 `@cell = f() !{ … }` sites in 7 files, **80 of them
in `flogenceP/src/app.scrml`**. Compiled that file and counted in the emitted artifact rather than trusting
the regex: **79 fire-and-forget IIFEs, 0 awaited, and 56 of them carry a bare `return;` in the relocated
error arm.**

**⚑ One thing in your S391 note is now stale, and it matters:** you recorded the error arm as dead code.
The **ss41** change already relocated the arm inside the IIFE, so **the arm does fire**. What remains is
that it fires asynchronously and its `return` is confined to the arrow. Three defects in eleven emitted
lines: the continuation runs before the fetch resolves (stale read); the arm's `return` exits only the
arrow, so **the continuation overwrites the error message the arm just set**; and a non-matching variant
does `return <envelope>` from the arrow — a resolved value the `.catch` never sees, silently swallowed —
followed by unreachable code.

**⚑ And "await" turns out to be TWO different targets, which is the part worth your attention:**
- **`+await` the existing IIFE** — fixes sequencing only, ~1 line. The arm's `return` STAYS confined.
- **Straight-line lift (drop the IIFE)** — emit `const r = await stub(args); if (r && r.__scrml_error) { arm } else { set }` directly in the function body. This makes the arm's `return` return from the **author's** function, and it deletes the unreachable set and the swallowed envelope as a side effect.

The machinery the second one needs **already exists and is already correct one level up**: a function
containing a server call is already emitted `async` and its callers already `await` it (verified by
compiling a two-level chain — `plainHelper` emits non-async, `outer` emits `async` + `await`). Only the
local IIFE call is un-awaited.

> **⚑ Your call, one sentence:** does `@cell = f() !{ … }` await — and if so, is it the **straight-line
> lift** (so the arm's `return` returns from the author's function) rather than merely awaiting the IIFE,
> given that **56 of flogenceP's 79 sites carry exactly that `return`**?

---

## 3. `g-cross-channel-cell-name-collision-silently-aliases` (MED, adopter flogenceP) — B is dead by your own hand; A and C now cost the same, so the ruling is the only cost

**Confirmed by execution at HEAD:** `<count>: number = 0` then `<count>: number = 5` at plain `<program>`
scope compiles **exit 0** with zero duplicate diagnostics (one unrelated SPA lint). Emitted client does
`set("count",0)` then `set("count",5)` — one cell, last-wins. The CLI printed info-tier lints on other
compiles this session, so the zero is not an `.errors`-only blind spot.

**Corpus cost of the general diagnostic (C), measured (INSTRUMENT, 2,713 files, 2,295 structural cell
declarations across 858 files):** 2 candidate files, **both hand-inspected and both false positives** —
`uname` declared inside two *different* compound groups (`<signup>` / `<profile>`), a legitimate per-compound
namespace. **Same-scope duplicates across the whole corpus plus both adopter apps: ZERO.** Cross-channel
specifically: 36 channel bodies declare cells, **0** same-name collisions between differently-named
channels (flogenceP's two channels are disjoint — the manual discipline the gap describes).

**⚑ The context that makes this cheaper than when you filed it:** `E-SCOPE-REDECLARE` (§7.3.3) **landed at
S430 round 5 — last week** — for `let`/`const`/`lin`/`function` redeclaration in a block, and its own SPEC
row argues the direction: *"newly-rejecting in name only."* `E-SCOPE-010` exists for file scope but skips
`kind: "state"` by construction. Per-construct duplicate errors already exist for engines, outlets, timers,
idle, foreign-lang, defer and each-empty. **The structural cell `<name> = …` is now the only declaration
kind in the language with no duplicate check at all.** And `E-CHANNEL-008` already makes two imported
channels sharing a *wire name* a hard error — this gap is one level down (distinct channel names, shared
*cell* name).

Both A and C are zero-migration, so cost does not separate them; placement does, and the codebase has both
patterns in this subsystem — declaration-site (`E-SCOPE-REDECLARE`, `E-CHANNEL-008`) and ambiguous-use
(`E-CELL-AMBIGUOUS-MEMBER-RENDER`).

> **⚑ Your call, one sentence:** does the general duplicate-structural-declaration diagnostic (C) land as a
> **declaration-site** error alongside `E-SCOPE-REDECLARE` — corpus cost measured at zero, so the ruling is
> the only cost — or is the channel case a **use-site** diagnostic in the `E-CELL-AMBIGUOUS-MEMBER-RENDER`
> mould (A)?

---

## 4. `g-route-004-untyped-fn-param-escapes-serializability-gate` (MED, adopter flogenceP) — (a) is tiny, but it lands on the one idiom the gap says to preserve

**The gate, read by symbol** (the entry's `:4734` has rotted; it is ~4988 now):
`checkRouteWireSerializability` does `if (!paramName || !paramAnnot) continue; // un-annotated param defaults asIs → allow`. The RETURN direction has the mirror hole, documented in place. The gate inspects annotations only, both directions.

**The exact population option (a) would newly catch — 5 declarations corpus-wide (INSTRUMENT, self-test
validated against the gap's own cited instance, which the first scanner version MISSED):**

```
samples/gauntlet-r13/go-api-service.scrml         handle(request, resolve)         [resolve]
samples/gauntlet-r13/react-auth-dashboard.scrml   handle(request, resolve)         [resolve]
samples/gauntlet-r14/go-api-service.scrml         handle(request, resolve)         [resolve]
samples/gauntlet-r14/react-auth-dashboard.scrml   handle(request, resolve)         [resolve]
../flogenceP/src/ports/lanes.scrml    runGatedAgentic(cwd, taskId, run)   [run]
```

Ratio: **5 of 506** server fns with un-annotated params (~1%); **1,095 un-annotated server-fn params** ride
the `asIs` hatch and (a) leaves every one of them alone.

**Blast radius by execution:** all four gauntlet samples **already fail at HEAD** for unrelated reasons
(`E-PA-002`, `E-CPS-NONIDEM-NO-STORAGE`, `E-SESSION-VALUE`, `E-SQL-004`) and none is in the corpus-compile
floor baseline — they are not working code (a) would break. **But `flogenceP/src/ports/lanes.scrml`
compiles exit 0 today** (3 capability warnings), and its emitted server JS does route it:
`__ri_route_runGatedAgentic_24`.

**⚑ So (a) does not dodge the breakage that ruled out (b) — it concentrates it into one adopter file**,
flipping `lanes.scrml` from exit 0 to exit 1. **And the measurement surfaced a third lever your fork does
not list:** by the gap's own account the route is *spurious* (the fn is import-only, called in-process with
a real thunk), so **not routing an import-only exported fn** removes the guaranteed-500 endpoint **without
rejecting any source at all**.

> **⚑ Your call, one sentence:** (a) as an error, (c) as a warning, or **suppress the route for an
> import-only fn** so the spurious endpoint disappears without rejecting flogenceP's idiom?

---

## Flagged UNMEASURED — stated rather than estimated

- **Item 4's serverness is a textual heuristic, not the compiler's `routeMap`.** Enumerating true route
  boundaries means 2,709 compiles, which this box cannot safely do (it hard-locked three times on
  2026-09-06 under memory pressure). The heuristic was validated against the gap's own instance and run at
  two sensitivities (4 vs 5 hits), so the true population could differ from 5.
- **Item 2's 86 is syntactic**; only flogenceP has compiled ground truth (79/56). Of the other 6 sites, at
  least `conformance/cases/error/handler-recovery-into-cell` calls a client-local failable and does not take
  this path — so the affected repo count is likely 1–2, not 6.
- **Item 3's scan is line-oriented** with a crude container tracker; "zero same-scope duplicates" rests on
  hand-inspecting the only 2 hits, not on a real scope model. A duplicate spelled entirely inline in markup
  would be missed.
- **Item 1(a) counts authored `.scrml` only** — a qualified `CREATE TABLE` reaching the harvester from a
  runtime-interpolated `?{}` is invisible to a static scan.
- One loose end nobody chased: `compile ../flogenceP/src/app.scrml` reports `2 × E-DG-002` **yet exits 0**.
  Out of scope here, but an error code on a zero exit is its own problem.

---
Also sent separately: the **#1045 review findings** (a host import in `clientJs` emits a dangling specifier
— one-call fix, in `api.js`, which is your footprint), landed as PR #1056.

— S433-peter (AdiPDesk). Sibling: S432-peter (laptop) holds the `hold/s429-*` refs, the `when … changes`
fix (#1054) and floor PRs #1047/#1048/#1051/#1052.
