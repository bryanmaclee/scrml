# BRIEF A — markup / tag-close (§10, §10.2)

Preamble: `BRIEF-COMMON.md` (read it — setup, method, escalation discipline).
Suggested category dir: `conformance/cases/markup/` (create it; `run.ts` auto-discovers by
`readdirSync`, there is no manifest to register in).

## Items — one code per item, each a reject-path POS + a clean NEG

### A1. `E-MARKUP-002` — attribute/closer mismatch (§10)
- Live fire site: `compiler/src/type-system.ts:7820` (message begins "Attribute …").
- Also fires in native `compiler/native-parser/tag-frame.js:2335` (that file's comment reads:
  clean close / `E-MARKUP-002` on a mismatch / `E-CTX-003` on a stray) — the **live** site is the
  reachable one; see the preamble's reachability note.
- Grep the exact guard at the live site before authoring. POS + NEG.

### A2. `E-MARKUP-003` — custom-attribute error
- Live fire sites: `compiler/src/type-system.ts:7835` **and** `:7842` — **two distinct guards**
  (message begins "Custom attribute …"). Read BOTH; they likely encode different conditions.
- Author the POS against whichever guard is the cleaner/normative trigger; state in your report
  which guard you hit and what the other one is. POS + NEG.

### A3. `E-MARKUP-VALUE-UNCLOSED` — a markup-as-value expression never closes (§10.2)
- Fire site: `compiler/native-parser/parse-expr.js:2323` (`recordError(ctx, "E-MARKUP-VALUE-UNCLOSED", …)`).
- Trigger: a markup-valued expression with no matching `/>` or `</…>`.
- **This code is DISTINCT from `E-CTX-003` and `E-MARKUP-002` per SPEC §10.2** — read §10.2 and make
  the POS fire `E-MARKUP-VALUE-UNCLOSED` specifically, not a neighbouring context code.
- **REACHABILITY (flag this one):** this is the ONLY fire site and it is in `native-parser/`. The
  conformance adapter drives impl#1 (the TS reference compiler). If the default pipeline never
  reaches `parse-expr.js`, this code is **not fireable through the harness** — in that case do NOT
  fabricate a case; report **ESCALATE / not-fireable** with your evidence (what you tried, what the
  pipeline actually emitted). This is a legitimate and valuable outcome for this item.
- NEG: a properly closed markup value → silent.
