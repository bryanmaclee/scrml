# BRIEF — egress-tojson-root (S350-bryan, 2026-08-18)

Dispatched by the PA onto `egress-fix-r1` (`f3cb62c9`). Security surface. **DO NOT LAND** — the PA
runs a mandatory S239 adversarial pass before any PR.

## Why this exists — PA-VERIFIED BY EXECUTION, not relayed

The S349 fix round recorded two blockers against `45fc29b5`. The PA re-ran both. One was
misdiagnosed, one is confirmed, and they share a single root.

### A/B, same source, both compilers (PA-executed)

| shape | main | branch `45fc29b5` |
|---|---|---|
| `handle()` + SQL inline + raw `globalThis.Response` | exit 0 (ships column) | **exit 1 `E-PROTECT-004`** |
| same + `{...u}` spread | exit 0 (ships column) | **exit 1 `E-PROTECT-004`** |
| `handle()` + SQL in a CALLED helper + spread | exit 0 | **exit 0 — gate silent** |

**`E-PROTECT-004` is INTRAPROCEDURAL.** It fires when a protected SELECT and a raw egress sit in the
same function body; it goes silent across one call hop. The spread is NOT what defeats it — the CALL
BOUNDARY is. The fix round's "object spread drops the toJSON hook" is the wrong cause for Blocker 1.

### Executing the BRANCH's own shipped helper (extracted from the emitted artifact)

```
JSON.stringify(u)      = {"id":1,"name":"ada"}                          <- redacted by toJSON
JSON.stringify({...u}) = {"id":1,"name":"ada","passwordHash":"SECRET"}  <- LEAKS
descriptor survives spread?  true
toJSON survives spread?      false
```

- **Blocker 2 CONFIRMED.** A SERVER-INTERNAL `JSON.stringify(row)` — e.g. stringifying a row into an
  audit table that never crosses the wire — returns SILENTLY MISSING COLUMNS on the branch. Main
  returns the full row. This is a behaviour regression the branch introduces.
- **Blocker 1's wire leak NOT REPRODUCED on the branch.** The cross-function shape compiles clean but
  emits a bare `fetchUser(1)` that is **not defined in the emitted module** -> ReferenceError, not a
  leak. Treat the cross-call residual as UNPROVEN-BUT-SUSPECTED, never as demonstrated.

## THE ROOT (this is the whole point of the arc)

`toJSON` is a **value-level hook doing an egress-direction job**. A value cannot know WHY it is being
serialized. That one property produces both symptoms: it over-fires on internal serialization
(Blocker 2) and under-fires after any shallow copy (Blocker 1's mechanism).

Patching the spread is a per-position fix — `Object.assign`, `structuredClone`, `.map(r => ({...r}))`,
`JSON.parse(JSON.stringify(r))` are all the same hole. FORK RULE row 4: fix the root.

## Rule 4 governing sentence (quoted — do not re-derive)

`compiler/SPEC.md` §14.8.9, the `E-PROTECT-004` catalog row (SPEC.md:19284):

> "...reaches a compiler-unanalyzable egress path — a `_{}` foreign-code block (§23), a manual
> `Response` / `handle()` body (§40), or an `asIs`-typed value — ... where origin-keyed structural
> redaction (§14.8.9) cannot be guaranteed, and the column is not `reveal`-declassified.
> **Fail-closed: the compiler will not ship a protected column through a path it cannot redact.**"

The SPEC already mandates REFUSAL, not best-effort redaction. The gate is the sanctioned mechanism;
the `toJSON` backstop is an unmandated fail-open addition that changes semantics.

## UNIT 1 — delete the `toJSON` install (the deletion)

`compiler/src/codegen/protect-egress.ts`, `SERVER_PROTECT_HELPER` (PA-located-verify — the PA read
this constant; report if the locus is wrong or incomplete). Remove `_scrml_protect_mark`'s
`Object.defineProperty(row, "toJSON", ...)` and route callers back to setting the Symbol descriptor
directly. Keep `_SCRML_PROTECT`, `_scrml_protect_tag`, `_scrml_protect_reveal`, `_scrml_protect_redact`
exactly as they are — the compiler-owned sink is the mechanism that stays.

**Also update the helper's own comment block**, which currently asserts the toJSON behaviour at
length. A comment describing a mechanism that no longer exists is the same defect class this arc is
closing (co-location: if a thing does a thing, look at the thing).

Direction-of-change: **semantics-changed, server-internal only** — restores main's behaviour for
internal serialization. No source that compiles today stops compiling. Prove it with an emit
differential, not an assertion.

## UNIT 2 — extend `E-PROTECT-004` across the call boundary

The residual. The gate must fire when a protected-origin row reaches a raw egress via a callee.
Direction-of-change: **newly-rejecting** (reversible; adopters can fix code).

**Measured migration — PA re-measured independently, do NOT re-derive:** 75 `.scrml` declare
`protect=`; 16 contain a raw `Response`/`handle()` egress; the intersection is
`conformance/cases/protect/raw-egress-e004/case.scrml` and
`conformance/cases/protect/reveal-suppresses-e004/case.scrml` — both dedicated cases that exist to
exercise this gate. (A third grep hit, `docs/website/pages/articles/server-boundary-disappears.scrml`,
is HTML-entity-escaped PROSE — `i&#102;` / `r&#101;turn` inside an article — not code. Confirmed by
the PA; do not migrate it.)

**If Unit 2 turns out to need interprocedural analysis the current pass structure cannot support,
STOP and report** with what you found rather than building new infrastructure. Unit 1 stands alone
and is worth landing by itself. Report the cost honestly — the depth-of-survey discount cuts both
ways and the PA would rather have a correct scoping than an attempted build.

## Rule 4b provenance (required on any normative/marker touch)

`prov=ruling:user-voice-scrml.md S347` for the defects-before-the-primitive sequencing;
`prov=spec:§14.8.9` for the fail-closed restoration. If you amend a SPEC section, carry the inline
`> **Provenance:**` line per the overlay.

## Verification you owe (do not mark DONE without these)

1. `bun install` then `bun run pretest` at startup (a fresh worktree inherits neither).
2. The four PA repro shapes above, re-run on YOUR tree, with the A/B table reproduced.
3. **Execute, do not grep.** Extract the emitted helper from a real artifact and run it, as the PA
   did. "The emitted text looks right" is not evidence (S265 theme-switch).
4. Full suite `bun run test` (chains pretest). Record pass/fail counts.
5. Conformance `bun conformance/run.ts` — the two protect cases MUST be addressed deliberately, and
   their expected.json updated in the SAME commit if Unit 2 changes what they assert.
6. An emit differential over the corpus for Unit 1, to prove the deletion is inert on the wire path.

## Standing rules for this dispatch

- **NEVER `--no-verify`, and NEVER override `core.hooksPath`.** The second is an escalation the
  contract flags as worse than the first. If the pre-commit gate is slow (~108-124s, and a
  compiler-source commit fires a post-commit full suite ~9min), BATCH your commits — do not disable
  the gate. If you believe a bypass is genuinely required, STOP and report.
- **Commit after each meaningful unit** and append to `docs/changes/egress-tojson-root/progress.md`
  (append-only, timestamped: what you did, what is next, blockers). Your branch + progress.md are the
  ONLY crash anchors — the PA has lost work to dead dispatches twice this week.
- Record every place the PA's stated locus or premise was WRONG. The PA's loci here are
  PA-located-verify; the executed findings are PA-executed. Correcting the PA is the highest-value
  thing you can report.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its Task-Shape Routing. Map watermark
`c93a692c`; repo HEAD `d604df09` — 19 commits apart, but **zero of them touch
`protect-egress.ts`, `emit-server.ts`, or `type-system.ts`**, so the map is current for this
surface. Treat map content as a verify-against-source hypothesis. Report whether the map was
load-bearing — "not load-bearing" is a valid and useful answer.
