/**
 * CONF-CG-263 | §14.8 (confidentiality) / §21.3 (cross-file imports) / §40 (client emit)
 *
 * `g-263-direct-cross-file-const-import-not-emitted-client`, the CONVERGENCE half.
 *
 * WHAT THIS PINS, AND WHY IT IS ONE FILE AND NOT SIX PATCHES
 * ---------------------------------------------------------
 * An exported `const` imported DIRECTLY by another unit and read in THAT unit's
 * CLIENT code must reach the exporting module's `.client.js` — declared AND in the
 * `_scrml_modules` footer — or the importer reads a free variable and the browser
 * throws `ReferenceError` at exit 0, with no diagnostic anywhere.
 *
 * The reachability seed that answers "does some client read this?" used to be a
 * hand-rolled walker that duplicated the markup/engine/match traversal
 * `dependency-graph.ts` already performed. Two
 * untyped walkers over the same AST drift, and this one's MISSING-position set GREW
 * across three adversarial review rounds — six positions were still open when the
 * enumeration approach was abandoned. Both passes now read ONE shared table
 * (`compiler/src/expr-positions.ts`).
 *
 * §1 POSITIONS — one case per position that was open. Each fixture reads the
 *    imported const ONLY in the position under test, and each also asserts the
 *    importer's own client bundle really does reference the name — so the case
 *    proves a live `ReferenceError`, not a theoretical one. All six FAILED before
 *    the convergence.
 *
 * §2 §14.8 NO-LEAK — the invariant the fix must not buy its correctness with. A
 *    server-only const SHALL NEVER be pulled client-side. The escaped-interpolation
 *    vector is here because a scanner written for §1 BROKE it once: a `\${SECRET}`
 *    in attribute text is LITERAL TEXT that codegen never wires, and a scanner that
 *    reads it as an interpolation ships the secret. Verified by EXECUTING the
 *    shipped bundle, not by grepping it.
 *
 * §3 BUILD-SIDE CONSTS — `import.meta` is a module-only meta-property and the
 *    compiler ships client bundles as CLASSIC scripts. A build-side const that
 *    reaches the client does not merely carry a useless build-host path; it makes
 *    the WHOLE FILE fail to load. Pinned as a fail-closed skip.
 *
 * §4 SAME-FILE §14.8 NO-LEAK — the SAME invariant as §2, on the OTHER call site.
 *    §2's six vectors all put the secret in a separate `models.scrml`, so every
 *    one of them travels the cross-file path. The per-file #263 gate is a second
 *    caller of the same collector, and for as long as shadow policy lived in the
 *    CALLERS the two could disagree — which they did, in the leaking direction.
 *    Two of these vectors leak on `main` and one more leaked on the first cut of
 *    this arc. **When a helper has two callers, a test that exercises one of them
 *    is measuring half the surface, and reads exactly like a test that measures
 *    all of it.**
 *
 * §5 A MODULE-SCOPE READ SURVIVES AN UNRELATED SHADOW — the other direction of
 *    the same question, and the one an over-eager shadow guard breaks. A client
 *    `function greet(NEEDED)` binds `NEEDED` inside its own body and nowhere else;
 *    it must not suppress a genuine `on mount { @a = NEEDED }` read of the import.
 *
 * Firing sites: codegen/client-read-seed.ts (`collectClientReadIdents`) ·
 * compiler/src/expr-positions.ts (`forEachExprPosition`) ·
 * codegen/emit-client.ts (`emitReferencedModuleExportConstLines`) ·
 * codegen/index.ts (`crossFileClientReads` precompute).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";
import { compileScrml } from "../../src/api.js";

const TMP_ROOT = join(tmpdir(), "scrml-263-seed-convergence");
const OPEN = "${";
const CLOSE = "}";
const BS = "\\";

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
  const allClient = () => {
    const list = [];
    for (const [fp, o] of result.outputs ?? new Map()) if (o?.clientJs) list.push([fp, o.clientJs]);
    return list;
  };
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    out,
    allClient,
  };
}

// ---------------------------------------------------------------------------
// §1 — the six positions.
// ---------------------------------------------------------------------------

const MODULE = `export const NEEDED = "needle-value-263"
export const SHOWN = "shown-client-value"
`;

/**
 * Each entry reads `NEEDED` ONLY in the named position.
 *
 * `clientRef` is the substring the IMPORTER's own client bundle must contain —
 * the emitted reference that made the miss a runtime `ReferenceError`. Asserting
 * it is what stops a case from silently degenerating into "the position is not
 * wired client-side at all", which would make the case prove nothing.
 */
const POSITIONS = [
  {
    label: "member/namespace call-ref base — the callee's BASE segment is a binding",
    dir: "cg263-callref-member-base",
    clientRef: "NEEDED.go(1)",
    entry: `<program>
import { NEEDED } from './models.scrml'
${OPEN} @a = 0 ${CLOSE}
<button onclick=NEEDED.go(1)>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // `safeParseExprToNodeGlobal` returns undefined for an EMPTY argument, and one
    // undefined drops `argExprNodes` for the WHOLE call — the raw `args` strings
    // are then the only representation of every OTHER argument too.
    //
    // SEPARATE PRE-EXISTING DEFECT, deliberately not asserted here: this shape
    // ALSO emits the elision verbatim (`handle(NEEDED, , 2)`), which is invalid
    // JS. It is invisible to `new vm.Script` under bun (bun's parser accepts a
    // great deal a browser will not — the same reason the emitted-artifact syntax
    // gate is a separate NODE subprocess). Reported for filing; this case pins the
    // SEED half only, and the seed half is what makes the const resolvable.
    label: "unparseable call-ref args — argExprNodes undefined for the whole call",
    dir: "cg263-callref-unparseable-args",
    clientRef: "handle(NEEDED",
    entry: `<program>
import { NEEDED } from './models.scrml'
${OPEN} @a = 0 ${CLOSE}
<button onclick=handle(NEEDED, , 2)>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "<match> block arm body — an attribute inside a raw-captured arm",
    dir: "cg263-match-arm-body",
    clientRef: "NEEDED()",
    entry: `<program>
import { NEEDED } from './models.scrml'
${OPEN} type Phase:enum = { Idle, Ready }
   <phase>: Phase = .Idle ${CLOSE}
<match for=Phase on=@phase>
  <Idle>
    <p onclick=NEEDED()>idle</p>
  </>
  <Ready>
    <p data-arm="ready">Ready</p>
  </>
</match>
</program>
`,
  },
  {
    label: "engine transition guard — <onTransition if=…>",
    dir: "cg263-engine-transition-guard",
    clientRef: "NEEDED === 1",
    entry: `<program>
import { NEEDED } from './models.scrml'
${OPEN} type Game:enum = { Title, Playing }
   <over> = false ${CLOSE}
<engine for=Game initial=.Title>
    <Title rule=.Playing>
        <onTransition to=.Playing if=(NEEDED == 1)>${OPEN} @over = true ${CLOSE}</>
    </>
    <Playing rule=.Title></>
</>
<p>${OPEN}@over${CLOSE}</p>
</program>
`,
  },
  {
    // The `:`-shorthand body exists ONLY as raw text under
    // `_record.engineMeta.stateChildren[].bodyRaw` — an OBJECT, unreachable by any
    // child recursion that descends only ARRAY-valued fields.
    label: "engine state-child body — the `:`-shorthand form, raw text under _record",
    dir: "cg263-engine-statechild-colon",
    clientRef: 'reactive_set("hits", NEEDED)',
    entry: `<program>
import { NEEDED } from './models.scrml'
${OPEN} type Game:enum = { Title, Playing }
   <hits> = 0 ${CLOSE}
<engine for=Game initial=.Title>
    <Title rule=.Playing : @hits = NEEDED>
    <Playing rule=.Title/>
</>
<p>${OPEN}@hits${CLOSE}</p>
</program>
`,
  },
  {
    // `derivedExprNode` is a parsed ExprNode whose FIELD NAME is not in the
    // ExprNode-field list — the drift was a spelling, not a shape.
    label: "engine derived= projection — the §51.0.J expression form",
    dir: "cg263-engine-derived",
    clientRef: "NEEDED === 1",
    entry: `<program>
import { NEEDED } from './models.scrml'
${OPEN} type Src:enum = { A, B }
   type Dst:enum = { X, Y } ${CLOSE}
<engine for=Src initial=.A>
    <A rule=.B/>
    <B rule=.A/>
</>
<engine for=Dst derived=(NEEDED == 1 ? .X : .Y)>
    <X/>
    <Y/>
</>
<p>${OPEN}@dst${CLOSE}</p>
</program>
`,
  },
];

for (const pos of POSITIONS) {
  describe(`CONF-CG-263 §1 — a directly-imported const read ONLY via: ${pos.label}`, () => {
    let dir;
    beforeEach(() => {
      dir = setupDir(pos.dir);
      writeFileSync(join(dir, "models.scrml"), MODULE);
      writeFileSync(join(dir, "index.scrml"), pos.entry);
    });
    afterEach(() => teardownDir(pos.dir));

    test("the importer really DOES reference the name client-side (the case is not vacuous)", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const idx = c.out("index.scrml");
      expect(idx).not.toBeNull();
      expect(idx.clientJs).toContain(pos.clientRef);
    });

    test("models.client.js DECLARES the const and REGISTERS it in the _scrml_modules footer", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const m = c.out("models.scrml");
      expect(m).not.toBeNull();
      // Pre-convergence: neither of these matched — the const was dropped entirely.
      expect(m.clientJs).toMatch(/^\s*const NEEDED = "needle-value-263";/m);
      expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*NEEDED: NEEDED[^}]*\}/);
      // A raw import/export would throw here — the bundle ships as a CLASSIC script.
      expect(() => new vm.Script(m.clientJs)).not.toThrow();
    });

    test("the importer DESTRUCTURES the const from the registry", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const idx = c.out("index.scrml");
      expect(idx.clientJs).toMatch(/const \{[^}]*\bNEEDED\b[^}]*\} = _scrml_modules\["models\.client\.js"\]/);
    });
  });
}

// ---------------------------------------------------------------------------
// §2 — §14.8: a server-only const SHALL NEVER be pulled client-side.
// ---------------------------------------------------------------------------

// A NON-foldable initializer, so a leaked client decl would be verbatim + greppable.
const SHADOW_MODULE = `export const SECRET = ["LEAK", "CANARY", "263"].join("-")
export const SHOWN = "shown-client-value"
`;

const LEAK_VECTORS = [
  {
    // THE ONE A SCANNER WRITTEN FOR §1 ACTUALLY BROKE. `\${SECRET}` in attribute
    // text is LITERAL TEXT — codegen emits it as characters and never wires a
    // read. A scanner that treats it as an interpolation believes MORE is wired
    // than is, and ships the value. The shared `${}` scan is escape-aware for
    // exactly this reason.
    label: "an ESCAPED ${} interpolation in attribute text is not a read",
    dir: "cg263-leak-escaped-interp",
    entry: `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string {
    return SECRET
}
on mount {
    @a = SHOWN
}
<p title="literal ${BS}${OPEN}SECRET${CLOSE} here">${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "the import name reused as a client <each … as> loop var (scope shadow)",
    dir: "cg263-leak-each-shadow",
    entry: `<program>
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
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "the name mentioned only inside a client STRING LITERAL is not a read",
    dir: "cg263-leak-string-literal",
    entry: `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string {
    return SECRET
}
on mount {
    @a = SHOWN
}
<p data-note="the value of SECRET is private">${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "the name mentioned only inside a COMMENT is not a read",
    dir: "cg263-leak-comment",
    entry: `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string {
    return SECRET
}
// SECRET must never be emitted client-side
on mount {
    @a = SHOWN
}
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // The engine state-child body is one of the NEW positions §1 opened up. A
    // server-only const must not ride in on it.
    label: "an engine state-child body reads only the CLIENT sibling",
    dir: "cg263-leak-engine-statechild",
    entry: `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} type Game:enum = { Title, Playing }
   @a = "" ${CLOSE}
server fn stash() -> string {
    return SECRET
}
on mount {
    @a = SHOWN
}
<engine for=Game initial=.Title>
    <Title rule=.Playing : @a = SHOWN>
    <Playing rule=.Title/>
</>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a client lambda PARAM shadowing the import name",
    dir: "cg263-leak-lambda-param",
    entry: `<program>
import { SECRET, SHOWN } from './models.scrml'
${OPEN} @a = ""
   @rows = [1, 2] ${CLOSE}
server fn stash() -> string {
    return SECRET
}
fn compute() {
    return @rows.map(SECRET => SECRET + 1)
}
on mount {
    @a = SHOWN
}
<button onclick=compute()>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
];

for (const vec of LEAK_VECTORS) {
  describe(`CONF-CG-263 §2 — §14.8 NO-LEAK: ${vec.label}`, () => {
    let dir;
    beforeEach(() => {
      dir = setupDir(vec.dir);
      writeFileSync(join(dir, "models.scrml"), SHADOW_MODULE);
      writeFileSync(join(dir, "index.scrml"), vec.entry);
    });
    afterEach(() => teardownDir(vec.dir));

    test("the server-only value is absent from EVERY .client.js, and present server-side", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const clients = c.allClient();
      // Guard the guard: a sweep that finds no bundles proves nothing.
      expect(clients.length).toBeGreaterThan(0);
      for (const [fp, js] of clients) {
        expect({ file: fp, leaked: /LEAK-CANARY-263|\["LEAK"/.test(js) }).toEqual({ file: fp, leaked: false });
        expect({ file: fp, decl: /\bconst SECRET\b/.test(js) }).toEqual({ file: fp, decl: false });
        expect({ file: fp, registered: /\bSECRET:/.test(js) }).toEqual({ file: fp, registered: false });
      }
      // The value IS legitimately present server-side.
      expect(c.out("models.scrml").serverJs ?? "").toMatch(/LEAK-CANARY-263|\["LEAK"/);
    });

    test("the client-read SIBLING still reaches the client (no over-prune)", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      const m = c.out("models.scrml");
      expect(m.clientJs).toMatch(/^\s*const SHOWN = "shown-client-value";/m);
    });

    test("EXECUTING the shipped models.client.js exposes SHOWN and NOT SECRET", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      const ctx = vm.createContext({
        _scrml_modules: {},
        _scrml_reactive_set: () => {}, _scrml_reactive_get: () => undefined, _scrml_init_set: () => {},
        _scrml_effect: () => ({}), _scrml_render_value: () => {}, _scrml_region_track: () => {},
        _scrml_register_rehydrator: () => {},
      });
      // `document` is left undefined so the boot IIFE early-returns; only the
      // top-level wiring + the registry footer run.
      vm.runInContext(c.out("models.scrml").clientJs, ctx, { filename: "models.client.js" });
      const reg = ctx._scrml_modules["models.client.js"];
      expect(reg).toBeDefined();
      expect(reg.SHOWN).toBe("shown-client-value");
      expect("SECRET" in reg).toBe(false);
    });
  });
}

// ---------------------------------------------------------------------------
// §3 — a BUILD-SIDE const must never be client-emitted.
// ---------------------------------------------------------------------------

describe("CONF-CG-263 §3 — an `import.meta` initializer is a BUILD-SIDE const and stays off the client", () => {
  const NAME = "cg263-build-side-const";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), `export const BUILD_ROOT = import.meta.url
export const SHOWN = "shown-client-value"
`);
    // BUILD_ROOT is read in CLIENT code — the reachability seed says "yes, a
    // client reads this". Reachability is not the question: the VALUE is a
    // build-host path with no browser meaning, and `import.meta` is a module-only
    // meta-property in a bundle the compiler ships as a CLASSIC script, so
    // emitting it makes the WHOLE FILE fail to load.
    writeFileSync(join(dir, "index.scrml"), `<program>
import { BUILD_ROOT, SHOWN } from './models.scrml'
${OPEN} @a = ""
   @b = "" ${CLOSE}
on mount {
    @a = BUILD_ROOT
    @b = SHOWN
}
<p>${OPEN}@a${CLOSE} ${OPEN}@b${CLOSE}</p>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("no .client.js contains `import.meta`, and BUILD_ROOT is neither declared nor registered", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const clients = c.allClient();
    expect(clients.length).toBeGreaterThan(0);
    for (const [fp, js] of clients) {
      // The tokenizer may space the property access, so match tolerantly.
      expect({ file: fp, importMeta: /\bimport\s*\.\s*meta\b/.test(js) })
        .toEqual({ file: fp, importMeta: false });
      expect({ file: fp, decl: /\bconst BUILD_ROOT\b/.test(js) }).toEqual({ file: fp, decl: false });
      expect({ file: fp, registered: /\bBUILD_ROOT:/.test(js) }).toEqual({ file: fp, registered: false });
    }
  });

  test("the fail-closed skip is NARROW — the ordinary sibling const still reaches the client", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    const m = c.out("models.scrml");
    expect(m.clientJs).toMatch(/^\s*const SHOWN = "shown-client-value";/m);
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*SHOWN: SHOWN[^}]*\}/);
  });

  test("the shipped bundles EXECUTE as classic scripts, deps-first, in one shared scope", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    // Faithful classic-script model: dependency first, ONE shared global scope
    // holding the `_scrml_modules` registry. `document` is left undefined so the
    // boot IIFE early-returns and only the top-level wiring runs.
    const ctx = vm.createContext({
      _scrml_modules: {},
      _scrml_reactive_set: () => {}, _scrml_reactive_get: () => undefined, _scrml_init_set: () => {},
      _scrml_effect: () => ({}), _scrml_render_value: () => {}, _scrml_region_track: () => {},
      _scrml_register_rehydrator: () => {},
    });
    // Pre-fix, this threw on `models.client.js`: "import.meta is only valid inside
    // modules". Note that PARSING the same bytes with bun's `vm.Script` reports
    // CLEAN — only node's parser and actual EXECUTION surface it, which is why
    // this assertion runs the bundle instead of parsing it.
    expect(() => {
      vm.runInContext(c.out("models.scrml").clientJs, ctx, { filename: "models.client.js" });
      vm.runInContext(c.out("index.scrml").clientJs, ctx, { filename: "index.client.js" });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §4 — SAME-FILE §14.8: the OTHER caller of the same collector.
//
// Every §2 vector puts the secret in a separate `models.scrml`, so every one of
// them travels the CROSS-FILE path. The per-file #263 gate
// (`emitReferencedModuleExportConstLines`) is a second caller, and while shadow
// policy lived in the CALLERS the two could — and did — disagree. Two of the
// vectors below leak on `main`; a third leaked on the first cut of this arc.
// ---------------------------------------------------------------------------

const SF_SECRET = `export const SECRET = ["LEAK", "CANARY", "SAMEFILE"].join("-")`;

const SAMEFILE_VECTORS = [
  {
    // Leaked on the FIRST CUT of this arc (not on main): the collector gained an
    // unconditional deep walk that reaches lambda bodies, with no scope check.
    label: "a lambda PARAM shadowing the export name",
    dir: "cg263-same-lambda-param",
    entry: `<program>
${SF_SECRET}
${OPEN} @a = ""
   @rows = [1, 2] ${CLOSE}
server fn stash() -> string { return SECRET }
fn compute() { return @rows.map(SECRET => SECRET + 1) }
on mount { @a = "hello" }
<button onclick=compute()>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // LEAKS ON MAIN. The `${SECRET}` read inside the each body is reachable with
    // no deep walk at all, and the same-file gate has never had a shadow guard.
    label: "an <each ... as SECRET> loop var shadowing the export name",
    dir: "cg263-same-each-var",
    entry: `<program>
${SF_SECRET}
${OPEN} @a = ""
   @rows = ["x", "y"] ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<ul><each in=@rows as SECRET><li>${OPEN}SECRET${CLOSE}</li></each></ul>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // LEAKS ON MAIN, same reason.
    label: "a client `function` PARAM shadowing the export name",
    dir: "cg263-same-fn-param",
    entry: `<program>
${SF_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
function compute(SECRET) { return SECRET }
on mount { @a = "hello" }
<button onclick=compute(1)>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a local `let` inside a client fn shadowing the export name",
    dir: "cg263-same-local-let",
    entry: `<program>
${SF_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
fn compute() {
    let SECRET = 1
    return SECRET
}
on mount { @a = "hello" }
<button onclick=compute()>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // The floor: no shadow anywhere, read only inside a pruned `server fn`.
    label: "no shadow at all — read only inside a pruned server fn",
    dir: "cg263-same-no-shadow",
    entry: `<program>
${SF_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
];

for (const vec of SAMEFILE_VECTORS) {
  describe(`CONF-CG-263 §4 — SAME-FILE §14.8 NO-LEAK: ${vec.label}`, () => {
    let dir;
    beforeEach(() => {
      dir = setupDir(vec.dir);
      writeFileSync(join(dir, "index.scrml"), vec.entry);
    });
    afterEach(() => teardownDir(vec.dir));

    test("the server-only value never reaches the client bundle", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const clients = c.allClient();
      expect(clients.length).toBeGreaterThan(0);
      for (const [fp, js] of clients) {
        expect({ file: fp, leaked: /LEAK-CANARY-SAMEFILE|\["LEAK"/.test(js) })
          .toEqual({ file: fp, leaked: false });
        expect({ file: fp, decl: /\bconst SECRET\b/.test(js) })
          .toEqual({ file: fp, decl: false });
      }
      // The value IS legitimately present server-side.
      expect(c.out("index.scrml").serverJs ?? "").toMatch(/LEAK-CANARY-SAMEFILE|\["LEAK"/);
    });
  });
}

describe("CONF-CG-263 §4 — the same-file gate is not simply OFF (positive control)", () => {
  const NAME = "cg263-same-positive";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    // A genuinely client-read same-file export const MUST still be emitted — every
    // no-leak vector above would pass trivially if the gate emitted nothing.
    writeFileSync(join(dir, "index.scrml"), `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = SHOWN }
<p>${OPEN}@a${CLOSE}</p>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("a genuinely client-read same-file export const IS emitted", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    expect(c.out("index.scrml").clientJs).toMatch(/^\s*const SHOWN = "shown-client-value";/m);
  });
});

// ---------------------------------------------------------------------------
// §5 — a MODULE-SCOPE read survives an unrelated shadow elsewhere in the file.
//
// The opposite failure of §4, and the one an over-eager shadow guard causes. A
// flat bag of bound names cannot tell these two apart; a scope stack can.
// ---------------------------------------------------------------------------

describe("CONF-CG-263 §5 — a client `function` param does NOT suppress a real module-scope read", () => {
  const NAME = "cg263-param-vs-real-read";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models.scrml"), MODULE);
    // `NEEDED` is bound as a param of `greet` — inside `greet` ONLY. The
    // `on mount` read is a genuine module-scope read of the import.
    writeFileSync(join(dir, "index.scrml"), `<program>
import { NEEDED } from './models.scrml'
${OPEN} @a = "" ${CLOSE}
function greet(NEEDED) { return NEEDED }
on mount { @a = NEEDED }
<button onclick=greet(1)>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("models.client.js still declares and registers the const", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("models.scrml");
    expect(m.clientJs).toMatch(/^\s*const NEEDED = "needle-value-263";/m);
    expect(m.clientJs).toMatch(/_scrml_modules\["models\.client\.js"\] = \{[^}]*NEEDED: NEEDED[^}]*\}/);
  });

  test("the importer's read RESOLVES at runtime — no free variable", () => {
    const c = compileEntry(join(dir, "index.scrml"));
    const sets = [];
    const ctx = vm.createContext({
      _scrml_modules: {},
      _scrml_reactive_set: (k, v) => { sets.push([String(k), v]); },
      _scrml_reactive_get: () => undefined,
      _scrml_cs_reactive_set: (k, v) => { sets.push([String(k), v]); return v; },
      _scrml_init_set: () => {}, _scrml_effect: () => ({}),
      _scrml_render_value: () => {}, _scrml_region_track: () => {},
      _scrml_register_rehydrator: () => {},
    });
    // Pre-fix this threw `ReferenceError: NEEDED is not defined` — the const was
    // dropped from `models.client.js` while `index.client.js` still read it.
    expect(() => {
      vm.runInContext(c.out("models.scrml").clientJs, ctx, { filename: "models.client.js" });
      vm.runInContext(c.out("index.scrml").clientJs, ctx, { filename: "index.client.js" });
    }).not.toThrow();
    const last = (suffix) => {
      for (let i = sets.length - 1; i >= 0; i--) if (sets[i][0].split("$").pop() === suffix) return sets[i][1];
      return undefined;
    };
    expect(last("a")).toBe("needle-value-263");
  });
});
