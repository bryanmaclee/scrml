/**
 * mangler-region-fencing.test.js
 *
 * REGION FENCES on the whole-buffer `post-fn-name-mangle` pass (emit-client.ts).
 *
 * The pass is a text rewrite over the ENTIRE assembled client buffer: every user
 * `fn`/`function` name is replaced by its `_scrml_<name>_<N>` encoding wherever it
 * appears in code position. It has no scope model and no JS parser. Three defects
 * measured at S325 (`docs/changes/limb2-mangler-retirement/SCOPING.md`) all reduce
 * to the same shape — a REGION of the buffer that the rewrite must not enter:
 *
 *   1. the assembled RUNTIME slot (`g-embed-runtime-ships-mangled-runtime-identifiers`)
 *   2. an object-literal SHORTHAND property region
 *      (`g-mangler-scope-blind-shorthand-key-rename`)
 *
 * and one that is not a region problem at all:
 *
 *   3. an EMPTY `fnNameMap` key, which turns the name alternation into a
 *      zero-width whole-buffer inserter
 *      (`g-mangler-empty-name-whole-buffer-insertion`) — guarded at map
 *      construction (emit-functions.ts), not in the regex.
 *
 * Every assertion here is VALUE-asserting on real compiled output, and the two
 * defects with a runtime consequence are proved by EXECUTING the emitted text,
 * not by grepping for a marker (S265: "the marker is present" is not evidence).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { emitFunctions } from "../../src/codegen/emit-functions.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { findObjectShorthandRegions } from "../../src/codegen/code-segments.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/mangler-region-fencing");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

const RUNTIME_END_MARKER = "\n// --- end scrml reactive runtime ---";

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

function compile(path, opts = {}) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false, ...opts });
}

/** The compiler-owned runtime region of an `embedRuntime` bundle. */
function runtimeRegion(js) {
  const end = js.indexOf(RUNTIME_END_MARKER);
  expect(end).toBeGreaterThan(-1); // the bundle must actually carry an embedded runtime
  return js.slice(0, end);
}

/** Everything the user's own program contributed, i.e. NOT the runtime. */
function clientBody(js) {
  const end = js.indexOf(RUNTIME_END_MARKER);
  expect(end).toBeGreaterThan(-1);
  return js.slice(end + RUNTIME_END_MARKER.length);
}

/**
 * Run `emitFunctions` over a single synthetic fn-decl carrying `name` and hand
 * back the resulting `fnNameMap`. Used to assert the registration guard at its
 * own locus, across a whole CLASS of names rather than one witnessed instance.
 */
function makeMapFor(name) {
  resetVarCounter();
  const fn = {
    kind: "function-decl",
    name,
    params: [],
    body: [],
    fnKind: "function",
    isServer: false,
    isGenerator: false,
    canFail: false,
    errorType: null,
    route: null,
    method: null,
    span: { file: "/test/app.scrml", start: 10, end: 20, line: 1, col: 1 },
  };
  return emitFunctions({
    filePath: "/test/app.scrml",
    fileAST: { filePath: "/test/app.scrml", nodes: [fn] },
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectedFields: new Set(),
    authMiddleware: null,
    middlewareConfig: null,
    csrfEnabled: false,
    encodingCtx: null,
    mode: "browser",
    testMode: false,
    dbVar: "_scrml_db",
    workerNames: [],
    errors: [],
    registry: new BindingRegistry(),
    derivedNames: new Set(),
  }).fnNameMap;
}

let runtimeCollisionFx, shorthandFx, plainFx, libFx, importerFx, shadowFx, protoFx, residualFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // §1 fixture — a user fn named `log`. The runtime declares
  // `function _scrml_replay(name, log, endIdx)`; `log` there is followed by `,`
  // (inside the mangle's lookahead set) while the body's `log.length` reads are
  // followed by `.` (outside it), so the unfenced pass renamed the PARAMETER and
  // left every use of it behind.
  runtimeCollisionFx = fix("runtime-collision.scrml", `<program>
\${
function log(n) { console.log(n) }
@count = 0
}
<button onclick=\${ log(@count) }>go</button>
</program>
`);

  // §2 fixture — object-literal shorthand whose keys are user fn names. The
  // PROPERTY NAME is part of the object's public shape; renaming it silently
  // turns `inner.get(...)` into `undefined is not a function`.
  shorthandFx = fix("shorthand-keys.scrml", `<program>
\${
function get(u) { return u }
function post(u) { return u }
const api = { get, post }
@out = ""
}
<button onclick=\${ @out = api.get("x") }>go</button>
</program>
`);

  // §3 fixture — a plain program with a normal named fn; the control for
  // "the mangle still does its job".
  plainFx = fix("plain.scrml", `<program>
\${
function greet(n) { return "hi " + n }
@msg = ""
}
<button onclick=\${ @msg = greet("a") }>go</button>
</program>
`);

  // §2d fixture — the S239 adversarial shadowing reproducer. A destructuring
  // pattern binds names that SHADOW two top-level fns, and the call sites in the
  // same scope use those bindings. Fencing the pattern (an earlier revision of
  // this fix) left the bindings dead and the calls mangled — a LOUD TypeError
  // became a SILENT wrong answer. The correct value of `run()` is
  // "src-get1|src-post2"; neither emission produces it, so the only thing this
  // fix can honestly protect is the LOUDNESS.
  shadowFx = fix("shadowed-binding.scrml", `<program>
\${
function get(u) { return "G" + u }
function post(u) { return "P" + u }
function run() {
    const src = { get: (x) => "src-get" + x, post: (x) => "src-post" + x }
    const { get, post } = src
    return get(1) + "|" + post(2)
}
@out = ""
}
<button onclick=\${ @out = run() }>go</button>
</program>
`);

  // §2e fixture — S239 adversarial. `{ __proto__ }` shorthand. ECMA-262 B.3.1:
  // only the `__proto__: value` form sets [[Prototype]]; the shorthand form
  // creates an ordinary own property. Expanding it therefore changes the
  // object's SHAPE, not just a name.
  protoFx = fix("proto-shorthand.scrml", `<program>
\${
function __proto__(u) { return "P" + u }
function get(u) { return "G" + u }
function shape() {
    const o = { __proto__, get }
    return Object.keys(o).length + "|" + (typeof o.call)
}
@out = ""
}
<button onclick=\${ @out = shape() }>go</button>
</program>
`);

  // §2f fixture — the RESIDUAL MAP. Every shorthand shape the fix does NOT
  // reach, in one cleanly-compiling source, so the boundary of the fix is a
  // measured artifact rather than a claim in a report.
  residualFx = fix("residual-shapes.scrml", `<program>
\${
function get(u) { return "G" + u }
function post(u) { return "P" + u }
const base = { z: 1 }
const flag = true
const nested = { api: { get, post } }
const spread = { ...base, get, post }
const mixed = { get, post, n: 1 }
const ternary = flag ? { get, post } : { get, post }
const commented = { get, /* c */ post }
@out = ""
}
<button onclick=\${ @out = "x" }>go</button>
</program>
`);

  // §2 NEGATIVE-DEPENDENCY pair. `buildModuleRegistryFooter` (emit-client.ts:121-134
  // and its call site) reasons EXPLICITLY that the mangle cannot corrupt the
  // cross-file registry footer because its property keys are followed by `:` and
  // therefore sit outside the mangle's lookahead char class. The shorthand region
  // class must not disturb that: the footer's members are `key: value` pairs, not
  // shorthand, and the IMPORTER's `const { … } = _scrml_modules[…]` destructure
  // must stay verbatim too. A green suite does not prove this — it is asserted.
  libFx = fix("registry-lib.scrml", `<program>
\${
export function get(u) { return "GET " + u }
export function post(u) { return "POST " + u }
const bundle = { get, post }
}
<p>lib</p>
</program>
`);
  importerFx = fix("registry-app.scrml", `<program>
\${
import { get, post } from './registry-lib.scrml'
@out = ""
}
<button onclick=\${ @out = get("x") }>go</button>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §1 — g-embed-runtime-ships-mangled-runtime-identifiers
//      The assembled runtime slot is a FENCED REGION.
// ---------------------------------------------------------------------------

describe("§1 the assembled runtime is fenced out of the fn-name mangle", () => {
  test("the fixture compiles clean under embedRuntime", () => {
    const result = compile(runtimeCollisionFx, { embedRuntime: true });
    expect(result.errors).toEqual([]);
  });

  test("the runtime region carries NO encoded user name", () => {
    const js = compile(runtimeCollisionFx, { embedRuntime: true }).outputs.get(runtimeCollisionFx).clientJs;
    const region = runtimeRegion(js);
    // `_scrml_log_<N>` is the encoding of the user's `log`. Pre-fence the runtime
    // region contained it (as `_scrml_replay`'s renamed parameter, among others).
    expect(region).not.toMatch(/_scrml_log_\d+/);
  });

  test("the runtime's own _scrml_replay signature is intact", () => {
    const js = compile(runtimeCollisionFx, { embedRuntime: true }).outputs.get(runtimeCollisionFx).clientJs;
    expect(runtimeRegion(js)).toContain("function _scrml_replay(name, log, endIdx) {");
  });

  test("the user's own call site IS still mangled (the fence narrows nothing it should not)", () => {
    const js = compile(runtimeCollisionFx, { embedRuntime: true }).outputs.get(runtimeCollisionFx).clientJs;
    const body = clientBody(js);
    expect(body).toMatch(/function _scrml_log_\d+\(/);
    expect(body).toMatch(/_scrml_log_\d+\(/);
  });

  test("EXECUTED: _scrml_replay from the shipped bundle runs (pre-fence: ReferenceError on `log`)", () => {
    const js = compile(runtimeCollisionFx, { embedRuntime: true }).outputs.get(runtimeCollisionFx).clientJs;
    const region = runtimeRegion(js);
    // Lift just the runtime's `_scrml_replay` out of the SHIPPED text and run it
    // against stub collaborators. Pre-fence the emitted body reads a free `log`,
    // which is a ReferenceError the moment the function is called.
    const start = region.indexOf("function _scrml_replay(");
    expect(start).toBeGreaterThan(-1);
    const src = region.slice(start, region.indexOf("\n}\n", start) + 3);
    const sets = [];
    const replay = new Function(
      "_scrml_machine_clear_timer",
      "_scrml_reactive_set",
      `${src}; return _scrml_replay;`,
    )(() => {}, (name, value) => sets.push([name, value]));
    replay("m", [{ from: "a", to: "b" }, { from: "b", to: "c" }], undefined);
    expect(sets).toEqual([["m", "c"]]);
  });

  test("DEFAULT mode is unaffected — no embedded runtime, user name still mangled", () => {
    const result = compile(runtimeCollisionFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(runtimeCollisionFx).clientJs;
    expect(js.indexOf(RUNTIME_END_MARKER)).toBe(-1); // runtime shipped separately
    expect(js).toMatch(/function _scrml_log_\d+\(/);
  });

  test("the mangle still reaches the whole client body (control)", () => {
    const js = compile(plainFx, { embedRuntime: true }).outputs.get(plainFx).clientJs;
    expect(clientBody(js)).toMatch(/function _scrml_greet_\d+\(/);
    expect(runtimeRegion(js)).not.toMatch(/_scrml_greet_\d+/);
  });
});

// ---------------------------------------------------------------------------
// §2 — g-mangler-scope-blind-shorthand-key-rename
//      An object-shorthand `{a, b}` is a REGION: each identifier is a property
//      NAME as well as a value reference, and the mangle renamed both halves.
//
//      This defect DOES reproduce on a cleanly-compiling source — the fixture
//      below is one, constructed for this test. (The S325 scoping note found it
//      only in two sources that fail compile upstream; that is a property of the
//      corpus, not of the defect.)
// ---------------------------------------------------------------------------

describe("§2a the brace-group classifier", () => {
  test("an object literal in expression position is recognised", () => {
    for (const src of [
      "const inner = wrapped || {get, post};",
      "return {get, post};",
      "f(a, {get, post});",
      "const x = [{get, post}];",
      "const y = flag ? {get, post} : none;",
    ]) {
      const [region] = findObjectShorthandRegions(src);
      expect(region).toBeDefined();
      expect(region.kind).toBe("object-literal");
      expect(region.names).toEqual(["get", "post"]);
    }
  });

  test("a destructuring pattern is recognised and is NOT an object literal", () => {
    for (const src of [
      "const { get, post } = _scrml_modules[\"lib.client.js\"];",
      "let { get } = x;",
      "var { get, post } = x;",
      "({get, post} = source);",
      "const f = ({get, post}) => get();",
      "function wrap({get, post}) { return get; }",
      "function ({get, post}) { return get; }",
    ]) {
      const [region] = findObjectShorthandRegions(src);
      expect(region).toBeDefined();
      expect(region.kind).toBe("binding-pattern");
    }
  });

  test("RECOGNISED but NOT ACTED ON — a binding pattern keeps today's emission", () => {
    // S239 adversarial finding. Emitting a binding pattern verbatim while the
    // pass still rewrites the uses those bindings SHADOW is a HALF-repair: the
    // bindings go dead and the calls resolve to the module-level function, which
    // converts a LOUD TypeError into a SILENT wrong answer. Honest repair needs
    // a scope model (the mangler-RETIREMENT arc). So the classifier keeps the
    // KNOWLEDGE and the consumer keeps its hands off. Asserted end-to-end below
    // in §2d; asserted here as the contract that only `object-literal` is acted
    // on.
    const [region] = findObjectShorthandRegions("const { get, post } = src;");
    expect(region.kind).toBe("binding-pattern");
    expect(region.kind).not.toBe("object-literal");
  });

  test("an undecided group stays UNKNOWN, so the caller changes nothing", () => {
    // `;`-led and `)`-led braces are blocks. Leaving them unclassified is what
    // keeps this fence from removing coverage it has not measured.
    for (const src of ["if (x) {get, post}\n", "doThing();\n{get, post}\n"]) {
      const [region] = findObjectShorthandRegions(src);
      expect(region).toBeDefined();
      expect(region.kind).toBe("unknown");
    }
  });

  test("a `key: value` group is NOT a shorthand region at all", () => {
    // This is the module-registry footer's shape and the reason it was already
    // safe. It must not become a region now.
    expect(
      findObjectShorthandRegions('_scrml_modules["k"] = { get: _scrml_get_2, post: _scrml_post_3 };'),
    ).toEqual([]);
    expect(findObjectShorthandRegions('_scrml_modules["k"] = {  };')).toEqual([]);
  });

  test("a block whose content is a keyword is not a region", () => {
    expect(findObjectShorthandRegions("function f() { return }")).toEqual([]);
  });
});

describe("§2b object shorthand keeps its KEY and gains the encoded VALUE", () => {
  test("the fixture compiles clean", () => {
    const result = compile(shorthandFx);
    expect(result.errors).toEqual([]);
  });

  test("shorthand `{ get, post }` expands to `{ get: <encoded>, post: <encoded> }`", () => {
    const js = compile(shorthandFx).outputs.get(shorthandFx).clientJs;
    // The KEY is the object's public shape and must survive verbatim.
    expect(js).toMatch(/\{\s*get:\s*_scrml_get_\d+,\s*post:\s*_scrml_post_\d+\s*\}/);
    // The pre-fix emission renamed the KEY, which is what made `api.get`
    // undefined at runtime.
    expect(js).not.toMatch(/\{\s*_scrml_get_\d+\s*,/);
  });

  test("EXECUTED: the emitted object answers to its SOURCE property names", () => {
    const js = compile(shorthandFx).outputs.get(shorthandFx).clientJs;
    const m = js.match(/const api = (\{[^}]*\})/);
    expect(m).not.toBeNull();
    const probe = new Function(
      `function _scrml_get_1(u) { return "got:" + u }
       function _scrml_post_2(u) { return "posted:" + u }
       const api = ${m[1].replace(/_scrml_get_\d+/, "_scrml_get_1").replace(/_scrml_post_\d+/, "_scrml_post_2")};
       return [typeof api.get, typeof api.post, api.get("x")];`,
    );
    expect(probe()).toEqual(["function", "function", "got:x"]);
  });
});

describe("§2c NEGATIVE DEPENDENCY — the cross-file module registry footer", () => {
  test("the footer stays `{ publicName: emittedName }` and the importer's destructure stays verbatim", () => {
    const result = compileScrml({
      inputFiles: [importerFx],
      outputDir: FIXTURE_OUTPUT,
      write: false,
    });
    expect(result.errors).toEqual([]);
    const libOut = [...result.outputs.entries()].find(([p]) => p.endsWith("registry-lib.scrml"));
    const appOut = [...result.outputs.entries()].find(([p]) => p.endsWith("registry-app.scrml"));
    expect(libOut).toBeDefined();
    expect(appOut).toBeDefined();

    // The footer's members are `key: value` — outside the shorthand region class
    // AND outside the mangle lookahead, exactly as emit-client.ts:131-134 claims.
    expect(libOut[1].clientJs).toMatch(
      /_scrml_modules\["[^"]+"\] = \{ get: _scrml_get_\d+, post: _scrml_post_\d+ \};/,
    );
    // The IMPORTER destructures by PUBLIC name. It is a binding pattern, so the
    // shorthand handling leaves it entirely alone — and, because `get`/`post`
    // are IMPORTED here rather than declared, they are not in this file's
    // fnNameMap either, so it reads exactly the keys the footer wrote.
    expect(appOut[1].clientJs).toMatch(/const \{ get, post \} = _scrml_modules\["[^"]+"\];/);
  });

  test("§2d a SHADOWING destructure keeps its LOUD failure (S239 half-repair guard)", () => {
    // The shorthand handling must not touch a binding pattern. If it did, the
    // pattern would bind `get`/`post` to `src`'s members while the call sites in
    // the same scope stayed mangled — dead bindings, calls resolving to the
    // module-level fns, and a wrong answer with NO error. Neither emission is
    // correct (the right answer is "src-get1|src-post2"), so the property this
    // guards is that the failure stays OBSERVABLE.
    const result = compile(shadowFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(shadowFx).clientJs;
    // The pattern is emitted with the SAME rewrite the pass has always applied.
    expect(js).toMatch(/const \{ _scrml_get_\d+, _scrml_post_\d+ \} = src;/);
    expect(js).not.toMatch(/const \{ get, post \} = src;/);

    // EXECUTED: lift the three emitted fns out of the shipped text and run.
    const lift = (prefix) => {
      const m = js.match(new RegExp(`^function ${prefix}\\d+\\([^)]*\\) \\{`, "m"));
      expect(m).not.toBeNull();
      return js.slice(m.index, js.indexOf("\n}\n", m.index) + 3);
    };
    const src = ["_scrml_get_", "_scrml_post_", "_scrml_run_"].map(lift).join("\n");
    const runName = js.match(/function (_scrml_run_\d+)\(/)[1];
    const run = new Function(`${src}\n; return ${runName};`)();
    // LOUD, not a silent "G1|P2".
    expect(() => run()).toThrow(TypeError);
  });

  test("§2e `{ __proto__ }` is NOT expanded — B.3.1 shape preservation (S239)", () => {
    // ECMA-262 B.3.1: `{ __proto__: v }` SETS [[Prototype]]; `{ __proto__ }`
    // creates an ordinary own property. Expanding the shorthand therefore
    // changes the object's SHAPE. Measured before the guard: own keys 2 -> 1 and
    // `typeof o.call` "undefined" -> "function" (the object began inheriting
    // from the function it was handed).
    const result = compile(protoFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(protoFx).clientJs;
    expect(js).not.toMatch(/__proto__:/);
    // The WHOLE region is skipped, not just the one name — a bare `__proto__`
    // shorthand beside expanded siblings would be a free reference, and that is
    // engine-dependent (node binds the global's prototype, bun throws).
    expect(js).toMatch(/const o = \{_scrml___proto___\d+, _scrml_get_\d+\};/);

    // EXECUTED: the emitted object must still have TWO own keys and must NOT
    // have inherited anything.
    const lift = (prefix) => {
      const m = js.match(new RegExp(`^function ${prefix}\\d+\\([^)]*\\) \\{`, "m"));
      expect(m).not.toBeNull();
      return js.slice(m.index, js.indexOf("\n}\n", m.index) + 3);
    };
    const src = ["_scrml___proto___", "_scrml_get_", "_scrml_shape_"].map(lift).join("\n");
    const shapeName = js.match(/function (_scrml_shape_\d+)\(/)[1];
    const shape = new Function(`${src}\n; return ${shapeName};`)();
    expect(shape()).toBe("2|undefined");
  });

  test("§2f RESIDUAL MAP — the shapes this fix does NOT reach (S239 F5, measured)", () => {
    // A partial fix that names its residual is fine; one that implies full
    // coverage is not. Every row below was MEASURED against base 13edcfbf, and
    // two of the five shapes relayed as residual turned out NOT to be.
    const result = compile(residualFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(residualFx).clientJs;

    // STILL BROKEN — nested: the inner group's left context is `:`, which the
    // classifier deliberately does not admit (a `label:`/`case x:` block).
    expect(js).toMatch(/const nested = \{api: \{_scrml_get_\d+, _scrml_post_\d+\}\};/);
    // STILL BROKEN — spread: `{...base, get, post}` is not an all-bare-identifier
    // group, so it is not a region at all.
    expect(js).toMatch(/const spread = \{\.\.\.base, _scrml_get_\d+, _scrml_post_\d+\};/);
    // STILL BROKEN — mixed: same reason (`n: 1` breaks the all-identifier shape).
    expect(js).toMatch(/const mixed = \{_scrml_get_\d+, _scrml_post_\d+, n: 1\};/);
    // ASYMMETRIC — a ternary's CONSEQUENT is fixed (left context `?`), its
    // ALTERNATE is not (left context `:`, excluded). Worth stating explicitly:
    // the same source expression compiles correctly on one branch and
    // incorrectly on the other.
    expect(js).toMatch(
      /const ternary = flag \? \{get: _scrml_get_\d+, post: _scrml_post_\d+\} : \{_scrml_get_\d+, _scrml_post_\d+\};/,
    );
    // NOT A RESIDUAL after all — a source-level comment inside the object does
    // NOT survive into the emitted buffer, so the group is contiguous and IS
    // fixed. The comment-split hazard is a property of the mechanism, not an
    // observable shape reachable from scrml source.
    expect(js).toMatch(/const commented = \{get: _scrml_get_\d+, post: _scrml_post_\d+\};/);
  });

  test("§2f a group with NO left context stays unknown (interpolation-leading)", () => {
    // `rewriteCodeSegments` recurses into a template-literal `${…}` interior as a
    // fresh string, so a group at interior offset 0 has nothing to its left and
    // cannot be classified. Left at pre-fix behaviour by design.
    expect(findObjectShorthandRegions("{get, post}")[0].kind).toBe("unknown");
    expect(findObjectShorthandRegions("  {get, post}")[0].kind).toBe("unknown");
    expect(findObjectShorthandRegions("x = {get, post}")[0].kind).toBe("object-literal");
  });

  test("the lib's own shorthand object is the ONLY thing that changed", () => {
    const js = [...compileScrml({ inputFiles: [importerFx], outputDir: FIXTURE_OUTPUT, write: false })
      .outputs.entries()].find(([p]) => p.endsWith("registry-lib.scrml"))[1].clientJs;
    expect(js).toMatch(/const bundle = \{get: _scrml_get_\d+, post: _scrml_post_\d+\};/);
  });
});

// ---------------------------------------------------------------------------
// §3 — g-mangler-empty-name-whole-buffer-insertion
//      A nameless fn must never reach fnNameMap; an empty alternation branch
//      matches ZERO-WIDTH at every word boundary in the buffer.
// ---------------------------------------------------------------------------

describe("§3 an empty fnNameMap key can never arm the alternation", () => {
  test("THE HAZARD: an empty alternation branch IS a whole-buffer inserter", () => {
    // This is the mechanism the guard exists to prevent, reproduced against the
    // mangle's own regex verbatim. It can never go vacuous: it does not depend
    // on any corpus source still carrying the defect.
    const names = ["greet", ""].sort((a, b) => b.length - a.length);
    const alternation = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const combined = new RegExp(
      `(?<![A-Za-z0-9_$)\\]]\\s*\\.\\s*)\\b(${alternation})\\b(?=\\s*[(;,}\\]\\n)]|$)`,
      "g",
    );
    const buffer = 'const a = 1;\nrender(a);\nconst b = [x, y];\n';
    let injections = 0;
    buffer.replace(combined, (m, n) => {
      if (n === "") injections++;
      return m;
    });
    expect(injections).toBeGreaterThan(0); // zero-width, at every qualifying boundary
  });

  test("THE OTHER HAZARD: an empty key makes exprUsesServerFn a WILDCARD (S239 F3)", () => {
    // The mangle is not the only consumer harmed. emit-event-wiring.ts's
    // buildServerFnNames puts the raw KEY into serverFnNames, and
    // exprUsesServerFn compiles each as `(?<![.\w$])<name>\s*\(`. With an empty
    // name that is a wildcard, so arbitrary expressions read as containing a
    // server call. This is the TRUE justification for the guard — the earlier
    // "the entry is inexpressible / nothing could look it up" rationale was
    // wrong, and a false rationale in a comment is what the next reader reasons
    // from.
    const wildcard = new RegExp(`(?<![.\\w$])${""}\\s*\\(`, "");
    expect(wildcard.test("@a + (b * 2)")).toBe(true);
    expect(wildcard.test("foo (1)")).toBe(true);
    // …whereas a real name is selective.
    const real = new RegExp(`(?<![.\\w$])loadRows\\s*\\(`, "");
    expect(real.test("@a + (b * 2)")).toBe(false);
    expect(real.test("loadRows()")).toBe(true);
  });

  test("THE CLASS, not the instance: any non-identifier key is refused", () => {
    // The guard tests IDENTIFIER SHAPE, not non-emptiness, so it closes the
    // class rather than the one witnessed instance.
    //
    // MEASURED, because the shapes that arm the alternation are not the obvious
    // ones: an empty key fires 13 times over three short buffers, a
    // WHITESPACE-ONLY key fires ZERO times (`\b( )\b` needs word chars on both
    // sides, but the lookahead then demands punctuation immediately after — a
    // contradiction), and a key with an INTERIOR space fires twice. The guard
    // does not depend on which of those happens to be hazardous under today's
    // lookaround, which is the point: that lookaround has been patched five
    // times.
    const mk = (name) =>
      new RegExp(
        `(?<![A-Za-z0-9_$)\\]]\\s*\\.\\s*)\\b(${name})\\b(?=\\s*[(;,}\\]\\n)]|$)`,
        "g",
      );
    expect("a b, c d;\nfoo(a b);\n".replace(mk("a b"), "X")).not.toBe("a b, c d;\nfoo(a b);\n");

    for (const bad of ["", " ", "a b", "1x", "a-b", "a.b", "a(", "\n"]) {
      expect(makeMapFor(bad).has(bad)).toBe(false);
    }
    for (const good of ["a", "_x", "$y", "Abc123", "__proto__"]) {
      expect(makeMapFor(good).has(good)).toBe(true);
    }
  });

  test("THE GUARD: a nameless fn-decl never enters fnNameMap", () => {
    // Direct assertion on the map emitFunctions returns, so the guard is proved
    // at its own locus and not only through a corpus source that may be fixed
    // upstream later.
    resetVarCounter();
    const namelessFn = {
      kind: "function-decl",
      name: "",
      params: [],
      body: [],
      fnKind: "function",
      isServer: false,
      isGenerator: false,
      canFail: false,
      errorType: null,
      route: null,
      method: null,
      span: { file: "/test/app.scrml", start: 10, end: 20, line: 1, col: 1 },
    };
    const namedFn = { ...namelessFn, name: "greet", span: { ...namelessFn.span, start: 30, end: 40 } };
    const { fnNameMap } = emitFunctions({
      filePath: "/test/app.scrml",
      fileAST: { filePath: "/test/app.scrml", nodes: [namelessFn, namedFn] },
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectedFields: new Set(),
      authMiddleware: null,
      middlewareConfig: null,
      csrfEnabled: false,
      encodingCtx: null,
      mode: "browser",
      testMode: false,
      dbVar: "_scrml_db",
      workerNames: [],
      errors: [],
      registry: new BindingRegistry(),
      derivedNames: new Set(),
    });
    expect(fnNameMap.has("")).toBe(false);
    // …and the guard is NARROW: the well-formed sibling is still registered.
    expect(fnNameMap.get("greet")).toMatch(/^_scrml_greet_\d+$/);
  });

  test("stdlib/cron no longer carries the zero-width injection signature", () => {
    // stdlib/cron/index.scrml is the ONE corpus source (of 1878) whose
    // fnNameMap carried an empty key: 781 zero-width injections into a single
    // file, 33.5% of every mangle rewrite in the corpus. Its own upstream
    // defect is unrelated and out of scope; what this asserts is that the
    // mangle no longer AMPLIFIES it into a whole-buffer corruption.
    // `_scrml_v_1_scrml_v_1` — an encoded name immediately followed by itself —
    // is the injection's signature, and it appeared in the error text itself.
    const src = join(import.meta.dir, "../../../stdlib/cron/index.scrml");
    const result = compileScrml({ inputFiles: [src], outputDir: FIXTURE_OUTPUT, write: false });
    const messages = [
      ...result.errors.map((e) => e.message ?? String(e)),
      ...(result.warnings ?? []).map((w) => w.message ?? String(w)),
    ].join("\n");
    expect(messages).not.toMatch(/_scrml_v_\d+_scrml_v_\d+/);
    const out = result.outputs?.get(src);
    if (out?.clientJs) expect(out.clientJs).not.toMatch(/_scrml_v_\d+_scrml_v_\d+/);
  });
});
