# progress — s430-reject-class-dynamic-import

- 2026-09-24 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a11f430a99fe27edf, base 585261d9 (includes 3676d2ae)
- Locus check: ast-builder.js E-THROW sites held (:9311 / :13928 region), but the default parser never builds a
  class node (class decl -> bare-expr escape-hatch ClassExpression; `export class` / unannotated `export const`
  keep raw text only). Chosen mechanism: a TOKEN scan at parseLogicBody entry (dedup on code+offset) +
  a raw-text scan at the three attribute-value sites that bypass the logic token stream (E-SWITCH-FORBIDDEN shape).
- Native: parseClassDecl (single site for stmt/export/export default) + parsePostfix arms for class expr and
  `import(`; stmt-head `import(` routed to expression statement. Fixed a pre-existing native bug: keyword-spelled
  destructure key `{ class: c } = o` panic-resynced into parseClassDecl. .scrml mirrors updated.
- Gate impact (the STOP condition): within-node canary (parses compiler/self-host + stdlib/compiler) moved —
  native had been MIS-PARSING every `^{ await import() }` block; allowlist 23 rows regenerated.
  compiler-api §90/§91, self-host-meta-checker, self-host-module-resolver, emit-library §7 compile
  stdlib/compiler/*.scrml -> re-pinned to exact residue (P2 precedent). PA decision flagged.
- COMPILED corpus (2,577 tracked .scrml, default parser, base vs build): 19 newly failing
  (4 compiler/self-host + 15 stdlib/compiler), 7 already-failing gained codes. 16 E-CLASS + 46 E-DYNAMIC-IMPORT hits.
  Zero hits outside compiler/self-host + stdlib/compiler.
