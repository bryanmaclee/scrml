# BRIEF — maps refresh S297 (verbatim dispatch prompt, archived per pa-base §5)

**Dispatched:** 2026-07-28, S297-bryan (ASUS). Agent: `project-mapper`, model `opus`, NON-isolated
(writes `.claude/maps/` in the shared checkout, on branch `chore/maps-refresh-s297` off
`origin/main` @ `115e8b1b`).

---

Refresh `.claude/maps/` for the scrml repo. You are on branch `chore/maps-refresh-s297` in
`/home/bryan-maclee/scrmlMaster/scrml`. **Do not switch branches. Do not `git commit`.** The PA
commits with an explicit pathspec afterward.

## Write-footprint — HARD LIMIT

Write ONLY inside `/home/bryan-maclee/scrmlMaster/scrml/.claude/maps/`. Nothing else. Do NOT touch
`compiler/`, `docs/` (other than the BRIEF dir which already exists), `stdlib/`, tests, or any
generated doc. A concurrent session (S297-peter, Windows clone) is live on
`emit-each.ts` / `emit-lift.js` / `emit-ssr-render.ts` / `runtime-template.js` — you must not write
to compiler source at all, so there is no collision by construction.

## The window

The map watermark is `c700c435` (2026-07-27T11:15:00Z). HEAD is `115e8b1b`. **39 commits.** Get the
real list yourself:

```
git log --oneline c700c435..115e8b1b
git diff --stat c700c435..115e8b1b -- compiler/src compiler/scripts scripts stdlib
```

## Landings the refresh MUST factor in (carried forward, owed across three sessions)

These were recorded as owed by S292, S296 and S295 and never applied. Verify each against source —
these notes are hypotheses about where things live, not ground truth (pa-base v2.7: a locus claim
is a hypothesis).

**From S292 (owed since then):**
- `compiler/src/sql-table-refs.js` — **NEW FILE**, no map row exists.
- `compiler/src/schema-differ.js` — the queried-table grant branch (+389 lines in this window).
- `compiler/src/commands/db-migrate.js` — scanner wiring + the `runPgApply` signature change.
- `compiler/src/runtime-template.js` — chunk-loading depth counter + absolute-url keying.

**From S296 (D-4, the coordinate-space class):**
- `compiler/src/codegen/emit-server.ts` — `distRelativeServerSpecifier`; server import specifiers
  are emitted in **dist** space, not source space (SPEC §47.9.5 strips a leading `pages/`).
- `compiler/src/api.js` — the dist-keyed **forward** index + BOTH reversal sites.
- The `stripPagesPrefix` helper and the source-vs-dist coordinate distinction generally. S296's
  dispatched agent reported the maps **"not load-bearing"** for that arc precisely because no row
  covered any of this.

**From S295 (the three-lane arc, ~1,400 lines):**
- `compiler/src/codegen/emit-client.ts` — see the routing gap below; this is the load-bearing one.
- `compiler/src/codegen/scheduling.ts` — **NEW FILE** (+283 lines), the `on mount` server-call
  async-scope work (§13.2).
- `compiler/src/codegen/index.ts` — child pages loading the shell's transitive module `<script>`s.
- `compiler/src/tailwind-classes.js` — the `outline-*` family registration (D-3).
- `compiler/src/codegen/emit-each.ts`, `emit-lift.js`, `emit-variant-guard.ts`,
  `emit-reactive-wiring.ts`, `emit-event-wiring.ts`, `binding-registry.ts` — the per-item reconcile
  family (S293/S294 landings inside this window).

## The filed routing gap — fix it explicitly

`docs/known-gaps.md` → `g-maps-error-map-missing-diagnostics-and-emit-client` (MED, OPEN). **Two
lanes reported it independently.** Read the entry in full. Two halves:

**(a)** `primary.map.md` §Task-Shape Routing routes "diagnostic codes / error classes" to
`error.map.md`, which has **zero hits** for `E-PA-002` or `TAILWIND`. Both loci had to be found by
grep. Fix the routing so a diagnostic-code lookup actually lands somewhere that contains the code —
either by making `error.map.md` cover them or by correcting where the routing points.

**(b)** The chunk / module-format and chunk-namespacing rows both point at `codegen/index.ts` and
**neither names `codegen/emit-client.ts`, where `detectRuntimeChunks` and every post-emit chunk gate
actually live.** That same blind spot produced the PA's wrong fix-locus in the GH #234 brief. The
gap entry carries a suggested row — verify it against source, then add it (adjusted if source
disagrees):

> runtime-chunk tree-shake gates / a `ReferenceError: _scrml_* is not defined` in a shipped bundle
> → `emit-client.ts` `detectRuntimeChunks` + `POST_EMIT_HELPER_CHUNK_GATES` + `runtime-chunks.ts`
> `CHUNK_DEPENDENCIES`

That row would route four historical bugs (6nz Bug P, Bug 57, GITI-036, GH #234). Confirm those
four actually route correctly under your new row — if one of them doesn't, say so.

## Also check

The scheduled `cloud-maps` CI job is reportedly **FAILING**. Look at
`.github/workflows/` for the job definition and, if you can determine the failure cause from the
workflow file + what the maps tooling now needs, report it. Do not edit `.github/`.

## What to report back (keep it SHORT — this is a report, not a document)

1. Watermark advanced from → to; which map files changed.
2. Per named surface above: **row added / row corrected / already covered / not applicable** —
   one line each. If a note above was WRONG about where something lives, say so explicitly; that
   is more valuable than the row.
3. The routing-gap fix: what you changed for (a) and (b), and whether the four historical bugs
   route correctly now.
4. The non-compliance report: what it flags that is NEW since the last run.
5. `cloud-maps` failure cause, if determinable.
6. Anything you could not map and why.

Do not commit. Leave the tree dirty for the PA.
