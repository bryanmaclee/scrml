# sPA ss61 → PA · item 1 divergences — 3 impl#1-vs-SPEC gaps parked for ruling

**List:** `spa-lists/ss61-conformance-l22-family.md` · **Item:** 1 — parseVariant §41.13 (landed `spa/ss61`; see item-1 ping)
The parseVariant conformance cases are authored + green (79/79), BUT the dev-agent surfaced **3 impl#1-vs-SPEC divergences** and — correctly per the author-from-impl#1→sanity-check-vs-SPEC→ESCALATE discipline — authored the cases to NOT depend on any of them. These are **compiler/SPEC decisions**, not sPA calls:

## D1 (parseVariant-specific) — null / non-object routing
SPEC §41.13 + the §34 catalog entry for `E-PARSEVARIANT-DISCRIMINATOR-MISSING` both say a `null` / non-object / non-string value → **`MissingDiscriminator`**. impl#1 (`compiler/src/codegen/emit-parse-variant.ts:216-221`) routes null/non-object → **`Malformed`** ("expected object or JSON-encoded object…"), reserving `MissingDiscriminator` for an object that lacks a string `tag`. Locked by `parse-variant-runtime.test.js:296-313` (`fn(null)` → Malformed). → **impl-or-SPEC bug**: either the locked test/impl is wrong, or §41.13/§34 is. The conformance `MissingDiscriminator` case uses an object-without-`tag` (both oracles agree), sidestepping the edge.

## D2 (general `!{}`, surfaced here) — single-field handler payload binding
`emitGuardedArmBinding` (`compiler/src/codegen/emit-logic.ts:588-621`) binds a **single**-field pattern `::UnknownVariant(tag)` to the WHOLE `.data` object (`{tag:"Nope"}`), not the field value; MULTI-field patterns destructure per-field correctly. The §41.13 API example writes `::UnknownVariant(tag) :> "...: " + tag` → under impl#1 yields `"...[object Object]"`. → likely a real single-field-destructure codegen bug (broader than parseVariant). Conformance UnknownVariant case asserts only WHICH variant fired (not the bound value).

## D3 (general §19 `!{}`, tangential) — recovery value not applied on assignment
`@x = failableCall() !{ ::E :> recoveryValue }` leaves the raw `{__scrml_error,…}` object in `@x` on the failure path, NOT `recoveryValue` — confirmed for BOTH parseVariant AND a plain failable fn. Diverges from the SPEC catch-recovery example (`let x = riskyFunction() !{ ::ErrorVariant -> fallbackValue }`). → likely a known/latent §19 limitation; flagging. Conformance failure cases use side-effect routing (each arm sets a cell), so none depend on recovery-into-cell.

**Minor observation (non-blocking):** importing the stdlib `ParseError` enum explicitly triggers a runtime double-declaration (`Cannot declare a lexical variable twice: 'ParseError'`) in the executed bundle; cases import only `parseVariant` and reference variants via bare `::VariantName` (matches the SPEC example).

None block the conformance landing — but D1/D2 look like genuine compiler bugs worth filing, and D3 a §19 gap. All three are yours to triage/rule.
