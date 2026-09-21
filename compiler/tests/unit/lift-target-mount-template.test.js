/**
 * g-todomvc-benchmark-app-dead-on-arrival-lift-target-inside-template — EMIT-SHAPE pins.
 *
 * An element inside a mount-deferred `<template>` (an `if=` gate or an if-chain
 * branch, SPEC §17.1) is NOT in the document until the template is cloned and
 * inserted, and `document.querySelector` never descends into template content.
 * Every module-init / boot-time `document.querySelector` for such an element
 * therefore binds `null`. Pre-fix that was:
 *
 *   - the `${ … lift … }` target (emit-reactive-wiring) — all three group shapes
 *     (keyed-reconcile-only, effect-wrapped, non-reactive): the effect shape threw
 *     on `null.innerHTML`, the other two fell back to `document.body` and lifted
 *     the rows OUTSIDE their host;
 *   - five anchor display sites (emit-event-wiring): `<textarea>` RCDATA content,
 *     `<errors of=…/>`, `<render of=@cell/>`, an `<errorBoundary>` `${…}`, and a
 *     `${serverFn()}` one-shot — each a document-scoped `_scrml_boot` block that
 *     no-ops and never re-runs.
 *
 * Fix (the S400 static-display mechanism, extended): template-interior sites
 * are bound from `_scrml_nav_rewire`, which re-runs root-scoped on every mount.
 * A site in the SSR body emits byte-identically to before (pinned here as the
 * control half of every pair).
 *
 * The behavioural half (mount in happy-dom, rows render, toggle cycles) is
 * compiler/tests/browser/browser-lift-target-mount-template.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "lift-target-mount-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const abs = join(TMP, `case-${++seq}.scrml`);
  writeFileSync(abs, source);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const errors = (result.errors || []).filter((e) => (e.severity ?? "error") === "error");
  const out = [...(result.outputs || new Map()).values()][0];
  return { errors, js: out?.clientJs ?? "", html: out?.html ?? "" };
}

/** The `_scrml_nav_rewire(root)` body — where per-mount (rebind) wiring lives. */
function navRewireBody(js) {
  const start = js.indexOf("function _scrml_nav_rewire(root) {");
  const end = js.indexOf("_scrml_nav_rewire(document);");
  if (start === -1 || end === -1) return "";
  return js.slice(start, end);
}

function logicPids(html) {
  return [...html.matchAll(/data-scrml-logic="(_scrml_logic_\d+)"/g)].map((m) => m[1]);
}

const count = (hay, needle) => hay.split(needle).length - 1;

/** Assert the mount-deferred lift shape for the (single) lift host in `src`. */
function expectMountDeferredLift(src) {
  const { errors, js, html } = compile(src);
  expect(errors).toEqual([]);
  const pids = logicPids(html);
  expect(pids.length).toBe(1);
  const pid = pids[0];
  // No eager module-init bind of a host the document does not yet contain.
  expect(js).not.toContain(`document.querySelector('[data-scrml-logic="${pid}"]')`);
  // The group is a function of its host, with the effect constructors as params.
  expect(js).toContain(`function _scrml_lift_mount_${pid}(_scrml_lift_host, _scrml_effect, _scrml_effect_static) {`);
  expect(count(js, "function _scrml_lift_mount_run(host, body) {")).toBe(1);
  // …bound per mount from the rebind rehydrator, root-scoped.
  const rewire = navRewireBody(js);
  expect(rewire).toContain(`const el = (root || document).querySelector('[data-scrml-logic="${pid}"]');`);
  expect(rewire).toContain(`_scrml_lift_mount_run(el, _scrml_lift_mount_${pid});`);
  return { js, pid };
}

describe("lift target inside a mount <template> — emitted shape", () => {
  test("keyed-reconcile-only group (the min repro): `_scrml_lift_target = _scrml_lift_host`", () => {
    const { js } = expectMountDeferredLift(`<program>
<items> = ["a", "b"]
<ul if=@items.length>
    \${ for (let it of @items) { lift <li>\${it}</li> } }
</ul>
</program>
`);
    expect(js).toContain("_scrml_lift_target = _scrml_lift_host;");
  });

  test("effect-wrapped group (the todomvc shape): the target var IS the host param", () => {
    const { js } = expectMountDeferredLift(`<program>
<items> = ["a", "b"]
<show> = true
<label> = "L"
<section if=@show>
    <ul>
        \${
            for (let it of @items) { lift <li>\${it}</li> }
            if (@label == "L") { lift <li class="extra">extra</li> }
        }
    </ul>
</section>
</program>
`);
    expect(js).toMatch(/const _scrml_lift_tgt_\d+ = _scrml_lift_host;/);
    expect(js).not.toMatch(/const _scrml_lift_tgt_\d+ = document\.querySelector/);
  });

  test("non-reactive group: `_scrml_lift_target = _scrml_lift_host`", () => {
    const { js } = expectMountDeferredLift(`<program>
<show> = true
function yes() { return true }
<section if=@show>
    <div class="host">
        \${ if (yes()) { lift <b>static-lift</b> } }
    </div>
</section>
</program>
`);
    expect(js).toContain("_scrml_lift_target = _scrml_lift_host;");
  });

  test("a lift host inside an if-chain branch", () => {
    expectMountDeferredLift(`<program>
<items> = ["a", "b"]
<mode> = 1
<div>
    <ul if=(@mode == 1)>
        \${ for (let it of @items) { lift <li>\${it}</li> } }
    </ul>
    <p else>none</p>
</div>
</program>
`);
  });

  test("a lift host inside an if= inside another if=", () => {
    expectMountDeferredLift(`<program>
<items> = ["a", "b"]
<outer> = true
<div>
    <section if=@outer>
        <ul if=@items.length>
            \${ for (let it of @items) { lift <li>\${it}</li> } }
        </ul>
    </section>
</div>
</program>
`);
  });

  test("two lift hosts in one if= body: one mount function each, one shared run helper", () => {
    const { errors, js, html } = compile(`<program>
<xs> = ["a"]
<ys> = ["b"]
<show> = true
<section if=@show>
    <ul class="x">\${ for (let v of @xs) { lift <li>\${v}</li> } }</ul>
    <ul class="y">\${ for (let v of @ys) { lift <li>\${v}</li> } }</ul>
</section>
</program>
`);
    expect(errors).toEqual([]);
    const pids = logicPids(html);
    expect(pids.length).toBe(2);
    for (const pid of pids) {
      expect(js).toContain(`function _scrml_lift_mount_${pid}(`);
      expect(navRewireBody(js)).toContain(`_scrml_lift_mount_run(el, _scrml_lift_mount_${pid});`);
    }
    expect(count(js, "function _scrml_lift_mount_run(host, body) {")).toBe(1);
  });

  // Round 2 (F1) — the mount function carries only render work.
  const mountFnBody = (js, pid) => {
    const start = js.indexOf(`function _scrml_lift_mount_${pid}(`);
    if (start === -1) return "";
    // The mount functions are emitted last in the reactive section, before the
    // event wiring; a following mount function (if any) also ends this one.
    const next = js.indexOf("\nfunction _scrml_lift_mount_", start + 1);
    const wiring = js.indexOf("// --- Event handler wiring", start);
    const end = [next, wiring].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? js.length;
    return js.slice(start, end);
  };
  const chunkPart = (js) => js.slice(0, js.indexOf("// --- lift groups whose host is inside a mount-deferred <template>"));

  test("F1 run-once block: declarations and lift-free statements stay at chunk scope, only the lift moves", () => {
    const { errors, js, html } = compile(`<program>
<items> = ["a", "b"]
<show> = true
<picked> = ""
<div if=@show>
    \${
        const prefix = "P-"
        @picked = "init"
        for (let it of @items) { lift <li>\${prefix + it}</li> }
    }
</div>
</program>
`);
    expect(errors).toEqual([]);
    const [pid] = logicPids(html);
    const body = mountFnBody(js, pid);
    expect(chunkPart(js)).toContain(`const prefix = "P-";`);
    expect(chunkPart(js)).toMatch(/_scrml_(?:cs_)?reactive_set\("picked", "init"\);/);
    expect(body).not.toContain("const prefix");
    expect(body).not.toContain('"picked"');
    expect(body).toContain("_scrml_reconcile_list(");
  });

  test("outer-effect block: declarations stay effect-local, exactly as the SSR-body twin emits them (no hoist)", () => {
    const { errors, js, html } = compile(`<program>
<items> = ["a", "b"]
<show> = true
<div if=@show>
    \${
        const limit = @items.length + 10
        for (let it of @items) { lift <li>\${it}</li> }
    }
</div>
</program>
`);
    expect(errors).toEqual([]);
    const [pid] = logicPids(html);
    const body = mountFnBody(js, pid);
    expect(chunkPart(js)).not.toMatch(/\blimit\b/);
    expect(body).toMatch(/_scrml_effect\(function\(\) \{[\s\S]*const limit = _scrml_(?:cs_)?reactive_get\("items"\)\.length \+ 10;/);
  });

  test("F2 — the run helper saves and restores the enclosing lift target", () => {
    const { js } = compile(`<program>
<items> = ["a"]
<ul if=@items.length>\${ for (let it of @items) { lift <li>\${it}</li> } }</ul>
</program>
`);
    expect(js).toContain("const prevTarget = _scrml_lift_target;");
    expect(js).toContain("_scrml_lift_target = prevTarget;");
  });

  test("CONTROL — a lift host in the SSR body keeps the eager module-init bind (unchanged)", () => {
    const { errors, js, html } = compile(`<program>
<items> = ["a", "b"]
<ul>
    \${ for (let it of @items) { lift <li>\${it}</li> } }
</ul>
</program>
`);
    expect(errors).toEqual([]);
    const [pid] = logicPids(html);
    expect(js).toContain(`_scrml_lift_target = document.querySelector('[data-scrml-logic="${pid}"]');`);
    expect(js).not.toContain("_scrml_lift_mount_run");
    expect(js).not.toContain("_scrml_lift_host");
  });
});

// ---------------------------------------------------------------------------
// The five anchor display sites (emit-event-wiring) — same class.
// Each case: the anchor inside `<div if=@show>` vs the identical anchor in the
// SSR body.
// ---------------------------------------------------------------------------

const ANCHORS = [
  {
    name: "<textarea> RCDATA content (data-scrml-rcdata)",
    attr: "data-scrml-rcdata",
    tracked: "_scrml_region_track(el, _scrml_effect(function() { _scrml_set_rcdata(); }));",
    untracked: "_scrml_effect(function() { _scrml_set_rcdata(); });",
    wrap: (inner, gated) => `<program>
<show> = true
<txt> = "RC_OK"
<div${gated ? " if=@show" : ""}>
    ${inner}
</div>
</program>
`,
    inner: `<textarea id="ta">\${@txt}</textarea>`,
  },
  {
    name: "<errors of=…/> (data-scrml-errors-anchor)",
    attr: "data-scrml-errors-anchor",
    tracked: /_scrml_region_track\(el, _scrml_effect\(function\(\) \{ render_\w+\(\); \}\)\);/,
    untracked: /\n\s+_scrml_effect\(function\(\) \{ render_\w+\(\); \}\);/,
    wrap: (inner, gated) => `<program>
<page>
  <show> = true
  <signupForm>
    <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
  </>
  <div${gated ? " if=@show" : ""}>
    ${inner}
  </div>
</page>
</program>
`,
    inner: `<form><input type="email" bind:value=@signupForm.email/><errors of=@signupForm.email/></form>`,
  },
  {
    name: "<render of=@cell/> (data-scrml-render-anchor)",
    attr: "data-scrml-render-anchor",
    tracked: /_scrml_region_track\(el, _scrml_(?:cs_)?reactive_subscribe\("[^"]+", function\(\) \{ render_\w+\(\); \}\)\);/,
    untracked: /\n\s+_scrml_(?:cs_)?reactive_subscribe\("[^"]+", function\(\) \{ render_\w+\(\); \}\);/,
    wrap: (inner, gated) => `<program>
type LE:enum = { NotFound(id: string) renders <p class="rend">No #\${id}</p>, Network(msg: string) renders <p class="rend">Net \${msg}</p> }
<err>: LE = .NotFound("42")
<show> = true
<div${gated ? " if=@show" : ""}>${inner}</div>
</program>
`,
    inner: `<render of=@err/>`,
  },
];

describe("anchor display sites inside a mount <template> — emitted shape", () => {
  for (const a of ANCHORS) {
    test(`${a.name}: rebinds from _scrml_nav_rewire, effect region-tracked`, () => {
      const { errors, js } = compile(a.wrap(a.inner, true));
      expect(errors).toEqual([]);
      expect(js).not.toContain(`document.querySelector('[${a.attr}=`);
      const rewire = navRewireBody(js);
      expect(rewire).toContain(`const el = (root || document).querySelector('[${a.attr}=`);
      if (a.tracked instanceof RegExp) expect(rewire).toMatch(a.tracked);
      else expect(rewire).toContain(a.tracked);
    });

    test(`CONTROL ${a.name} in the SSR body: document-scoped boot block, effect untracked (unchanged)`, () => {
      const { errors, js } = compile(a.wrap(a.inner, false));
      expect(errors).toEqual([]);
      expect(js).toContain(`    const el = document.querySelector('[${a.attr}=`);
      expect(navRewireBody(js)).not.toContain(`[${a.attr}=`);
      if (a.untracked instanceof RegExp) expect(js).toMatch(a.untracked);
      else expect(js).toContain(`      ${a.untracked}`);
      expect(js).not.toContain("_scrml_region_track(el, _scrml_effect(function() { _scrml_set_rcdata(); }))");
    });
  }

  const EB = (gated) => `type LoadError:enum = {
    NotFound(id: string)
        renders <div class="eb-nf">Item \${id} not found</>
    Timeout
}

function loadItem(id: string)! LoadError {
    if (id == "") fail LoadError::NotFound(id)
    return "EB_OK_" + id
}

<page>
    <show> = true
    <div${gated ? " if=@show" : ""}>
        <errorBoundary fallback={<div class="eb-fb">went wrong</>}>
            <span id="ebv">\${loadItem("42")}</span>
        </>
    </div>
</page>
`;

  test("<errorBoundary> ${…} display: rebinds from _scrml_nav_rewire", () => {
    const { errors, js, html } = compile(EB(true));
    expect(errors).toEqual([]);
    const [pid] = logicPids(html);
    expect(js).not.toContain(`document.querySelector('[data-scrml-logic="${pid}"]')`);
    const rewire = navRewireBody(js);
    expect(rewire).toContain(`const el = (root || document).querySelector('[data-scrml-logic="${pid}"]');`);
    expect(rewire).toContain("_eb_render_");
  });

  test("CONTROL <errorBoundary> ${…} display in the SSR body: document-scoped (unchanged)", () => {
    const { errors, js, html } = compile(EB(false));
    expect(errors).toEqual([]);
    const [pid] = logicPids(html);
    expect(js).toContain(`    const el = document.querySelector('[data-scrml-logic="${pid}"]');`);
  });

  const SRV = (gated) => `<program>
<show> = true
server function greeting() { return "SRV_OK" }
<div${gated ? " if=@show" : ""}>
    <span id="sv">\${greeting()}</span>
</div>
</program>
`;

  test("${serverFn()} one-shot display: rebinds from _scrml_nav_rewire", () => {
    const { errors, js, html } = compile(SRV(true));
    expect(errors).toEqual([]);
    const [pid] = logicPids(html);
    expect(js).not.toContain(`document.querySelector('[data-scrml-logic="${pid}"]')`);
    const rewire = navRewireBody(js);
    expect(rewire).toContain(`const el = (root || document).querySelector('[data-scrml-logic="${pid}"]');`);
    expect(rewire).toContain("el.textContent = await (");
  });

  test("CONTROL ${serverFn()} one-shot in the SSR body: document-scoped (unchanged)", () => {
    const { errors, js, html } = compile(SRV(false));
    expect(errors).toEqual([]);
    const [pid] = logicPids(html);
    expect(js).toContain(`    const el = document.querySelector('[data-scrml-logic="${pid}"]');`);
  });
});
