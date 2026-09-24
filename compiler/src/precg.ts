/**
 * precg.ts — Stage 3.004 (PRECG): pipeline-agnostic post-AST pre-codegen derivations.
 *
 * This is the body that used to sit inline in `compileScrml`'s PRECG loop (api.js), moved here
 * VERBATIM so the stage has a named entry the stage-substitution seam (pipeline-seam.ts,
 * s430-stage-swap) can swap. Behaviour is unchanged: the same three passes, the same field
 * names, the same order. See api.js "Stage 3.004 (PRECG)" for why these passes live at this seam
 * rather than in TAB.
 *
 * MUTATES `fileAST` in place (the fields every downstream consumer reads):
 *   hasResetExpr / hasEqualityExpr / hasChunkedMarkupTag / hasForStmt  (computePGOFlags)
 *   authConfig / middlewareConfig / mcpConfig                           (computeProgramConfig)
 *   fileShape                                                           (computeFileShape)
 */
import { computePGOFlags, computeFileShape } from "./compute-pgo-flags.ts";
import { computeProgramConfig } from "./compute-program-config.ts";

export function runPRECG(fileAST: any): void {
  const nodes = fileAST.nodes ?? [];
  const pgo = computePGOFlags(nodes);
  fileAST.hasResetExpr = pgo.hasResetExpr;
  fileAST.hasEqualityExpr = pgo.hasEqualityExpr;
  fileAST.hasChunkedMarkupTag = pgo.hasChunkedMarkupTag;
  fileAST.hasForStmt = pgo.hasForStmt;
  const cfg = computeProgramConfig(nodes);
  fileAST.authConfig = cfg.authConfig;
  fileAST.middlewareConfig = cfg.middlewareConfig;
  computeFileShape(fileAST);
  // MCP V0 Sub-unit D — stash <program mcp> opt-in result. Consumed by
  // the auto-activation pass in api.js (which scans every fileAST after the
  // PRECG loop completes) to set emitPerRoute + emit a boot import in
  // the generated _server.js.
  fileAST.mcpConfig = cfg.mcpConfig;
}
