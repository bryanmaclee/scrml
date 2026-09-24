// s430-stage-swap bite fixture — a CONTRACT-VIOLATING TAB: the real TS buildAST, then the `span`
// of one nested node is deleted (PIPELINE.md "Span loss"). The seam must refuse it at the TAB
// boundary with StageSeamError naming the stage and the path, before any downstream stage sees
// the malformed AST.
import { buildAST as tsBuildAST } from "../../../../src/ast-builder.js";

export function buildAST(bsResult, tokenizerOverride) {
  const result = tsBuildAST(bsResult, tokenizerOverride);
  const nodes = result.ast?.nodes ?? [];
  const parent = nodes.find((n) => Array.isArray(n?.children) && n.children.length > 0);
  const victim = parent ? parent.children[0] : nodes[0];
  if (victim) delete victim.span;
  return result;
}
