# non-compliance.report.md
# project: scrml
# updated: 2026-07-21T14:05:00Z  commit: 9481bc69

Docs/maps that do NOT match current spec or code. Findings are written here rather than returned
inline — the S276 pass returned them inline and they went stale unread, which is the failure this
file exists to prevent.

## OWED — carried, still open

### 1. `compiler/native-parser/` parity is UNCONFIRMED (not confirmed-drifted)
**Re-verified directly this pass:** `git diff --name-only df2ac831..HEAD -- compiler/native-parser/`
returns **0 files**. The native parser (impl#2 mirror, 79 files) has had ZERO diff across the entire
`df2ac831` → `9481bc69` window, while impl#1 gained `E-SCRIPT-001`, a relocated
`E-CELL-RENDER-SPEC-NOT-BINDABLE` fire site, the outlet/landmark surface and a new shared predicate
module. Whether the mirror is BEHIND or simply out of scope for these surfaces is **not established
either way** — that is the finding. Do not upgrade this to "drifted" without executing the native
path; do not downgrade it to "fine" on the grounds that nothing changed. Carried from S276.
Related standing memory: `.scrml` mirrors have shipped malformed predicates before.

### 2. `error.map.md` catalog-count methodology unresolved
The carried row count and a raw §34 extraction differ by ~1. The raw grep over-matches sibling
tables inside §34, so **neither number is authoritative** and the map says so rather than asserting
one. A proper count audit — a parser that respects the §34 table boundaries — is owed at the next
cold start. Carried from S276.

### 3. §34 `E-STYLE-001` row describes a different trigger than the code fires
The catalog row reads *"CSS: syntax error in `#{}` style block"*. The code at
`block-splitter.js` fires *"`<style>` blocks are not supported in scrml"* — an ELEMENT rejection,
not a `#{}` syntax error. Either the row is stale or the code is double-duty with one trigger dead;
it needs a ruling, not a mechanical edit. **Newly conspicuous** as of S277: it now sits directly
beside an accurate `E-SCRIPT-001` row describing the symmetric twin correctly. Filed S277.

## RESOLVED this pass

- **SPEC §4.17's `<script>` claim was FALSE and is now corrected** (S277 #127). It stated `<script>`
  was "a Ghost-Pattern lint surface (W-LINT-018 family)"; `W-LINT-018` is "Pattern 19: Svelte store
  API calls" and no ghost-pattern rule targeted `<script>` at all. In practice a `<script>` element
  compiled clean and its body reached the emitted document verbatim. The clause now carries an
  explicit S277 correction note rather than a silent rewrite.
- **The S276 map-report items 1-3 are no longer returned inline** — they are the OWED section above.

## Map currency at this stamp

| map | stamp | status |
|---|---|---|
| primary · domain · error · structure | `9481bc69` | current (HEAD) |
| dependencies | `c48e59a2` | one window stale — S277 added one module (`landmark-tag.ts`) with two importers; refresh next pass |
| auth · schema · test | `df2ac831` | deliberately older — S277 touched no auth, schema, or test-infrastructure surface |
| build · config · infra | `99ae45ca` / `f079d0a9` | deliberately older — S277 added no CLI flag, env var, or CI change |

An honest older stamp beats a false "verified at HEAD". Every row above is a decision, not an
oversight.

## Process friction — the mapper stalls near the end of a full pass

**Third consecutive occurrence.** S274 stalled before `domain.map.md`; S276 ran partial; S277 stalled
after three maps, before `primary.map.md` and this file. Consistent shape: one agent walking ~11 maps
in a single pass runs out of runway near the end, and the INDEX map — the one every consumer reads
first — is last in line and therefore the most likely to be left stale while the content maps are
current. Recorded rather than normalised. Candidate fixes for a future pass: split the refresh into
two dispatches (content maps, then index+report), or stamp the index FIRST from the planned delta.
