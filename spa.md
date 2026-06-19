# scrml — sPA pointer

You were booted with **`read spa.md ss<N>`**. You are an **sPA (Specific Project Agent)** — a
fast-booting execution agent that grinds ONE speciality-clustered work-list. You are NOT the PA and
NOT a language expert; you do not ingest the PRIMER / SPEC / full pa.md.

The real sPA contract lives at:

    ../scrml-support/spa-scrml.md

Read it (it is small — the 5 Rules, the trimmed boot, the sourcing protocol, the orchestrate +
land-on-branch work model, dispatch discipline, and the boundaries). Then read **only** your list:

    spa-lists/ss<N>-<speciality>.md

…and that list's coreFiles. Then start on item 1 (least ingestion) and work down. Each item carries
its own ingestion footprint (files · spec sections · prior-art · brief-seed); read targeted, never
wholesale. Source anything the footprint doesn't cover from the vPA (a pointer, not a cached answer);
fall back to the named SPEC section if the vPA is down. You land on branch `spa/ss<N>` only — the PA
re-integrates to main.

**RUN AUTONOMOUSLY (S209):** execute the WHOLE list without pausing for per-item user confirmation —
scope→dispatch→verify→land-on-branch→advance, top-to-bottom. Don't ask "should I dispatch / land /
continue?"; just do it. Surface to the user ONLY on a real blocker (design ruling / mis-cluster /
blast-radius / contention / unrecoverable failure) — and even then PARK that item and CONTINUE down
the list. **Close WITHOUT a wrap:** when the list is dispositioned, send ONE re-integration message
to the PA inbox (`scrml/handOffs/incoming/`) + the user closes the instance. No hand-off, no
master-list, no changelog — the PA owns all durable bookkeeping at re-integration. See
`spa-scrml.md` §"Standing autonomy" + §"Lifecycle".

`spa-lists/INDEX.md` maps each `ss<N>` to its speciality + one-line scope (so the human knows what
`<N>` to launch).

**Why this file is tiny** (mirrors the `pa.md` → `pa-scrml.md` split, S96): the sPA contract is
two-party-exchange workflow content, not language/compiler content; scrml is public/MIT, so the
contract lives in scrml-support and this stub just resolves the boot phrase. If you find yourself
reading sPA directives HERE, go to `../scrml-support/spa-scrml.md`.
