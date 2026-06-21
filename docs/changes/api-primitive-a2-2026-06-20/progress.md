# A2 W3 — `<api>` TYPER wave — progress

change-id: api-primitive-a2-2026-06-20 · wave W3 (type-system; resolve + CHECK, NO codegen)

## 2026-06-20 — startup
- Worktree verified at .claude/worktrees/agent-a80f17c2cb0c3c4bc; git clean; merge main already up to date.
- W2 api-decl node present (ast-builder.js, 3 hits); SPEC §60 present (line 32909).
- bun install + bun run pretest green.
- SPEC §60 read in full. SCOPE doc read (W3 is the type-system wave).
- W2 node shape confirmed via probe: ast.nodes carries `{kind:"api-decl", base, src, endpoints:[{name,reqShape?,method,path,responseType,span}]}`.
  reqShape/responseType are RAW type-ref text (null when absent).
- `<request api=X args=...>` ALREADY captures api=/args= in the generic markup `attrs` array
  (api= → string-literal value; args= → variable-ref w/ exprNode). No new PARSE code needed — typer reads existing attrs.
- api-decl survives CE into the typer (post-CE top kinds include "api-decl").
- §60.6 client-only ALREADY satisfied: a valid <api>+<request api=> app compiles exit-0 with NO serverJs
  (probe confirmed serverJs absent). <api> is not a §12.2 escalation trigger.

## Plan (TS-API pass in processFile, after TS-J)
1. Resolve endpoint reqShape/responseType via resolveTypeExpr; fire E-TYPE-UNKNOWN-NAME on undeclared type-refs
   (reuse forEachTypeNameLeaf + isUnrecognizedTypeNameAtom).
2. E-API-PATH-PARAM-UNBOUND — each `${param}` in path must be a field of the resolved reqShape struct.
3. <request api=X args=...>: E-API-ENDPOINT-UNKNOWN (X not declared); E-API-REQ-SHAPE-MISMATCH (args type vs reqShape).
4. §12.2 client-only confirming test.
5. §34 rows for the 3 new codes; §60.9 mark wired.

## 2026-06-20 — implementation DONE
- c89925a5 — checkApiDeclarations TS-API pass in type-system.ts (after TS-J in processFile):
  - Pass 1: collect api-decl nodes → per-file endpoint registry (first-name-wins).
  - Pass 2: resolve reqShape/responseType via resolveTypeExpr; undeclared → E-TYPE-UNKNOWN-NAME
    (reuse forEachTypeNameLeaf + isUnrecognizedTypeNameAtom, exempt = imported + machine names).
    E-API-PATH-PARAM-UNBOUND: each ${param} must be a field of the resolved reqShape struct
    (no-reqShape / non-struct reqShape → every param unbound).
  - Pass 3: deep-walk <request> markup; read EXISTING api=/args= attrs.
    E-API-ENDPOINT-UNKNOWN (api=X not in registry); E-API-REQ-SHAPE-MISMATCH (args=@cell struct
    missing a reqShape field; superset tolerated; unresolvable args → conservative skip).
  - Cell-type map deep-walks logic.body (state-decls live inside top-level logic, not file-top).
  - W2 test fixture updated (valid <api> now declares its types — W3 resolves them).
- 7976e61c — api-decl-typer.test.js (16 tests): one per code + valid-clean + §60.6 client-only.
- 56d01723 — §34 rows (3 W3 codes) + §60.9 wired + SPEC-INDEX line-range regen. §60 Nominal banner KEPT.

## Compile-verify (CLI)
- VALID  (/tmp/api-cv/valid.scrml):   `bun run compiler/src/cli.js compile valid.scrml -o out`   → exit 0;
  emits valid.client.js + valid.html + runtime; NO .server.js (pure client §60.6); NO base-URL leak.
- INVALID (/tmp/api-cv/invalid.scrml): same cmd → exit 1; fires E-API-PATH-PARAM-UNBOUND + E-API-ENDPOINT-UNKNOWN.

## DEFERRED to W4 (NOT in W3)
- The thin typed fetch callable codegen; automatic parseVariant(response, ResponseT) decode wiring;
  the actual <request> runtime integration (loading/data/error/stale + .data:ResponseT). A typed-and-
  checked <api> + <request api=> STILL emits nothing runtime at W3 (confirmed by compile-verify).
