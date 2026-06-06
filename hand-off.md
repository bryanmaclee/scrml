# scrmlTS — Session 169 (OPEN / IN FLIGHT)

**Date:** 2026-06-06
**Previous:** `handOffs/hand-off-173.md` (= S168 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-174.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md"; default A). Session-start reads done: pa.md full · PRIMER §1–§13 · SPEC-INDEX recent-landings + section map · master-list §0 (S168→S149) · user-voice S162–S168.

## S169 — MAP-ARC PHASE C IN FLIGHT (survey → decomposition → iteration ruling → D0 dispatched)

User: **"start the map arc phase c"** (the value-native `map` BUILD; §59 landed Nominal S168). PA ran a **4-parallel read-only infra survey** before any dispatch (depth-of-survey discount), produced a grounded decomposition, surfaced + got a ruling on a §59↔§17.7 spec inconsistency, amended §59.8, and dispatched **D0** (union-`not` normalization). Also: copied the language-inspiration audit into scrmlTS (separate user request).

### ⚠ UNCOMMITTED PA WORK (commit-pending — NO commit auth given this session yet)
- **scrmlTS working tree:**
  - `docs/language-inspiration-audit-2026-06-06.md` (NEW — copy of scrml-support @4d1b22e + a `mirror-of:` provenance line; canonical stays in scrml-support).
  - `compiler/SPEC.md` — **§59.8 amended** (iteration rides `<each ... as e>`; `(k,v) in` tuple-opener removed). SPEC-INDEX footer NOT yet re-synced (the §59.8 edit is net ~+10L; regen `bun run scripts/regen-spec-index.ts` at the next SPEC landing).
  - `docs/changes/map-type-2026-06-06/RATIFIED-DESIGN.md` — S169 iteration-ruling note.
  - `docs/changes/map-build-phase-c-2026-06-06/` — NEW: `SURVEY-SYNTHESIS.md` (the grounded fire-site map for D1–D4), `BRIEF-d0-union-not.md`.
  - `hand-off.md` (this) + `handOffs/hand-off-173.md` (rotation).
- **scrml-support working tree:** `user-voice-scrmlTS.md` — S169 ruling appended (9696L). Commit + push pending.
- **Action for next step:** surface to user → commit with EXPLICIT pathspecs (separate the audit + §59.8 + arc-docs from any in-flight D0 landing). scrml-support user-voice rides its own commit.

### THE BUILD DECOMPOSITION (grounded by the survey — full detail in `docs/changes/map-build-phase-c-2026-06-06/SURVEY-SYNTHESIS.md`)
```
D0 union-`not` normalization (§42.3.1)   [IN FLIGHT — agent a9c3075095363301a, isolation:worktree, bg]
D1 type-system: MapType + recognition + key-check + E-MAP-BRACKET-WRITE gate   [L, foundation]
D2 parser: [:]/[k:v] literal (legacy Acorn pre-rewrite L / native parseArrayLiteral M) + iteration form
D3 runtime: value-canonical hasher + map structure + method surface + lossless codec + map-==   [L]
D4 codegen: mapVarNames collector + emit-expr interception   [M, gated behind D1+D3, ~80% pattern-mirror]
D5 Set + self-host migration (130 sites)   [decoupled, P3 bridge, NOT a v1 blocker]
```
**Survey headline:** §59 is mostly NET-NEW (no `[KeyT:ValT]` recognition — resolves to `tAsIs()` today; §42.3.1 union-`not` spec-only; value-canonical hasher fully net-new; map runtime structure+codec net-new) WITH codegen ~80% pattern-mirror (`engineVarNames`/`.advance` interception templates `mapVarNames`/map-methods; COW bracket-write path needs ZERO change — map `@m[k]=v` is a FATAL typer error before COW). **Hard ordering: TYPER FIRST.**

### S169 RULING (durable — user-voice S169) — map-entry iteration surface
**Rides the shipped §17.7 `<each in=@m.entries() as e>` opener** + `e.key`/`e.value`; `.entries()` → `[{key:KeyT, value:ValT}]` value-native **structs** (no tuple); `.keys()`→`[KeyT]`, `.values()`→`[ValT]`; optional `as (k, v)` positional-destructure (§14.11). The `<each (k,v) in ...>` tuple-opener is REJECTED. SPEC §59.8 amended PA-direct.

### D0 — IN FLIGHT (agent `a9c3075095363301a`)
`§42.3.1 union-`not` normalization`. `normalizeUnion(members)` in `tUnion` (type-system.ts:~593): flatten nested unions + dedup `not` → `(V|not)|not` collapses to `V|not`. **SCOPE: dedup-`not`-ONLY** (no member reorder/dedup — protects the schemaFor/tableFor EXACTLY-`[T,not]` recognizers @~13201/13217/13898/13902). Mandatory blast-radius canary on those recognizers. Brief: `BRIEF-d0-union-not.md`. **On completion (per S164 — wait for the notification before reading HEAD/coherence):** PA review → S147 coherence → S67 file-delta land → PA-independent verify (full suite 23,091 baseline + canary + `T|not` corpus smoke) → then D1.

### OPEN QUESTIONS / NEXT (S169)
1. **D0 landing** (in flight) → then D1 type-system (the foundation).
2. **Commit auth** — the uncommitted PA work above needs the user's go (audit + §59.8 + arc-docs + scrml-support user-voice). Surface at next exchange.
3. **PA-decided design defaults** (surfaced for veto, in SURVEY-SYNTHESIS): value-canonical literal-form byte-exactness; plain-object full-canonical-string map keying + clone-on-write, defer HAMT; `@ordered` `_order` sidecar; key-comparability at decl-binding sites; native bracket-write→COW parity gap decoupled if native shadow-only; nested-map read `@outer["a"]["b"]` resolution (D4 Q1).
4. Carried from S168: Bug B (HIGH codegen mistarget @emit-logic.ts:3003); JS-host reject-on-cycle barrier; JS-host scalar-gap; native-swap re-triage; §6.2↔§59 cross-ref polish.

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap` / 88% floor. wrap step 6c maps refresh.
- Dispatch discipline: S88 isolation explicit · F4 startup-verify · S112 merge-startup · S99/S126 Bash-edit + no-`cd` (S100 hook) · S136 BRIEF.md archival · S138 R26 / PA-independent dual-verify · S147 branch-leak coherence · S164 background-commit-race (wait for completion notification).
- `feedback_no_batch_ratify_foundational_axioms` (S166) — axiom-level Qs one-at-a-time; survey-STOP before heavy dispatch.

## Tags
#session-169 #profile-a-full-start #map-build-arc-phase-c #survey-stop #d0-union-not-in-flight #iteration-ruling-s169 #commit-pending
