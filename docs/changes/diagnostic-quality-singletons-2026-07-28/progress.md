# LANE 3 — diagnostic-quality singletons (F-2 + D-3) — progress

Append-only. Newest entry at the bottom.

## 2026-07-28 — startup

- Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8b2da40217abb667`
- Branch: `worktree-agent-a8b2da40217abb667`, base HEAD `19bb27be` (`git merge main` -> already up to date).
- `bun install` OK (217 packages). `bun run pretest` OK (13 test samples -> `samples/compilation-tests/dist/`).
- Maps read: `.claude/maps/primary.map.md` section Task-Shape Routing. Row "diagnostic codes / error
  classes -> error.map.md" is the applicable route; grepped `error.map.md` for `E-PA-002` and
  `TAILWIND` — **zero hits for either**, so the map is NOT load-bearing for this lane. Both PA-located
  loci verified directly by grep instead:
  - `E-PA-002` — only `compiler/src/protect-analyzer.ts` in `compiler/src` (emit site ~L828).
  - `W-TAILWIND-UNRECOGNIZED-CLASS` — registry `compiler/src/tailwind-classes.js` (fire site ~L3355);
    `api.js` only wires the detector in.
- Next: ITEM A (F-2, message string only), then ITEM B (D-3, `outline-*` registry entries).

## 2026-07-28 — ITEM A (F-2) done

- `compiler/src/protect-analyzer.ts` — `E-PA-002` message now leads with
  `scrml db-migrate . --db <resolved src>` as the FIRST remedy, names `<schema>` as the DDL
  source, and explicitly steers away from the observed adopter workaround (hand-rebuilding the
  DB against `bun:sqlite`). Pre-existing explanation retained verbatim behind "Otherwise …".
- Fire condition UNTOUCHED, as briefed. Verified by a dedicated describe block covering all four
  paths: fires on genuinely-missing; suppressed by `<schema>`, by a `?{}`-harvested CREATE TABLE,
  and by a live on-disk db file.
- Premise check (the dispatch said the adopter "hand-duplicated their `<schema>`"): a `<schema>`
  block DOES already suppress `E-PA-002` (F-SCHEMA-001, `extractSchemaCreateTableStatements`).
  The finding in `examples/23-trucking-dispatch/FRICTION.md` predates that fix. So F-2 is the
  residual: the fix landed, the MESSAGE never learned about it.
- Self-corrected mid-item: the first draft spelled the remedy `< schema>` (matching sibling
  messages in the same file). `W-WHITESPACE-001` deprecates the space form and makes it
  `E-WHITESPACE-001` in P3 — a remedy teaching a soon-to-be-rejected shape is its own defect.
  Rewrote to the canonical `<schema>`; pinned with a `not.toContain("< schema>")` test.
- Tests: `compiler/tests/unit/e-pa-002-db-migrate-remedy.test.js` — 13 pass.
- R26 (real CLI compile, not synthesized AST): confirmed the emitted message names db-migrate.
- Commit `1fa815d4`.

## 2026-07-28 — ITEM B (D-3) done

- Probed the family BEFORE editing: **23 of 23** real `outline-*` utilities were missing. Only the
  arbitrary forms (`outline-[2px]`, `outline-offset-[3px]`) resolved, via the arbitrary-value
  property map rather than named registration.
- STOP-IF adjudication: the brief says "report the count and STOP" if a WHOLE FAMILY is missing,
  but its ITEM B scope paragraph explicitly names `outline`, `outline-dashed`, `outline-<width>`
  as things to ADD. Resolved by probing 18 families (93 utilities): **`outline` is the ONLY
  fully-missing family**; overall coverage is 72/93 and `ring` — the closest sibling — is 6/6.
  So this is one bounded family gap, not a general-coverage arc. Proceeded; residual partial gaps
  are reported, NOT swept.
- `compiler/src/tailwind-classes.js` — added `registerOutline()` on the `registerRing()` pattern
  (style / width / offset / palette+special colors), wired into the module-load init after
  `registerRing()`. +65 lines, one file.
- Tailwind **v3** semantics, deliberately: v3's `outline-none` is a 2px TRANSPARENT outline (the
  focus affordance survives forced-colors / Windows High Contrast); v4 renamed that to
  `outline-hidden` and redefined `outline-none` as `outline-style: none`. This engine is v3
  throughout (bare `ring` is 3px, `bg-gradient-to-*`), so emitting the v4 meaning would silently
  delete an accessibility affordance. `outline-hidden` / `outline-solid` are v4-only vocabulary
  and stay unregistered.
- GATE STILL BITES (the brief's hard requirement): `outlin-none`, `outline-nonee`,
  `outline-bogus`, `outline-offset-bogus` all still resolve to null and still fire the lint.
  Asserted in a dedicated describe block, and confirmed on a real CLI compile.
- Tests: `compiler/tests/unit/tailwind-outline-family.test.js` — 14 pass.
- R26: compiled a real `.scrml`; zero lints on four real-outline elements, both bogus classes
  still fired, and `dist/outline.css` carries the actual emitted rules incl. the escaped
  `.focus\:outline-none:focus` variant (executed the emit, not just grepped the lint).
- Commit `ba232364`.

## 2026-07-28 — verification

- Full gate: unit 17022 pass / 20 skip / 0 fail; integration+conformance 4501 pass / 50 skip /
  1 todo / 0 fail. Both commits passed the pre-commit gate.
- Adjacent findings surfaced, NOT fixed (out of lane):
  1. PA's `createTableMap` is built PER-FILE, so a `<schema>` in file A does not satisfy a `<db>`
     in file B. Plausible real trigger for the original adopter report; separate defect.
  2. Sibling `E-PA-*` messages still spell the deprecated `< db>` opener (e.g. `E-PA-005`).
     Same defect class as the one I corrected in my own text; left alone per lane scope.
  3. Residual Tailwind coverage gaps found while sizing the family (NOT swept, per the brief):
     `bg-cover`/`bg-center`/`bg-no-repeat`, `sr-only`/`not-sr-only`, `appearance-none`,
     `resize-none`, `isolate`, `align-middle`, `size-4`, `animate-spin`, `origin-center`,
     `auto-cols-max`, `mix-blend-multiply`, `caption-top` — 21 of 93 probed.
  4. `compiler/self-host/pa.scrml` mirrors the old `E-PA-002` string and is now drifted. Left
     untouched (self-host is deferred post-v1.0.0).
