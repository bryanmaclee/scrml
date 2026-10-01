# s446-bootstrap-uc-codec — progress (append-only, timestamped)

## 2026-10-01 — start
- Worktree `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a447b5f6e7bf1de4c`, branch `worktree-agent-a447b5f6e7bf1de4c`.
- Startup: worktree was created at `fe5cad679`; `git fetch` showed origin/main at `bca39b61a` (#1201, #1206 landed
  after creation), so the merge-base check failed as created. The tree was clean with no commits, so it was
  fast-forwarded (`git merge --ff-only origin/main`); merge-base == origin/main == `bca39b61a` thereafter.
- `bun install`, `bun run pretest` OK. Pre-commit gate baseline (first commit): 27258 pass / 72 skip / 12 todo / 0 fail.

## 2026-10-01 — governing text (quoted)
- §57.2: "The envelope SHALL be a JSON object with exactly one own property named `__scrml_absent` whose value is
  the boolean `true`."
- §57.3: "Server-function code-generation SHALL emit the canonical envelope `{"__scrml_absent": true}` when the
  function's declared (or inferred) return type is `T | not` AND the runtime value is the scrml-absence sentinel."
  · "For the non-absent variant (`T`), the encoder SHALL emit the value through the normal JSON serializer — no
  envelope wrapping." · "For declared return types that are NOT `T | not` … the encoder continues to use raw JSON
  `null` for any JS-host `null` that may slip through".
- §57.1: the format applies to "Any JSON payload the compiler emits for a `T | not` field whose value is the
  scrml-absence sentinel `not`" and (S444) to `persist=` storage values. → the envelope is applied at EVERY
  `T | not` position (struct field, sequence element, root), not only at a server-fn's top-level return.
- §57.4: "SHALL accept `{"__scrml_absent": true}` (canonical) and lower it to scrml `not`" · "SHALL ALSO accept a raw
  JSON `null` … and lower it identically" · "Any envelope shape other than the two admitted forms … SHALL be treated
  as a malformed payload" · "The decoder SHALL NOT silently coerce arbitrary JSON object shapes into scrml-absence."
- §57.5: at v1.0 "the decoder SHALL accept ONLY the canonical envelope". Implemented as an opt-in
  `{ canonicalOnly: true }`; default dual (we are v0.8.0). Whether persist= binds to it is OPEN (O-061-12).
- §12.5.1: "Enum types (serialize as the variant name string)".
- §42.3.1: "`(T | not) | not` is `T | not`" → `Maybe(Maybe(T))` resolves to one `maybe`.
- §42.8 / §42.9: `not` is JS `null`; `undefined` is treated as `not` at the boundary.
- §6.14.2 r2-r3: storage values use "the §57 wire format and the §59.10 lossless codec"; "decoded against the cell's
  **current** declared type and its full declared contract (e.g. §53 refinements, §66.12 sequence bounds)"; any
  failure → the default; "SHALL NOT be coerced".
- §59.10: maps use an entries-array codec — OUT OF SCOPE: Core has no map type.

## 2026-10-01 — design
- Compile-time half `compiler/self-host-v2/codec.scrml`: `wireBuild(p: CoreProgram, t: Type) -> WireBuild { table |
  not, why }` resolves a Core type to a closed descriptor (`WireTable`: defs + root; Named → `WRef(slot)`, so
  recursive types close); `wireTableJs` / `wireTableText` print it as the JS literal a printer embeds.
  REFUSES (why, no table): payload-carrying enum variants (SPEC question 1), a struct field named `__scrml_absent`
  (SPEC question 2), Named naming no TypeDef (a §66 declaration type).
- Runtime half `compiler/self-host-v2/slice-codec/runtime/codec.js` (new file; runtime.js untouched):
  `encode`/`encodeText`/`decode`/`decodeText`/`isAbsenceEnvelope`. Results, never throws:
  `{ok:false, error:{kind: malformed|contract|parse|value, path, reason}}`.
- Decode decisions where §57 is silent (fail-closed reading of §57.4 "never coerce" + §6.14.2 r3): an EXTRA struct
  key is malformed (refused, not dropped); a MISSING field is malformed even for a `T | not` field (omission is not
  one of §57.4's two admitted absence forms); `null`/envelope at a non-`T | not` position is malformed; an object
  carrying `__scrml_absent` that is not exactly the envelope is malformed.
- Contract: `Seq` `Bounded(min,max)` (§66.12) checked on decode → kind "contract". `Fixed` constrains writes, not
  values, and carries no static length — not checkable by the decoder alone (U5 note).

## 2026-10-01 — committed `6ff967f0b` (codec halves); tests written
- `slice-codec/codec.test.js` (41 tests): descriptors from REAL Core (bootstrap front end lowers
  `slice-codec/src/types.scrml`) + hand-built Core types for shapes the parser cannot spell yet
  (`(T | not)[]`, `Bounded`, `Maybe(Maybe(T))` — the front end never produces `Bounded`; analyze.scrml:4198 only
  matches it). Encode/decode/failure/refusal cases; property-style round trip, 16 types x 150 seeded values each,
  with `not` at every `maybe` (p=0.35), asserting (a) no raw null at any `maybe` position of the wire, (b) dual
  decode == value, (c) canonical-only decode == value.
- `slice-codec/cross-impl.test.js` (25 tests): impl#1 compiles a probe with `T | not` / pure-T server fns; the test
  extracts impl#1's EMITTED `_scrml_wire_encode` (server.js) and `_scrml_wire_decode` (scrml-runtime.*.js), pins the
  emitted call shapes, and checks both directions for the shared shapes (byte-identical text too); divergences pinned.
- Bite proof 1 (runtime): encoder envelope key `__scrml_absent` -> `__scrml_absnt` → 18 fail / 48 pass; restored → 66/66.
- Bite proof 2 (compile-time): codec.scrml `.Maybe` arm drops the `WMaybe` wrapper → 15 fail / 51 pass; restored → 66/66.
- `bun scripts/lint-no-default-arm.js` → 61 files, 0 violations (58 + codec.scrml + slice-codec/{bundle,src/types}.scrml).

## impl#1 divergences from §57 (observed in impl#1's emitted output, pinned in cross-impl.test.js)
- D1 — the envelope is applied ONLY to a server fn's top-level `T | not` return (`emit-server.ts`
  `returnTypeAllowsAbsence` + `_scrml_wire_encode`); a `T | not` struct field / sequence element goes out as raw
  `null`. §57.1 scopes the format to "Any JSON payload the compiler emits for a `T | not` field". Survives only
  while the dual-decoder lives (§57.5 canonical-only would reject it).
- D2 — the client decoder unwraps only a top-level envelope; a nested envelope stays an object `{__scrml_absent:true}`.
- D3 — `_scrml_wire_decode` tests `value.__scrml_absent === true`, not "exactly one own property" (§57.2):
  `{"__scrml_absent":true,"x":1}` decodes as `not`.
- D4 — not type-directed: a malformed payload passes through unchanged (§57.4: "SHALL be treated as a malformed
  payload").
- D5 — server-fn ARGUMENTS are `JSON.stringify`d raw (client stub): a `T | not` argument's absence is raw `null`.
- D6 — `returnTypeAllowsAbsence` is a string predicate on the annotation; a type alias that includes `not`, or an
  inferred `T | not` return, is not recognized (seen in wire-format.ts; not separately probed).
- Payload enum variants: impl#1 emits the RUNTIME shape `{"variant":"Circle","data":{"r":2}}` (probe: server fn
  `-> Shape` returning `Shape.Circle(2)`); unit variants `"Square"`. The bootstrap's runtime shape is different
  (print.scrml `variantTest` reads `m$.tag`, payload fields flat on the object) — no shared runtime shape to inherit.

## SPEC questions (surfaced, NOT decided)
- Q1 — payload-variant wire shape. §12.5.1: "Enum types (serialize as the variant name string)" — silent for a
  variant with a payload. impl#1 sends `{variant, data:{…}}`; §41.13 parseVariant speaks of a discriminator "`tag`
  field"; §32727's runtime shape is `{ variant, data }`. The codec REFUSES payload variants (no guessed shape).
- Q2 — is a struct field named `__scrml_absent` (or any `__scrml_*`) legal? Its present value in a `T | not`
  position is indistinguishable from the envelope (lossy). The codec REFUSES the type.
- Q3 — extra / missing struct keys: §57 is silent. Implemented fail-closed (both malformed) per §57.4 "never
  coerce" + §6.14.2 r3; a "drop unknown keys" forward-compat reading would be a different, explicit rule.
- Q4 — §57.5 says the dual-decoder retires at v1.0 "which coincides with the from-scratch scrml self-host rewrite".
  The bootstrap IS that rewrite but ships under v0.x; implemented dual by default with `canonicalOnly` opt-in. With
  D1, a canonical-only bootstrap client could not read impl#1 server payloads with nested absence.
- Q5 — non-finite `number` (NaN/Infinity) has no JSON form; §57 is silent. The encoder refuses (kind "value")
  rather than letting `JSON.stringify` write `null` (which a `T | not` decoder would read as absence).

## 2026-10-01 — verification (at `60cc85427`)
- Pre-commit gate (unit+integration+conformance via hook): 27258 pass / 72 skip / 12 todo / 0 fail (= baseline).
- Bootstrap: slice-m1 73/73 · lowered slice-m1 73/73 · slice-m2 448/448 · slice-m3 60/60 · slice-m4 403 + 1 todo ·
  slice-codec 66/66 (NEW) · lint-no-default-arm 61 files / 0 violations.
- `bun test compiler/tests/*.test.js`: 6387 pass / 13 skip / 0 fail (14 files).

## Handoff notes
- CI: `slice-codec/` is NOT in `.github/workflows/ci.yml`'s bootstrap step (brief: new files only). PA: add
  `bun test ./compiler/self-host-v2/slice-codec/` beside the slice-m4 line.
- For U1: emit `wireTableJs(wireBuild(p, ty).table)` per server-fn return type AND per parameter type; refuse the
  server fn (bootstrap diagnostic) when `why` is non-empty. The runtime half is a new file; U1 decides whether it is
  folded into the emitted runtime or imported beside `runtime.js`.
- For U5 (§6.14.2 r3): `decodeText(table, storage.getItem(key))` — any `ok:false` (parse / malformed / contract), or a
  null text, → the cell's default. Contract coverage today: only `Seq` `Bounded` (Core has no refinements, §53, and
  no validator in Core — `AValidator` lives in ast/analyze only, §55; O-061-4 open). `Fixed` length needs the
  default's length from the caller. Map (§59.10) absent from Core.
- Finding outside scope (not touched): js.scrml `propKey` prints `__proto__` bare, so print.scrml `structJs` for a
  struct field named `__proto__` would set the prototype instead of a field. The codec's runtime builds decoded
  structs with `Object.defineProperty`, so it is not affected.

## 2026-10-01 — review round r1 (findings on `5ff6f5b4e`, all LOW) — each reproduced by probe before fixing
- L1 FIXED (`d2346547a`). Reproduced: `encode(Int, undefined)` → ok `"null"`; seq hole → `[1,null,3]`;
  `Bounded(1,2)` with `[]` → ok `"[]"`; struct field undefined → `{"x":null}`. PA ruling (fail-closed): encode is
  STRICT by default — null/undefined/hole at a non-`T | not` position and a `Bounded` violation are kind "value".
  §57.3's sentence ("For declared return types that are NOT `T | not` … the encoder continues to use raw JSON `null`
  for any JS-host `null` that may slip through") is about a server-function RETURN, so it is the explicit opt-in
  `encode(table, v, { hostNullPassthrough: true })` for U1's return position. Tests for both modes, plus a
  property test over seeded near-miss values (junk / holes / dropped fields / grown sequences) pinning: strict
  encode ok ⇒ decode (dual and canonical-only) ok and equal to the value (with §42.9 undefined → not). Bite: forcing
  passthrough on in strict mode → 7 red.
- L2 FIXED (`d2346547a`). Reproduced: `decode/decodeText(…, null)` threw TypeError; a throwing getter / Proxy trap
  threw out. Now `opts ?? {}` on every entry point; `guarded(kind, run)` turns ANY throw while reading input into a
  failure value (classifying the thrown thing defensively — `instanceof` on a thrown Proxy runs traps). The one
  remaining throw is the new exported `CodecDefect`: a broken DESCRIPTOR (unknown kind, dangling ref) — a compiler
  bug, not input. Header updated to say so.
- L3 FIXED (`d2346547a`). Reproduced: `encode(Struct{}, new Date())` → ok; `decode(Struct{}, new Map())` → ok. Struct
  values must now have prototype `Object.prototype` or `null` (both directions); null-prototype objects accepted.
- L4 FIXED (`d2346547a`). Reproduced: an encode cycle reported kind "malformed". `guarded` now takes the operation's
  kind: encode → "value", decode → "malformed".
- L7 FIXED (`b7e06c5c9`). `.github/workflows/ci.yml` bootstrap step runs `bun test ./compiler/self-host-v2/slice-codec/`
  after slice-m4 (the one authorized shared-file edit).
- L5, L6 NOT fixed (per PA) — recorded as SPEC questions below.

## SPEC questions added in r1
- Q6 (L5) — Int range and `-0`. The codec accepts any `Number.isInteger` value, including integers beyond 2^53 that
  JSON round-trips only approximately; `-0` encodes as `0` (JSON has no negative zero). §57 / §14 do not say what
  `int`'s wire range is.
- Q7 (L6) — duplicate JSON keys. `JSON.parse` is last-wins (`{"x":1,"x":2}` → `x = 2`), so `decodeText` cannot see
  a duplicate key and accepts that text. §57 is silent; a strict reading would need its own JSON reader.
- Q8 — other `__scrml_*` field names. §57.2: "both envelopes share the `__scrml_*` namespace". That reserves the
  prefix for ENVELOPES; it does not say struct fields may not use it. The only identifier reservation in SPEC is
  §42-area S439 #7 / S440 #9 (`E-NAME-COLLIDES-RESERVED-PREFIX`), and it covers `_scrml_` (one underscore) BINDINGS,
  not `__scrml_` struct fields. So the codec refuses only `__scrml_absent` (where the collision is lossy inside
  the codec) and does not refuse `__scrml_error`. Risk to record: impl#1's client treats a response body with
  `.__scrml_error === true` as the §19 error envelope, so a successful return of a struct with a `__scrml_error:
  true` field would be misread there. U1 will hit this when it adds the error envelope. Ruling owed: is the whole
  `__scrml_` prefix reserved for struct field names?

## r1 verification (at `b7e06c5c9`)
- Hook: 27258 pass / 72 skip / 12 todo / 0 fail (unchanged). slice-codec 83/83 (was 66). slice-m1 73/73, lowered
  73/73, slice-m2 448/448, slice-m3 60/60, slice-m4 403 + 1 todo. `compiler/tests/*.test.js` 6387 pass / 13 skip /
  0 fail. lint-no-default-arm 61 files / 0 violations.
- U1 handoff note amended: use `{ hostNullPassthrough: true }` only when encoding a server function's
  non-`T | not` RETURN; arguments and every other sink are strict.

## 2026-10-01 — r2 follow-up N1-N3 (r2 re-review CLEAN; Uc landing as PR #1213 @ `40692dd64`) — `e17c92dce`
All three reproduced by probe before fixing.
- N1 FIXED. Reproduced: `Object.prototype.hostNullPassthrough = true` made `encodeText(int, null)` ok `"null"` with
  no opts (and a polluted `canonicalOnly` flipped the decoder). Flags are now read only as OWN properties
  (`Object.hasOwn`), for both flags. Tests pollute the prototype (restored in `afterEach`) and use an opts object with
  inherited flags. Bite: reverting to a plain property read → 3 red.
- N2 FIXED. Reproduced: a getter on opts and a revoked Proxy as opts threw out of encode / decodeText. Opts are now
  read inside the guarded region → failure of the operation's kind. Tested on all four entry points.
- N3 FIXED. Reproduced: `encode(Pt, {…, extra: 2})` → ok, key dropped. Encode now refuses an undeclared own
  enumerable key (kind "value", path `$.extra`), symmetric with decode. A non-enumerable own property is not a key.
- Header: the "encode ok ⇒ decodes equal" claim now states the one exception, number `-0` → `0`, pointing at Q6
  (not normalised; Q6 unruled). Pinned by a test.
- Verification: slice-codec 92/92 (was 83); slice-m1 73/73, lowered 73/73, slice-m2 448/448, slice-m3 60/60,
  slice-m4 403 + 1 todo; lint 61 files / 0; hook 27258 pass / 0 fail.
