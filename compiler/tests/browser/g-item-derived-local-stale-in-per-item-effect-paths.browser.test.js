/**
 * g-item-derived-local-stale-in-per-item-effect-paths (MED, S288→S293) — runtime gate.
 *
 * SPLIT OFF from g-nested-for-lift-no-reconcile-on-cell-replace. The S288 fix made
 * the inner-list RECONCILE render path re-resolve item-derived LOCAL aliases
 * (`let {name}=e`, `let nm=e.field`) on REPLACE. But the OTHER per-item effect
 * wrappers re-resolved only the iter var, never replaying item-derived local decls:
 *
 *   - TEXT / class: binding  (maybeWrapLiftPerItemEffect): the effect re-resolves
 *     `e` but the body reads the STALE create-time `name` → text stays stale.
 *   - EVENT handler (maybeWrapLiftPerItemHandler / …CallableHandler): the wrap's
 *     detection keyed on the iter var only, so a handler reading an item-derived
 *     LOCAL was not wrapped at all → the listener closes over the stale local.
 *
 * The DIRECT iter-var form (`<h3>${e.name}</h3>`, `onclick=${pick(e.name)}`) already
 * works (the effect/handler re-resolves `e`); the LOCAL alias is the asymmetry.
 *
 * Executed-DOM — codegen inspection cannot see the stale runtime read. Models
 * g-nested-for-lift-no-reconcile-on-cell-replace.browser.test.js.
 *
 * NOTE (scope): per-item ATTRIBUTE bindings (`title=${name}`) are NOT covered here
 * and are NOT part of this class — the DIRECT form `title=${e.name}` ALSO emits no
 * per-item effect (set once at create time), so there is no local-vs-direct
 * asymmetry to fix. That is a separate, larger pre-existing gap
 * (g-lift-per-item-attribute-binding-not-reactive-on-reconcile), filed separately.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const clone = (x) => JSON.parse(JSON.stringify(x));

const tmpRoot = resolve("/tmp", "scrml-gap-item-derived-local-stale");
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

describe("gap: item-derived local stale in per-item effect paths (REPLACE)", () => {
  beforeEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} GlobalRegistrator.register(); });
  afterEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileOut(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__scrml_set__(n, v),
      get: (n) => globalThis.__scrml_get__(n),
      names: () => [...document.querySelectorAll("#root h3")].map((n) => n.textContent.trim()),
      buttons: () => [...document.querySelectorAll("#root button")],
    };
  }

  const A = [{ name: "mario" }, { name: "luigi" }];
  const B = [{ name: "drag" }, { name: "drop" }];

  // ── Mechanism 1: TEXT binding over a DESTRUCTURED item-derived local ──
  const SRC_TEXT = `<program>
type Row:struct = { name: string }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    let { name } = e;
    lift <div class="row"><h3>\${name}</h3></div>;
  } }
</div>
</program>
`;
  test("TEXT over destructured local `let {name}=e` updates on REPLACE", () => {
    const app = mount(SRC_TEXT, "text");
    app.set("rows", clone(A));
    expect(app.names()).toEqual(["mario", "luigi"]);
    app.set("rows", clone(B)); // REPLACE → index keys match → nodes reused
    expect(app.names()).toEqual(["drag", "drop"]); // was STALE ["mario","luigi"] pre-fix
  });

  // ── Mechanism 1: TEXT over a MEMBER-decl item-derived local `let nm=e.name` ──
  const SRC_MEMBER = `<program>
type Row:struct = { name: string }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    let nm = e.name;
    lift <div class="row"><h3>\${nm}</h3></div>;
  } }
</div>
</program>
`;
  test("TEXT over member-decl local `let nm=e.name` updates on REPLACE", () => {
    const app = mount(SRC_MEMBER, "member");
    app.set("rows", clone(A));
    expect(app.names()).toEqual(["mario", "luigi"]);
    app.set("rows", clone(B));
    expect(app.names()).toEqual(["drag", "drop"]);
  });

  // ── Control: the DIRECT iter-var form must remain correct (byte-path unchanged) ──
  const SRC_DIRECT = `<program>
type Row:struct = { name: string }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    lift <div class="row"><h3>\${e.name}</h3></div>;
  } }
</div>
</program>
`;
  test("control: direct `${e.name}` still updates on REPLACE", () => {
    const app = mount(SRC_DIRECT, "direct");
    app.set("rows", clone(A));
    expect(app.names()).toEqual(["mario", "luigi"]);
    app.set("rows", clone(B));
    expect(app.names()).toEqual(["drag", "drop"]);
  });

  // ── Mechanism 2: EVENT handler over an item-derived local ──
  // The handler writes the local into a cell; after REPLACE the REUSED button's
  // listener must fire with the NEW item's name, not the stale create-time one.
  const SRC_EVENT = `<program>
type Row:struct = { name: string }
<rows>: Row[] = []
<selected>: string = ""
\${ fn select(n: string) { @selected = n } }
<div id="root">
  \${ for (let e of @rows) {
    let { name } = e;
    lift <div class="row"><button onclick=\${select(name)}>\${name}</button></div>;
  } }
</div>
</program>
`;
  test("EVENT handler over local `let {name}=e` fires with fresh value after REPLACE", () => {
    const app = mount(SRC_EVENT, "event");
    app.set("rows", clone(A));
    let btns = app.buttons();
    btns[0].click();
    expect(app.get("selected")).toBe("mario");
    app.set("rows", clone(B)); // REPLACE → index-key reuse of the button node
    btns = app.buttons();
    btns[0].click();
    expect(app.get("selected")).toBe("drag"); // was STALE "mario" pre-fix
  });

  // ── Shared-path (class:) — codegen presence: the class: toggle effect over a
  //    local must replay the local decl inside the effect (same maybeWrapLift-
  //    PerItemEffect as TEXT). Codegen assertion (the DOM toggle mechanism is
  //    identical to TEXT, gated above executed-DOM). ──
  const SRC_CLASS = `<program>
type Row:struct = { name: string }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    let nm = e.name;
    lift <div class:tag=\${nm is some}>x</div>;
  } }
</div>
</program>
`;
  // ── Mechanism 1+2: item-derived local declared inside a NESTED BLOCK (if) ──
  // scanItemDerivedLocals must descend into if-branches (they share the item
  // scope) — a local declared in `if (…) { let nm=e.name; lift }` is item-derived
  // and its per-item binding must replay it. (Adversarial finder, S293.)
  const AA = [{ name: "mario", active: 1 }, { name: "luigi", active: 1 }];
  const BB = [{ name: "drag", active: 1 }, { name: "drop", active: 1 }];
  const SRC_NESTED_TEXT = `<program>
type Row:struct = { name: string, active: (not to timestamp) }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    if (e.active is some) {
      let { name } = e;
      lift <div class="row"><h3>\${name}</h3></div>;
    }
  } }
</div>
</program>
`;
  test("TEXT over local declared inside an if-block updates on REPLACE", () => {
    const app = mount(SRC_NESTED_TEXT, "nested-text");
    app.set("rows", clone(AA));
    expect(app.names()).toEqual(["mario", "luigi"]);
    app.set("rows", clone(BB));
    expect(app.names()).toEqual(["drag", "drop"]); // was STALE pre-scan-recursion
  });

  const SRC_NESTED_EVENT = `<program>
type Row:struct = { name: string, active: (not to timestamp) }
<rows>: Row[] = []
<selected>: string = ""
\${ fn select(n: string) { @selected = n } }
<div id="root">
  \${ for (let e of @rows) {
    if (e.active is some) {
      let { name } = e;
      lift <div class="row"><button onclick=\${select(name)}>\${name}</button></div>;
    }
  } }
</div>
</program>
`;
  test("EVENT handler over local declared inside an if-block fires fresh after REPLACE", () => {
    const app = mount(SRC_NESTED_EVENT, "nested-event");
    app.set("rows", clone(AA));
    let btns = app.buttons();
    btns[0].click();
    expect(app.get("selected")).toBe("mario");
    app.set("rows", clone(BB));
    btns = app.buttons();
    btns[0].click();
    expect(app.get("selected")).toBe("drag"); // was STALE "mario" pre-scan-recursion
  });

  test("class: toggle over local replays the local decl inside the effect", () => {
    const { errors, clientJs } = compileOut(SRC_CLASS, "cls");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    // The effect must re-resolve `e` AND replay `let nm = e.name` before reading nm.
    const m = clientJs.match(/_scrml_effect\(\(\) => \{[\s\S]*?_scrml_resolve_item[\s\S]*?\}\);/);
    expect(m).not.toBeNull();
    expect(m[0]).toContain("let nm = e.name");
    expect(m[0].indexOf("let nm = e.name")).toBeLessThan(m[0].lastIndexOf("nm"));
  });
});
