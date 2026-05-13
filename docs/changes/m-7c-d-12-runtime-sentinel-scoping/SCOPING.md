# M-7C-D-12 — Runtime Absence-Sentinel SCOPING

**Status:** SCOPING. No code changes. Surface design options + recommendation + OQs for PA disposition.
**Date:** 2026-05-13
**Position:** Wave 7.D follow-on; BLOCKER prerequisite for M-7C-D-4/5/6/7/8/9/10/13/14/17 (9 follow-on migrations) + paired M-8C-D-* items (undefined-mirror).
**Per pa.md Rule 3:** Surface ALL viable options. Do not pre-pick the easy answer.

---

## §1 Background + position in absence-eradication chain

### 1.1 The audit-driven framing

Wave 7.D audit (`docs/audits/null-audit-compiler-src-2026-05-13.md`) classified 2,777 `null` occurrences across 81 files. ~720 sites are M-class ("scrml-semantic-mirror-migrate") — they emit `null` to scrml-author-observable surfaces:

- AST `LitExpr{ litType: "null" }` mirrors (~70 sites)
- Codegen `not` → `null` substitution (emit-expr.ts L296-298 + rewrite.ts L739)
- Server-fn HTTP wire format (emit-server.ts L928/934/1089)
- SQL `.get/.first` row-absence (emit-logic.ts L2117/2138/2148)
- Engine state history cells (emit-engine.ts L985/1338)
- Audit-log label/auditTarget interpolation (emit-machines + emit-logic, ~7 sites)
- Reactive-wiring default `targetExpr = "null"` (emit-reactive-wiring.ts L849)
- Match-arm `not` kind + for-loop reconciler key (emit-control-flow.ts L557/749/829)
- Runtime `_scrml_lift_target` + `^{}` capturedBindings (runtime-template.js L588/L1335)

Wave 8.D mirror audit (`undefined-audit-compiler-src-2026-05-13.md`) classified 861 `undefined` sites; ~140 M-class. Most pair 1:1 with null sites at the same line (`=== null || === undefined`). Unique-to-undefined patterns: the `?? "undefined"` string-interpolation init-fallback (emit-server.ts L882 + emit-logic.ts ×10 + scheduling.ts L127-129), the `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` throw (emit-engine.ts L2141-2200), and machine-fn payload-positional undefined.

### 1.2 The SPEC-ratified framing (load-bearing finding)

**SPEC §42.5 (Codegen) — current normative text:**

> - `not` literal → `null` in JavaScript output
> - `x is not` → `x === null || x === undefined` in JavaScript output
> - `given x => body` → `if (x !== null && x !== undefined) { body }` in JavaScript output

**SPEC §42.8 (Runtime Representation) — current normative text:**

> `not` is the scrml absence value. Its runtime representation in compiled JavaScript is `null`.
>
> - The `not` literal SHALL compile to the JavaScript value `null` in all output targets.
> - The `is not` operator SHALL compile to `(x === null || x === undefined)` in JavaScript output. The check matches both JavaScript `null` and `undefined` because foreign code (JS libraries, `^{}` blocks, `?{}` SQL results) may produce either.
> - The `is not not` double-negation pattern (presence check) SHALL compile to `(x !== null && x !== undefined)` in JavaScript output.
> - No scrml program SHALL directly emit the JavaScript value `undefined`. The only way absence enters a scrml variable is through the value `not` (which compiles to `null`) or through the JS interop boundary.
>
> **Rationale for `null` over `undefined`:** `null` is an explicit, assignable value in JavaScript; `undefined` is the implicit absence of assignment. Using `null` as the scrml `not` representation makes intentional absence explicit in generated code.

**SPEC §12.5.1 (Server Function Return Values) — current normative text:**

> Return types are serialized as JSON. Supported return types:
> - `string`, `number`, `boolean`
> - `not` (serializes as `null`)
> ...

**SPEC §42.1 Exclusions (S89, current):**

> - Codegen-emitted JavaScript fragments (`runtime-template.js`, `emit-*.ts` outputs, runtime helpers — these compile FROM scrml TO JavaScript and legitimately use JS `null`).
> - Wire-format JSON literal descriptions (§41.13 `parseVariant`, §12.5 server function return — JSON has a literal `null`; spec prose describing wire values uses `null` to describe JSON).

**Key implication:** The SPEC currently **NORMATIVELY MANDATES** that:
1. `not` compiles to JS `null` (§42.5, §42.8).
2. The wire format encodes `not` as JSON `null` (§12.5.1).
3. JS-host `null`/`undefined` arriving via interop are normalised to `not` on the scrml side (§42.9).
4. Codegen-emitted JS legitimately uses `null` (§42.1 exclusion list, S89).

The Wave 7.D audit's M-class "drift" findings are evaluated against the user-voice intent ("null does NOT EXIST IN SCRML"), but the SPEC's current §42.5 + §42.8 + §12.5.1 + §42.1 explicitly RATIFY null as the runtime representation. **This is not drift — it is the current canonical ABI.**

### 1.3 Scaffold-investment framing (pa.md self-host-is-from-scratch)

> ✅ TS impl is scaffold; will be replaced by from-scratch scrml self-host.
> ✅ When TS impl uses `null` internally as a JS host primitive, that's fine — it's JS.
> ✅ When TS impl emits `null` in a structure scrml-side consumers READ, that's drift — the TS impl should emit a scrml-faithful sentinel (Optional discriminator or whatever the scrml side expects).

The friction the audit surfaces: when a scrml-author reads back a value that originated as scrml `not`, what they see in JavaScript-host introspection is JS `null`. If the spec is "scrml-faithful means the scrml-side observation honors scrml semantics," then the question becomes: **does a scrml-author observe `null` or `not`?**

The §42.9 interop boundary says: JS `null`/`undefined` arriving via interop → normalised to `not` on scrml side. The compiled JS uses `null` as the bit-pattern; the **scrml-language-level observation** of that value via `is not` / `is some` / `given` predicates yields the correct scrml semantics. The leak the audit calls out is: JSON wire formats, HTTP debug introspection, browser DevTools — where the JS-host bit pattern IS observable.

### 1.4 Position in cascade

Per Wave 7.D §6 recommendation, M-7C-D-12 is item #1 (runtime infrastructure). Per Wave 8.D §6 recommendation, same — M-7C-D-12 is unchanged from null-audit. Both audits agree: the runtime sentinel decision blocks 9 follow-on migrations.

**The decision this SCOPING informs:** Does the project RATIFY the current SPEC §42.5/§42.8 position (runtime null = scrml absence; option α) and CLOSE the audit's M-class drift findings by spec-amendment rather than codegen migration? Or does the project DEPART from §42.5/§42.8 to introduce a runtime sentinel distinct from JS null/undefined (options β/γ/δ)?

---

## §2 Surface inventory — where absence representation is OBSERVABLE

Per pa.md self-host-is-from-scratch rule: the question is which surfaces leak the **bit-pattern** to scrml-author-observable positions.

| # | Surface | Visibility | Current behavior | Audit reference |
|---|---|---|---|---|
| 1 | **scrml-language predicate level** (`x is not`, `x is some`, `given x =>`) | scrml-author writes this | Returns correct boolean per scrml semantics regardless of underlying JS bit-pattern (handles both `null` AND `undefined`) | emit-expr.ts L465-470 |
| 2 | **HTTP server-fn JSON wire format** (response body) | scrml-author observes via browser DevTools Network panel, `curl`, etc.; consumed by client-side decoder | Currently `JSON.stringify(x ?? null)` — emits literal JSON `null` token for scrml `not` | emit-server.ts L928/934/1089 (M-7C-D-6) |
| 3 | **SQL `.get/.first` row-absence** | Returned as scrml value; consumed by scrml code | `(await sql)[0] ?? null` — JS `null` lands in a scrml variable, which §42.9 normalises to `not` semantically | emit-logic.ts L2138/2148 (M-7C-D-9) |
| 4 | **Engine state-cell history initial values** | Read via `@varName` reactive accessor | `_scrml_state[cellKey] = null` — read returns `null`; scrml semantics narrows via predicates | emit-engine.ts L985/1338 (M-7C-D-7) |
| 5 | **Audit-log `@auditTarget` entries** | `@auditTarget` is a reactive cell scrml code reads (label/rule/at fields) | `label: null` appears in entry objects when audit rule has no label | emit-machines.ts L515-773 + emit-logic.ts L1044-1049 (M-7C-D-8) |
| 6 | **Reactive-wiring default target** | Compiled JS interpolation `let targetExpr = "null"` | Defaults baked into compiled output strings | emit-reactive-wiring.ts L849 (M-7C-D-10) |
| 7 | **Match-arm `not` discriminator** | Internal AST → compiled JS match-arm condition | Match-arm with `kind:"not"` carries `test:null, binding:null` in IR; compiled to `x === null \|\| x === undefined` | emit-control-flow.ts L557/749/751/829 (M-7C-D-13) |
| 8 | **For-loop reconciler key fallback** | Compiled JS reconciler runs in user runtime | `mapVar.get(loopVar.keyField) ?? null` for absent key | emit-control-flow.ts L557 (in M-7C-D-13) |
| 9 | **`^{}` capturedBindings / `_scrml_lift_target`** | Ambient runtime state observable through diagnostics | `_scrml_lift_target = null` initial; `capturedBindings != null ? capturedBindings : null` ternary | runtime-template.js L588/L1335 (M-7C-D-14) |
| 10 | **Machine-property-tests emitted harness** | Runs in user runtime; outputs to test harness | Uses `return undefined` for no-match (paired with M-7C-D-17) | emit-machine-property-tests.ts L259-279 |
| 11 | **`?? "undefined"` init-fallback string interpolation** | Compiled JS emitted as `let x = undefined;` for un-initialized `let x;` | The literal string `"undefined"` is interpolated as JS source | emit-server.ts L882 + emit-logic.ts ×10 + scheduling.ts L127-129 (M-8C-D-6 — UNIQUE to undefined audit) |
| 12 | **Derived-engine init-undefined throw** | Runtime error `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` | Emitted check `if (__scrml_derived_v === undefined) { throw ... }` (§51.0.J) | emit-engine.ts L2141-2200 (M-8C-D-8 — UNIQUE) |
| 13 | **`parseVariant` API (§41.13)** | scrml-author calls; receives Result-like | Already a tagged envelope — `MissingDiscriminator`/`UnknownVariant`/`InvalidPayload`/`Malformed` variants | (existing — not in audit migration set) |
| 14 | **SQL schema-differ DDL** | Emits SQL DDL strings | `default: null` in column-record → SQL `DEFAULT NULL` or omit `DEFAULT` clause | schema-differ.js L67-69 (M-7C-D-15) |
| 15 | **Browser DevTools introspection** (JS Console, React-style devtools) | scrml-author MAY inspect variables directly | Variable holds JS `null` for scrml `not`; introspection shows `null` | All surfaces above |

### 2.1 Inventory groupings by observability mechanism

- **Scrml-language predicate-level only (no leak):** #1, #7, #8. Authors only ever use `is not`/`is some`/`given` — bit pattern is irrelevant. ZERO migration value for these per pa.md scaffold rule.
- **Wire-format / JSON serialization (LEAK):** #2, #5. JSON serializer emits literal JSON `null` token; scrml-decoder needs to map back to `not`.
- **Runtime variable inspection (PASS-THROUGH):** #3, #4, #6, #9. JS variable holds `null`; scrml code reads it via predicates. Leak only via browser DevTools / debugger.
- **Compile-time JS-source string interpolation (LEAK only at debug-view level):** #11. The compiled JS literally contains the keyword `undefined`. Reading the compiled bundle (e.g., a sourcemap-disabled view) shows the JS keyword.
- **Spec-cross-cutting (RUNTIME ERROR MESSAGE):** #12. Error message string literally names "undefined" — visible if user catches the runtime error.
- **Already-handled correctly:** #13 (parseVariant uses Result-like envelope).
- **JS-host boundary (SQL DDL):** #14. SQL has its own NULL; the leak is bidirectional but legitimate at the §42.9 interop boundary.

### 2.2 The actual leak surface (consolidated)

After triage, the **single load-bearing user-visibility leak** is: **the HTTP server-fn JSON wire format (#2).** Reason:
- scrml-authors observe the JSON via browser DevTools, `curl`, error logs, audit replay, etc.
- Third-party scrml clients (future native-mobile scrml runtime, server-to-server scrml IPC) decode the wire — they need a tag to distinguish "field absent" from "field present with value null" from "scrml absence."
- `?? null` at the wire emit collapses three distinct scrml states into one JSON token.

All other "leaks" are either (a) pass-through that the §42.9 interop boundary covers (DevTools inspection of a JS variable that scrml predicates handle correctly), (b) bit-pattern-only differences not observable to scrml authors who use only scrml predicates, or (c) SPEC-ratified by §42.5/§42.8 to be JS `null`.

---

## §3 Options analysis

### Option α — Keep JS `null` as runtime; add encoding fences at wire-format boundary only

**Shape:**
- Runtime `null` continues to represent scrml `not` (PRESERVES §42.5 / §42.8 normative text).
- Type-system + lexer/parser + gauntlet already forbid scrml-author from writing `null`/`undefined` in source (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE).
- AST `LitExpr.litType` `"null"` and `"undefined"` are renamed/folded to `"not"` — single canonical absence AST kind (cleans up internal mirrors, not runtime ABI).
- Wire-format codegen (emit-server.ts L928/934/1089) wraps `?? null` in an absence-tagging encoder when the declared return type is `T | not`.
- §42.1 exclusions list ratifies runtime-`null` AS scrml absence — already in spec.

**Mechanical cost:**
- AST cleanup (M-7C-D-1, M-7C-D-2, M-7C-D-3, M-7C-D-11, M-8C-D-1, M-8C-D-2, M-8C-D-14): ~12 files, ~80 sites. Mechanical AST/parser/type-system migration removing `"null"`/`"undefined"` from union types and keyword sets. **Internal cleanup only — does not change runtime ABI.**
- Wire-format change (M-7C-D-6, plus paired M-8C-D-6): 3 emit-server sites; ~10 emit-logic sites for `?? "undefined"` init fallback; 3 scheduling sites. ~16 mechanical edits + a runtime encoder helper.
- Engine state-cell history (M-7C-D-7): 3 sites in emit-engine.ts; mechanical replace `null` → encoder helper for cells observable via `@varName`.
- Audit-log labels (M-7C-D-8): ~7 sites; same shape.
- Match-arm IR cleanup (M-7C-D-13): IR shape — replace `test:null, binding:null` with `kind:"absent"` discriminator. Internal-only.
- Codegen `is-not`/`is-some` (M-7C-D-4, M-8C-D-4): NO CHANGE per §42.8 ("matches both JavaScript `null` and `undefined`"). The double-check is normative.

**Wire-format implication:**
- Currently: scrml `not` → JSON `null`.
- Proposed: scrml `not` → tagged envelope (e.g., `{"_scrml_absent": true}` or `{":scrml":"not"}`) when at the wire boundary AND the field's declared type is `T | not`. Plain JS `null` retained for backwards-compat at the §42.9 interop edge (foreign-code passthrough).
- Spec amendment §12.5.1 + §41.13 + a new §50.x scrml-wire-format section required.

**Backwards-compat:** v0.3 wire-format-breaking-change UNLESS new tag is opt-in (per-field type-driven). If only `T | not` fields use the envelope, plain `T` fields still serialize as before. Approach: enclose only at scrml-aware decoders, leave JS-host JSON behavior intact.

**Performance impact:**
- Internal AST cleanup: zero runtime impact.
- Wire-format envelope: minor JSON overhead (one extra key on absence value); zero overhead for non-absent values.
- All other sites: zero (codegen output unchanged).

**Drift-detection-friendliness:**
- The W-ABSENCE-IN-SCRML-SOURCE info lint already covers source-position regression.
- Compiled JS still legitimately uses `null` per §42.1 exclusions — no false-positive on emit-* output.
- The audit's "look for `null` in compiled output" sweep would HAVE to recognize the exclusion.

**Honors stated intent:**
- **YES at scrml-author surface:** Author writes `not`, reads back values via `is not`/`is some`/`given`, never sees the underlying JS bit pattern in scrml-language code.
- **NO at browser-DevTools / debugger surface:** Author can inspect a JS variable in DevTools and see `null` instead of `not`. But this is a scaffold-investment trade-off — the eventual scrml self-host can present absence differently in its native runtime / debugger.
- **YES per §42.5/§42.8 SPEC normative ABI** — option α IS the current spec.

**Recommendation per option:** **Strongest.** Per pa.md Rule 3 + self-host-is-from-scratch: the SPEC has already ratified §42.5/§42.8; departing from them to satisfy a TS-scaffold audit is over-investment in code that will be discarded. Wire format is the ONE load-bearing leak; fix it with an envelope at that single boundary.

---

### Option β — New runtime sentinel object (`Symbol.for("scrml:absent")` or `{__scrml_absent: true}`)

**Shape:**
- Runtime `null` is reserved for JS-host null (foreign-code passthrough only).
- scrml `not` codegens to a dedicated sentinel: `Symbol.for("scrml:absent")` (most JS-idiomatic) or a frozen sentinel object `Object.freeze({__scrml_absent: true})`.
- All emit-* sites that currently emit `null` for scrml-absence rewire to emit the sentinel reference (`_SCRML_ABSENT` global or import).
- Wire format: serialize sentinel as `{"_scrml_absent": true}` (or symbol-aware codec).
- Runtime helpers `_scrml_is_absent(x)`, `_scrml_is_some(x)` — single-checks instead of paired `null || undefined`.

**Mechanical cost:**
- 18 emit-* sites + runtime-template.js (~6 sites) + runtime-validators.js (~6 sites) = ~30 codegen changes.
- Runtime helper module: ~1 file new, ~5 functions.
- AST cleanup same as Option α.
- Wire-format change same as Option α (envelope still needed, since the symbol doesn't JSON-serialize naturally).
- Spec amendment: §42.5 + §42.8 entire rewrite (BREAKING the current "compiles to null" normative text).
- SQL `.get/.first` decoder change (3 sites) + `?{}` interop boundary change (§42.9 amendment).
- §51.0.J derived-engine init-undefined check rewrite.

**Wire-format implication:** Same envelope as Option α at the JSON boundary; symbol/sentinel doesn't survive JSON serialization. Net: same wire-format work as α + the runtime-side rewrite.

**Backwards-compat:** v0.3 BREAKING. All compiled programs must be recompiled. Pre-existing serialized scrml data (e.g., persisted audit logs with `label: null` for scrml absence) would need migration. Foreign-code passthrough (`^{}`, `_{}`) becomes more subtle — JS `null` arriving from foreign code is NOT scrml absence, and the §42.9 normalisation must explicitly convert (currently it's a no-op since both are `null`).

**Performance impact:**
- Sentinel-comparison vs `null`-check: roughly equivalent for `===` reference-equality.
- Sentinel boxing: zero (it's a singleton).
- Wire envelope: same as α.
- Heap residency: negligible (one global).
- `is-not`/`is-some` could become a single check `=== _SCRML_ABSENT` if foreign-code interop is consistently normalised — minor perf win.

**Drift-detection-friendliness:** **Strongest.** A compiler-output assertion can grep "no literal `null` in scrml-emit positions" and pass cleanly. Sentinel identity makes the boundary detectable mechanically.

**Honors stated intent:** **Strongest.** Author writes `not`, runtime represents `not` as a distinct sentinel, DevTools shows `Symbol(scrml:absent)` instead of `null`. Bit-pattern boundary is sharp.

**Cost-benefit honest read:** This option is the **structurally pure** answer (Rule 3's "right answer"). The cost is investing ~30 codegen edits + a SPEC §42.5/§42.8 rewrite + the §42.9 boundary normalisation, ALL in the TS scaffold that will be discarded. The self-host rewrite would presumably adopt the sentinel-pure design natively — but the scaffold doesn't need to lead.

**Recommendation per option:** **Defensible structurally, but over-investment for the scaffold.** Right answer for a long-lived runtime; scaffold-wasteful for a discardable one.

---

### Option γ — Tagged-union absence at scrml-source layer; runtime stays flexible

**Shape:**
- scrml type system already makes `not` a unique value (true via §42).
- Runtime can use whatever — JS `null`, sentinel, undefined — codegen handles the impedance.
- Wire format: serialize `not` as a recognizable JSON shape (e.g., `{":scrml-not":true}` or `null` with a side-channel type marker).
- Codegen is free to choose per-site optimization — `null` where simplest, sentinel where boundary matters.
- Heterogeneous runtime: complex documentation surface.

**Mechanical cost:**
- AST cleanup same as Option α.
- Wire-format change same as Option α (envelope).
- Per-site emit-* decisions: 18 sites with case-by-case choice → high coordination burden.
- Runtime helpers needed for absent-check, but they handle multiple bit patterns: `x === null || x === undefined || x === _SCRML_ABSENT`.

**Wire-format implication:** Same as α envelope; the heterogeneity is internal-only.

**Backwards-compat:** Like α (wire-format change is the breaking part).

**Performance impact:** Possibly best-of-both-worlds: simple sites stay `null` (fast), boundary sites use sentinel. But adds complexity to optimization decisions.

**Drift-detection-friendliness:** WORST. Heterogeneous runtime means "is this `null` scrml-absence or foreign-host-null?" requires per-site reasoning. Defeats the audit's purpose.

**Honors stated intent:** Partial. The scrml-source layer is clean; the runtime layer's heterogeneity could itself be a source of bugs.

**Recommendation per option:** **Rejected.** Per pa.md Rule 3 (right answer beats easy answer), and self-host-is-from-scratch: heterogeneous runtime is a maintenance liability AND doesn't improve over α's wire-envelope-only approach. The optimization wins are negligible vs the consistency cost.

---

### Option δ — `not` is JS `undefined` in runtime (not `null`)

**Shape:**
- Codegen changes `not` from emitting `null` to emitting `undefined`.
- JS-host `null` is permitted in foreign code, normalised to `not`/undefined on scrml side.
- Wire format: `undefined` doesn't serialize in JSON natively — emit a tag or omit the field.
- All `=== null || === undefined` paired checks collapse to `=== undefined`.
- SPEC §42.8 Rationale ("`null` over `undefined`") is INVERTED.

**Mechanical cost:**
- 18 emit-* sites + runtime-template.js changes + every internal `?? null` patten reviewed.
- Wire format: trickier than α/β — JSON has no `undefined`. Field omission means GET-on-absent-key must distinguish "absent" from "present with undefined."
- Spec amendment §42.5/§42.8 inversion: replace "null" with "undefined" throughout normative bullets. §42.8 Rationale inverted.

**Wire-format implication:** **WORST.** JSON doesn't carry `undefined`. Field omission is ambiguous (does `{}` mean `{x: not}` or `{}` literally missing x?). The audit's M-7C-D-6 fix becomes "encode `undefined` as `null` in JSON" (i.e., the current behavior — circular). Or "omit the field" (semantically lossy).

**Backwards-compat:** v0.3 BREAKING + footgun-prone. The audit's pattern `?? "undefined"` interpolation (M-8C-D-6) becomes the canonical emit pattern instead of being eliminated.

**Performance impact:** Marginally faster (`x === undefined` single check vs paired). Negligible.

**Drift-detection-friendliness:** Worse than α; better than γ. The JS-host `null` arrives ALL the time from foreign code, so `=== undefined` alone is insufficient — need paired check anyway → defeats the purpose.

**Honors stated intent:**
- **NO** — JS-host `undefined` is the ambiguous value (uninitialized = absent? function-without-return = absent?). The SPEC §42.8 Rationale explicitly argues `null` over `undefined` for THIS reason.
- "harder to detect drift" per the dispatch brief — confirmed.

**Recommendation per option:** **Rejected.** This is a step backwards from the current spec, and the wire-format problem is worse. Selecting δ would require inverting a SPEC §42.8 normative-statement that was deliberately chosen.

---

### Option ε — Hybrid: spec-amend the audit's framing instead of migrating runtime (NEW, surfaced via SCOPING analysis)

**Shape:**
- Recognize that SPEC §42.5/§42.8/§42.1-exclusions ALREADY RATIFIES `null` as scrml-absence's runtime representation.
- The audit's M-class "drift" findings are evaluated against user-voice (S89 "null does not exist in scrml") — which user-voice ALSO produced §42.1 exclusions clarifying that codegen-emitted JS legitimately uses `null`.
- Reconcile: the audit is correct that scrml-author SOURCE positions must not contain `null`/`undefined` (covered by E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE). The audit's "compiled-JS contains literal null" findings are NOT drift per §42.1 exclusions.
- Concrete action: do nothing to the runtime ABI; CLOSE most audit M-class findings as "ratified spec ABI; not drift." Migrate only:
  - (a) AST internal cleanup (`litType: "null"` → `"not"`) — internal hygiene, no observable change. (M-7C-D-1, M-7C-D-2, M-7C-D-11, M-8C-D-1, M-8C-D-2, M-8C-D-14.)
  - (b) Wire-format envelope at server-fn boundary (M-7C-D-6 + paired M-8C-D-6 init-fallback that participates in compiled scrml code). This is the load-bearing user-visibility leak.
  - (c) The `?? "undefined"` string interpolation pattern (M-8C-D-6) — this IS drift because the literal keyword `undefined` is interpolated as JS SOURCE, not just used as a runtime value. Migrate the FALLBACK STRING from `"undefined"` to `"null"` (consistent with §42.8 "null over undefined") OR to a proper init expression.
  - (d) §51.0.J derived-engine throw message (M-8C-D-8) — rename `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` to `E-DERIVED-ENGINE-INITIAL-ABSENT-RT` (user-facing error message language alignment). Spec amendment §51.0.J + §34.
- Defer or close audit items #M-7C-D-4 (`is-not` emission), #M-7C-D-5 (rewrite.ts `not → null`), #M-7C-D-7 (engine state-cell), #M-7C-D-8 (audit-log labels), #M-7C-D-10 (reactive-wiring default), #M-7C-D-13 (match-arm), #M-7C-D-14 (runtime ambient), #M-7C-D-15 (schema), #M-7C-D-17 (machine-property-tests) — these are all SPEC-ratified `null`-emission per §42.1 + §42.5 + §42.8.

**Mechanical cost:**
- AST cleanup: ~80 sites (same as α core).
- Wire envelope: 3 emit-server sites + decoder; ~10 emit-logic `?? "undefined"` migrations to `?? "null"` (or proper sentinel).
- Spec amendment: SPEC-INDEX section ratifying §42.1 exclusions cover the audit M-class items.
- Audit follow-on cleanup: mark closed items in master-list.

**Wire-format implication:** Same envelope as α at the load-bearing boundary; nothing else changes.

**Backwards-compat:** Lowest impact. Wire-format envelope only at scrml-aware decoders.

**Performance impact:** Zero except wire envelope (negligible).

**Drift-detection-friendliness:** Spec-amended drift definition: "literal `null` in emit-* outputs targeting scrml-author-observable surfaces" — but §42.1 already excludes most cases. Practical drift-check shrinks to wire-format + DevTools introspection.

**Honors stated intent:**
- **YES** — author never types `null`/`undefined`; W-ABSENCE-IN-SCRML-SOURCE + E-SYNTAX-042 enforce; AST cleanup removes mirror-of-null from internal types.
- **YES at runtime via §42.9 interop boundary** — scrml predicates correctly classify all values.
- **YES at wire format** via envelope.
- **DOES NOT pretend** that JS runtime can avoid `null` cheaply — accepts §42.5/§42.8 as the SPEC-ratified canonical answer.

**Recommendation per option:** **Strongest, paired with α-style internal AST cleanup.** Per pa.md Rule 3: this IS the right answer when "right" is evaluated against the SPEC AS RATIFIED, not against an audit grep. The audit's value was surfacing the surface inventory — option ε reads the SPEC + audit together and chooses minimum-investment-honoring-stated-intent.

---

### §3.1 Other options considered and dismissed

**Option ζ — Make `not` un-representable in compiled JS entirely (errors at boundary).** Would require every `T | not` field to use a discriminated union shape at the source layer. Breaks §6.7.6 `<poll>.value` semantics, breaks SQL `.get/.first` semantics, breaks server-fn return semantics. Out of scope (this is a v2 type-system design question, not a scaffold migration).

**Option η — JS Symbol.for + Proxy wrapper for all scrml cells.** Wraps every scrml value in a Proxy that intercepts equality, predicate access, etc. Allows arbitrary bit-pattern flexibility. Massive performance + complexity overhead. Out of scope (v2+).

---

## §4 Sub-phase decomposition (post-ratification impl)

These sub-phases ASSUME Option α + ε (recommended). Sub-phase costs estimated for the scaffold work — TS impl only.

### Track 1: AST internal cleanup (independent of runtime decision)

| Phase | Description | Files | Est. hours |
|---|---|---|---|
| D-12.1a | Add `"absent"` / `"not"` consolidated discriminator to LitExpr; deprecate `"null"`/`"undefined"` litType variants | `types/ast.ts` | 2-3 |
| D-12.1b | Migrate parser to manufacture only `"not"` litType (remove `"null"`/`"undefined"` creation sites) | `expression-parser.ts`, `ast-builder.js`, `tokenizer.ts` | 3-4 |
| D-12.1c | Migrate gauntlet-phase3 lint detector to new discriminator | `gauntlet-phase3-eq-checks.js` | 1-2 |
| D-12.1d | Migrate component-expander default="null" path | `component-expander.ts` | 1 |
| D-12.1e | Remove `"null"` / `"undefined"` from type-system GLOBAL_NAMES + keyword whitelists | `type-system.ts`, `route-inference.ts` | 1 |
| D-12.1f | Tests for AST migration | `tests/unit/` | 2-3 |
| **Subtotal** | | | **10-14h** |

### Track 2: Wire-format envelope (load-bearing user-visibility fix)

| Phase | Description | Files | Est. hours |
|---|---|---|---|
| D-12.2a | Define wire envelope shape (e.g., `{":scrml":"not"}` or `{__scrml_absent:true}`) — coord with PA on JSON shape | SPEC §12.5.1 + §41.13 + new §50.x | 2 (spec) |
| D-12.2b | Server-fn emission: wrap `?? null` in envelope encoder when return type is `T \| not` | `emit-server.ts` L928/934/1089 | 3-4 |
| D-12.2c | Client-fn decoder: detect envelope, lower to scrml `not` (i.e., back to JS `null`) | runtime decoder helper | 2 |
| D-12.2d | Tests for wire format | `tests/integration/`, `tests/conformance/` | 3-4 |
| **Subtotal** | | | **10-12h** |

### Track 3: `?? "undefined"` init-fallback fix (UNIQUE to undefined audit)

| Phase | Description | Files | Est. hours |
|---|---|---|---|
| D-12.3a | Replace `?? "undefined"` JS-source interpolation with `?? "null"` (per §42.8 "null over undefined" rationale); ensure init produces scrml-absence-correctly-typed JS value | `emit-server.ts` (×3), `emit-logic.ts` (×10), `scheduling.ts` (×3) | 3-4 |
| D-12.3b | Add gauntlet/CG-level check to forbid literal `undefined` JS keyword interpolation in compiled output | new lint or extend existing | 2 |
| D-12.3c | Tests | | 2 |
| **Subtotal** | | | **7-8h** |

### Track 4: Spec amendments

| Phase | Description | Files | Est. hours |
|---|---|---|---|
| D-12.4a | §12.5.1 amendment: `not` wire format → envelope shape (clarify §42.1 wire-format exclusion still covers raw JSON null for non-`T \| not` fields) | SPEC.md | 1-2 |
| D-12.4b | §50.x new section: scrml wire-format normative (envelope rules, decoder semantics) | SPEC.md | 2-3 |
| D-12.4c | §51.0.J amendment: rename `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` → `E-DERIVED-ENGINE-INITIAL-ABSENT-RT`; update error message text | SPEC.md | 1 |
| D-12.4d | SPEC-INDEX.md refresh | SPEC-INDEX.md | 0.5 |
| **Subtotal** | | | **4-7h** |

### Track 5: Audit closure documentation

| Phase | Description | Files | Est. hours |
|---|---|---|---|
| D-12.5a | Document audit-item closure rationale (which items closed-as-spec-ratified, which migrated) | master-list.md + audit appendix | 1-2 |
| D-12.5b | Re-grep compiler/src/ post-migration; update audit counts | docs/audits/ | 1 |
| **Subtotal** | | | **2-4h** |

### Totals

| Track | Hours |
|---|---|
| AST internal cleanup | 10-14 |
| Wire-format envelope | 10-12 |
| `?? "undefined"` fix | 7-8 |
| Spec amendments | 4-7 |
| Audit closure docs | 2-4 |
| **GRAND TOTAL (Option α + ε)** | **33-45h** |

**Comparison vs Option β (sentinel-pure):**

| Track | β additional hours |
|---|---|
| Tracks 1-5 above | 33-45 |
| Runtime sentinel module + helpers | 4-6 |
| Migrate emit-expr is-not/is-some/is-not-not (M-7C-D-4) | 2-3 |
| Migrate rewrite.ts `not → null` (M-7C-D-5) | 2-3 |
| Migrate emit-engine state-cell history (M-7C-D-7) | 2-3 |
| Migrate emit-machines/emit-logic audit-log labels (M-7C-D-8) | 2-3 |
| Migrate emit-reactive-wiring default (M-7C-D-10) | 1-2 |
| Migrate emit-control-flow match-arm + key (M-7C-D-13) | 3-4 |
| Migrate runtime-template.js (M-7C-D-14 + M-8C-D-11) | 4-6 |
| Migrate runtime-validators.js (M-7C-D-18 + M-8C-D-13) | 3-4 |
| Migrate machine-property-tests (M-7C-D-17 + M-8C-D-9) | 2-3 |
| §42.5/§42.8 spec REWRITE + §42.9 interop normalisation rewrite | 4-6 |
| Conformance test sweep for sentinel ABI | 4-6 |
| **Option β GRAND TOTAL** | **66-94h** |

**Net delta: Option β costs roughly 2× Option α+ε for a scaffold that will be discarded.**

---

## §5 Open Questions for PA / user disposition

### OQ-1 — Which option? (α / β / γ / δ / ε)

The dispatch surfaced α/β/γ/δ as alternatives. SCOPING analysis recommends **ε (spec-amend the audit framing) paired with α-style internal AST cleanup**.

**Sub-decisions if ε chosen:**
- ε-1: Confirm the SPEC §42.5 + §42.8 + §12.5.1 + §42.1 exclusions are RATIFIED — runtime null IS scrml absence; this is not drift. (Audit M-class items closed-as-spec-ratified except wire-format + AST cleanup.)
- ε-2: Confirm the AST `litType:"null"`/`"undefined"` migration to single `"not"` discriminator is internal-cleanup-only with zero observable impact.
- ε-3: Confirm wire-format envelope is the SOLE user-visibility migration target.

**Sub-decisions if β chosen:**
- β-1: Sentinel shape — `Symbol.for("scrml:absent")` vs frozen object `{__scrml_absent:true}` vs other?
- β-2: §42.5 + §42.8 spec rewrite plan + grandfathering policy for already-shipped code?
- β-3: Are the ~30 codegen sites worth the scaffold investment given pa.md self-host-is-from-scratch?

### OQ-2 — Wire-format envelope JSON shape (if α / ε / γ)

Three candidate shapes:
- **(a) Tagged object:** `{":scrml":"not"}` (uses `:` prefix per §41.x stdlib namespace convention)
- **(b) Sentinel object:** `{"__scrml_absent": true}` (matches the runtime sentinel naming if β chosen later — forward-compat)
- **(c) JSON null with side-channel schema:** Out-of-band type marker (e.g., a wire-format schema descriptor accompanies the payload). Most complex.

Recommendation: (b) `{"__scrml_absent": true}` — forward-compat with β if ever taken, mirrors the `__scrml_error` envelope already in emit-server.ts L952 (canonical precedent).

### OQ-3 — Migration sequence (impl-first vs spec-amend-first)

- **(a) Spec-first:** Amend §12.5.1 + new §50.x + §51.0.J language; then implement codegen + tests.
- **(b) Impl-first:** Implement encoder/decoder; ship under feature-flag; spec-amend after stability.
- **(c) Parallel:** Spec + impl in same wave; coordinate.

Recommendation: **(a) spec-first** — per pa.md Rule 3, spec is the authority; let the spec settle before TS-scaffold codegen lands. Spec amendment is the cheapest test of whether the design is sound.

### OQ-4 — Backwards-compat for wire format

Does the v0.3 → v0.4 transition support the envelope-tagged wire? Two policies:
- **(a) Wire-format breaking change at v0.4:** All clients must redeploy. Clean cut.
- **(b) Dual-decoder:** v0.4 decoder accepts BOTH raw `null` AND `{__scrml_absent:true}`. v0.4 encoder emits envelope.
- **(c) Feature-flagged:** Per-program flag to opt into envelope.

Recommendation: **(b) dual-decoder** for the scaffold lifetime; (a) clean break at v1.0 / self-host rewrite.

### OQ-5 — `?? "undefined"` interpolation: which fallback?

The `emit-server.ts L882` pattern interpolates `stmt.init ?? "undefined"` as JS source. Two replacement options:
- **(a) Replace `"undefined"` with `"null"`:** Aligns with §42.8 "null over undefined" rationale; consistent with rest of codegen.
- **(b) Replace with proper init expression:** Trace upstream; ensure scrml `let x;` (no init) compiles to `let x;` (no init) in JS, not `let x = null;` either. This may break invariants.

Recommendation: **(a) `"null"`** — it preserves the existing semantics (declared-but-uninitialized → scrml-absence which is JS null per §42.5/§42.8) while eliminating the `undefined` keyword string interpolation. The audit's M-8C-D-6 flagging of `"undefined"` interpolation is well-founded; the fix is to use `"null"` instead.

### OQ-6 — `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` rename (M-8C-D-8)

Should the user-facing runtime error code be renamed?
- **(a) Rename:** `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` → `E-DERIVED-ENGINE-INITIAL-ABSENT-RT`. User error messages no longer name "undefined."
- **(b) Keep:** Existing code is documented in §51.0.J; rename is breaking-change to error catalog.

Recommendation: **(a) rename** — aligned with §42.8 ("No scrml program SHALL directly emit the JavaScript value `undefined`"). Spec amendment §51.0.J + §34 catalog row.

### OQ-7 — DevTools / debugger experience

Even under Option α + ε, a scrml-author inspecting variables in browser DevTools sees JS `null`, not `not`. Is this acceptable for the scaffold lifetime?
- **(a) Accept:** Document in §42.8 "Runtime Representation" subsection — DevTools shows the JS bit-pattern; scrml-language predicates classify correctly. The self-host rewrite addresses native scrml debugger experience.
- **(b) Add devtools-hook:** Emit a __scrml_inspect helper that re-presents values with scrml semantics in DevTools. Significant ongoing investment.

Recommendation: **(a) accept** — per pa.md self-host-is-from-scratch, devtools experience is a self-host concern.

### OQ-8 — Schema-differ (M-7C-D-15) cross-cutting

SQL DDL has its own NULL keyword. The §42.9 interop boundary normalises SQL `NULL` to scrml `not`. Does the schema-differ migration target change under any of α/β/ε?
- All options agree: SQL-side `NULL` is JS-host-J classification; the scaffold's `default: null` field in schema-record is internal-only. Migration target is documentation, not code.

Recommendation: **Defer M-7C-D-15 to internal cleanup track; no SQL DDL change.**

### OQ-9 — Spec-amendment timeline

The recommended path requires spec amendments (§12.5.1 + new §50.x + §51.0.J + §42.5 clarifying note that wire format uses envelope when type is `T | not`). Does this slot before or after Wave 4 (adopter content) in the v0.3.0 roadmap?

Recommendation: **PA disposition.** Likely AFTER Wave 4 (Wave 4 is adopter content; spec changes are post-cut).

---

## §6 Cross-cutting impact

### §6.1 §13.2 Sub-B isAsync infrastructure
**Impact: zero.** The isAsync work is about async-await contracts in compiled JS. Absence-sentinel decision is orthogonal.

### §6.2 §13.2 Sub-Phase E migrations
**Impact: zero.** Phase E migrations are already landed (S88 phase 3a). No interaction.

### §6.3 A-2.X waves (Approach A reachability)
**Impact: zero.** Reachability analysis is compile-time DG construction. Absence-sentinel is runtime ABI.

### §6.4 A-3 SCOPING
**Impact: zero direct.** A-3 is reachability follow-on. If A-3 ever needs to encode "this dependency is absent", that's a DG-internal sentinel, not a runtime ABI choice.

### §6.5 LIFT-5 ambient (M-7C-D-14 entry)
**Impact: marginal.** LIFT-5 already shipped S88. The runtime ambient `_scrml_lift_target = null` is internal to lift-template runtime and not scrml-author-observable. Under Option α + ε: zero migration needed. Under Option β: ~3 sites in runtime-template.js to rewire.

### §6.6 stdlib:host (S88 safeCall / safeCallAsync)
**Impact: zero.** stdlib:host returns tagged HostError envelopes — already follows the "tagged envelope at boundary" precedent. Wire-format envelope (OQ-2) should mirror the `__scrml_error` shape per stdlib:host precedent.

### §6.7 Wave 4 adopter content (v0.3.0 blocker)
**Impact: potential.** Adopter content (examples + tutorial) describes how scrml absence works. If §42.5/§42.8 changes (Option β), Wave 4 prose must be updated. Under Option α + ε: Wave 4 prose stays consistent with current §42.5/§42.8.

### §6.8 parseVariant (§41.13)
**Impact: zero direct.** parseVariant ALREADY uses tagged Result-style envelopes (`MissingDiscriminator`, etc.) — this is the canonical PRIOR ART for wire-format envelopes. The recommended wire-format envelope (OQ-2) extends this precedent.

### §6.9 happy-dom + browser tests
**Impact: zero under α + ε.** Under β: every test that asserts `result === null` for absent scrml values must change to `_scrml_is_absent(result)`. ~50+ test files.

### §6.10 Self-host (scrml-from-scratch)
**Impact: ALIGNS.** Per pa.md, the eventual scrml self-host is from-scratch. Whatever runtime representation IT chooses is independent of the TS scaffold. Option α + ε defers this design to the self-host; Option β pre-commits the scaffold to a specific ABI.

---

## §7 Recommendation

### Primary recommendation: Option ε + α-style AST cleanup

**Per pa.md Rule 3:** The "right answer" is to read the SPEC + audit + user-voice TOGETHER. The SPEC has already ratified §42.5/§42.8/§12.5.1/§42.1-exclusions as the canonical absence ABI. The audit's value is surfacing the surface inventory — and the surface inventory, properly triaged, reveals ONE load-bearing user-visibility leak (the wire format).

**Per pa.md self-host-is-from-scratch:** The TS impl is a scaffold; do not over-invest in scaffold ABI. Migrate only what affects scrml-observable surfaces. Specifically:
- AST internal cleanup (`litType:"null"`/`"undefined"` → `"not"`) — internal hygiene, ~10-14h.
- Wire-format envelope at server-fn boundary — load-bearing user-visibility fix, ~10-12h.
- `?? "undefined"` interpolation → `?? "null"` — eliminates literal `undefined` JS keyword in compiled output, ~7-8h.
- Spec amendments (§12.5.1 + new §50.x + §51.0.J) — ~4-7h.
- Audit closure documentation — ~2-4h.

**Total: 33-45h** for the scaffold work, vs ~66-94h for Option β (sentinel-pure) which over-invests in code that will be discarded.

### Why NOT Option β

Option β is the "structurally pure" answer and would be the right answer for a long-lived runtime. It is NOT the right answer for the TS scaffold per pa.md self-host-is-from-scratch. The audit's framing of "compiled JS contains `null` therefore drift" is challenged by §42.1 exclusions (S89 ratified) which explicitly carve out codegen-emitted JS from the W-ABSENCE-IN-SCRML-SOURCE lint. The audit was correct to surface the surface; the disposition resolves to "spec-ratified, not drift" for all sites except wire format + internal AST cleanup.

### Why NOT Options γ / δ

- γ: Heterogeneous runtime is a maintenance liability with no benefit over α+ε.
- δ: Inverts §42.8 normative-statement (null over undefined) and worsens the wire-format ambiguity.

### Cascade unblocking under Option ε

The 9 follow-on audit items (M-7C-D-4/5/6/7/8/9/10/13/14/17) are disposed as follows:
- **M-7C-D-4 (`is-not` emission):** CLOSED — §42.8 normatively mandates `=== null || === undefined` (handles JS-host interop per §42.9). No change.
- **M-7C-D-5 (rewrite.ts `not → null`):** CLOSED — §42.5/§42.8 normatively mandate this codegen.
- **M-7C-D-6 (server-fn wire format):** MIGRATE per Track 2 (10-12h).
- **M-7C-D-7 (engine state-cell history):** CLOSED — internal storage; scrml-author observes via `@varName` predicate-level; §42.5/§42.8 applies.
- **M-7C-D-8 (audit-log labels):** CLOSED — `@auditTarget.label` is read via scrml predicates; `is not` handles null correctly. No change.
- **M-7C-D-9 (SQL .get/.first absence):** CLOSED — §42.9 interop boundary; SQL NULL → scrml `not` is already correctly modeled by predicate-level reads.
- **M-7C-D-10 (reactive-wiring default):** CLOSED — internal codegen string; §42.1 exclusion.
- **M-7C-D-13 (match-arm):** PARTIAL — IR cleanup (replace `test:null, binding:null` with `kind:"absent"` discriminator) is good hygiene; runtime emission unchanged.
- **M-7C-D-14 (runtime _scrml_lift_target):** CLOSED — internal runtime ambient; §42.1 exclusion.
- **M-7C-D-17 (machine-property-tests):** CLOSED — emitted test harness; §42.1 exclusion.

The 5 unique-to-undefined audit items (M-8C-D-6/8/15 + cache-slot + array-first):
- **M-8C-D-6 (init fallback `?? "undefined"`):** MIGRATE per Track 3 (7-8h) — literal `undefined` keyword in compiled JS source IS drift even under §42.1 (the keyword is interpolated as JS source, not just a runtime value).
- **M-8C-D-8 (derived-engine throw):** MIGRATE per Track 4 (1h) — rename error code + message.
- **M-8C-D-15 (machine-fn payload-positional undefined):** SEPARATE PA disposition needed (see audit §5.3); defer.
- **Cache-slot invalidation (L500):** CLOSED — internal cache idiom; §42.1.
- **Array-first helpers (L2203, L2236):** REVIEW — these emit literal `undefined` in compiled runtime helpers; under recommended policy, replace with `null` (since scrml `arr.first()` on empty should return scrml-absence = JS null).

### What this disposition means strategically

The audit's M-class count drops from "~860 sites across 18 follow-on items" to **"~95 sites across 5 follow-on items"** — a >85% reduction in scaffold migration work. The work shifts from runtime-ABI-rewrite to (a) wire-format envelope + (b) AST hygiene + (c) literal-keyword-cleanup + (d) spec amendments.

**This disposition is consistent with:**
- pa.md Rule 3 (right answer beats easy answer): right answer here is reading the SPEC + audit together, not chasing audit grep.
- pa.md self-host-is-from-scratch: TS scaffold should not be over-invested.
- SPEC §42.1 exclusions (S89): codegen-emitted JS legitimately uses `null`; not drift.
- SPEC §42.5/§42.8 (current normative ABI): runtime null IS scrml absence; preserve.
- SPEC §42.9 (interop boundary): JS-host null/undefined → scrml `not` at boundary; predicate-level reads classify correctly.

### Worst-case if PA disposition picks Option β instead

If PA rules that runtime sentinel purity IS worth the scaffold investment, the path is:
1. Spec-amend §42.5/§42.8 to specify sentinel (drop "compiles to null"; specify symbol/object).
2. Implement runtime sentinel module + helpers.
3. Cascade all 18 audit M-class items + spec ABI rewrite.
4. ~66-94h total work, vs ~33-45h for ε.
5. All conformance tests + runtime-template.js + runtime-validators.js touched.

That path is acceptable structurally — it's the "purist" answer — but it spends scaffold cycles that the self-host rewrite will discard.

---

## Appendix A — File-line index for follow-on dispatch

### Track 1: AST internal cleanup sites

```
compiler/src/types/ast.ts:1476  LitExpr.value type
compiler/src/types/ast.ts:1482  litType: "null"
compiler/src/types/ast.ts:1483  litType: "undefined"
compiler/src/types/ast.ts:1484  litType: "not"
compiler/src/types/ast.ts:1568  doc cite

compiler/src/expression-parser.ts:971   not keyword → LitExpr
compiler/src/expression-parser.ts:987   JS null → LitExpr (parse-failure path)
compiler/src/expression-parser.ts:1187  is-not RHS injection
compiler/src/expression-parser.ts:1192  is-some RHS injection
compiler/src/expression-parser.ts:1197  is-not-not RHS injection
compiler/src/expression-parser.ts:1230-1236  reset() zero-arg synth
compiler/src/expression-parser.ts:1255-1258  reset() multi-arg synth
compiler/src/expression-parser.ts:1316  array-hole undefined
compiler/src/expression-parser.ts:1483  empty-expr placeholder
compiler/src/expression-parser.ts:1596  emitStringFromTree round-trip
compiler/src/expression-parser.ts:2185  keyword whitelist

compiler/src/ast-builder.js:2133/2441/8461  VALUE_KEYWORDS sets

compiler/src/tokenizer.ts:61/699/707/713/724  KEYWORD + VALUE_KEYWORDS

compiler/src/type-system.ts:578   tPrimitive("null") registration
compiler/src/type-system.ts:3143  GLOBAL_NAMES set

compiler/src/gauntlet-phase3-eq-checks.js:168/351-353/378/386/413-414/437-443/509-512/604-607  detector

compiler/src/component-expander.ts:745-752  default="null" path

compiler/src/route-inference.ts:1582  reserved-name list
```

### Track 2: Wire-format envelope sites

```
compiler/src/codegen/emit-server.ts:928   JSON.stringify(_scrml_result ?? null)  [Ext5Dedup path]
compiler/src/codegen/emit-server.ts:934   JSON.stringify(_scrml_result ?? null)  [non-dedup path]
compiler/src/codegen/emit-server.ts:1089  JSON.stringify(... ?? null)  [client-fetch wrap]
```

### Track 3: `?? "undefined"` interpolation sites

```
compiler/src/codegen/emit-server.ts:882   stmt.init ?? "undefined"
compiler/src/codegen/emit-server.ts:1047  stmt.init ?? "undefined"
compiler/src/codegen/emit-server.ts:1139  stmt.init ?? "undefined"

compiler/src/codegen/emit-logic.ts:591    initStr === "undefined"
compiler/src/codegen/emit-logic.ts:1764   _emitReactiveSet(encoded21, "undefined", ...)
compiler/src/codegen/emit-logic.ts:1823   node.init ?? "undefined"
compiler/src/codegen/emit-logic.ts:1885   initStr !== "undefined"
compiler/src/codegen/emit-logic.ts:1900   initStr !== "undefined"
compiler/src/codegen/emit-logic.ts:2155   ternary fallback "undefined"
compiler/src/codegen/emit-logic.ts:2262   guardedNode.init ?? "undefined"
compiler/src/codegen/emit-logic.ts:2265   guardedNode.init ?? "undefined"
compiler/src/codegen/emit-logic.ts:2281   resultVar = undefined; (emitted JS)
compiler/src/codegen/emit-logic.ts:2378   node.value ?? "undefined"

compiler/src/codegen/scheduling.ts:127   initStr || "undefined"
compiler/src/codegen/scheduling.ts:128   (same)
compiler/src/codegen/scheduling.ts:129   return "undefined"
```

### Track 4: Spec amendment sites

```
compiler/SPEC.md  §12.5.1 (L6442-6480)        Server function return — add envelope rule for T | not
compiler/SPEC.md  §42.5 (L18467-18474)         Codegen — clarify wire-format envelope override
compiler/SPEC.md  §42.8 (L18525-18537)         Runtime Representation — keep; add wire-format cross-ref
compiler/SPEC.md  §51.0.J                       Derived-engine throw — rename error code
compiler/SPEC.md  §34 (L14422-14929)            Error catalog — add E-DERIVED-ENGINE-INITIAL-ABSENT-RT row
compiler/SPEC.md  §50.x  (NEW)                  Wire-format normative section
compiler/SPEC-INDEX.md                          Section index refresh
```

---

## Appendix B — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User-voice REJECTS the §42.1 exclusion framing ("null does not exist" wins over §42.1 carve-out) | Med | High — forces Option β | This SCOPING explicitly surfaces the conflict; PA decides |
| Wire-format envelope breaks an unforeseen consumer (e.g., a sample app's hardcoded JSON parse) | Med | Low | Dual-decoder per OQ-4(b) covers backward-compat |
| Spec amendment §12.5.1 + new §50.x conflicts with §41.13 parseVariant envelope shape | Low | Low | Mirror parseVariant's tagged-variant shape (OQ-2 (b)) |
| Option β chosen but runtime-template.js refactor breaks LIFT regression tests | Med (if β) | Med | Comprehensive runtime regression sweep before commit |
| `?? "undefined"` → `?? "null"` migration breaks a fragile invariant (e.g., a downstream `=== "undefined"` check) | Low | Med | M-8C-D-6 Track 3 includes downstream consumer audit (emit-logic L591/1885/1900) |
| Audit re-grep post-migration reveals new sites not in §2 inventory | Low | Low | Track 5 includes re-grep and update |

---

## Tags

#scoping #s89 #m-7c-d-12 #runtime-absence-sentinel #wave-7-d-blocker #wave-8-d-blocker #pa-rule-3 #self-host-scaffold

## Links

- [primary.map.md](../../.claude/maps/primary.map.md)
- [schema.map.md](../../.claude/maps/schema.map.md)
- [error.map.md](../../.claude/maps/error.map.md)
- [null-audit-compiler-src-2026-05-13.md](../../audits/null-audit-compiler-src-2026-05-13.md)
- [undefined-audit-compiler-src-2026-05-13.md](../../audits/undefined-audit-compiler-src-2026-05-13.md)
- [pa.md](../../../pa.md)
- SPEC §42 (L18222-18567); §12.5.1 (L6442-6480); §42.1.1 (L18250-18282)
