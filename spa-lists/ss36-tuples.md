# ss36 — tuples (anonymous positional product type) — SURVEY-FIRST feature

**Fill-note:** a NEW language feature — **tuples**, RATIFIED by the user S222 ("ok with tuples, I believe I even suggested them WAY back"). Motivated by multi-return ergonomics (the DG-builder slice's `DfsResult` struct-wrapping; pure functions returning `(a, b)` without minting a named struct) and the narrow-Road-B compiler mechanics. **SURVEY-FIRST** — propose the syntax + semantics, build the uncontroversial core, **PARK any genuine syntax/semantics fork for the PA→user** (don't unilaterally ratify the surface).

**Shared ingestion:** the expression parser (tuple literal), the type parser (tuple type), the pattern/destructure path (binding + `match`), the type-system (a positional product type), and codegen (tuple emit + destructure lowering). One feature spanning parser→typer→codegen → **SEQUENTIAL within-list** (the phases couple).

**coreFiles:** `compiler/native-parser/ast-expr.js` + `ast-stmt.js` (literal + type + pattern) · `compiler/src/ast-builder.js` · `compiler/src/type-system.ts` (product type) · `compiler/src/codegen/emit-expr.ts` (emit + destructure). SPEC: a new §-section for tuples (PA ratifies the normative text).

**Brief reminders:** SURVEY-FIRST — Phase 0 proposes the surface (literal `(a, b)`, type `(T, U)`, destructure `<(x, y)> = expr` / multi-return / in `match`) + flags the genuine forks (e.g. 1-tuple disambiguation vs grouping parens; tuple vs named-struct guidance per co-location; trailing-comma; `.0`/`.1` access vs destructure-only). Land the un-controversial core, park forks. R26 + adversarial (S215). Re-baseline within-node parity allowlist in the same landing if fixture ASTs shift; FULL `bun run test` before DONE (S198). New SPEC normative text → PA ratifies (don't author unilaterally).

## Items

1. **tuples — anonymous positional product type** (NEW feature, RATIFIED S222) `[status=open]` **SURVEY-FIRST**
   - Surface to propose (Phase 0): literal `(a, b, c)`; type `(T, U)`; destructuring bind `<(x, y)> = pairFn()`; tuple in `match` arms; multi-return `fn f() -> (int, string)`. Access: destructure-only vs `.0`/`.1` — FLAG as a fork.
   - Semantics: value type (structural `==`, value-acyclic per §59.5 like the rest of scrml's value model); fixed arity; positional.
   - **Why now:** the narrow-Road-B mechanics need clean multi-return (the DG slice's `DfsResult` wrap); serves the whole language regardless. Co-location note to weigh: tuples are anonymous-positional — propose guidance on tuple-vs-named-struct (tuples for ephemeral local multi-return; named structs when the shape is a domain concept).
   - Footprint: parser (literal/type/pattern) → ast-builder → type-system (product type + destructure binding) → codegen (emit + destructure lowering, likely to JS array or object). Park the syntax forks; build the core.
