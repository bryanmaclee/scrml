# BRIEF C — context boundary / style (§4, §4.6)

Preamble: `BRIEF-COMMON.md` (read it — setup, method, escalation discipline).
Suggested category dirs: `conformance/cases/block-grammar/` and `conformance/cases/style/` (both
exist — **add new case dirs; do NOT modify existing ones**).

## Items — one code per item, each a reject-path POS + a clean NEG

### C1. `E-CTX-001` — a context-boundary error
- Fire sites: `compiler/src/block-splitter.js:3099`, `:3286`, `:3297`, `:3683` (**four sites**; the
  original list's `:2989` is **stale**). Site `:3683` is near "Unclosed `<…>` structural element".
  Read the guards and pick the cleanest normative trigger for the POS.
- **This is the PRESENCE case.** `E-CTX-001` appears in the corpus today ONLY as an ABSENCE
  (`notCodes`) assertion, in three cases:
  - `conformance/cases/block-grammar/block-028-leading-equals-text-pos/`
  - `conformance/cases/block-grammar/block-029-leading-equals-quote-prose-pos/`
  - `conformance/cases/style/theme-tokens-recognized/`
  Those three are **regression guards** (issue #28: a `>=` guard used to corrupt the tag stack into
  an E-CTX-001 cascade). **Do not modify them** — read them for context on what E-CTX-001 means,
  then author the positive twin that proves the code fires when it SHOULD.
- POS + NEG. Report which of the four guards you hit.

### C2. `E-STYLE-001` — `<style>` blocks are not supported in scrml
- Fire sites: `compiler/src/block-splitter.js:3480` (**live** — the reachable one) and
  `compiler/native-parser/parse-markup.js:991` (native; see the preamble reachability note).
- POS: a `<style>` block → `E-STYLE-001`.
- NEG: the equivalent expressed as **scrml styling** → silent. Look at the existing
  `conformance/cases/style/` cases (e.g. `clean-single-rule`) for what idiomatic scrml styling
  looks like — the NEG should be genuinely idiomatic, not a contrived empty program. A NEG that
  asserts absence by simply having no styling at all proves nothing.
