// s430-stage-swap bite fixture — the UNPERTURBED substitute: a straight re-export of the TS TAB
// stage. Swapped in via `--swap TAB=<this file>`, the hybrid must be green on BOTH conformance and
// the differential (N of N identical). If it is not, the harness — not the substitute — is wrong.
export { buildAST } from "../../../../src/ast-builder.js";
