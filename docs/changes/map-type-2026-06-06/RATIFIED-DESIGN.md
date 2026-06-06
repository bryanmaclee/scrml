# scrml value-native `map` type — RATIFIED DESIGN (S167, 2026-06-06)

> The fully-ratified surface for scrml's value-native runtime-keyed dictionary. Produced by: JS-host-boundary DD (the capability warrant) → user fork-1/fork-2 ratification → map-surface debate (`scrml-support/docs/debates/map-surface-bracket-vs-method-2026-06-06.md`, grafted hybrid 53/60) → user rulings (write-surface = grafted hybrid; order = unordered-loud). This doc is the input to the SPEC-draft + build decomposition. NOT yet built; NOT yet in SPEC.

## Why a map (the warrant — settled)

A runtime-keyed dictionary is a **genuine capability gap**: scrml structs have compile-time-fixed keys; a map keys by a runtime value. The corpus proves demand (68 self-host `new Map` sites) and proves no scrml-native answer exists (0 object-as-dict, 0 array-of-pairs-dict — the only fill today is the raw-JS-`Map` leak, which `JSON.stringify` silently drops). Raw JS Map also violates §45.6 (identity-keyed). This is a capability ADD + a spec-contradiction fix, NOT familiarity-bias. (JS-host-boundary DD, S167.)

## The ratified surface

```scrml
// ─── TYPE + EMPTY (fork 1) ───────────────────────────────────────────────
<fareByLane>:   [string: Money] = [:]            // [KeyT: ValT] concrete affix (no generics); [:] = empty map
<userById>:     [int: User]     = [:]            // int key
<priceByRoute>: [Route: Money]  = [:]            // STRUCT key — §45 structural == (fork 2)

// ─── LITERAL ─────────────────────────────────────────────────────────────
<seed>: [string: int] = [ "DAL": 3, "HOU": 5 ]   // primitive-key literal [k: v, ...]
// struct-key literals via .insert (the literal's weakest case); primitive-key literal is pleasant

// ─── READ — bracket-native (validated unchanged; allocation-free, terse) ──
const fare = @fareByLane["DAL-001"]              // -> Money | not  (key-miss yields not)
given f = @fareByLane["DAL-001"] { use(f) }      // composes with given / is some / (not to V); ZERO new rules
const f2 = @fareByLane.getOr("DAL-001", 0)       // fallback-read in one expr
const have = @fareByLane.has("DAL-001")          // -> bool (present-with-not decidable)

// ─── WRITE / REMOVE — method-native (the grafted hybrid) ─────────────────
@fareByLane = @fareByLane.insert("DAL-001", 4500)        // visible reassignment (consistent w/ @arr=[...@arr,x])
@fareByLane = @fareByLane.remove("DAL-001")               // distinct verb (NOT =not) — [K:V|not] CAN store not
@fareByLane = @fareByLane.update("DAL-001", f => (f ?? 0) + 100)   // upsert, no read-modify-write race
@fareByLane = @fareByLane.insertAll(pairs)                // BULK — one clone (defuses O(n^2) loop)

// ─── ITERATION — method-native arrays + existing <each> (unordered + loud) ─
<each (k, v) in @fareByLane.entries()> ... </each>        // UNSPECIFIED order
<each (k, v) in @fareByLane.entries().sorted()> ... </each>   // .sorted() = cheap explicit stabilizer
<ranked>: [string: Money]@ordered = [:]                    // opt-in insertion-order affix (costs more)
// .keys() / .values() / .entries() all return value-native arrays
```

## Ratified decisions (the locks)

| # | Decision | Ruling |
|---|---|---|
| M1 | TYPE expression | `[KeyT: ValT]` concrete affix (no generics); `[:]` empty literal; `[k: v, …]` literal (fork 1) |
| M2 | KEY domain | any §45-comparable value (primitives + structs + enums); function-containing types excluded via `E-EQ-003` (fork 2) |
| M3 | KEY hash | the EXISTING §47 canonical-string codec (FNV-1a-32, alpha-sorted fields, `&Name` recursion guard) — hash-consistency `(=x y)⇒(=hash x hash y)` falls out of §45 FOR FREE (the validated keystone) |
| M4 | READ | bracket `@m[k] -> ValT | not`; `.getOr(k, default)`; `.has(k) -> bool` |
| M5 | WRITE/REMOVE | method-native: `.insert(k,v)` / `.remove(k)` / `.update(k, fn)` / `.insertAll(pairs)` — all return a new map, reassignment-canonical (the grafted hybrid, debate 53/60) |
| M6 | DELETE semantics | `.remove(k)` ONLY; `=not` is NOT a remove. A `[K: V|not]` map stores `not` via `.insert(k, not)`, removes via `.remove(k)`, distinguishes via `.has(k)` |
| M7 | ITERATION | `.keys()/.values()/.entries()` → value-native arrays; **UNORDERED by default + LOUD**; `.sorted()`/`.sortedBy()` stabilizer; opt-in `@ordered` affix (insertion-order, costs more) |
| M8 | `==` | structural, order-independent (§45) — even for `@ordered` maps `==` ignores order |
| M9 | SERIALIZATION | lossless codec (the map round-trips §57 wire / SQL / equality; raw JS Map rejected — `JSON.stringify` drops it) |

**S169 amendment — iteration surface (user ruling, AskUserQuestion).** M7's iteration rides the SHIPPED §17.7 `<each in=@m.entries() as e>` opener — NOT a `(k, v) in` tuple-opener (rejected: conflicts with the attribute-only §17.7 `<each>`; scrml has no tuple type, §59.7 avoids pair-lists). `.entries()` → `[{key: KeyT, value: ValT}]` value-native structs (`e.key`/`e.value`); `.keys()` → `[KeyT]`; `.values()` → `[ValT]`; optional `as (k, v)` binds the two fields positionally (§14.11). SPEC §59.8 amended to match (S169). See user-voice S169.

## v1 scope-cuts (decide-on-purpose, documented)

- **Map-as-key:** NOT in v1. `[K: V]` keys are "any §45-comparable EXCEPT another map." Unordered-by-default (M7) keeps the door open to add later without breaking `==` (an `@ordered` map could never be a key — ordered `==` is order-sensitive, breaks hash-consistency). Document explicitly.
- **Struct-key literals:** primitive-key literal `["DAL": 4500]` ships; complex/struct-keyed maps built via `.insert` (Swift programmers do this anyway — the struct-key literal is bracket syntax's weakest case).

## Blocking prerequisites (gate the ship)

1. **Cycle safety (HARD PREREQ).** Struct keys are structurally hashed via the §47 codec. `_scrml_structural_eq` (runtime-template.js:2491) has **no seen-set guard** → RangeErrors on cyclic values, and `@arr[0]=@arr` builds a live cycle TODAY. **Must land first:** (a) seen-set guard in `_scrml_structural_eq`; (b) the S166 cycles-forbid barrier (reject-on-cycle at cell-assignment + route `@arr[i]=x` bracket-write through COW). The "acyclic keys guaranteed" precondition is FALSE today. (This is the S166 cycles ruling — already ratified, needs implementation.)
2. **Write-path correctness — LARGELY DISSOLVED** by the method-write choice (`.insert` reassigns a named cell, sidestepping the broken bracket-target codegen). Bug A (multi-statement deep-set write-loss) RESOLVED `75431e9e`. The bracket-index-skips-COW path is now only relevant to prereq #1 (the cycles barrier needs it), not to map writes.

## SPEC-section outline (for the draft)

A new SPEC section (§ TBD — likely §6.x collection-types or a dedicated § near §14 type-system) covering: the `[KeyT: ValT]` type grammar + `@ordered` affix; the `[:]` / `[k: v]` literal grammar (bracket-depth-1 entry-colon parse discipline; repro `[ {a:1}: {b:2} ]`); the key-constraint (§45-comparable, `E-EQ-003`); the §47-codec key-hash + hash-consistency; the bracket-read `-> V | not`; the method surface (`.insert`/`.remove`/`.update`/`.insertAll`/`.get`/`.getOr`/`.has`/`.keys`/`.values`/`.entries`/`.sorted`/`.size`); unordered-iteration + `==` order-independence; the lossless codec; the v1 scope-cuts; new `E-` codes (map-key-not-comparable, `@ordered`-as-key, literal-grammar, etc.).

## Build decomposition (rough)

1. **Prereq:** cycles barrier + seen-set guard (the S166 ruling) — separate dispatch, lands first.
2. **Type-system:** `[K:V]` type recognition + `@ordered` affix + key-constraint check (reuse `E-EQ-003`); the `V | not` read type + `not|not ≡ not` idempotence.
3. **Parser:** `[:]` / `[k:v]` literal (bracket-depth-1 entry-colon); bracket-read `@m[k]`; the `<each (k,v) in …>` destructuring binding (or rely on `.entries()` pairs).
4. **Runtime:** the value-native map structure (insertion-tracked or HAMT) + structural key-hash via §47 codec + the method surface + the lossless codec; cache canonical key-string per node (amortize).
5. **Codegen:** lower bracket-read → `_scrml_map_get`; method calls → runtime ops returning new maps; reactivity via reassignment (the established path).
6. **Set (follow-on, decoupled):** derive `set` from `map` (map-keyed-to-self) OR `scrml:data` helpers — the thinner S166 warrant, decided separately.
7. **Self-host migration (DECOUPLED, rides the P3 bridge):** the 130 self-host `new Map`/`new Set` sites migrate to the value-native map as part of the value-native-self-host milestone — NOT a v1 adopter-ship blocker.

## Cross-refs

- `scrml-support/docs/deep-dives/js-host-boundary-2026-06-06.md` (the capability warrant + the member-class frame).
- `scrml-support/docs/debates/map-surface-bracket-vs-method-2026-06-06.md` (the surface debate + scorecard + failure-modes).
- `~/.claude/design-insights.md` — "scrml value-native map surface" entry (the per-operation-honesty insight).
- SPEC: §45/§45.6 (structural ==, E-EQ-003), §47 (canonical-string codec — the key-hash), §57 (wire-absence envelope), §42 (no-null), §6.5.1/DQ-2 (reassignment-canonical).
- S166 cycles-forbid ruling (the hard prereq) + the value-native-self-host goal (the decoupled migration target).

#map-type #ratified-design #bracket-read-method-write #unordered-loud #s167 #spec-draft-input #cycles-prereq
