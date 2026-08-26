/**
 * g-render-snippet-slot-renders-empty (default-pipeline parametric limb, S375-peter)
 *
 * A parametric snippet fill `foot={ (v) => <markup> }` rendered via
 * `${render foot(arg)}` used to render NOTHING (exit 0, zero diagnostics). Two
 * root causes in the default pipeline, both fixed here:
 *
 *   (A) The render-bearing component body was re-parsed via the NATIVE path,
 *       which discards a Render expr into an empty escape-hatch
 *       (translate-expr.js:296), so `_injectChildrenWalk`'s render-slot detection
 *       never matched. Fix: `sourceNeedsLiveFallback` now routes a render-bearing
 *       body through the LEGACY path (which rewrites `render name(...)` →
 *       `__scrml_render_name__(...)`, a real call node) — the same divergence-guard
 *       class as the existing `<each>`/`<match>` rule.
 *   (B) Once detected, the parametric substitution pushed a `{ bare-expr, expr }`
 *       node using the dead legacy `expr:` field (codegen reads `exprNode` since
 *       Phase 4d Step 8), so it emitted nothing. Fix: `parseSnippetBodyNodes`
 *       reparses the param-substituted body into real AST nodes (fresh ids).
 *
 * BITING: pre-fix the render site is empty. Executes the SHIPPED pruned runtime.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();
const TMP = resolve("/tmp", "scrml-render-snippet-parametric");
beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

function shipMount(src) {
  const d = resolve(TMP, `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, "out");
  mkdirSync(d, { recursive: true });
  const input = resolve(d, "..", "app.scrml");
  writeFileSync(input, src);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: d, log: () => {} });
  const rd = (f) => (existsSync(resolve(d, f)) ? readFileSync(resolve(d, f), "utf8") : "");
  const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const html = rd("app.html");
  const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  document.body.innerHTML = body;
  new Function("window", "document",
    `${rd(r.runtimeFilename ?? "scrml-runtime.js")}\n` + captureInsideChunkScope(rd("app.client.js"), ""),
  )(globalThis.window, globalThis.document);
  document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  return { errs, text: (sel) => document.querySelector(sel)?.textContent?.trim() };
}

describe("g-render-snippet-slot-renders-empty (parametric, default pipeline)", () => {
  test("§1 a parametric snippet with a MARKUP body renders", () => {
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ foot: snippet(v: string) }><div class="cf">${render foot("FOOTVAL")}</div></div> }',
      "<Card foot={ (v) => <span class=\"fv\">FOOT:${v}</span> } />",
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    // BITING: pre-fix ".cf" was empty and ".fv" absent.
    expect(m.text(".cf")).toBe("FOOT:FOOTVAL");
    expect(m.text(".fv")).toBe("FOOT:FOOTVAL");
  });

  test("§2 a parametric snippet with a PLAIN-EXPRESSION body renders", () => {
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ foot: snippet(v: string) }><div class="cf">${render foot("Z")}</div></div> }',
      '<Card foot={ (v) => "P" + v } />',
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    expect(m.text(".cf")).toBe("PZ");
  });

  test("§3 the `slot=` fill form still renders (regression)", () => {
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ head: snippet }><div class="ch">${render head()}</div></div> }',
      '<Card><span slot="head">HEADVAL</span></Card>',
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    expect(m.text(".ch")).toBe("HEADVAL");
  });

  test("§4 a bare-word body renders as text, not a page-killing var interpolation (review #1)", () => {
    // Pre-hardening: `(v) => Active` wrapped as `${Active}` → ReferenceError at
    // boot → dead page. A bare identifier body renders as literal text instead.
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ foot: snippet(v: string) }><div class="cf">${render foot("Z")}</div></div> }',
      "<Card foot={ (v) => Active } />",
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    expect(m.text(".cf")).toBe("Active"); // rendered as text; no throw
  });

  test("§5 a NON-parametric snippet filled with a zero-arg lambda renders (g-render-snippet-nonparametric-lambda-fill)", () => {
    // Pre-fix: `head={ () => <markup/> }` on a non-parametric `head: snippet` was
    // captured nowhere (the parametric loop gates on snippetParamType!==null and
    // needs a param) → rendered empty. Now parsed into the snippet's slotted group.
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ head: snippet }><div class="ch">${render head()}</div></div> }',
      "<Card head={ () => <span class=\"hv\">HEADVAL</span> } />",
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    expect(m.text(".ch")).toBe("HEADVAL");
  });

  test("§6 arity-tolerant: a zero-arg lambda on a PARAMETRIC prop renders (no page crash)", () => {
    // Review #2: pre-fix `foo={ () => ... }` on `foo: snippet(v)` was captured
    // nowhere → the #713 live-fallback rewrite left `__scrml_render_foo__(...)`
    // undefined → ReferenceError killed the page. Now the zero-arg lambda fills
    // the parametric snippet (ignoring the arg) and renders.
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ foo: snippet(v: string) }><div class="cf">${render foo("Z")}</div></div> }',
      "<Card foo={ () => <span>HI</span> } />",
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    expect(m.text(".cf")).toBe("HI");
  });

  test("§7 arity-mismatch: a one-param lambda on a NON-parametric prop renders empty, never crashes", () => {
    // Review #1/#2: pre-#713 this was silent-empty; #713's live-fallback made it a
    // whole-page crash (`__scrml_render_head__` undefined). A `(param) =>` fill on a
    // non-parametric snippet is an arity mismatch (the render site passes no arg, so
    // the param is unbound) — it now renders EMPTY: the render call is consumed (no
    // undefined-fn crash) and the mismatched body (which may read the unbound param)
    // is not emitted (no undefined-var crash). Whether a mismatch should be a
    // compile diagnostic is a §16.6 semantics question, deferred to bryan.
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ head: snippet }><div class="ch">${render head()}</div></div> }',
      "<Card head={ (v) => <span>${v}</span> } />", // body USES the unbound param
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    expect(m.text(".ch")).toBe(""); // empty, and — critically — no throw at boot
  });

  test("§8 arity-mismatch does not corrupt SIBLING valid snippets on the same component", () => {
    // A mismatched fill must not poison a well-formed sibling snippet.
    const m = shipMount([
      "<program>",
      '${ const Card = <div props={ good: snippet, bad: snippet }>' +
        '<div class="g">${render good()}</div><div class="b">${render bad()}</div></div> }',
      '<Card good={ () => <span>GOOD</span> } bad={ (v) => <span>${v}</span> } />',
      "</program>", "",
    ].join("\n"));
    expect(m.errs).toEqual([]);
    expect(m.text(".g")).toBe("GOOD"); // the valid sibling still renders
    expect(m.text(".b")).toBe("");     // the mismatch renders empty, no crash
  });
});
