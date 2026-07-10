# progress — capability-decl-impl-wave-2026-07-10

Status: **COMPLETE.** §23.5 capability-DECLARATION half BUILT (recognize + validate + advisory-lint +
inheritance) + §34 catalog rows + conformance batch (8 cases) + unit test (16 cases). Full gate green.
Enforcement (§23.5.6 manifest/sandbox) stays DEFERRED (not built, per brief).

## Failing baseline reproduced FIRST (the fail-closed-Nominal violation)

`<program capabilities=[network("api.example.com")]><div>hi</div></>` — the SPEC §23.5.2 worked example —
HARD-FAILED:
```
error [E-SCOPE-001]: Undeclared identifier `network` in logic expression.  (fatal)
warning [W-ATTR-001]: Attribute `capabilities=` is not recognized on `<program>`.
FAILED — 1 error, 2 warnings
```
Root cause: `capabilities=` was unregistered (→ W-ATTR-001) and its bracket value was parsed as a general
array-expression, so `network` resolved as an undefined scope ref (→ fatal E-SCOPE-001). A SPEC-valid
advisory declaration must not hard-fail — the invariant this wave restores.

## Build items — fire-sites + changes

| Item | Fire-site | Change |
|---|---|---|
| 1. Register `capabilities=` | `compiler/src/attribute-registry.js` `<program>` `allowedAttrs` (~L162) | Added `["capabilities", attrSpec({ supportsInterpolation:false })]` — suppresses W-ATTR-001. Valid top-level + nested (§4.12.2 row). |
| 2. Special-parse token list | `compiler/src/ast-builder.js` `parseAttributes` (value-kind chain, ~L2684) + new `parseCapabilitiesAttrValue` helper (~L3206) | When `name==="capabilities"` on a `<program>` (tagName threaded from `block.name`), the value routes to `parseCapabilitiesAttrValue` → `{ kind:"capabilities", tokens }` with NO exprNode. TS scope walker never sees the token names → NO E-SCOPE-001. `fs-read`/`fs-write` admitted via `[A-Za-z][A-Za-z0-9-]*` (hyphenated keywords, not JS idents). Args captured verbatim (opaque — §23.5.6 enforcement deferred). |
| 3. Validate closed vocab | same helper | Token NAME checked against `CAPABILITY_VOCAB = {network,fs-read,fs-write,spawn,env,db}`; unknown → `E-FOREIGN-CAPABILITY-UNKNOWN` (TABError, Error). |
| 4. Presence-nudge lint | `compiler/src/type-system.ts` new `checkUndeclaredCapabilities` (~L20471) wired in `processFile` foreign-block block (~L21722); §28 suppression filter in `compiler/src/api.js` (~L1942) | Fires `W-FOREIGN-UNDECLARED-CAPABILITY` (TSError, severity `"info"`) on each foreign construct (`kind:"foreign"` `_{}` / `use-decl` `_foreignSidecarNominal` / WASM extern+sigil via anchored `WASM_EXTERN_DECL_RE`/`WASM_CALL_CHAR_SIGIL_RE` on `init`/`expr`/`raw`) governed by an empty set. Presence-only (opacity bound §23.2.3). Suppressed at api.js when `compilerSettings.lintForeignUndeclaredCapability === "off"`. |
| 5. Inheritance | same `checkUndeclaredCapabilities` walk | Tree walk threads a `governingCount`; a `<program>` with `capabilities=` REPLACES it for its subtree (closest-wins, NO union — mirrors §23.2.1 `lang=`). Empty set if no ancestor declares. |
| 6. §34 catalog rows | `compiler/SPEC.md` §34 master catalog (~L17692) | Added `E-FOREIGN-CAPABILITY-UNKNOWN` (Error) + `W-FOREIGN-UNDECLARED-CAPABILITY` (Info) rows; both cross-ref fire-sites + partition. |

## DoD probe results (all PASS)

- `capabilities=[network("api.example.com")]` → CLEAN (only W-PROGRAM-SPA-INFERRED; NO E-SCOPE-001, NO W-ATTR-001).
- `capabilities=[fs-read("/etc/x"), spawn, db]` + `[]` + all-six + argless-caps → CLEAN.
- `capabilities=[teleport]` → `E-FOREIGN-CAPABILITY-UNKNOWN` (NOT E-SCOPE-001, NOT W-ATTR-001).
- foreign construct under empty set → `W-FOREIGN-UNDECLARED-CAPABILITY` (Info; in result.warnings).
  Suppressed by `{ compilerSettings: { lintForeignUndeclaredCapability: "off" } }` → 0.
  Suppressed by declaring a non-empty `capabilities=` on the enclosing `<program>` → 0.
- Inheritance: outer `network` + inner (no decl) foreign → NO lint (inherit-covers). outer `network` +
  inner `[]` foreign → lint FIRES (closest-wins-no-union proven; a union would have suppressed it).

## Oracle before → after

- `bun conformance/run.ts`: **271/271 → 279/279** (+8 capability cases).
- `bun test compiler/tests/{unit,integration,conformance}`: **19757 pass / 0 fail** post-items-4-6
  (full-gate run before the commit); no new failures. New unit file: 16 pass / 0 fail.

## Conformance case-ids authored (`conformance/cases/capability/`)

1. `capability-valid-clean` — SPEC worked example → clean (regression anchor).
2. `capability-explicit-empty` — `[]` declare-nothing, no foreign → clean.
3. `capability-all-tokens-valid` — all six v1 tokens in one list.
4. `capability-argless-caps-empty-allowlist` — no-parens arg-cap form (§23.5.2 empty allow-list) + db.
5. `capability-unknown-token` — `teleport` → E-FOREIGN-CAPABILITY-UNKNOWN (severity error).
6. `capability-inheritance-closest-wins-no-union` — outer network + inner `[]` foreign → lint fires (sharp no-union proof).
7. `capability-inheritance-inherit-covers` — outer network + inner (no decl) foreign → no lint.
8. `capability-undeclared-with-foreign` — sidecar under empty set → W-FOREIGN-UNDECLARED-CAPABILITY (info) + E-FOREIGN-SIDECAR-NOMINAL (error).

Unit test: `compiler/tests/unit/capability-declaration.test.js` (16 tests — includes the §28 suppression
case, which the conformance harness cannot express: the `compile()` adapter has no per-case
`compilerSettings` channel, so suppression is unit-tested rather than authored as a conformance case).

## Impl-vs-SPEC ambiguities / notes

- **Info lint co-fires with the Nominal fail-closed errors.** A WASM sigil / `use foreign:` sidecar
  ALWAYS fires its §23.3/§23.4 Nominal error (E-WASM-NOMINAL / E-FOREIGN-SIDECAR-NOMINAL). §23.5.5 is
  presence-based ("SHALL emit … when a foreign construct is governed by an empty set") and unconditional
  on other errors, so W-FOREIGN-UNDECLARED-CAPABILITY (Info) co-fires. This is SPEC-honest: the
  declaration HABIT the lint nudges applies regardless of whether the specific foreign RUNTIME is landed
  yet. The clean-compiling `_{}` inline value-returning-in-server-fn form fires the lint alone.
- **Suppression is unit-tested, not a conformance case** — the conformance `compile()` adapter takes no
  compilerSettings. Extending the shared harness was out of scope (blast-radius / parallel-dispatch
  collision risk on a PA-owned harness). Flagged for PA.
- **`db` args not over-validated.** The §23.5.2 EBNF makes `db` presence-only; a hypothetical `db("x")`
  is not the named-error surface (only E-FOREIGN-CAPABILITY-UNKNOWN is specced, for unknown *tokens*). v1
  validates the token NAME against the vocab and captures any args opaquely; enforcement is deferred
  (§23.5.6). Not a divergence — kept minimal per the named-codes-only rule.
- **WASM foreign-construct lint detection is anchored-regex-based** (reusing `WASM_EXTERN_DECL_RE` /
  `WASM_CALL_CHAR_SIGIL_RE` on `init`/`expr`/`raw` node fields). Best-effort presence detection; a missed
  WASM sigil still fails closed with the fatal E-WASM-NOMINAL, so the correctness floor is the Nominal
  error, not the Info lint.
