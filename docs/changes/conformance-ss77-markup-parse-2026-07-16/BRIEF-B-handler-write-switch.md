# BRIEF B — handler / write-context / switch (§4, §17)

Preamble: `BRIEF-COMMON.md` (read it — setup, method, escalation discipline).
Suggested category dirs: `conformance/cases/markup-handler/` and `conformance/cases/control-flow/`
(the latter already exists — add new case dirs, do NOT modify existing ones).

## Items — one code per item, each a reject-path POS + a clean NEG

### B1. `E-MULTI-STATEMENT-HANDLER` — a multi-statement event-handler attribute
- Fire sites: `compiler/src/ast-builder.js:15906` **and** `compiler/src/symbol-table.ts:7583`
  (**two sites** — the original list named only the ast-builder one). Read both guards; report
  which one your POS actually hits.
- POS: a multi-statement handler, e.g. `on:click="a; b"` → `E-MULTI-STATEMENT-HANDLER`.
- NEG: a single-statement handler → silent.

### B2. `E-WRITE-NOT-IN-LOGIC-CONTEXT` — a bare write outside a logic context
- Fire site: `compiler/src/symbol-table.ts:2532` (`code: "E-WRITE-NOT-IN-LOGIC-CONTEXT"`).
- POS: a bare write outside any logic context.
- NEG: the same write **inside** a logic block (`${ ... }`) → silent.
- **Declaration-form trap (read the preamble note):** V5-strict is `<x>=0` at top level and `@x=0`
  ONLY inside `${...}`. This item is precisely about that boundary — getting the form wrong will
  make your POS and NEG both fail to reproduce. Be deliberate about which form each case uses.

### B3. `E-SWITCH-FORBIDDEN` — `switch` is forbidden in scrml
- Fire sites: `compiler/src/ast-builder.js:2231`, `:8614`, `:12654` (**three sites**; the original
  list named only one, and its line ref is stale). There is also a consumer at `:17696`
  (`if (e && e.code === "E-SWITCH-FORBIDDEN" && e.tabSpan)`) — that is a handler, not a fire site.
- POS: a `switch` block → `E-SWITCH-FORBIDDEN`.
- NEG: the equivalent written with `match` → silent.
- Report which of the three guards your POS hits and what distinguishes the other two.
