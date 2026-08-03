/**
 * CONF-CG-263-TYPEANNOTATED | §7.5 (type grammar) / §14.8 (confidentiality) /
 *                             §21.3 (cross-file imports) / §40 (client emit)
 *
 * g-263-typeannotated-export-const-not-collapsed-client — the type-ANNOTATED
 * residual of GH #263 / #358. A `export const X: T = v` (a VALUE const carrying
 * a `: TYPE` annotation) that another compilation unit imports and reads in its
 * CLIENT code was NOT emitted into the exporting module's `.client.js` nor its
 * `_scrml_modules` footer — so the importer destructured a name the registry
 * never held and read `undefined` at runtime (pre-#358: a ReferenceError). And
 * for an ARROW/UNION annotation (`: () => T` / `: A | B`) the decl did not even
 * COMPILE: the export-decl builder ran the generic `collectExpr()`, which
 * truncates `raw` at the arrow/union glyph INSIDE the annotation, leaving the
 * initializer + annotation-tail dangling as bogus sibling statements
 * (E-STMT-MISSING-SEMICOLON / E-MU-001).
 *
 * ROOT CAUSE. `export const NAME : TYPE = INIT` built its `export-decl` from
 * `collectExpr()` over the whole `const NAME : TYPE = INIT`, and every value
 * consumer (emit-client `stripExportDeclInit`, emit-server's raw regex)
 * re-split the initializer off `raw` with an ANNOTATION-BLIND regex that
 * fail-closes on the leading `:` (or never sees an arrow/union-truncated init).
 * The REGULAR const-decl parser handles all these shapes because it splits the
 * annotation with the bracket-aware `collectTypeAnnotation()` BEFORE collecting
 * the init.
 *
 * FIX. The export-decl builder mirrors the regular const-decl parser for the
 * annotated plain-named form: `collectTypeAnnotation()` splits the `: TYPE`,
 * then the init is collected as its OWN expression and attached to the
 * export-decl as `valueInit` / `valueInitExpr`. emit-client + emit-server prefer
 * the AST field over their raw regex. Server-only initializers (`?{…}` / `_={…}`)
 * are consumed but left without a `valueInit` (leak-safe under-emit). The #263 /
 * #358 reachability gate is UNCHANGED — a server-only annotated const still
 * never crosses to the client.
 *
 * Direction of change: a MISCOMPILE / UNDER-EMIT (and, for arrow/union, a
 * hard-compile-error) fix. NOT a language decision — const/import/export
 * semantics are unchanged; only what reaches each bundle is corrected, in the
 * under-emit direction only (a server-only const never leaks — §14.8).
 *
 * CODES-HALF   — simple `: string`, array `: number[]`, object `: {a:number}`,
 *                union `: A | B`, AND arrow `: () => T` all reach the exporting
 *                module's `.client.js` (declared + registered) and its
 *                `.server.js`; the importer destructures each; the unannotated
 *                sibling stays byte-identical; both bundles parse as CLASSIC
 *                scripts. NEG: an annotated const read ONLY in a `server fn`, and
 *                one with a `_={…}` foreign (server-only) initializer, stay OFF
 *                every `.client.js`.
 * RUNTIME-HALF — evaluates the SHIPPED `models.client.js` in a vm and asserts the
 *                registry carries the CORRECT runtime value for each annotated
 *                const (the arrow const resolves to a callable returning 42).
 *
 * Firing sites: ast-builder.js (export-decl annotated-value interception) ·
 * codegen/emit-client.ts (valueInit preference) · codegen/emit-server.ts
 * (valueInit preference).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";
import { compileScrml } from "../../src/api.js";

const TMP_ROOT = join(tmpdir(), "scrml-263-typeannotated-const");
const OPEN = "${";
const CLOSE = "}";

function setupDir(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
function teardownDir(name) {
  rmSync(join(TMP_ROOT, name), { recursive: true, force: true });
}

/** Compile a temp entry (no disk writes); return { errors, out(rel) }. */
function compileEntry(entry) {
  const result = compileScrml({ inputFiles: [entry], write: false, log: () => {} });
  const out = (rel) => {
    for (const [fp, o] of result.outputs ?? new Map()) {
      if (fp.endsWith(`/${rel}`) || fp.endsWith(`\\${rel}`) || fp.endsWith(rel)) return o;
    }
    return null;
  };
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    out,
  };
}

/** Eval a `models.client.js` bundle in isolation; return its `_scrml_modules`
 *  registry entry (the object the importer destructures). `document` is left
 *  undefined so any boot early-returns; only the top-level footer runs. */
function evalModelsRegistry(modelsJs) {
  const ctx = vm.createContext({
    _scrml_modules: {},
    _scrml_reactive_set: () => {}, _scrml_reactive_get: () => undefined, _scrml_init_set: () => {},
    _scrml_effect: () => ({}), _scrml_render_value: () => {}, _scrml_region_track: () => {},
    _scrml_register_rehydrator: () => {},
  });
  vm.runInContext(modelsJs, ctx, { filename: "models.client.js" });
  return ctx._scrml_modules["models.client.js"];
}

// A module of type-ANNOTATED value consts (simple / array / object / union /
// arrow-fn) + an unannotated PLAIN sibling (byte-identity guard) + two
// server-only canaries: SECRET_SERVER_READ (read only in a `server fn`) and
// SECRET_FOREIGN (a `_={…}` foreign, server-only initializer). The canary
// substrings must never appear in any `.client.js`.
const MODULE = `export const S_ANN: string = "s-value"
export const ARR_ANN: number[] = [10, 20, 30]
export const OBJ_ANN: {a: number} = {a: 7}
export const UNION_ANN: string | number = "u-value"
export const FN_ANN: () => number = () => 42
export const PLAIN = "plain-value"
export const SECRET_SERVER_READ: string = "LEAK-CANARY-263-serverread"
export const SECRET_FOREIGN: string = _={ return "LEAK-CANARY-263-foreign" }=
`;

// The entry reads every VALUE const in MARKUP interpolation (robust client
// reachability — real IdentExpr nodes) and pins SECRET_SERVER_READ behind a
// `server fn` (client-pruned) while still IMPORTING it. SECRET_FOREIGN is even
// imported AND read in client markup — its VALUE must still never ship (its
// server-only init leaves no `valueInit`, so it fails closed).
const ENTRY = `<program>
import { S_ANN, ARR_ANN, OBJ_ANN, UNION_ANN, FN_ANN, PLAIN, SECRET_SERVER_READ, SECRET_FOREIGN } from './models.scrml'
server fn leakGuard(): string { return SECRET_SERVER_READ }
<div class="col"><p>${OPEN}S_ANN${CLOSE} ${OPEN}ARR_ANN[0]${CLOSE} ${OPEN}OBJ_ANN.a${CLOSE} ${OPEN}UNION_ANN${CLOSE} ${OPEN}FN_ANN()${CLOSE} ${OPEN}PLAIN${CLOSE} ${OPEN}SECRET_FOREIGN${CLOSE}</p></div>
</program>
`;

const VALUE_CONSTS = [
  { name: "S_ANN", decl: /^\s*const S_ANN = "s-value";/m, value: "s-value" },
  { name: "ARR_ANN", decl: /^\s*const ARR_ANN = \[10, 20, 30\];/m, value: [10, 20, 30] },
  { name: "OBJ_ANN", decl: /^\s*const OBJ_ANN = \{a: 7\};/m, value: { a: 7 } },
  { name: "UNION_ANN", decl: /^\s*const UNION_ANN = "u-value";/m, value: "u-value" },
  { name: "FN_ANN", decl: /^\s*const FN_ANN = \(\) => 42;/m, value: 42 /* callable */ },
  { name: "PLAIN", decl: /^\s*const PLAIN = "plain-value";/m, value: "plain-value" },
];

describe("CONF-CG-263-typeannotated — codes-half: every annotated value const reaches the client (declared + registered)", () => {
  const NAME = "cg263-ann-codes";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), MODULE);
    writeFileSync(join(dir, "index.scrml"), ENTRY);
  });
  afterEach(() => teardownDir(NAME));

  test("compiles clean — no dangling-statement / unused errors (arrow & union annotations no longer break the parse)", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
  });

  test("models.client.js DECLARES each annotated value const with its correct init and REGISTERS it", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    expect(m).not.toBeNull();
    for (const { name, decl } of VALUE_CONSTS) {
      expect(m.clientJs).toMatch(decl);
      expect(m.clientJs).toMatch(
        new RegExp(`_scrml_modules\\["models\\.client\\.js"\\] = \\{[^}]*\\b${name}: ${name}\\b[^}]*\\}`),
      );
    }
    // Classic-script parse guard (a truncated arrow/union init would throw here).
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });

  test("index.client.js DESTRUCTURES every annotated value const from the registry", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const idx = c.out("index.scrml");
    expect(idx).not.toBeNull();
    for (const { name } of VALUE_CONSTS) {
      expect(idx.clientJs).toMatch(
        new RegExp(`const \\{[^}]*\\b${name}\\b[^}]*\\} = _scrml_modules\\["models\\.client\\.js"\\]`),
      );
    }
    expect(() => new vm.Script(idx.clientJs)).not.toThrow();
  });
});

describe("CONF-CG-263-typeannotated — runtime-half: the shipped registry carries the CORRECT runtime value for each annotated const", () => {
  const NAME = "cg263-ann-runtime";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), MODULE);
    writeFileSync(join(dir, "index.scrml"), ENTRY);
  });
  afterEach(() => teardownDir(NAME));

  test("simple / array / object / union / arrow / plain all resolve to their declared values", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
    expect(reg).toBeDefined();
    expect(reg.S_ANN).toBe("s-value");
    expect(reg.ARR_ANN).toEqual([10, 20, 30]);
    expect(reg.OBJ_ANN).toEqual({ a: 7 });
    expect(reg.UNION_ANN).toBe("u-value");
    // The HARD case: an arrow/fn-type annotation — the const must be a callable.
    expect(typeof reg.FN_ANN).toBe("function");
    expect(reg.FN_ANN()).toBe(42);
    expect(reg.PLAIN).toBe("plain-value");
  });
});

describe("CONF-CG-263-typeannotated — NO-LEAK: annotated server-only consts stay OFF every .client.js (§14.8)", () => {
  const NAME = "cg263-ann-noleak";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), MODULE);
    writeFileSync(join(dir, "index.scrml"), ENTRY);
  });
  afterEach(() => teardownDir(NAME));

  test("a server-fn-read annotated const AND a foreign-init annotated const are absent from client bundles (present server-side)", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();

    // (1) SECRET_SERVER_READ — read only inside `server fn leakGuard` → pruned.
    const canaryRead = /LEAK-CANARY-263-serverread/;
    expect(m.clientJs).not.toMatch(canaryRead);
    expect(idx.clientJs).not.toMatch(canaryRead);
    expect(m.clientJs).not.toMatch(/\bconst SECRET_SERVER_READ\b/);
    expect(m.clientJs).not.toMatch(/SECRET_SERVER_READ:/);
    // Legitimately present server-side (imported + used by the server fn).
    expect(m.serverJs ?? "").toMatch(canaryRead);

    // (2) SECRET_FOREIGN — its `_={…}` foreign init is server-only; even though it
    // is imported AND read in client markup, its VALUE never ships (no valueInit →
    // fail-closed skip). Under-emit is the safe direction; a leak never is.
    const canaryForeign = /LEAK-CANARY-263-foreign/;
    expect(m.clientJs).not.toMatch(canaryForeign);
    expect(idx.clientJs).not.toMatch(canaryForeign);

    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });
});
