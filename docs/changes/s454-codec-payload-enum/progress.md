# s454-codec-payload-enum — progress (append-only)

## 1. Start (base b35593879, branch feat/s454-codec-payload-enum)

### Governing sentences (SPEC.md at b35593879)

- §57.8 bullet 1 (unit variant): "An enum value whose variant carries NO payload SHALL be encoded as the variant
  name, a JSON string (`"Square"`) — §12.5.1, unchanged."
- §57.8 bullet 2 (payload variant): "An enum value whose variant carries a payload SHALL be encoded as a JSON object
  with exactly two own properties: `"variant"`, the variant name as a string, and `"data"`, a JSON object whose keys
  are the variant's DECLARED field names and whose values are the field values, each encoded by this section's rules
  (a `T | not` field whose value is absent is the §57.2 envelope; a nested enum value is encoded by this rule; a
  struct by the normal serializer)."
- §57.8 bullet 3 (error envelope): "The `fail` error envelope (§19.9.1) SHALL carry the same `variant` and `data`,
  plus `"__scrml_error": true` and `"type"` (the enum's name). For an error variant with no fields, `data` is `{}`.
  One decoder therefore reads a variant's payload the same way whether it arrived as a value or as an error."
- §12.5.1: "Enum types: a variant with no payload serializes as the variant name string; a variant WITH a payload
  serializes as `{"variant": "<V>", "data": {<field>: <value>, …}}` (§57.8, S451 R8 …)"
- §57.4 (strictness): "Any envelope shape other than the two admitted forms … SHALL be treated as a malformed
  payload … The decoder SHALL NOT silently coerce arbitrary JSON object shapes into scrml-absence." and (R10) "On a
  route whose BOTH ends this compiler emitted … the decoder SHALL be strict".

### Direction

Newly-accepting inside the bootstrap only: a payload-enum type (refused by `codec.scrml` `enumDef` with "a payload
wire shape is not ruled") now gets a wire descriptor, so a server function / `persist=` cell whose type holds one
is no longer E-BOOTSTRAP-UNSUPPORTED. Toward the contract — §57.8 bullet 2 (quoted above) already fixes the shape —
so this is a conformance restoration, not a language change. Nothing changes in impl#1 or SPEC.

### Locate (PA hypothesis: `codec.scrml:~211`)

HELD, refined. The refusal is decided in ONE place: `codec.scrml` `enumDef` (the `v.fields.length > 0` branch,
line 211). Every consumer reads it through `wireBuild(...).table is not`:
- `analyze.scrml` `wireDiag` (server-fn params/return → E-BOOTSTRAP-UNSUPPORTED, message names the payload enum) and
  `persistCellProblem` (persist cell → E-BOOTSTRAP-UNSUPPORTED);
- `check.scrml` C-S4 (server fn) and C17 `checkPersist`;
- `print.scrml` `persistedJs` (embeds `wireTableJs`).
Work needed: descriptor (WEnum carries per-variant fields), `wireTableJs` literal, `hasFixedLength`; the runtime
half (`slice-m1/runtime/runtime.js` "The §57 wire codec" — `slice-codec/runtime/codec.js` only re-exports it):
encoder + decoder enum branch; analyze's message text (no longer names the payload enum). `persisted` needs no
change (it calls encode/decode against the table).

Runtime value shape used (Ue DESIGN §5, `docs/changes/s451-boot-ue/DESIGN.md`, and `print.scrml` `variantValueJs`):
"nullary: its tag string; payload: `{ variant: "V", data: [v0, …] }`, the payload POSITIONAL … the R8 wire form
keys `data` by field name, the codec maps index ↔ field".

Core has no map type (`core.scrml` `Type` = Int/Num/Str/Bool/Named/Seq/Maybe), so "maps inside a payload" cannot
reach the codec; nothing to build for them.

## 2. Built (code + tests, one commit)

- `codec.scrml`: `WireVariant { name, fields }`; `WEnum(name, variants)`; `enumDef` describes every variant's
  payload fields through `wireTy` (nested structs, enums, `T | not`, sequences resolve as before). The refusal is
  gone. A payload field named `__scrml_absent` is NOT refused (the `data` object never stands in a `T | not`
  position). `hasFixedLength` looks into variant payloads. Literal: `{ k: "enum", name, variants: [{ name, fields }] }`.
- `slice-m1/runtime/runtime.js` (§57 section): `encEnum`, `decEnum`, `decPayload` (shared by value + error
  decode — §57.8 "One decoder therefore reads a variant's payload the same way whether it arrived as a value or as
  an error"), `decodeError` (exported; re-exported by `slice-codec/runtime/codec.js`; NOT wired to any call path).
- `analyze.scrml` `wireDiag`: message no longer claims the payload enum is missing; `print.scrml` comment updated.
- Strict decode: unknown variant (`$.variant`), unknown unit name (`$`), missing field (`$.data.<f>`, even for a
  `T | not` field), extra field (`$.data.<k>`), wrong field type (`$.data.<f>`), `data` on a unit variant (`$`),
  `{variant}` with no data on a unit variant (`$`), payload variant as a bare name (`$`), missing `data`,
  missing `variant`, `data` as array / null, non-string `variant`, a third top-level key, an error envelope where a
  value is expected, absence where none is admitted, nested paths through struct / Seq / enum `| not`, a malformed
  absence envelope inside a payload; Object.prototype names (`__proto__`, `toString`…) name no variant; a getter
  throw and deep nesting through a recursive enum stay failure values. Every reject asserted in BOTH modes (the
  payload rules do not depend on `canonicalOnly`); raw `null` in a payload `T | not` field: strict refuses,
  dual default admits.
- No-echo: reasons quote at most a 40-char cut of a foreign string, objects are named by kind ("an object").
  (Residual, pre-existing and shared with structs: an unknown KEY is echoed in full in the path.)
- Error envelope: exactly four own keys; `__scrml_error === true`; `type === <declared enum name>` (so impl#1's
  `"CpsError"` against a declared `LoadError` is refused at `$.type`); `data` `{}` for a unit variant.

## 3. Cross-impl

- SHARED: impl#1's payload-enum VALUE wire bytes equal the bootstrap's (`Shape.Circle(2)` →
  `{"variant":"Circle","data":{"r":2}}`), both directions; impl#1's runtime value is keyed, the bootstrap's
  positional — the codec maps.
- D6 (pinned, not conformed to): impl#1's `fail` envelope sends `data: null` for a unit variant and the bare
  argument (`data: "neg"`) for a payload variant, with status 200. §57.8 says `{}` / keyed object; the U1b design
  §3.2 says a 2xx envelope is Malformed. The bootstrap refuses both impl#1 forms.

## 4. Conformance counter

Before (b35593879 + docs): PASS 121 · FAIL 48 · NOT-TWINNED 514 · UNSUPPORTED 629 of 1312.
After: identical; per-case JSON diff: 0 bucket moves, 0 verdict-detail changes. No conformance case reached the
old refusal (no case's verdict carried it). `--check`: docs/bootstrap-conformance.md is current — nothing to
regenerate.

## 5. Owed elsewhere (not edited here — sibling owns SPEC / known-gaps)

- known-gaps: impl#1 `fail` envelope data shape diverges from §57.8 (unit → `null`, payload → bare first arg,
  not keyed) and is sent 200 — candidate gap entry (impl#1 frozen).
- Payload sequences resolve with `Fixed` length (variant payload fields carry `noGrants()`), so a `persist=` cell
  whose payload holds a sequence is refused by `hasFixedLength` — conservative; a payload is a value built whole,
  so whether `Fixed` should apply there is a question for U5's owner.
- The bootstrap cannot CONSTRUCT a payload enum value outside `fail` (`Shape.Box(3)` / `.Box(3)` in a value
  position → E-BOOTSTRAP-UNSUPPORTED) — tests construct one via `!{ _ e :> @s = e }`.
