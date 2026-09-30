/**
 * request-deps-attr-s444.test.js — §6.7.7 `<request deps=[…]>` is honored in BOTH forms.
 *
 * g-request-deps-attr-ignored-both-forms (S444, HIGH): the attribute parser delivers
 * `deps=[@q, @ver]` as `{kind:"expr", raw, refs, exprNode:{kind:"array", elements:[ident]}}`,
 * but the two readers (emit-reactive-wiring `emitRequestNode` for `url=`, and
 * reactive-deps `collectRequestBodyCells` for the body form) accepted only a
 * `kind:"array"` value or a string `.value` — both returned `[]`:
 *   - `url=` form → one-shot fetch; a listed dep changing never re-fetched;
 *   - body form   → fell back to INFERRED deps, dropping the author's list, and an
 *                   explicit `deps=[]` could not suppress inference.
 *
 * SPEC §6.7.7: "When present, `deps` overrides inference." · Re-execution: "Any
 * `@variable` in `deps=` changes" · Example 2 `deps=[]` = "Fetch on mount only".
 *
 * Coverage:
 *   §A reader  — readRequestDepsAttr over the real parsed attribute shape.
 *   §B emit    — the re-fire effect's deps list for url= / body / deps=[] / explicit-subset.
 *   §C runtime — mount + stubbed fetch: a listed dep change re-fetches; an unlisted
 *                inferred read does NOT (explicit overrides); deps=[] is mount-only;
 *                a settle does not re-trigger the effect (no refetch loop).
 *
 * The refetch loop (found while building §C): the re-fire effect called the fetch fn
 * TRACKED, and the fetch fn's synchronous prologue reads `<state>.data`, so the effect
 * subscribed to its own result and re-fired on every settle. The effect now runs the
 * fetch through `_scrml_untracked`. The stub caps at 20 calls so a regression fails
 * instead of hanging.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { readRequestDepsAttr, analyzeRequestDepsAttr } from "../../src/codegen/reactive-deps.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-request-deps-s444");

function compile(src, baseName) {
  const tmpDir = resolve(tmpRoot, `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: outDir });
    const out = result.outputs.get(tmpInput);
    return { errors: result.errors ?? [], clientJs: out ? out.clientJs : "" };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function requestNode(src) {
  const bs = splitBlocks("/t/app.scrml", src);
  const { ast } = buildAST(bs);
  let found = null;
  const walk = (n) => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.kind === "markup" && n.tag === "request") { found = n; return; }
    for (const k of Object.keys(n)) if (k !== "span" && k !== "parent") walk(n[k]);
  };
  walk(ast);
  return found;
}

// url= form — the SPEC example shape `deps=[@page]`.
const URL_SRC = `<program>
<page> = 1
<request id="rows" url="/api/rows" deps=[@page]></>
<p id="l">\${<#rows>.loading}</p>
<button id="next" onclick=\${@page = @page + 1}>next</button>
</program>
`;

// url= form without deps — one-shot (control).
const URL_NODEPS_SRC = `<program>
<request id="rows" url="/api/rows"></>
<p id="l">\${<#rows>.loading}</p>
</program>
`;

// Body form: the body reads @userId, but the author lists ONLY @ver.
function bodySrc(depsAttr) {
  return `<program db="./app.db">
\${
    type User:struct = { id: number, name: string }
    <userId> = 1
    <ver> = 0
    <userData> : User | not = not
    function loadUser(id: number) : User | not {
        rows = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}
        return rows[0]
    }
}
<page>
    <request id="userReq"${depsAttr}>
        \${ @userData = loadUser(@userId) }
    </>
    <p id="loading">\${<#userReq>.loading}</>
    <p id="ver">\${@ver}</>
    <p id="who" if=\${<#userReq>.data}>\${@userData?.name}</>
</page>
</program>
`;
}

// ---------------------------------------------------------------------------
// §A — the shared reader
// ---------------------------------------------------------------------------

describe("§A: readRequestDepsAttr reads the parsed kind:expr attribute", () => {
  test("deps=[@q, @ver] → [q, ver]", () => {
    const n = requestNode(`<program>\${ <q> = "" <ver> = 0 }<request id="h" url="/x" deps=[@q, @ver]></></program>`);
    expect(n).toBeTruthy();
    expect(readRequestDepsAttr(n)).toEqual(["q", "ver"]);
  });

  test("deps=[] → [] (present-but-empty, NOT absent)", () => {
    const n = requestNode(`<program><request id="h" url="/x" deps=[]></></program>`);
    expect(readRequestDepsAttr(n)).toEqual([]);
  });

  test("no deps attribute → null (caller infers)", () => {
    const n = requestNode(`<program><request id="h" url="/x"></></program>`);
    expect(readRequestDepsAttr(n)).toBe(null);
  });

  test("legacy array-kind + string shapes still read", () => {
    expect(readRequestDepsAttr({ attrs: [{ name: "deps", value: { kind: "array", elements: [{ kind: "variable-ref", name: "@a" }] } }] })).toEqual(["a"]);
    expect(readRequestDepsAttr({ attrs: [{ name: "deps", value: { value: "[@a, @b]" } }] })).toEqual(["a", "b"]);
  });

  test("duplicates collapse, order kept", () => {
    const n = requestNode(`<program>\${ <a> = 0 <b> = 0 }<request id="h" url="/x" deps=[@b, @a, @b]></></program>`);
    expect(readRequestDepsAttr(n)).toEqual(["b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// §B — emitted re-fire effect
// ---------------------------------------------------------------------------

describe("§B: emitted deps effect", () => {
  test("url= deps=[@page] → an effect over page (was: bare one-shot call)", () => {
    const { errors, clientJs } = compile(URL_SRC, "url-deps");
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toEqual([]);
    expect(clientJs).toMatch(/_scrml_effect\(function\(\) \{\s*var _d = \[_scrml_cs_reactive_get\("page"\)\];\s*if \(_scrml_request_rows_mounted\) _scrml_untracked\(_scrml_request_rows_fetch\);\s*\}\);/);
    expect(clientJs).not.toMatch(/\n_scrml_request_rows_fetch\(\);/);
  });

  test("url= without deps stays one-shot", () => {
    const { clientJs } = compile(URL_NODEPS_SRC, "url-nodeps");
    expect(clientJs).toMatch(/\n_scrml_request_rows_fetch\(\);/);
    expect(clientJs).not.toContain("var _d = [");
  });

  test("body form deps=[@ver] → the effect lists ONLY ver (explicit overrides inferred @userId)", () => {
    const { errors, clientJs } = compile(bodySrc(" deps=[@ver]"), "body-deps");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('var _scrml_deps = [_scrml_cs_reactive_get("ver")];');
    expect(clientJs).not.toContain('var _scrml_deps = [_scrml_cs_reactive_get("userId")');
  });

  test("body form deps=[@userId, @ver] → both, in order", () => {
    const { clientJs } = compile(bodySrc(" deps=[@userId, @ver]"), "body-deps2");
    expect(clientJs).toContain('var _scrml_deps = [_scrml_cs_reactive_get("userId"), _scrml_cs_reactive_get("ver")];');
  });

  test("body form deps=[] → mount-only bare fetch, NO effect (inference suppressed)", () => {
    const { clientJs } = compile(bodySrc(" deps=[]"), "body-deps-empty");
    expect(clientJs).not.toContain("var _scrml_deps = [");
    expect(clientJs).toMatch(/_scrml_register_cleanup\(function\(\) \{ _scrml_request_userReq_mounted = false; \}\);\s*\n_scrml_request_userReq_fetch\(\);/);
  });

  test("body form with NO deps attr still infers (control)", () => {
    const { clientJs } = compile(bodySrc(""), "body-infer");
    expect(clientJs).toContain('var _scrml_deps = [_scrml_cs_reactive_get("userId")];');
  });
});

// ---------------------------------------------------------------------------
// §C — runtime
// ---------------------------------------------------------------------------

beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});
afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
});

const tick = () => new Promise((res) => setTimeout(res, 0));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

function mount(src, baseName, stateVar) {
  const tmpDir = resolve(tmpRoot, `m-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  const calls = [];
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
    const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    const fetchStub = async (url, init) => {
      calls.push({ url, body: init && init.body });
      if (calls.length > 20) return new Promise(() => {});
      return { ok: true, status: 200, json: async () => ({ id: calls.length, name: "n" + calls.length }) };
    };
    const exec = new Function(
      "window", "document", "fetch",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `if (typeof _scrml_run_dom_ready === "function") { _scrml_run_dom_ready(); }\n` +
      `globalThis.__req__ = ${stateVar};\n` +
      `globalThis.__get__ = _scrml_reactive_get;\n` +
      `globalThis.__set__ = _scrml_reactive_set;\n`),
    );
    exec(window, document, fetchStub);
    return { errors: result.errors ?? [], req: globalThis.__req__, get: globalThis.__get__, set: globalThis.__set__, calls };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("§C: runtime re-execution", () => {
  test("url= deps=[@page]: mount fetches once, a settle does not loop, a page change re-fetches", async () => {
    const { req, set, calls } = mount(URL_SRC, "rt-url", "_scrml_request_rows");
    await settle();
    expect(calls.length).toBe(1);
    expect(req.loading).toBe(false);
    set("page", 2);
    await settle();
    expect(calls.length).toBe(2);
    expect(req.loading).toBe(false);
  });

  test("body deps=[@ver]: an @ver change re-fetches; an @userId change (inferred-only read) does NOT", async () => {
    const { req, set, calls } = mount(bodySrc(" deps=[@ver]"), "rt-body", "_scrml_request_userReq");
    await settle();
    expect(calls.length).toBe(1);
    set("userId", 2);
    await settle();
    expect(calls.length).toBe(1);
    set("ver", 1);
    await settle();
    expect(calls.length).toBe(2);
    expect(req.loading).toBe(false);
  });

  test("body with INFERRED deps: a settle does not loop; the inferred @userId re-fetches", async () => {
    // Pre-S444 every dep-driven request re-fired on its own settle: the effect ran the
    // fetch fn TRACKED, and its prologue reads `<state>.data` — calls ran away to the cap.
    const { req, set, calls } = mount(bodySrc(""), "rt-body-infer", "_scrml_request_userReq");
    await settle();
    expect(calls.length).toBe(1);
    set("userId", 3);
    await settle();
    expect(calls.length).toBe(2);
    expect(req.loading).toBe(false);
    expect(req.data).toEqual({ id: 2, name: "n2" });
  });

  test("body deps=[]: mount-only — neither the body read nor any cell re-fetches", async () => {
    const { set, calls } = mount(bodySrc(" deps=[]"), "rt-body-empty", "_scrml_request_userReq");
    await settle();
    expect(calls.length).toBe(1);
    set("userId", 5);
    set("ver", 5);
    await settle();
    expect(calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §D — E-LIFECYCLE-022 (S444 review fix round). An explicit deps= overrides
// inference, so an entry the reader cannot use must be REFUSED, never skipped —
// skipping turned `deps=[@u.id]` into a silent mount-only request.
// ---------------------------------------------------------------------------

function lifecycle022(src, name) {
  const { errors } = compile(src, name);
  return errors.filter((e) => e.code === "E-LIFECYCLE-022");
}

const cellsDecl = `<n> = 1\n<u> = { id: 1 }\n`;

describe("§D: E-LIFECYCLE-022 on a deps= entry that is not a bare @identifier", () => {
  test("member access @u.id (url= form) → 022 naming the entry and the cell fix", () => {
    const errs = lifecycle022(`<program>\n${cellsDecl}<request id="r" url="/x" deps=[@u.id]></>\n<p>\${<#r>.loading}\${@u.id}</p>\n</program>\n`, "e22-member");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("`@u.id`");
    expect(errs[0].message).toContain("deps=[@u]");
  });

  test("member access in the BODY form → 022 (was: silent mount-only)", () => {
    const errs = lifecycle022(bodySrc(" deps=[@userData.id]"), "e22-body-member");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("deps=[@userData]");
  });

  test("a name without the sigil and a literal → one 022 each", () => {
    const src = `<program>\n${cellsDecl}<request id="a" url="/x" deps=[n]></>\n<request id="b" url="/x" deps=[@n, 3]></>\n<p>\${<#a>.loading}\${<#b>.loading}\${@n}\${@u.id}</p>\n</program>\n`;
    const errs = lifecycle022(src, "e22-shapes");
    expect(errs.map((e) => e.message.match(/entry `([^`]*)`/)?.[1])).toEqual(["n", "3"]);
    expect(errs[0].message).toContain("`@n`");
  });

  test("a value that is not a [ ] list (deps=@n) → 022 suggesting deps=[@n]", () => {
    const errs = lifecycle022(`<program>\n${cellsDecl}<request id="r" url="/x" deps=@n></>\n<p>\${<#r>.loading}\${@n}\${@u.id}</p>\n</program>\n`, "e22-notlist");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("deps=[@n]");
  });

  test("valid lists fire nothing: deps=[@n, @u], deps=[]", () => {
    expect(lifecycle022(`<program>\n${cellsDecl}<request id="r" url="/x" deps=[@n, @u]></>\n<p>\${<#r>.loading}\${@n}\${@u.id}</p>\n</program>\n`, "e22-ok")).toEqual([]);
    expect(lifecycle022(bodySrc(" deps=[]"), "e22-ok-empty")).toEqual([]);
  });

  test("the analyzer never lists an invalid entry as a dep", () => {
    const n = requestNode(`<program>\${ <u> = { id: 1 } <n> = 1 }<request id="h" url="/x" deps=[@n, @u.id]></></program>`);
    const a = analyzeRequestDepsAttr(n);
    expect(a.names).toEqual(["n"]);
    expect(a.invalid).toEqual(["@u.id"]);
    expect(a.notList).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §E — a DERIVED dep re-fires once per upstream change (S444 review fix round).
// ---------------------------------------------------------------------------

const DERIVED_URL_SRC = `<program>
<q> = "a"
const <qq> = @q + "!"
<request id="rows" url="/api/rows" deps=[@qq]></>
<p id="l">\${<#rows>.loading} \${@qq}</p>
</program>
`;

const DERIVED_BODY_SRC = `<program db="./app.db">
\${
    type User:struct = { id: number, name: string }
    <q> = 1
    const <qq> = @q + 1
    <userData> : User | not = not
    function loadUser(id: number) : User | not {
        rows = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}
        return rows[0]
    }
}
<page>
    <request id="userReq">
        \${ @userData = loadUser(@qq) }
    </>
    <p>\${<#userReq>.loading}</>
</page>
</program>
`;

describe("§E: derived deps", () => {
  test("emission: a derived dep settles untracked, then reads through the derived getter", () => {
    const { clientJs } = compile(DERIVED_URL_SRC, "derived-emit");
    expect(clientJs).toContain('_scrml_untracked(function() { _scrml_cs_derived_get("qq"); });');
    expect(clientJs).toContain('var _d = [_scrml_cs_derived_get("qq")];');
  });

  for (const [label, src, stateVar] of [
    ["url= deps=[@qq]", DERIVED_URL_SRC, "_scrml_request_rows"],
    ["body form, inferred @qq", DERIVED_BODY_SRC, "_scrml_request_userReq"],
  ]) {
    test(`runtime (${label}): three upstream writes → exactly three re-fetches (was +2/+1/+2)`, async () => {
      const { set, get, calls } = mount(src, "rt-derived", stateVar);
      await settle();
      expect(calls.length).toBe(1);
      for (let i = 1; i <= 3; i++) {
        set("q", typeof get("q") === "number" ? get("q") + 1 : get("q") + "b");
        await settle();
        expect(calls.length).toBe(1 + i);
      }
    });
  }
});
