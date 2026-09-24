// s430-stage-swap bite fixture — a DELIBERATELY PERTURBED TAB: the real TS buildAST, then every
// `function-decl` node is removed from every node list (`nodes` / `children` / `body`) in the
// FileAST. The output is still a structurally valid FileAST — it passes the seam's contract
// check — so only the conformance suite and the differential can catch it. They must: swapped in
// via `--swap TAB=<this file>`, conformance must go red and the differential must name the
// divergent artifacts.
import { buildAST as tsBuildAST } from "../../../../src/ast-builder.js";

const DROPPED_KIND = "function-decl";

function dropKind(v, seen) {
  if (!v || typeof v !== "object" || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const x of v) dropKind(x, seen);
    return;
  }
  for (const k of Object.keys(v)) {
    const child = v[k];
    if ((k === "nodes" || k === "children" || k === "body") && Array.isArray(child)) {
      v[k] = child.filter((n) => !(n && typeof n === "object" && n.kind === DROPPED_KIND));
    }
    dropKind(v[k], seen);
  }
}

export function buildAST(bsResult, tokenizerOverride) {
  const result = tsBuildAST(bsResult, tokenizerOverride);
  dropKind(result.ast, new Set());
  return result;
}
