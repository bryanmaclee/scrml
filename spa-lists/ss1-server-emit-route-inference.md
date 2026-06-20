# sPA ss1 — server-emit-route-inference

**Launch:** `read spa.md ss1` · **Branch:** `spa/ss1` · **Worktree:** `../scrml-spa-ss1`

**Fill:** ~48% · `at-ceiling`

## Shared ingestion
Server emit + route inference + selfhost server-emit triangle: `route-inference.ts` (Step 5b/5d
`__ri_route_` inference), `emit-server.ts`, `codegen/index.ts`, `api.js`, `route-splitter.ts`. The
const-only-module no-server-emit dangling-import bug and the route-001 over-fire are both reachable from
the emit-server/route-inference understanding (same triangle as the RESOLVED `g-route-mis-inference` +
`g-pure-module-server-emit-missing` siblings).

## Core files
`compiler/src/route-inference.ts` · `compiler/src/codegen/emit-server.ts` · `compiler/src/codegen/index.ts` · `compiler/src/api.js`

## Items (least-ingestion-first)
1. **`g-route-001-local-computed-write`** `[status=open]` LOW · tier med — `E-ROUTE-001` over-fires on a pure-fn LOCAL computed-index array write. A pure fn doing `result[idx]=result[idx]+1` on a freshly `slice()`'d LOCAL array emits warning `E-ROUTE-001` (computed member access cannot statically determine property); route inference flags ALL computed member-assigns, not just ones reachable to protected DB/wire fields. Benign (warning only) but erodes diagnostic surface. Flux dog-food S193. route-inference.ts. status=open.
   > **Brief seed:** Scope `E-ROUTE-001` to computed writes whose receiver can reach a protected/route-relevant binding, excluding pure-fn-local arrays (a freshly `slice()`'d local can't reach a protected field). Grep actual fire sites first; R26 the false-positive.
2. **`g-const-only-module-no-server-emit`** `[status=open]` MED · tier med — const-only module (no server content) emits no `.server.js` → server-used const import dangles at runtime. A module whose exports are CONSTANTS/pure-types only emits NO `.server.js`; a server-side consumer still emits `import {CONST} from './mod.server.js'` → file doesn't exist → 'Cannot find module' at runtime. WARNED (`W-SERVER-IMPORT-UNEMITTED` MISSING-FILE branch) not silent. ss1 (795704c1) closed only the MISSING-EXPORT branch. Sibling of the RESOLVED route-mis-inference + pure-module-server-emit gaps (same emit-server/api.js triangle). Option-1 force-emit rejected (link-errors on erased TYPE imports). emit-server.ts + index.ts + route-inference.ts. status=open.
   > **Brief seed:** When a const-only module is server-imported by-name, EITHER emit a minimal value-only `.server.js` (value bindings, NOT erased types) OR tree-shake the consumer's server import to the used value names (drop the line when all dangle). Mirror the sibling RESOLVED pure-module fix; verify the `W-SERVER-IMPORT-UNEMITTED` warning drops to 0.

## Progress
`ss1.progress.md`. Land on `spa/ss1`; ping PA inbox when ready. Do not advance main / do not push.
