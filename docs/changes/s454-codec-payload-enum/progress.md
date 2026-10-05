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
