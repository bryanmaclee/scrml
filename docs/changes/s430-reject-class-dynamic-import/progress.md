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
- f428de0d impl + tests + re-pins + allowlist (pre-commit gate PASS: 30,745 pass).
- d1005d43 SPEC §7.2 / NEW §7.2.1 / NEW §21.3.2 / §34 two rows / §34.1 E-STMT-CLASS-* closed; SPEC-INDEX regen; FACTS --write.
- Final `bun run test`: 32,502 pass / 55 fail / 127 skip. All 55 pre-existing or env: browser tier fails identically
  on a base-tree extract (bug60 E-TYPE-031 `email`, transitions, navigate-*, engine-*); dev-command + detector +
  esm tests pass in isolation (full-suite timing). CI-side gates run locally: corpus-compile-floor PASS,
  snippet-gate 110/110, facts PASS, SPEC-INDEX --check PASS, s34 --check-new PASS, delta-lint PASS,
  conflict-marker PASS. types-gate reports 21 NEW TS diagnostics, none in a touched file (pre-existing/env).
- STOPPED before landing per brief: gated tests + the within-node canary consume compiler/self-host and
  stdlib/compiler; PA decides on the allowlist regen + residue re-pins vs sequencing behind import:host.
- PA decision: land TOGETHER with the stdlib/compiler migration. Merged origin/main (#1045 import:host, #1046) at 9f67a65d (FACTS conflict regenerated).
- 32ea0f3e repo-root scrml.toml (host-import = "self-host-only") + 30 stdlib/compiler dynamic-import sites migrated
  (27 -> import:host; meta-checker's non-resolving "./expression-parser.js" -> import:host from compiler/src/expression-parser.ts;
  module-resolver's "path"/"fs" -> static scrml:path / scrml:fs, since import:host rejects builtins). Manifest A/B: only the 15
  import:host files differ, only by losing E-IMPORT-008, 0 artifact diffs. Runtime proof test: compiled umbrella + 13 stages
  re-export the TS compiler's own functions. User `scrml:compiler` import compiles byte-identical to base. Pins dropped.
- 656aecc1 review fixes: default check is now tree-counted + keyword-placed (no prose FPs); native attrs checked; native
  BlockStub body diagnostics forwarded (were dropped); native class-expr parses its body; native ${}/^{} first-line col fix;
  exact-duplicate native diagnostics collapsed. All 41 review probes + 2 new pinned both parsers. Quoted attr = data (PA).
- c5067e21 within-node allowlist tightened by the 899 SPAN-COORD the col fix removed (312 rows, none up).
- 3f3ac6c9 self-host-smoke strips the new static scrml:path/fs imports (surfaced only in the full run).
- Full `bun run test`: 32,664 pass / 56 fail (55 = the same pre-existing browser/dev/detector/esm set; 1 = self-host-smoke, fixed in 3f3ac6c9).
