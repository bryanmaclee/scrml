# sPA ss37 → scrml PA — value-native Set SHAPE fork, developed for a user ruling

**Re-integration + park.** ss37 is a 1-item SURVEY-FIRST lane. Phase-0 verdict: **the un-defer is RATIFIED, the SHAPE is not.** No build dispatched. Branch `spa/ss37` carries only bookkeeping (list status + progress + this message). Below is developed ready to bring to the user (or to seed a deep-dive/debate first).

---

## What is already settled (do NOT re-litigate)

- **Un-defer Set: RATIFIED S222.** `docs/changes/compiler-reimagining-derisk-2026-06-26/RULING.md` §20 + user-voice 10769 ("the mechanics-beauty program … value-native Set §59.12 (un-defer, ss37)"). This **supersedes** the S170 "defer the type" ruling (newest-first). The warrant is no longer thin — the **DG-builder exerciser** is the demand signal S170 lacked. Build is warranted.
- **Value semantics are forced** (whichever shape): value-canonical-hashed (reuse §59.5), COW/reassignment-canonical, structural order-independent `==`, value-acyclic, bracket-WRITE rejected. All inherited from the §59 map — not open.
- **Set-algebra HELPERS already shipped** (S170): `union`/`intersection`/`difference`/`member`/`unique` in `scrml:data` (`stdlib/data/transform.scrml`), value-correct via the §59.5 codec. So "kills set-as-array verbosity" is *partially already delivered* — the remaining win is type-level intent + dedup-by-construction + O(1) membership.
- **Sequencing clear:** ss38 (HAMT map rep) already landed in `main` (`1ada2b3e`), so the shared-§59-runtime constraint (HAMT-first) is satisfied — Set rides the HAMT rep.

## Why it parked: §59.12 has NO build-ready shape

§59.12 today literally says **"NO `set` TYPE … `set[K]`-over-map stays ON THE SHELF."** There is no normative type grammar, no literal decision, no method roster. The S170 deep-dive (`scrml-support/docs/deep-dives/set-warrant-and-shape-2026-06-06.md`) pre-leaned **B2** and **eliminated A — but A's elimination was explicitly conditioned on "zero adopter demand"** (deep-dive §A "Loses" + user-voice 9708). The S222 exerciser is exactly that condition flipping. **So the A-vs-B2 axis is re-opened**, and it's load-bearing — it cascades to literal-or-not, type spelling, and the method surface. An sPA cannot rule it or author §59.12 normative text.

---

## The fork (scope: language-wide — a new collection type's entire surface)

### Option B2 — set as a thin alias over the §59 map  *(my lean)*
`set[K]` desugars to the already-built `[K: unit]` map. No new data structure, no new runtime, no new literal — seed via `.add` (lowers to `.insert(k, unit)`); algebra lowers to map folds.
```scrml
<visited>: set[NodeId] = [:]                 // type says set; empty literal is the map's [:]
@visited = @visited.add(n)                   // lowers to .insert(n, unit)
const seen = @visited.has(n)                 // already a map method (§59.6)
@both = @a.union(@b)                          // lowered: fold @b's elements into @a
<each in=@visited.values() as v> … </each>   // .keys()/.values() already ship
```
- **Limit-primitives win** (`feedback_limit_primitives_not_godify`): sharper primitive riding the built map; near-zero compiler lift (a desugar pass + ~4 lowered methods); cannot drift from map semantics (same hasher/`==`/codec/cycle-safety). **Struct elements are value-correct for free** (rides the map's structural key-hash). This IS literally what the DG-builder exerciser already hand-writes as `[K:bool]`/`[K:Color]` maps — B2 just names it.
- **Loses:** no set-shaped LITERAL (`{ "a", "b" }`) — always seed via `.add`. "Type says set, empty literal `[:]` says map" — a small cohesion seam. Prior art (Gleam/Roc/Elm) is exactly this thin-wrapper-as-named-type shape.

### Option A — first-class value-native `set` type (mirrors §59)
Its own type grammar, **its own literal**, methods, codec — ~80% a pattern-mirror of the map.
```scrml
<tags>: {string} = { "DAL", "HOU" }          // A1 brace literal (collides w/ block/struct {})
<tags>: [string]@set = [ "DAL", "HOU" ]      // A2 [..]@set affix + [::] empty (no collision, unfamiliar)
@tags = @tags.insert("DAL")                  // dedup-by-construction
const sub = @a.isSubsetOf(@b)
```
- **Wins:** reads as a distinct intent at the type site; set-shaped literal; named discoverable algebra surface; closes the struct-membership hole as a first-class capability.
- **Loses:** a *second* collection type to spec/teach/maintain; **literal-collision is the sharpest cost** — A1 `{…}` collides with block/struct `{}` (the Python `{}`-is-dict wart); A2 `[::]`/`@set` avoids it but no language uses `[::]`. New corpus-ouroboros surface. This is the option S170 eliminated **on zero-demand** — the exerciser is the only thing that could revive it.

*(Option C — array-helpers-only — is moot: already shipped, and the un-defer ruling explicitly wants a TYPE now.)*

---

## The cascade (these collapse once A-vs-B2 is ruled)
1. **Literal?** B2 = no literal. A = a literal, and which spelling (A1 `{…}` collision vs A2 `[…]@set`/`[::]`).
2. **Type grammar spelling.** `set[K]` (B2) vs `{K}` (A1) vs `[K]@set` (A2). `set<K>` is OUT (no generics, §10).
3. **Method naming + algebra surface.** `.add` (set-conventional, the ss37 list) vs `.insert` (map-parity). And: set-algebra as **methods** (`.union`/`.intersect`/`.difference`) vs the **already-shipped `scrml:data` free functions** — duplicate / overload / methods-delegate-to-helpers? (`feedback_limit_primitives_not_godify` — don't double the surface.)

## sPA read (present, don't decide)
**B2.** Limit-primitives + cohesion-falls-under-fingers (`feedback_cohesion_and_falls_under_fingers`): the map IS the set; B2 is the cheapest, drift-proof, struct-correct path, and it's exactly the `[K:bool]` shape the exerciser already writes. **The only reason to revisit A:** the exerciser is the *new fact* the S170 A-elimination didn't have, and the user weighted demand-evidence above cohesion at S170 — so the honest move is to re-surface A-vs-B2 as a one-axis ruling rather than treat B2 as auto-decided. The set literal is A's one genuine pull (the 19 cleaner constant-lookup-table literals the self-host DD flagged) — weigh that against the `{}`-collision tax.

## Suggested PA next step
This is a **foundational axiom-level shape** → `feedback_no_batch_ratify_foundational_axioms` applies: one axis, deep-dive/AskUserQuestion (not a multi-Q pass), with worked-code previews (`feedback_show_code_to_reason_about`) — the A1/A2/B2 snippets above are preview-ready. Either (a) bring A-vs-B2 to the user directly using the cascade above, or (b) re-fire the S170 deep-dive's shape half now that the warrant flipped (the warrant analysis is done; only the shape needs re-deciding against the new exerciser). After the ruling + §59.12 normative text, the build is mechanical (mirror S169 Map D1-D4; Set rides the HAMT rep).

— sPA ss37 (branch `spa/ss37` tip TBD-this-commit; 1/1 parked; stood down)
