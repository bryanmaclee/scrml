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
// ASSERTION HELPERS — anchored, line-scoped, and kind-agnostic.
//
// Every one of these replaces an assertion that could be satisfied by something
// other than what it claimed to measure. That matters more here than usual: this
// file's job is to prove a §14.8 leak is absent, and a defeatable no-leak
// assertion reads exactly like a real one.
//
//   /const SHOWN = "shown-client-value";/        a COMMENT mentioning the line
//                                                satisfies it (unanchored).
//   /_scrml_modules\[…\] = \{[^}]*NEEDED: NEEDED/ `NEEDEDNEEDED: NEEDEDNEEDED`
//                                                satisfies it (substring).
//   /\bconst SECRET\b/                           misses an `export let` leak,
//                                                which emits `let SECRET`.
//   toContain(clientRef)                         matches inside a comment.
// ---------------------------------------------------------------------------

/**
 * Does `js` declare `name` at MODULE TOP LEVEL — column zero, no indent?
 *
 * THAT IS WHERE THE #263 GATE EMITS, and the distinction is what makes this
 * usable as a no-leak assertion. A legitimate client-scope SHADOW of the same
 * name is always INDENTED — `<each … as SECRET>` emits
 * `    let SECRET = _scrml_resolve_item(…)` inside the per-item renderer and
 * `fn compute() { let SECRET = 1 }` emits `  let SECRET = 1;` inside the
 * function — so an indent-tolerant check fails on correct output. (Measured:
 * loosening it flagged both shadow vectors as leaks.)
 *
 * `const`/`let`/`var` all count: an `export let` candidate is emitted as
 * `let SECRET = …`, so a `const`-only check cannot see that leak at all.
 */
function declaresTopLevelBinding(js, name) {
  return new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=`, "m").test(js ?? "");
}

/** Does `js` declare `name` with EXACTLY this initializer text, on its own line? */
function declaresBindingAs(js, name, initSource) {
  const esc = initSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[ \\t]*(?:const|let|var)\\s+${name}\\s*=\\s*${esc};`, "m").test(js ?? "");
}

/**
 * Does the `_scrml_modules` footer really export `name`? Parsed by SPLITTING the
 * object literal, so `NEEDEDNEEDED: NEEDEDNEEDED` cannot satisfy a query for
 * `NEEDED`.
 */
function registersExport(js, name) {
  const m = (js ?? "").match(/_scrml_modules\[[^\]]*\]\s*=\s*\{([^}]*)\}/);
  if (!m) return false;
  return m[1].split(",").map((s) => s.trim()).some((p) => p === `${name}: ${name}` || p === name);
}

/** Every line of `js` that is not blank and not a `//` comment. */
function codeLines(js) {
  return (js ?? "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//"));
}

/** Does NON-COMMENT code in `js` contain `needle`? */
function codeContains(js, needle) {
  return codeLines(js).some((l) => l.includes(needle));
}

/**
 * A vm context that stubs the `_scrml_*` RUNTIME and nothing else.
 *
 * The stubs are derived FROM THE BUNDLES — every `_scrml_`-prefixed identifier
 * they mention gets a no-op — so the harness never needs updating when codegen
 * reaches for another runtime helper. Deliberately narrow: a USER binding is NOT
 * stubbed, so a const the gate failed to emit still surfaces as the real
 * `ReferenceError` an adopter would see.
 */
function runtimeStubs(sources) {
  const ctx = { _scrml_modules: {} };
  for (const src of sources) {
    for (const m of (src ?? "").matchAll(/\b_scrml_[A-Za-z0-9_]+\b/g)) {
      if (m[0] === "_scrml_modules" || m[0] in ctx) continue;
      ctx[m[0]] = function () { return undefined; };
    }
  }
  ctx._scrml_effect = () => ({});
  ctx._scrml_reactive_get = () => undefined;
  return ctx;
}

/** Is `name` named as an identifier by non-comment code, ignoring declarations? */
function codeReferencesBinding(js, name) {
  const re = new RegExp(`(?:^|[^\\w$."'])${name}(?![\\w$])`);
  const declRe = new RegExp(`^[ \\t]*(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=`);
  return codeLines(js).some((l) => !declRe.test(l) && re.test(l));
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
      // CODE lines only — a `toContain` over the whole bundle is satisfied by a
      // comment, and every emitted binding carries a `// …` echo of its source.
      expect({ ref: pos.clientRef, inCode: codeContains(idx.clientJs, pos.clientRef) })
        .toEqual({ ref: pos.clientRef, inCode: true });
    });

    test("models.client.js DECLARES the const and REGISTERS it in the _scrml_modules footer", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const m = c.out("models.scrml");
      expect(m).not.toBeNull();
      // Pre-convergence: neither of these matched — the const was dropped entirely.
      expect(declaresBindingAs(m.clientJs, "NEEDED", '"needle-value-263"')).toBe(true);
      // Parsed out of the footer object, not substring-matched: the old regex was
      // satisfied by `NEEDEDNEEDED: NEEDEDNEEDED`.
      expect(registersExport(m.clientJs, "NEEDED")).toBe(true);
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
        expect({ file: fp, decl: declaresTopLevelBinding(js, "SECRET") }).toEqual({ file: fp, decl: false });
        expect({ file: fp, registered: registersExport(js, "SECRET") }).toEqual({ file: fp, registered: false });
      }
      // The value IS legitimately present server-side.
      expect(c.out("models.scrml").serverJs ?? "").toMatch(/LEAK-CANARY-263|\["LEAK"/);
    });

    test("the client-read SIBLING still reaches the client (no over-prune)", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      const m = c.out("models.scrml");
      expect(declaresBindingAs(m.clientJs, "SHOWN", '"shown-client-value"')).toBe(true);
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
    expect(declaresBindingAs(m.clientJs, "SHOWN", '"shown-client-value"')).toBe(true);
    expect(registersExport(m.clientJs, "SHOWN")).toBe(true);
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
        expect({ file: fp, decl: declaresTopLevelBinding(js, "SECRET") })
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
    expect(declaresBindingAs(c.out("index.scrml").clientJs, "SHOWN", '"shown-client-value"')).toBe(true);
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
    expect(declaresBindingAs(m.clientJs, "NEEDED", '"needle-value-263"')).toBe(true);
    expect(registersExport(m.clientJs, "NEEDED")).toBe(true);
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

// ---------------------------------------------------------------------------
// §6 — WIRED vs NOT-WIRED, end to end.
//
// The shared table answers "where does user expression SOURCE appear?". THIS
// gate asks "which identifiers does CLIENT-EXECUTED code reference?". Three
// §14.8 leaks across three review rounds all lived in the gap between those two
// questions: prose the compiler renders as text, an attribute it lowers to a
// static HTML string, and a name that is merely shadowed.
//
// Every NEG row below is a position where the identifier appears in SOURCE but
// codegen emits no client-executed reference to it. Every row is paired with a
// POS control in §7 proving the genuinely-wired form of the same position still
// emits — because a gate that emits nothing passes every no-leak test there is.
// ---------------------------------------------------------------------------

const WIRED_SECRET = `export const SECRET = ["LEAK", "CANARY", "WIRED"].join("-")`;

const NOT_WIRED_VECTORS = [
  {
    // The compiler emits `createTextNode("SECRET items")` — pure literal. The
    // pre-fix heuristic (`/^\s*</` on the raw body) sent anything not STARTING
    // with `<` to the expression parser, so rendered words became client reads.
    // Wrapping the same prose in `<p>` made the leak vanish, which is the
    // signature of a heuristic rather than a rule.
    label: "literal prose in an <each> body",
    dir: "cg263-nw-each-prose",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = ""
   @rows = [1, 2] ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<each in=@rows as r>SECRET items</each>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "literal prose in an <each> body, wrapped in an element",
    dir: "cg263-nw-each-prose-wrapped",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = ""
   @rows = [1, 2] ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<each in=@rows as r><p>SECRET items</p></each>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "literal prose in a <match> arm",
    dir: "cg263-nw-match-prose",
    entry: `<program>
${WIRED_SECRET}
${OPEN} type Phase:enum = { Idle, Ready }
   <phase>: Phase = .Idle
   @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<match for=Phase on=@phase>
  <Idle>SECRET pending</>
  <Ready>done</>
</match>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // A BARE-BODY state child is a rendered body; only a `:`-shorthand one is
    // client-executed statements. The AST records which (`isColonShorthand`), so
    // the table declares it instead of guessing from the text.
    label: "literal prose in an engine state-child body",
    dir: "cg263-nw-engine-prose",
    entry: `<program>
${WIRED_SECRET}
${OPEN} type Game:enum = { Title, Playing }
   @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<engine for=Game initial=.Title>
    <Title rule=.Playing>SECRET screen</>
    <Playing rule=.Title/>
</>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // MEASURED: the emitted HTML is `class="SECRET"` and the client bundle has
    // ZERO wiring for it — yet the const declaration was being emitted, and that
    // declaration was the only line in the bundle mentioning the name at all.
    label: "a bare unquoted `class=` attribute",
    dir: "cg263-nw-bare-class",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<p class=SECRET>hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a bare unquoted `data-x=` attribute",
    dir: "cg263-nw-bare-data",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<p data-x=SECRET>hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a QUOTED attribute with no interpolation",
    dir: "cg263-nw-quoted",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<p title="SECRET">hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // MEASURED, and this row used to sit in §7 asserting the OPPOSITE. `if=` on a
    // BARE value lowers through the §17.1 mount gate as a reactive-CELL read:
    // `if (_scrml_cs_reactive_get("SECRET"))`. That is a STRING KEY into the cell
    // store — the emitted bundle names `SECRET` nowhere as an identifier — so the
    // declaration the seed emitted resolved nothing and was pure leak. `if=(X)`
    // and `if=X()` ARE genuine binding reads and stay in §7.
    label: "a BARE value on `if=` — a cell-store read, not a binding",
    dir: "cg263-nw-bare-if",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<p if=SECRET>hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a BARE dotted value on `if=`",
    dir: "cg263-nw-bare-if-dotted",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<p if=SECRET.enabled>hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // The same gate on a STRUCTURAL element (§17.1.2). `<each>`/`<match>`/
    // `<engine>` carry `if=` as `ifCond`, not in an `attrs` array, and they route
    // through the identical mount gate — so they must classify identically, and
    // the table now passes the attribute NAME rather than a pre-computed class so
    // that they cannot diverge.
    label: "a BARE value on a STRUCTURAL `if=` (`<each … if=SECRET>`)",
    dir: "cg263-nw-bare-if-structural",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = ""
   @rows = [1, 2] ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<each in=@rows as r if=SECRET><li>row</li></each>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // MEASURED: `onclick=X.go` fails codegen's bare-ref identifier test and falls
    // to the general static branch — the emitted HTML is `onclick="SECRET.go"`
    // and zero client JS references the binding. The old name-only predicate said
    // "wired" for every `on…` attribute regardless of the VALUE's shape.
    label: "a bare DOTTED value on an event attribute (`onclick=SECRET.go`)",
    dir: "cg263-nw-bare-onclick-dotted",
    entry: `<program>
${WIRED_SECRET}
${OPEN} @a = "" ${CLOSE}
server fn stash() -> string { return SECRET }
on mount { @a = "hello" }
<button onclick=SECRET.go>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
];

for (const vec of NOT_WIRED_VECTORS) {
  describe(`CONF-CG-263 §6 — NOT WIRED, so NOT emitted: ${vec.label}`, () => {
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
        expect({ file: fp, leaked: /LEAK-CANARY-WIRED|\["LEAK"/.test(js) })
          .toEqual({ file: fp, leaked: false });
        expect({ file: fp, decl: declaresTopLevelBinding(js, "SECRET") })
          .toEqual({ file: fp, decl: false });
      }
      expect(c.out("index.scrml").serverJs ?? "").toMatch(/LEAK-CANARY-WIRED|\["LEAK"/);
    });
  });
}

// ---------------------------------------------------------------------------
// §7 — the WIRED half of the same matrix.
//
// Without these, every §6 row would pass on a gate that emits nothing at all.
// ---------------------------------------------------------------------------

const WIRED_VECTORS = [
  {
    label: "a `${}` interpolation in an <each> body",
    dir: "cg263-w-each-interp",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = ""
   @rows = [1, 2] ${CLOSE}
on mount { @a = "hello" }
<each in=@rows as r><p>${OPEN}SHOWN${CLOSE}</p></each>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a `${}` interpolation in a QUOTED attribute",
    dir: "cg263-w-attr-interp",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<p title="v-${OPEN}SHOWN${CLOSE}">hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a call-ref in an event handler",
    dir: "cg263-w-callref",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<button onclick=SHOWN.go(1)>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a call-ref on a PLAIN attribute (wired regardless of name)",
    dir: "cg263-w-callref-plain",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<p class=SHOWN.go()>hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a parenthesized expr on a PLAIN attribute",
    dir: "cg263-w-expr-plain",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<p title=(SHOWN)>hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // The bare `if=SHOWN` form is NOT here — it is a §6 NOT-WIRED row, measured.
    // These two ARE binding reads: `if ((SHOWN))` and `if ((SHOWN()))`.
    label: "a PARENTHESIZED value on `if=`",
    dir: "cg263-w-paren-if",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<p if=(SHOWN)>hello</p>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a BARE value on an event handler",
    dir: "cg263-w-bare-onclick",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<button onclick=SHOWN>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    // THE FOUR NAMES THE TWO PREDICATES DISAGREED ON. `expr-positions` said
    // `/^on[a-z]/`, codegen said `name.startsWith("on")`; codegen wired
    // `"_scrml_attr_on_tap_1": SHOWN,` into the handler table while the seed left
    // `SHOWN` undeclared — a live `ReferenceError` at exit 0. One shared
    // predicate now, so the gap cannot reopen.
    label: "a bare event handler on `on-tap=` (predicate-drift name)",
    dir: "cg263-w-bare-on-tap",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<button on-tap=SHOWN>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "a bare event handler on `on2=` (predicate-drift name)",
    dir: "cg263-w-bare-on2",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} @a = "" ${CLOSE}
on mount { @a = "hello" }
<button on2=SHOWN>go</button>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
  {
    label: "an engine state-child `:`-shorthand body (client-executed statements)",
    dir: "cg263-w-engine-colon",
    entry: `<program>
export const SHOWN = "shown-client-value"
${OPEN} type Game:enum = { Title, Playing }
   @a = "" ${CLOSE}
on mount { @a = "hello" }
<engine for=Game initial=.Title>
    <Title rule=.Playing : @a = SHOWN>
    <Playing rule=.Title/>
</>
<p>${OPEN}@a${CLOSE}</p>
</program>
`,
  },
];

for (const vec of WIRED_VECTORS) {
  describe(`CONF-CG-263 §7 — WIRED, so still emitted: ${vec.label}`, () => {
    let dir;
    beforeEach(() => {
      dir = setupDir(vec.dir);
      writeFileSync(join(dir, "index.scrml"), vec.entry);
    });
    afterEach(() => teardownDir(vec.dir));

    test("the client-read const IS declared in the client bundle", () => {
      const c = compileEntry(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const js = c.allClient().map(([, s]) => s).join("\n");
      expect(declaresBindingAs(js, "SHOWN", '"shown-client-value"')).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// §8 — ONE POSITION MATRIX, RUN ON BOTH PATHS AND BOTH EXPORT KINDS.
//
// §2/§4/§6/§7 each measure ONE cell of a three-axis product, and the cells they
// leave out are where the bugs lived:
//
//   PATH        §2 is cross-file only; §4/§6/§7 are same-file only. Those are
//               TWO CALLERS of one collector (`emitReferencedModuleExportConstLines`
//               and `codegen/index.ts`'s `crossFileClientReads` precompute), and
//               the recorded reason the shadow leak survived three review rounds
//               is that every leak vector travelled the cross-file path while the
//               same-file caller went untested.
//   EXPORT KIND every vector used `export const`. An `export let` candidate is
//               emitted as `let SECRET = …`, which a `/\bconst SECRET\b/`
//               no-leak assertion cannot see AT ALL.
//   DIRECTION   a leak check and an under-emit check are different questions and
//               a gate that emits NOTHING passes every leak check there is.
//
// So the matrix below is declared ONCE and the product is generated. A vector
// added here cannot be added to only one half.
//
// Every `binding` value is MEASURED against emitted output, and three of them
// contradict what the pre-round table asserted:
//   `if=MARK` / `if=MARK.f` / `<each … if=MARK>` lower through the §17.1 mount
//   gate to `_scrml_cs_reactive_get("MARK")` — a STRING KEY into the cell store,
//   not a binding — and `onclick=MARK.go` lowers to the static HTML attribute
//   `onclick="MARK.go"`. All four were classified as wired and all four shipped
//   the value to the browser.
// ---------------------------------------------------------------------------

const MARK_VALUE = '["MK", "CANARY", "263"].join("-")';
const MARK_CANARY = /MK-CANARY-263|\["MK"/;

const POSITION_MATRIX = [
  // --- NOT a binding: the compiler names MARK nowhere as an identifier. ------
  { id: "if-bare", binding: false, markup: `<p if=MARK>gated</p>` },
  { id: "if-bare-dotted", binding: false, markup: `<p if=MARK.enabled>gated</p>` },
  { id: "if-structural-each", binding: false, markup: `<each in=@rows as r if=MARK><li>row</li></each>` },
  { id: "onclick-bare-dotted", binding: false, markup: `<button onclick=MARK.go>go</button>` },
  { id: "class-bare", binding: false, markup: `<p class=MARK>hello</p>` },
  { id: "quoted-no-interp", binding: false, markup: `<p title="MARK">hello</p>` },
  { id: "escaped-interp", binding: false, markup: `<p title="lit ${BS}${OPEN}MARK${CLOSE} here">hello</p>` },
  { id: "each-body-prose", binding: false, markup: `<each in=@rows as r>MARK items</each>` },
  { id: "match-arm-prose", binding: false, markup: `<match for=Phase on=@phase>\n  <Idle>MARK pending</>\n  <Ready>done</>\n</match>` },
  { id: "comment-only", binding: false, markup: `<p>plain</p>`, extraLogic: `// MARK must never be emitted client-side` },

  // --- IS a binding: the emitted bundle must DECLARE MARK. ------------------
  { id: "if-paren", binding: true, markup: `<p if=(MARK)>gated</p>` },
  { id: "onclick-bare-ident", binding: true, markup: `<button onclick=MARK>go</button>` },
  { id: "on-tap-bare-ident", binding: true, markup: `<button on-tap=MARK>go</button>` },
  { id: "callref-dotted-base", binding: true, markup: `<button onclick=MARK.go(1)>go</button>` },
  { id: "callref-plain-attr", binding: true, markup: `<p class=MARK.go()>hello</p>` },
  { id: "attr-template", binding: true, markup: `<p title="v-${OPEN}MARK${CLOSE}">hello</p>` },
  { id: "attr-paren", binding: true, markup: `<p title=(MARK)>hello</p>` },
  { id: "each-body-interp", binding: true, markup: `<each in=@rows as r><p>${OPEN}MARK${CLOSE}</p></each>` },
  { id: "engine-colon-shorthand", binding: true, markup: `<engine for=Game initial=.Title>\n    <Title rule=.Playing : @a = MARK>\n    <Playing rule=.Title/>\n</>` },
  { id: "on-mount-read", binding: true, markup: `<p>plain</p>`, extraLogic: `on mount { @a = MARK }` },
];

/** Build the two files for one matrix cell. */
function matrixSources(vec, path, exportKind) {
  const decl = `export ${exportKind} MARK = ${MARK_VALUE}`;
  const body = `${OPEN} type Phase:enum = { Idle, Ready }
   type Game:enum = { Title, Playing }
   <phase>: Phase = .Idle
   @a = ""
   @rows = [1, 2] ${CLOSE}
server fn stash() -> string { return MARK }
${vec.extraLogic ?? ""}
${vec.markup}
<p>${OPEN}@a${CLOSE}</p>
</program>
`;
  if (path === "same-file") {
    return { "index.scrml": `<program>\n${decl}\n${body}` };
  }
  return {
    "models.scrml": `${decl}\nexport const SHOWN = "shown-client-value"\n`,
    "index.scrml": `<program>\nimport { MARK, SHOWN } from './models.scrml'\n${body}`,
  };
}

for (const vec of POSITION_MATRIX) {
  for (const path of ["same-file", "cross-file"]) {
    for (const exportKind of ["const", "let"]) {
      const dirName = `cg263-m-${vec.id}-${path}-${exportKind}`;
      const what = vec.binding ? "IS a client binding" : "is NOT a client binding";
      describe(`CONF-CG-263 §8 — ${vec.id} ${what} [${path} / export ${exportKind}]`, () => {
        beforeEach(() => {
          const dir = setupDir(dirName);
          for (const [name, src] of Object.entries(matrixSources(vec, path, exportKind))) {
            writeFileSync(join(dir, name), src);
          }
        });
        afterEach(() => teardownDir(dirName));

        if (!vec.binding) {
          test("§14.8 — the server-only VALUE reaches no .client.js, and no bundle declares it", () => {
            const c = compileEntry(join(TMP_ROOT, dirName, "index.scrml"));
            expect(c.errors).toEqual([]);
            const clients = c.allClient();
            // Guard the guard: a sweep that finds no bundles proves nothing.
            expect(clients.length).toBeGreaterThan(0);
            for (const [fp, js] of clients) {
              expect({ file: fp, leaked: MARK_CANARY.test(js) }).toEqual({ file: fp, leaked: false });
              // Top-level AND `let`-aware: an `export let` leak emits `let MARK = …`.
              expect({ file: fp, decl: declaresTopLevelBinding(js, "MARK") })
                .toEqual({ file: fp, decl: false });
              expect({ file: fp, registered: registersExport(js, "MARK") })
                .toEqual({ file: fp, registered: false });
            }
            // The value IS legitimately present server-side — otherwise this whole
            // case would pass on a compiler that emitted nothing at all.
            const owner = path === "same-file" ? "index.scrml" : "models.scrml";
            expect(MARK_CANARY.test(c.out(owner).serverJs ?? "")).toBe(true);
          });
        } else {
          test("the binding IS declared in the owning bundle and resolves at runtime", () => {
            const c = compileEntry(join(TMP_ROOT, dirName, "index.scrml"));
            expect(c.errors).toEqual([]);
            const owner = path === "same-file" ? "index.scrml" : "models.scrml";
            const ownerJs = c.out(owner)?.clientJs ?? "";
            expect(declaresBindingAs(ownerJs, "MARK", MARK_VALUE)).toBe(true);
            if (path === "cross-file") {
              // Declared but unregistered is still a ReferenceError in the importer.
              expect(registersExport(ownerJs, "MARK")).toBe(true);
              expect(c.out("index.scrml").clientJs)
                .toMatch(/const \{[^}]*\bMARK\b[^}]*\} = _scrml_modules\["models\.client\.js"\]/);
            }
          });

          test("EXECUTING the shipped bundles never throws `MARK is not defined`", () => {
            const c = compileEntry(join(TMP_ROOT, dirName, "index.scrml"));
            const bundles = [];
            // Dependency FIRST, ONE shared global scope, `document` left undefined
            // so the boot IIFE early-returns — the faithful classic-script model.
            if (path === "cross-file") bundles.push(["models.client.js", c.out("models.scrml").clientJs]);
            bundles.push(["index.client.js", c.out("index.scrml").clientJs]);
            const ctx = vm.createContext(runtimeStubs(bundles.map(([, js]) => js)));
            let thrown = null;
            try {
              for (const [name, js] of bundles) vm.runInContext(js, ctx, { filename: name });
            } catch (e) { thrown = e; }
            // SCOPED ON PURPOSE. The stub context above fakes the `_scrml_*`
            // runtime, so an unrelated TypeError out of a stub is the harness's
            // fault, not the compiler's — asserting "does not throw" would make
            // this case fail for reasons that have nothing to do with §14.8. What
            // it must never do is fail to resolve the USER binding, which is the
            // exact shape of the bug: an under-emit is a live
            // `ReferenceError: MARK is not defined` at exit 0.
            const isMarkRefError =
              thrown instanceof ReferenceError && /\bMARK\b.*not defined/.test(thrown.message);
            expect({ marker: dirName, markUnresolved: isMarkRefError, message: isMarkRefError ? thrown.message : "" })
              .toEqual({ marker: dirName, markUnresolved: false, message: "" });
          });
        }
      });
    }
  }
}
