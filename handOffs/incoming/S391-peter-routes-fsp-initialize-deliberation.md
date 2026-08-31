# Route → bryan: FSP `Initialize` handshake shape — dPA deliberation, ready for your ruling

**From:** S391-peter (dPA-run deliberation) · **Your lane:** you own the §61 typed FSP surface (`<endpoint accepts=FspMethod>`).
**Status:** dPA-produced, **awaiting PA+user ratification** — a recommendation with the empirical fork already resolved, NOT a settled decision.
**Not a scrml-compiler issue** — flogenceP FSP-protocol design.

## The full context (read this)
`flogenceP/docs/debates/fsp-initialize-self-vs-discovery.md` — pushed on flogenceP branch **`dpa/fsp-initialize-deliberation`** (`8427819`). Carries both expert positions, the judge scorecard, the resolved grep, the executable decision tree, exact field shapes, and the (B)-fallback.

## What / why (surfaced by dog-fooding the wire on a db copy)
- `Initialize` → `{protocol:"fsp/2026-06", projects:["flogence"], satellites:[{name:"flogence", state:<live>}]}` — **hardcodes** `["flogence"]` (`fsp-core.scrml:356` `mInitialize`), never queries the projects table.
- `FleetStatus` → real fleet (`projects:2`; flogence + scrml) via `SELECT name, satellite_state FROM projects`.
- Same field name `projects` = "orchestrator-self" in Initialize, "the fleet" in FleetStatus. Pre-existing (the original `scripts/fsp-core.ts:304` hardcodes identically — faithful port, not a scrml regression).

## Deliberation outcome (2 experts + judge; 25.0 vs 24.0 — close)
- **Convergence:** the status-quo shape (plural array hardcoded to a singleton, leaking one live `satellite_state`) is the defect; both experts reject it AND reject "rename but keep the hardcode."
- **Load-bearing fork:** is `Initialize` a discovery method any client reads for membership? **RESOLVED by grep** — the sole runtime reader is `sdk/smoke.ts:13`, which only *logs* `init.projects`; no client indexes `satellites[0]` as self or iterates it as a roster. ⟹ Initialize has never been used for discovery.
- **Recommendation → coherent-(A):** make `Initialize` a clean self-handshake:
  `{ protocol: "fsp/2026-09", self: { name:"flogence", role:"orchestrator", state:<live> } }` — drop the plural `projects` + singleton `satellites`; `FleetStatus` stays the sole roster (matches MCP/LSP/gRPC/JMAP: handshake = identity/capabilities, inventory = a separate list call).
- **Compat (measured):** only `sdk/smoke.ts:13` (a log) + an SDK regen (`InitResult` in `fsp-client.gen.ts` is generated). Bump the protocol string `fsp/2026-06`→`fsp/2026-09`. No dual-emit needed. **Never** ship the intermediate (plural-array-backed-by-hardcoded-singleton).
- **If you disagree on posture** (want Initialize to carry the fleet): (B)-fixed — mirror `mFleetStatus`'s query + add an additive `self:{name,state}` so nothing indexing `satellites[0]` breaks. Spec in the artifact.

## Design-insight candidate (staged, awaiting ratification)
> A handshake's *response shape* is a contract independent of its name/intent — a plural/array field commits the protocol to membership-correctness the moment it exists; the only two non-lying resolutions are collapse-to-singular or enumerate-correctly; a rename alone never closes the gap.

Your ruling: ratify coherent-(A) (then it's a small flogenceP fix + SDK regen — a trivial peter follow-on), choose (B)-fixed, or re-frame.
