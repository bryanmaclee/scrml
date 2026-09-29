# s441-audit-gap-filing progress

- [x] startup: worktree clean, base cf62b4154 == origin/main, bun install ok
- [x] audit items 1-20 reproduced / checked; reproducers in repro/
- [x] PA addendum 1 (items 21-28) reproduced; reproducers in repro/
- [x] PA addendum 2 (site-fix S1-S9) and 3 (tutorial-fix T1-T9) — reproduced by two forks (repro/site-*, repro/tut-*); S9g + S5 spot-re-verified by the parent
- [x] known-gaps §S441 section (46 new: 21 HIGH, 20 MED, 5 LOW) + S441 notes on 11 existing entries
- [x] state.ts --write / --check PASS (gap-counts + master-list recent-sessions regenerated)
- [x] PA addenda 4 (cell-12 review R1-R7) + 5 (fail-shorthand review P1-P8, N3): 13 more new entries (6 HIGH, 4 MED, 3 LOW) + 2 notes — 59 new S441 entries in total
- [ ] push (checkpoint pushed at ebcc45717)

Addendum-2 not filed: S7 (duplicate — note on g-discarded-map-set-method-result-is-a-silent-noop), S9e (client write to a `<x server>` cell is §52.4.2 behaviour), S9f (UPDATE of a protect= column — §14.8 governs read/egress only; ruling-gated if wanted), S9h (= item 12), S8's W-STDLIB half (= item 28), S9c's broad claim (number/email predicates ARE guarded; only `.length` is not — filed narrow), S1 main form (= item 15).

All compiles: `bun compiler/bin/scrml.js compile <f> --output-dir <scratch>` on `cf62b4154`.

## NOT-REPRODUCED (not filed)

Whole items that did not reproduce, and audit sub-claims that turned out wrong. The rest of each item was filed.

| item | claim | what was run | what was seen |
|---|---|---|---|
| 7 (sub-claim) | the warning is a "mislabelled E-WHITESPACE-001" | compile `nerdme/q/hv-pw.scrml` | the code is `W-WHITESPACE-001`; the message only mentions that the form "becomes E-WHITESPACE-001 in P3". Not a mislabel. (The `<255>` fix-it it suggests is wrong, noted in the gap.) |
| 7 (control) | `.length <255` (no space) also breaks | compile `nerdme/q/hv-pw2.scrml` | compiles; `<input>` present. Only the space triggers. |
| 13 (sub-claim) | an exit-1 compile writes INVALID JS | compile `audit/A-repo/tut/t10.scrml`, `node --check t10.client.js` | artifacts are written (confirmed, existing gap), but the JS parses (rc=0). |
| 2 (citation) | "SPEC §38.11 says dynamic topic SHALL emit a subscription call" | read SPEC | the subscription sentence is §38.6.2; §38.11 says the opposite ("SHALL be static literals"). Filed with both sentences quoted. |
| 11 (sub-claim) | fires on the `fn` parameter type | compile `repro/w-lint-008-refinement-predicate.scrml` | fires at the `{` opening a body that contains the predicate (struct body, fn body), not at the parameter. |
| 14 (framing) | "W-ATTR-001 is wrong, SPEC lists db=" | compile `repro/page-db-attr-w-attr-001.scrml` with a `?{}` | the warning is accurate: `<page db=>` is inert (E-SQL-004 fires). The defect is SPEC-sanctioned-but-unimplemented; filed ruling-gated. |
| 22 (r1121 part) | `oauthConfig` route leaks `GOOGLE_CLIENT_SECRET` | executed the emitted `__ri_route_oauthConfig_4` handler as an outside caller | the handler throws `kvPut is not defined` before returning — no leak on that path (a separate emission defect, noted in the gap). The `secretConfig` shape DID leak (HTTP 200 with the secret). |
| T6b | W-TAILWIND-UNRECOGNIZED-CLASS fires on plain classes | fork compiled a class defined in `#{ .card{…} }` | does not fire; it fires only on classes with no CSS anywhere (`host`, `err`) — the §26.5 behaviour. Side note: it also counts class names spelled in `//` comments. |
| T9 | v0.3.0 announcement repeats the false `<auth role>` "strictly smaller bundle" claim | read `docs/website/v0.3.0-announce-2026-05-14.md` | CONFIRMED at line 14 ("Anonymous visitors download a strictly smaller initial bundle than admins … They can't even see the ad…"), contradicting §40.9.5 (SPEC.md ~L24445-24448, "withholds NOTHING" in default mode). A doc defect, not a compiler gap — not filed in known-gaps; routed to the PA. |
| R2 (sub-claim) | inline/arrow `!{}` leak compiles with NO error, SyntaxError at load | compiled rv-cell12-out/p/s7/finline + farrowconst and a `<program>` reproducer | with the default emit gate the build FAILS loud (E-CODEGEN-INVALID-LOGIC, no artifacts); the raw `!{` shows only with `--no-validate-emit`. Filed MED, not HIGH. |
| R4 | CPS poll wrapper `_scrml_cps_driveTick` emits an un-awaited `let r = _scrml_fetch_collectDispatches…()` | two minimal shapes: a `<poll>` body calling a function that calls a server fn (`let r = await _scrml_fetch_collectDispatches_4();`), and a CPS-split function with its own `?{}` + a peer call (server side `let r = await collectDispatches();`, client `await _scrml_fetch_driveTick_6()`) | awaited in both. Not reproduced minimally; the claim came "by inspection" of the flogence build — needs the flogence source to reproduce. NOT filed. |
| R6 | method shorthand emits invalid JS | compiled `repro/object-method-shorthand-emits-invalid-js.scrml` | reproduced, but a DUPLICATE of g-js-constructs-not-rejected-with-named-codes (S440 ruled it) — S441 note added there, no new entry. |
| P1 (sub-claim) | `n == 1 && fail A.X` — "no diagnostic" | compiled `repro/fail-in-expression-position.scrml` | loud on main via the emit gate; the unconditional `return` is visible only with `--no-validate-emit`. Filed MED. |
| P4 (severity) | top-level `fail .X` is MED | same reproducer, read the emit | a top-level `return` kills the page script and the gate misses it — filed HIGH. |
| P8 | nested-comments.scrml stack overflow | compile `samples/gauntlet-s19-phase4/nested-comments.scrml` | reproduced; DUPLICATE of g-recursive-component-overflows-ce-deep-clone — note added. |
| 12 (masking) | — | compiled the engine-effect reproducer with a header comment naming the helper/cell | the warnings disappear: comment text counts as a reference. Recorded in the gap as a second facet. |
