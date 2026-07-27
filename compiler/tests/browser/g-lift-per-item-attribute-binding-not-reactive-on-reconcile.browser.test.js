/**
 * g-lift-per-item-attribute-binding-not-reactive-on-reconcile (MED, S293) — runtime gate.
 *
 * In a Tier-0 reconciled `${ for (let e of @cell) { …lift… } }`, a per-item ATTRIBUTE
 * binding that reads the item was set ONCE at create time (no live-keyed effect), so it
 * stayed STALE when @cell is REPLACED and the outer reconcile reuses the DOM node — while
 * the sibling TEXT / class: bindings (and the <each> Tier-1 path) update correctly.
 *
 * The template-STRING attr form (`data-x="pre-${e.name}"`) already wrapped in a per-item
 * effect; the `${expr}` form (`title=${e.name}`) and the call form (`data-y=${fn(e.name)}`)
 * did not. This brings them to parity with the text/class: paths and the <each> reference.
 *
 * Executed-DOM — codegen inspection cannot see the stale runtime read. Models
 * g-item-derived-local-stale-in-per-item-effect-paths.browser.test.js.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const tmpRoot = resolve("/tmp", "scrml-gap-lift-attr-reactive");
function compileOut(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  rmSync(tmpDir, { recursive: true, force: true });
  return { errors: result.errors ?? [], html, clientJs, runtimeJs };
}

describe("gap: lift per-item attribute reactive on REPLACE", () => {
  beforeEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} GlobalRegistrator.register(); });
  afterEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileOut(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__scrml_set__ = _scrml_reactive_set;\nglobalThis.__scrml_get__ = _scrml_reactive_get;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__scrml_set__(n, v),
      titles: () => [...document.querySelectorAll("#root .row")].map((n) => n.getAttribute("title")),
      dataY: () => [...document.querySelectorAll("#root .row")].map((n) => n.getAttribute("data-y")),
    };
  }

  const A = [{ id: "a", name: "mario" }, { id: "b", name: "luigi" }];
  const B = [{ id: "a", name: "drag" }, { id: "b", name: "drop" }];

  // expr form: title=${e.name}
  const SRC_EXPR = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    lift <div class="row" title=\${e.name}>x</div>;
  } }
</div>
</program>
`;
  test("expr-form attr title=${e.name} updates on same-key REPLACE", () => {
    const app = mount(SRC_EXPR, "expr");
    app.set("rows", clone(A));
    expect(app.titles()).toEqual(["mario", "luigi"]);
    app.set("rows", clone(B));
    expect(app.titles()).toEqual(["drag", "drop"]); // was STALE pre-fix
  });

  // call form: data-y=${up(e.name)}
  const SRC_CALL = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
\${ fn up(s: string) { return s } }
<div id="root">
  \${ for (let e of @rows) {
    lift <div class="row" data-y=\${up(e.name)}>x</div>;
  } }
</div>
</program>
`;
  test("call-form attr data-y=${up(e.name)} updates on same-key REPLACE", () => {
    const app = mount(SRC_CALL, "call");
    app.set("rows", clone(A));
    expect(app.dataY()).toEqual(["mario", "luigi"]);
    app.set("rows", clone(B));
    expect(app.dataY()).toEqual(["drag", "drop"]); // was STALE pre-fix
  });

  // item-derived-local form: title=${name} where let {name}=e (exercises the S293 replay)
  const SRC_LOCAL = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    let { name } = e;
    lift <div class="row" title=\${name}>x</div>;
  } }
</div>
</program>
`;
  test("attr over item-derived local title=${name} updates on same-key REPLACE", () => {
    const app = mount(SRC_LOCAL, "local");
    app.set("rows", clone(A));
    expect(app.titles()).toEqual(["mario", "luigi"]);
    app.set("rows", clone(B));
    expect(app.titles()).toEqual(["drag", "drop"]); // was STALE pre-fix
  });

  // control: template-string form was ALREADY reactive — must stay green
  const SRC_TPL = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    lift <div class="row" title="v-\${e.name}">x</div>;
  } }
</div>
</program>
`;
  test("control: template-string attr title=\"v-${e.name}\" stays reactive", () => {
    const app = mount(SRC_TPL, "tpl");
    app.set("rows", clone(A));
    expect(app.titles()).toEqual(["v-mario", "v-luigi"]);
    app.set("rows", clone(B));
    expect(app.titles()).toEqual(["v-drag", "v-drop"]);
  });
});
