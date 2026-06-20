# sPA ss12 — selfhost-mirror-parity

**Launch:** `read spa.md ss12` · **Branch:** `spa/ss12` · **Worktree:** `../scrml-spa-ss12`

**Fill:** ~55% · `healthy` (multiple same-ingestion items; but LOW priority / mostly post-v1.0-deferred)

> **Low priority** — mostly post-v1.0-deferred experiments. The self-host is a from-scratch
> human-authored showcase, NOT a mechanical TS port (memory `self_host_is_from_scratch`). PA sequences
> post-v1.0. NOT sPA-sized as a bulk.

## Shared ingestion
Self-host `.scrml` mirror parity + idiomification: `self-host/ast.scrml`, `bs.scrml`, `ts.scrml`,
`cg.scrml`, `api.js` + the JS originals (`ast-builder.js`, `expression-parser.ts`,
`component-expander.ts`, `meta-eval.ts`) + `type-system.ts` scope walker. Shared understanding = the
from-scratch human-authored self-host showcase (NOT TS parity) + the L2/L3 bootstrap parity. All items
are the same self-host port arc; mostly post-v1.0-deferred, LOW priority. Large lockstep arc —
fatten-eligible because all share the self-host mirror understanding, but PA may prefer to sequence
post-v1.0.

## Core files
`compiler/self-host/ast.scrml` · `compiler/self-host/bs.scrml` · `compiler/self-host/ts.scrml` · `compiler/self-host/api.js` · `compiler/src/ast-builder.js` · `compiler/src/type-system.ts`

## Items (least-ingestion-first)
1. **`selfhost-s29-adjacent-bugs`** `[status=open]` LOW · tier med — 3 S29-surfaced self-host bugs (export class/fn name+scope, const destructure). 3 S29-surfaced self-host bugs (export class/function name+scope, const destructure fragmentation) in ast-builder.js + the TS scope walker. A RELATED S40 scope-walker fix (`64b2e54`, `extractDestructuredNames`) — verify overlap before re-dispatch. ast-builder.js + ast.scrml + type-system.ts. LOW priority. status=open.
   > **Brief seed:** Fix the 3 S29 self-host bugs (export class/fn name+scope, const destructure fragmentation) in ast-builder.js + type-system.ts scope walker. VERIFY the S40 `64b2e54` (`extractDestructuredNames`) overlap FIRST — may already be partly fixed.
2. **`self-host-ast-bs-parity-stale-mirror`** `[status=open]` LOW · tier high — `ast.scrml`/`bs.scrml` stale mirrors (26 parity tests skipped; null-token `E-SYNTAX-042`). `ast.scrml`/`bs.scrml` mirrors structurally stale vs JS originals; 26 parity tests skipped pending v1.0+ re-mirror. `bs.scrml` holds 13 source-position null tokens now `E-SYNTAX-042` (blocked: emit-library doesn't run `rewriteNot`). `ast.test.js:230` + bs.test.js. status=open.
   > **Brief seed:** Re-mirror `ast.scrml`/`bs.scrml` to the JS originals (v1.0+ re-mirror, 26 parity tests). The `rewriteNot` blocker (emit-library doesn't run it → 13 null tokens hit `E-SYNTAX-042`) is a prereq — fix emit-library to run `rewriteNot` or migrate the null tokens. null→not is ABSOLUTE.
3. **`selfhost-idiomification-ts-ast`** `[status=open]` NOMINAL · tier high — Idiomify `ts.scrml` + `ast.scrml` off ~200+ null/!=null patterns (scope w/ ExprNode Phase 5). Idiomify `ts.scrml` + `ast.scrml` (~6109 lines) off ~200+ null/!=null patterns to idiomatic scrml (human-authored SHOWCASE, NOT TS parity — 'scrml does it WAY BETTER'). OVERLAPS the Structured Expression AST Phase 5 self-host parity (port ast.scrml to ExprNode, same file) — scope together. S81 audit per-file null counts. status=open.
   > **Brief seed:** Idiomify `ts.scrml` + `ast.scrml` off ~200+ null/!=null patterns to idiomatic scrml — a from-scratch SHOWCASE rewrite (self-host is human-authored, NOT a mechanical TS port). Scope WITH the ExprNode Phase 5 port (same files). null/undefined→not ABSOLUTE.
4. **`selfhost-ce-me-port`** `[status=open]` NOMINAL · tier high — Port component-expander + meta-eval TS→self-host `.scrml`. Port component-expander + meta-eval from TS to self-host `.scrml` (api.js imports them directly :23/:31). `self-host/api.js` + component-expander.ts + meta-eval.ts. status=open.
   > **Brief seed:** Port component-expander + meta-eval from TS to self-host `.scrml` (api.js :23/:31 currently import the TS directly). From-scratch idiomatic showcase, not a mechanical port.
5. **`self-compilation-l3-parity-gap`** `[status=open]` LOW · tier high — Bootstrap L3 self-compile parity (21 parity assertions fail). Bootstrap L3 self-hosted compiler-compiles-compiler test skipped; strip-bug fixed S80 but L2/L3 parity unmet (21 parity assertions fail). `self-compilation.test.js:549` + self-host/api.js + cg.scrml. NOTE L2/L3 oracle-strategy is itself a Bucket-B debate-fork — this is the build side, gated. status=open.
   > **Brief seed:** Close L2/L3 self-compile parity (21 failing assertions). GATED on the L2/L3 oracle-strategy debate (Bucket B) — sequence after that ruling. self-compilation.test.js:549.

## Progress
`ss12.progress.md`. Land on `spa/ss12`; ping PA inbox when ready. Do not advance main / do not push.
