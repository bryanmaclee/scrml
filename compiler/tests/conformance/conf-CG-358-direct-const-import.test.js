/**
 * CONF-CG-358 | §14.8 (confidentiality) / §21.3 (cross-file imports) / §40 (client emit)
 *
 * Issue #358 — the RESIDUAL of GH #263. `d139d775` fixed the
 * closed-over-by-a-crossing-fn half; this pins the DIRECT-IMPORT half:
 *
 *   An exported `const` imported DIRECTLY by another compilation unit and read in
 *   THAT unit's CLIENT code was NOT emitted to the exporting module's `.client.js`
 *   nor added to its `_scrml_modules` export table — so the importer destructured
 *   without it and read a free variable → `ReferenceError` at runtime. A const
 *   CLOSED OVER by a crossing `fn` WAS emitted. The per-file reachability gate
 *   keyed on "referenced by a client node in THIS module" instead of "read by ANY
 *   client compilation unit."
 *
 * FIX. `runCG` precomputes a compile-unit-wide `crossFileClientReads` map (each
 * module → the export names some OTHER file READS in its CLIENT code, via the
 * SAME confidentiality-safe prune the #263 gate uses). The exporter unions it into
 * the reachability seed (so a directly-imported+client-read const is emitted +
 * registered); the importer uses it as ground truth to keep such a const in its
 * `_scrml_modules` destructure even when NR mis-tags an all-caps value const as a
 * `user-component`.
 *
 * Direction of change: a MISCOMPILE / UNDER-EMIT fix (the program already validly
 * references DIRECT). NOT a language decision — `import`/`export`/const semantics
 * are unchanged; only what reaches the client bundle is corrected, in the
 * under-emit direction only (a server-only const still never leaks — §14.8).
 *
 * CODES-HALF   — the discriminator: DIRECT (direct-import) + CLOSED_OVER
 *                (crossing-fn) BOTH reach `models.client.js` (declared + in the
 *                `_scrml_modules` footer); the importer destructures DIRECT; both
 *                bundles parse as CLASSIC scripts. NEG: a server-only exported
 *                const imported directly but read ONLY server-side stays OFF every
 *                `.client.js` (present server-side).
 * RUNTIME-HALF — DETERMINISTIC, executes the SHIPPED `models.client.js` +
 *                `index.client.js` in one shared vm scope (no HTTP, no DOM: with
 *                `document` undefined the boot early-returns, so only the top-level
 *                reactive wiring runs). Proves the on-mount reactive state: `@a`
 *                receives the DIRECT value and `@b` the crossing-fn value — no
 *                ReferenceError (the pre-fix symptom).
 *
 * Firing sites: codegen/index.ts (crossFileClientReads precompute) ·
 * codegen/emit-client.ts (emitReferencedModuleExportConstLines seed +
 * `_scrml_modules` importer destructure).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";
import { compileScrml } from "../../src/api.js";

const TMP_ROOT = join(tmpdir(), "scrml-358-direct-const-import");
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

// A server-only exported const (NON-foldable initializer, so a leaked client decl
// would be verbatim + greppable) + a legitimately client-read sibling. The canary
// substring `LEAK-CANARY-358` must never appear in any `.client.js`.
const SHADOW_MODULE = `export const SECRET = ["LEAK", "CANARY", "358"].join("-")
export const SHOWN = "shown-client-value"
`;
// Two scope-shadow entries: SECRET/loc is read ONLY server-side (a `server fn`
// stub), while an UNRELATED client \`<each ... as SECRET/loc>\` reuses the same
// name as its loop var. A scope-blind cross-file seed would mis-read the loop-var
// read as an import read and LEAK the server-only value. `${OPEN}rows${CLOSE}` etc.
const shadowEntryEach = `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = ""
   @rows = ["x", "y"] ${CLOSE}
server fn stash() -> string {
    return SECRET
}
on mount {
    @a = SHOWN
}
<ul><each in=@rows as SECRET><li>${OPEN}SECRET${CLOSE}</li></each></ul>
<div><p>${OPEN}@a${CLOSE}</p></div>
</program>
`;
const shadowEntryAlias = `<program>
import { SECRET as loc, SHOWN } from './models.scrml'
${OPEN} @a = ""
   @rows = ["x", "y"] ${CLOSE}
server fn stash() -> string {
    return loc
}
on mount {
    @a = SHOWN
}
<ul><each in=@rows as loc><li>${OPEN}loc${CLOSE}</li></each></ul>
<div><p>${OPEN}@a${CLOSE}</p></div>
</program>
`;

// The discriminator module: DIRECT (only ever DIRECTLY imported) + CLOSED_OVER
// (only reached via the crossing fn `reader`). Both are all-caps value consts.
const DISCRIMINATOR_MODULE = `export const DIRECT = "direct-import-only"
export const CLOSED_OVER = "closed-over-by-a-crossing-fn"

export fn reader() { return CLOSED_OVER }
`;
// The entry: a <program> importing DIRECT (directly) + reader, reading both in a
// multi-statement `on mount` (the faithful #358 repro shape).
const DISCRIMINATOR_ENTRY = `<program>
import { DIRECT, reader } from './models.scrml'
${OPEN} @a = ""
   @b = "" ${CLOSE}
on mount {
    @a = DIRECT
    @b = reader()
}
<div class="col"><p>${OPEN}@a${CLOSE} ${OPEN}@b${CLOSE}</p></div>
</program>
`;

describe("CONF-CG-358 — codes-half: DIRECT (direct-import) + CLOSED_OVER (crossing-fn) both reach the client", () => {
  const NAME = "cg358-discriminator";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), DISCRIMINATOR_MODULE);
    writeFileSync(join(dir, "index.scrml"), DISCRIMINATOR_ENTRY);
  });
  afterEach(() => teardownDir(NAME));

  test("models.client.js DECLARES both consts and registers BOTH in the _scrml_modules footer", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    expect(m).not.toBeNull();
    // The crossing-fn half (already working) is unchanged...
    expect(m.clientJs).toMatch(/return CLOSED_OVER;/);
    expect(m.clientJs).toMatch(/^\s*const CLOSED_OVER = "closed-over-by-a-crossing-fn";/m);
    // ...and the direct-import half is now ALSO declared (the #358 bug: it was not).
    expect(m.clientJs).toMatch(/^\s*const DIRECT = "direct-import-only";/m);
    // Both register in the export table (directly-importable client bindings).
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*DIRECT: DIRECT[^}]*\}/);
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*CLOSED_OVER: CLOSED_OVER[^}]*\}/);
    // Classic-script parse guard (a raw import/export would throw here).
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });

  test("index.client.js DESTRUCTURES DIRECT from the registry (was dropped by the component mis-tag)", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const idx = c.out("index.scrml");
    expect(idx).not.toBeNull();
    // DIRECT survives the `_scrml_modules` destructure filter now.
    expect(idx.clientJs).toMatch(/const \{[^}]*\bDIRECT\b[^}]*\} = _scrml_modules\["models\.client\.js"\]/);
    // And it is read (the site that ReferenceError'd pre-fix).
    expect(idx.clientJs).toMatch(/\bDIRECT\b/);
    expect(() => new vm.Script(idx.clientJs)).not.toThrow();
  });
});

describe("CONF-CG-358 — codes-half NEG: a server-only export const imported directly stays OFF the client (§14.8)", () => {
  // A directly-imported const read ONLY inside a `server fn` (the client lowers
  // that to a fetch STUB that never names it) must NOT be pulled to the client by
  // the new cross-file seed — the server-fn body is pruned before the seed sees it.
  const NAME = "cg358-noleak";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), `export const SECRET = "LEAK-CANARY-358-secret"
export const SHOWN = "shown-client-value"
`);
    writeFileSync(join(dir, "index.scrml"), `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string {
    return SECRET
}
on mount {
    @a = SHOWN
}
<div class="col"><p>${OPEN}@a${CLOSE}</p></div>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("SECRET (server-only) is absent from EVERY .client.js; SHOWN (client-read) reaches the client", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    const canary = /LEAK-CANARY-358-secret/;
    // The security-critical invariant: the value must NEVER reach any client bundle.
    expect(m.clientJs).not.toMatch(canary);
    expect(idx.clientJs).not.toMatch(canary);
    // The value is legitimately present server-side.
    expect(m.serverJs ?? "").toMatch(canary);
    // The client-read sibling DOES reach the client (no over-prune) + registers.
    expect(m.clientJs).toMatch(/^\s*const SHOWN = "shown-client-value";/m);
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*SHOWN: SHOWN[^}]*\}/);
    // SECRET is NOT registered (no client binding).
    expect(m.clientJs).not.toMatch(/SECRET:/);
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });
});

describe("CONF-CG-358 — runtime-half: the shipped bundles resolve DIRECT + CLOSED_OVER at runtime (no ReferenceError)", () => {
  const NAME = "cg358-runtime";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), DISCRIMINATOR_MODULE);
    writeFileSync(join(dir, "index.scrml"), DISCRIMINATOR_ENTRY);
  });
  afterEach(() => teardownDir(NAME));

  test("evaluating models.client.js then index.client.js sets @a = DIRECT value and @b = crossing-fn value", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const modelsJs = c.out("models.scrml").clientJs;
    const indexJs = c.out("index.scrml").clientJs;

    // Faithful classic-script model: deps-first, ONE shared global scope holding
    // the `_scrml_modules` registry. Runtime accessors are stubbed to CAPTURE the
    // reactive writes; `document` is left undefined so the boot IIFE early-returns
    // (only the top-level reactive wiring — the on-mount writes — executes).
    const sets = [];
    const ctx = vm.createContext({
      _scrml_modules: {},
      _scrml_reactive_set: (k, v) => sets.push([String(k), v]),
      _scrml_reactive_get: (k) => {
        for (let i = sets.length - 1; i >= 0; i--) if (sets[i][0] === String(k)) return sets[i][1];
        return undefined;
      },
      _scrml_init_set: () => {},
      _scrml_effect: () => ({}),
      _scrml_render_value: () => {},
      _scrml_region_track: () => {},
      _scrml_register_rehydrator: () => {},
    });

    let threw = null;
    try {
      vm.runInContext(modelsJs, ctx, { filename: "models.client.js" });
      vm.runInContext(indexJs, ctx, { filename: "index.client.js" });
    } catch (e) {
      threw = e;
    }
    // Pre-fix: `_scrml_reactive_set("…$a", DIRECT)` reads the undeclared free
    // variable DIRECT → ReferenceError → threw !== null.
    expect(threw).toBeNull();

    // The registry footer registered BOTH value consts as real client bindings.
    const reg = ctx._scrml_modules["models.client.js"];
    expect(reg).toBeDefined();
    expect(reg.DIRECT).toBe("direct-import-only");
    expect(reg.CLOSED_OVER).toBe("closed-over-by-a-crossing-fn");
    expect(typeof reg.reader).toBe("function");

    // Reactive state after the top-level on-mount writes (chunk-namespaced keys
    // end with `$a` / `$b`): @a received the DIRECT value; @b the crossing-fn value.
    const lastFor = (suffix) => {
      for (let i = sets.length - 1; i >= 0; i--) {
        const key = sets[i][0];
        if (key.split("$").pop() === suffix) return sets[i][1];
      }
      return undefined;
    };
    expect(lastFor("a")).toBe("direct-import-only");
    expect(lastFor("b")).toBe("closed-over-by-a-crossing-fn");
  });
});

// ---------------------------------------------------------------------------
// SCOPE-SHADOW no-leak regression pins (both halves) — the leak an S239 pass
// found in the first cut: `crossFileClientReads` was scope-BLIND, so a
// server-only export whose NAME collided with a client `<each ... as X>` loop
// var / alias local was mis-marked client-reachable and its value SHIPPED. The
// fix requires the import read to be UNSHADOWED by any client-side binding.
// ---------------------------------------------------------------------------
const SHADOW_VECTORS = [
  { label: "each-var shadow (import name reused as a client loop var)", entry: shadowEntryEach },
  { label: "alias shadow (import { SECRET as loc } + client `<each as loc>`)", entry: shadowEntryAlias },
];
for (const { label, entry } of SHADOW_VECTORS) {
  describe(`CONF-CG-358 — NO-LEAK on scope shadow: ${label}`, () => {
    const NAME = "cg358-shadow-" + label.replace(/\W+/g, "_").slice(0, 20);
    let dir;
    beforeEach(() => {
      dir = setupDir(NAME);
      writeFileSync(join(dir, "models.scrml"), SHADOW_MODULE);
      writeFileSync(join(dir, "index.scrml"), entry);
    });
    afterEach(() => teardownDir(NAME));

    test("codes-half: the server-only value + its export-table entry are ABSENT from every .client.js", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const m = c.out("models.scrml");
      const idx = c.out("index.scrml");
      expect(m).not.toBeNull();
      const canary = /LEAK-CANARY-358|\["LEAK"/;
      // The value must NEVER reach any client bundle (the leak this pins).
      expect(m.clientJs).not.toMatch(canary);
      expect(idx.clientJs).not.toMatch(canary);
      // No `const SECRET = …` decl and no `SECRET:` export-table entry.
      expect(m.clientJs).not.toMatch(/\bconst SECRET\b/);
      expect(m.clientJs).not.toMatch(/\bSECRET:/);
      // The export table matches the pre-fix shape for a server-only const: ONLY
      // the legitimately client-read sibling is registered.
      expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{ SHOWN: SHOWN \};/);
      // The value IS present server-side (it is legitimately a server value).
      expect(m.serverJs ?? "").toMatch(/LEAK-CANARY-358|\["LEAK"/);
      expect(() => new vm.Script(m.clientJs)).not.toThrow();
    });

    test("runtime-half: the shipped models.client.js registry exposes SHOWN but NOT SECRET", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
      expect(reg).toBeDefined();
      // The client-read sibling resolves to its value...
      expect(reg.SHOWN).toBe("shown-client-value");
      // ...and the server-only secret is NOT a client binding at all.
      expect("SECRET" in reg).toBe(false);
      expect(reg.SECRET).toBeUndefined();
    });
  });
}

// ---------------------------------------------------------------------------
// ATTRIBUTE-VALUE DIMENSION (S332-peter) — the residual filed as
// g-263-direct-cross-file-const-import-not-emitted-client. The tests above pin a
// const read in an `on mount` body; this pins a const read ONLY inside a markup
// ATTRIBUTE. A markup attribute's ExprNode(s) live UNDER `attr.value` (a tagged
// `{kind,…}` object) — an `onclick={…}`/`if=` is `{value:{kind:"expr",exprNode}}`,
// a call-ref `onclick=fn(CONST)` is `{value:{kind:"call-ref",argExprNodes}}`, and a
// template attribute `title="…${CONST}…"` is `{value:{kind:"string-literal",value}}`
// whose `${}` interiors are raw source wired into a client `setAttribute` effect.
// The crossFileClientReads seed walked `attr[f]` (always absent at that level), so a
// directly-imported const read ONLY in one of those attribute contexts was invisible
// to the seed → absent from the dep's `.client.js` + `_scrml_modules` footer → the
// emitted client handler referenced a FREE variable → ReferenceError when the event
// fired. Fix: emit-client.ts collectClientReferencedIdentsForAST walks the
// ExprNode-bearing fields of `attr.value` (+ parses template `${}` interiors) through
// the SAME deep collector, so the scope-blindness/leak guard is preserved.
// ---------------------------------------------------------------------------
const ATTR_MODULE = `export const H_DIRECT = "handler-direct"
export const C_ARG = "callref-arg"
export const T_TPL = "template-tpl"
`;
// H_DIRECT read ONLY in an event-handler expr; C_ARG ONLY as a call-ref arg; T_TPL
// ONLY inside a template-attribute `${}` — none via a mount body / cell init (those
// paths already worked). The reactive `@n` button keeps the subtree hydrated.
const ATTR_ENTRY = `<program>
import { H_DIRECT, C_ARG, T_TPL } from './models.scrml'
${OPEN} @a = ""
   @b = ""
   @n = 0 ${CLOSE}
function setB(v) { @b = v }
<div title="tpl ${OPEN}T_TPL${CLOSE}">
  <button onclick={ @a = H_DIRECT }>h</button>
  <button onclick=setB(C_ARG)>c</button>
  <button onclick={ @n = @n + 1 }>${OPEN}@n${CLOSE}</button>
  <p>${OPEN}@a${CLOSE} ${OPEN}@b${CLOSE}</p>
</div>
</program>
`;

describe("CONF-CG-358 — attribute-value dimension: a const read ONLY in a handler / call-ref / template attr reaches the client", () => {
  const NAME = "cg358-attrdim";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), ATTR_MODULE);
    writeFileSync(join(dir, "index.scrml"), ATTR_ENTRY);
  });
  afterEach(() => teardownDir(NAME));

  test("codes-half: all three consts are DECLARED + REGISTERED in models.client.js; index destructures each", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    for (const name of ["H_DIRECT", "C_ARG", "T_TPL"]) {
      // Pre-fix: the seed never saw the attribute read, so the const was neither
      // declared nor registered (the footer was `{}` for these three).
      expect(m.clientJs).toMatch(new RegExp(`^\\s*const ${name} = `, "m"));
      expect(m.clientJs).toMatch(
        new RegExp(`_scrml_modules\\["models\\.client\\.js"\\] = \\{[^}]*${name}: ${name}[^}]*\\}`),
      );
      expect(idx.clientJs).toMatch(
        new RegExp(`const \\{[^}]*\\b${name}\\b[^}]*\\} = _scrml_modules\\["models\\.client\\.js"\\]`),
      );
    }
    // Classic-script parse guard (a raw import/export would throw here).
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
    expect(() => new vm.Script(idx.clientJs)).not.toThrow();
  });

  test("runtime-half: the shipped models.client.js registry exposes all three values (pre-fix the footer was `{}`)", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
    expect(reg).toBeDefined();
    expect(reg.H_DIRECT).toBe("handler-direct");
    expect(reg.C_ARG).toBe("callref-arg");
    expect(reg.T_TPL).toBe("template-tpl");
  });
});

// NO-LEAK on a handler lambda-param shadow — the confidentiality guard must survive
// the attribute-value walk: a server-only export read only in a `server fn`, whose
// name is reused as a lambda PARAM inside an unrelated client handler, must NOT be
// cross-marked (the deep collector records the lambda param into `boundOut`, so the
// shadow read cannot pull the server value client). This is the handler-context
// analogue of the each-var / alias shadow vectors above.
const ATTR_SHADOW_MODULE = `export const SECRET = ["LEAK", "CANARY", "358H"].join("-")
export const SHOWN = "shown-client-value"
`;
const ATTR_SHADOW_ENTRY = `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string {
    return SECRET
}
on mount {
    @a = SHOWN
}
<button onclick={ @a = [1].map(SECRET => SECRET).join("") }>x</button>
<div><p>${OPEN}@a${CLOSE}</p></div>
</program>
`;

describe("CONF-CG-358 — NO-LEAK on a handler lambda-param shadow (the attribute-value walk keeps the guard)", () => {
  const NAME = "cg358-attr-shadow";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), ATTR_SHADOW_MODULE);
    writeFileSync(join(dir, "index.scrml"), ATTR_SHADOW_ENTRY);
  });
  afterEach(() => teardownDir(NAME));

  test("codes-half: the server-only value + its export-table entry are ABSENT from every .client.js; SHOWN present", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    const canary = /LEAK-CANARY-358H|\["LEAK"/;
    // The value must NEVER reach any client bundle (the leak this pins).
    expect(m.clientJs).not.toMatch(canary);
    expect(idx.clientJs).not.toMatch(canary);
    // No `const SECRET = …` decl and no `SECRET:` export-table entry.
    expect(m.clientJs).not.toMatch(/\bconst SECRET\b/);
    expect(m.clientJs).not.toMatch(/\bSECRET:/);
    // The client-read sibling IS registered.
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*SHOWN: SHOWN[^}]*\}/);
    // The value IS present server-side (it is legitimately a server value).
    expect(m.serverJs ?? "").toMatch(/LEAK-CANARY-358H|\["LEAK"/);
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });

  test("runtime-half: registry exposes SHOWN but NOT SECRET", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
    expect(reg).toBeDefined();
    expect(reg.SHOWN).toBe("shown-client-value");
    expect("SECRET" in reg).toBe(false);
    expect(reg.SECRET).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// STRUCTURAL-`if=` DIMENSION (S332-peter) — the second half of the attribute
// residual, surfaced by the S239 adversarial pass. The render-gate `if=` on a
// scrml STRUCTURAL element (`<each>` / `<match>` / `<engine>`) has NO `attrs`
// array — the predicate lives on `node.ifCond` (ast-builder captureStructuralIfAttr),
// which the node.attrs walk never reaches. So a const read ONLY in that gate stayed
// unseeded → dep omits it → the emitted client render effect references a free
// variable → ReferenceError when the gate evaluates. Seed from `node.ifCond` too.
// ---------------------------------------------------------------------------
describe("CONF-CG-358 — structural `if=` gate: a const read ONLY in an <each if=(CONST)> render gate reaches the client", () => {
  const NAME = "cg358-structif";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), `export const GATE = true\n`);
    writeFileSync(join(dir, "index.scrml"), `<program>
import { GATE } from './models.scrml'
${OPEN} @rows = [1, 2] ${CLOSE}
<ul><each in=@rows as r if=(GATE)><li>${OPEN}r${CLOSE}</li></each></ul>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("codes-half: GATE is DECLARED + REGISTERED in models.client.js and destructured by index", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    expect(m.clientJs).toMatch(/^\s*const GATE = true;/m);
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*GATE: GATE[^}]*\}/);
    expect(idx.clientJs).toMatch(/const \{[^}]*\bGATE\b[^}]*\} = _scrml_modules\["models\.client\.js"\]/);
    // The gate predicate reads GATE on the client (the site that ReferenceError'd pre-fix).
    expect(idx.clientJs).toMatch(/\bGATE\b/);
    expect(() => new vm.Script(idx.clientJs)).not.toThrow();
  });

  test("runtime-half: the shipped models.client.js registry exposes GATE", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
    expect(reg).toBeDefined();
    expect(reg.GATE).toBe(true);
  });
});

// NO-LEAK on an ESCAPED template interpolation — the confidentiality guard the S239
// pass caught: the `${}` seed scan must honor the SAME backslash-escape codegen wiring
// does. An ESCAPED `\${SECRET}` is literal attribute text, NEVER wired into a client
// setAttribute effect (rewriteTemplateAttrValue treats `\$` as literal), so a
// server-only SECRET referenced only there must stay off the client. The first cut's
// escape-blind scan extracted SECRET and SHIPPED its value — a §14.8 leak. The shared
// forEachTemplateInterpolation is escape-aware, so this pins the fix.
describe("CONF-CG-358 — NO-LEAK on an escaped `\\${…}` template interpolation (the shared scanner is escape-aware)", () => {
  const NAME = "cg358-escaped-noleak";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), `export const SECRET = ["LEAK", "CANARY", "358E"].join("-")
export const SHOWN = "shown-client-value"
`);
    // `title="x \${SECRET}"` — the `\\` in this template literal is ONE backslash in
    // the .scrml source, so the source reads `x \${SECRET}`: an ESCAPED interpolation.
    writeFileSync(join(dir, "index.scrml"), `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string {
    return SECRET
}
on mount {
    @a = SHOWN
}
<div title="x \\${OPEN}SECRET${CLOSE}"><p>${OPEN}@a${CLOSE}</p></div>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("codes-half: the escaped SECRET is ABSENT from every .client.js; SHOWN present", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    const canary = /LEAK-CANARY-358E|\["LEAK"/;
    // The value must NEVER reach any client bundle (the leak this pins).
    expect(m.clientJs).not.toMatch(canary);
    expect(idx.clientJs).not.toMatch(canary);
    expect(m.clientJs).not.toMatch(/\bconst SECRET\b/);
    expect(m.clientJs).not.toMatch(/\bSECRET:/);
    // The mount-read sibling IS registered (the escape guard does not over-suppress).
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*SHOWN: SHOWN[^}]*\}/);
    // The value IS present server-side.
    expect(m.serverJs ?? "").toMatch(canary);
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });

  test("runtime-half: registry exposes SHOWN but NOT the escaped SECRET", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
    expect(reg).toBeDefined();
    expect(reg.SHOWN).toBe("shown-client-value");
    expect("SECRET" in reg).toBe(false);
    expect(reg.SECRET).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CALL-REF CALLEE + STRUCTURAL RAW-OPENER DIMENSIONS (S332-peter) — the final two
// facets of the #358 attribute class, surfaced by a second S239 adversarial pass.
// A call-ref `onclick=FN()` keeps the CALLEE in `attr.value.name` (not argExprNodes),
// and a structural opener (`<each in=/of=/key=>`, `<engine in=/key=/on=>`) keeps its
// iteration/key source as a RAW STRING (`inExprRaw`/`ofExprRaw`/`keyExprRaw`/…), not an
// ExprNode / attr / ifCond. A const read ONLY through one of those still ReferenceError'd
// on the client. Seed `av.name` + the raw-opener expr fields.
// ---------------------------------------------------------------------------
describe("CONF-CG-358 — call-ref callee: a fn read ONLY as `onclick=FN()` reaches the client", () => {
  const NAME = "cg358-callee";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), `export const CB = () => "cb-value"\n`);
    writeFileSync(join(dir, "index.scrml"), `<program>
import { CB } from './models.scrml'
${OPEN} @n = 0 ${CLOSE}
<div><button onclick=CB()>go</button><p>${OPEN}@n${CLOSE}</p></div>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("codes-half: CB is DECLARED + REGISTERED in models.client.js and destructured by index", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    expect(m.clientJs).toMatch(/^\s*const CB = /m);
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*CB: CB[^}]*\}/);
    expect(idx.clientJs).toMatch(/const \{[^}]*\bCB\b[^}]*\} = _scrml_modules\["models\.client\.js"\]/);
    expect(() => new vm.Script(idx.clientJs)).not.toThrow();
  });

  test("runtime-half: the registry exposes CB as a function", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
    expect(reg).toBeDefined();
    expect(typeof reg.CB).toBe("function");
    expect(reg.CB()).toBe("cb-value");
  });
});

describe("CONF-CG-358 — structural raw opener: a const read ONLY as `<each in=CONST>` reaches the client", () => {
  const NAME = "cg358-rawopener";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), `export const ROWS = [10, 20, 30]\n`);
    writeFileSync(join(dir, "index.scrml"), `<program>
import { ROWS } from './models.scrml'
<ul><each in=ROWS as r><li>${OPEN}r${CLOSE}</li></each></ul>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("codes-half: ROWS is DECLARED + REGISTERED in models.client.js and destructured by index", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    expect(m.clientJs).toMatch(/^\s*const ROWS = \[10, 20, 30\];/m);
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*ROWS: ROWS[^}]*\}/);
    expect(idx.clientJs).toMatch(/const \{[^}]*\bROWS\b[^}]*\} = _scrml_modules\["models\.client\.js"\]/);
    // The each render reads ROWS on the client (the site that ReferenceError'd pre-fix).
    expect(idx.clientJs).toMatch(/\bROWS\b/);
    expect(() => new vm.Script(idx.clientJs)).not.toThrow();
  });

  test("runtime-half: the registry exposes ROWS with its value", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const reg = evalModelsRegistry(c.out("models.scrml").clientJs);
    expect(reg).toBeDefined();
    expect(reg.ROWS).toEqual([10, 20, 30]);
  });
});
