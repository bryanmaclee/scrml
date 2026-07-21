/**
 * Phase A10 Phase 3+4 — engine state-child body render codegen.
 *
 * Authored S78 2026-05-10.
 * SCOPE doc: docs/changes/phase-a10-engine-state-child-body-render/SCOPE-AND-DECOMPOSITION.md
 * SURVEY doc: docs/changes/phase-a10-engine-state-child-body-render/PHASE-0-SURVEY.md
 *
 * Per SCOPE §3.4 (Option C-prime, RATIFIED S78): variant-guarded markup
 * render via factored helper + engine consumer. This suite asserts
 * EMISSION SHAPE: render functions, dispatcher, mount slot, tree-shake,
 * payload bindings. Integration tests (compile + run + DOM assertions)
 * are SKIPPED with reason citing the post-innerHTML-replace reactive-
 * subscription gap (documented limitation in emit-variant-guard.ts).
 *
 * Coverage:
 *   §1 Empty engine — no dispatcher / no render fns / no mount slot (tree-shake)
 *   §2 Single state-child with text body — render fn returns text
 *   §3 Multi state-child — dispatcher switches on variant tag
 *   §4 Body with markup — <button onclick=fn()> rendered as proper HTML
 *      with event-binding placeholder + delegation wiring
 *   §5 Body with ${@cell} interpolation — reactive-wiring registers
 *      logic-binding for the placeholder
 *   §6 Body with payload binding — <Error msg> render fn takes msg param;
 *      HTML body references it as logic node (which uses _scrml_reactive_get
 *      semantics; payload-scope-injection deferred in Phase 1+2)
 *   §7 Variant change → dispatcher uses _scrml_reactive_subscribe
 *   §8 Tree-shake invariant — engine with all-empty bodies emits zero
 *      body-render code beyond the C12 marker comment
 *   §9 Helper unit tests — extractPayloadBindingsFromAttrs,
 *      filterRenderableChildren, emitInitialArmHtmlForMount
 *  §10 Structural-element filter — <onTimeout>/<onTransition> stripped
 *      from arm body before render
 *  §11 Mount slot HTML emitted in initial-variant body
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import {
  emitVariantGuardedRender,
  extractPayloadBindingsFromAttrs,
  filterRenderableChildren,
  emitInitialArmHtmlForMount,
} from "../../src/codegen/emit-variant-guard.ts";

// ---------------------------------------------------------------------------
// compile helper — writes a temp .scrml, compiles to client.js + html, reads
// the outputs, cleans up. Mirrors the pattern used by
// engine-onIdle-watchdog.test.js.
// ---------------------------------------------------------------------------

function compileToOutputs(source, suffix = "bodyrender") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    const html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs, html };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — Empty engine — no dispatcher / no render fns / no mount slot
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §1 — empty-body engine tree-shake", () => {
  test("engine with all empty state-child bodies emits no body-render code", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "shake-empty");
    expect(errors).toEqual([]);
    // No body-render section header
    expect(clientJs).not.toContain("// --- engine body render");
    // No render functions
    expect(clientJs).not.toMatch(/_scrml_engine_phase_render_/);
    // HTML has no mount slot (all bodies empty → tree-shake)
    expect(html).not.toMatch(/data-scrml-engine-mount/);
    // C12 marker comment IS preserved (Q4)
    expect(clientJs).toContain("§51.0.D engine mount position");
  });

  test("self-closing-shape engine (no body) emits no body-render code", () => {
    // Self-closing `<engine for=T/>` is structurally invalid (state-children
    // must cover all variants of T). Use a body-with-empty-children form
    // that compiles cleanly to test the no-bodyChildren branch of the
    // engine consumer.
    const src = `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading/>
  <Loading rule=.Idle/>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "shake-selfclose");
    expect(errors).toEqual([]);
    // No body-render section header (each state-child is self-closing → empty body)
    expect(clientJs).not.toContain("// --- engine body render");
    expect(clientJs).not.toMatch(/_scrml_engine_phase_render_/);
    expect(html).not.toMatch(/data-scrml-engine-mount/);
    expect(clientJs).toContain("§51.0.D engine mount position");
  });
});

// ---------------------------------------------------------------------------
// §2 — Single state-child with text body
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §2 — single state-child with text body", () => {
  test("text-body arm produces a render fn returning the text", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading>Idle text</>
  <Loading rule=.Idle></>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "text-body");
    expect(errors).toEqual([]);
    // Section header present (S108 — extended to cover match-block body
    // render emission alongside engine body render; shared section header).
    // S130 HU-1 iteration Landing 1 — extended further to optionally
    // cover each-block body render.
    expect(clientJs).toMatch(/\/\/ --- engine( \+ match)?( \+ each)? body render/);
    // Idle render fn returns text
    expect(clientJs).toMatch(/function _scrml_engine_phase_render_Idle\(\) {/);
    // Loading also gets a render fn (returns "" since body is empty);
    // empty-body arms still emit no-arg shells for dispatcher uniformity.
    expect(clientJs).toMatch(/function _scrml_engine_phase_render_Loading\(\) {/);
    // Mount slot exists in HTML, contains initial-arm content
    expect(html).toMatch(/data-scrml-engine-mount="phase"/);
    expect(html).toContain("Idle text");
  });
});

// ---------------------------------------------------------------------------
// §3 — Multi state-child — dispatcher switches on variant tag
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §3 — multi state-child dispatcher", () => {
  test("dispatcher switches on _tag for each variant", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading, Done }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading>Idle</>
  <Loading rule=.Done>Loading</>
  <Done>Done</>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "multi");
    expect(errors).toEqual([]);
    // Phase A10 re-wire (S78, 2026-05-10): the dispatcher is now a NAMED
    // function `__scrml_engine_phase_dispatch(_v)` invoked by both the
    // `_scrml_reactive_subscribe` registration AND the `DOMContentLoaded`
    // initial-fire block. The subscribe call passes the dispatch fn by
    // reference instead of an inline `function(_v) { ... }` literal.
    expect(clientJs).toMatch(/function __scrml_engine_phase_dispatch\(_v\)/);
    expect(clientJs).toMatch(/_scrml_reactive_subscribe\("phase", __scrml_engine_phase_dispatch\)/);
    // Each variant has an if/else-if branch
    expect(clientJs).toMatch(/if \(_tag === "Idle"\) {[\s\S]*?_scrml_engine_phase_render_Idle\(\)/);
    expect(clientJs).toMatch(/else if \(_tag === "Loading"\) {[\s\S]*?_scrml_engine_phase_render_Loading\(\)/);
    expect(clientJs).toMatch(/else if \(_tag === "Done"\) {[\s\S]*?_scrml_engine_phase_render_Done\(\)/);
    // mount-element querySelector
    expect(clientJs).toMatch(/document\.querySelector\('\[data-scrml-engine-mount="phase"\]'\)/);
  });
});

// ---------------------------------------------------------------------------
// §4 — Body with markup — <button onclick=fn()>
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §4 — body with event-handler markup", () => {
  test("button with onclick renders with event binding placeholder", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading }
  fn load() {}
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading>
    <button onclick=load()>Load</button>
  </>
  <Loading rule=.Idle></>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "evt-btn");
    expect(errors).toEqual([]);
    // Render function for Idle contains the button HTML
    expect(clientJs).toMatch(/function _scrml_engine_phase_render_Idle\(\) {[\s\S]*?<button[\s\S]*?>Load<\/button>/);
    // Event binding placeholder present in render fn output (via JSON-encoded HTML literal)
    expect(clientJs).toMatch(/data-scrml-bind-onclick=\\"_scrml_attr_onclick_/);
    // File-level event delegation wiring includes a click handler that maps
    // the placeholder to the load function
    expect(clientJs).toMatch(/_scrml_load_\d+/);
    // Initial mount slot in HTML contains the button
    expect(html).toMatch(/data-scrml-engine-mount="phase"/);
    expect(html).toMatch(/<button[\s\S]*?>Load<\/button>/);
  });
});

// ---------------------------------------------------------------------------
// §5 — Body with ${@cell} interpolation
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §5 — body with ${@cell} interpolation", () => {
  test("interpolation produces logic placeholder + reactive-wiring entry", () => {
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 0
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing>
    <div>Count: \${@count}</div>
  </>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "interp");
    expect(errors).toEqual([]);
    // Showing is initial — its body lands in mount slot HTML
    expect(html).toMatch(/data-scrml-engine-mount="phase"/);
    expect(html).toMatch(/data-scrml-logic="_scrml_logic_/);
    // The render fn for Showing contains the placeholder span
    expect(clientJs).toMatch(/function _scrml_engine_phase_render_Showing[\s\S]*?<span data-scrml-logic=/);
    // Phase A10 re-wire (S78, 2026-05-10): the arm's `${@count}` binding
    // is wired by the per-arm wire fn (`_scrml_engine_phase_wire_Showing`),
    // NOT by the file-level "Reactive display wiring" section. The wire
    // fn calls `_scrml_effect` so the textContent updates on cell change.
    expect(clientJs).toMatch(
      /function _scrml_engine_phase_wire_Showing\(_root\) {[\s\S]*?_scrml_effect\(function/,
    );
  });
});

// ---------------------------------------------------------------------------
// §6 — Body with payload binding
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §6 — body with payload binding", () => {
  test("Error msg arm render fn takes msg parameter; dispatcher passes _data[\"msg\"]", () => {
    const src = `\${
  type Phase:enum = { Idle, Error(msg: string) }
}
<engine for=Phase initial=.Idle>
  <Idle></>
  <Error msg>
    <div>Whoops</div>
  </>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "payload");
    expect(errors).toEqual([]);
    // Error render fn signature includes the msg parameter
    expect(clientJs).toMatch(/function _scrml_engine_phase_render_Error\(msg\) {/);
    // S95 Bug 2 fix — dispatcher passes the named-field lookup
    // `_data && _data["msg"]` instead of the never-realized positional
    // `_payload[0]`. Per SPEC §51.3.2 the runtime data shape is
    // `{ fieldName: value }` keyed by the variant's declared field names.
    expect(clientJs).toMatch(/_scrml_engine_phase_render_Error\(_data && _data\["msg"\]\)/);
  });
});

// ---------------------------------------------------------------------------
// §7 — Dispatcher uses _scrml_reactive_subscribe (not _scrml_effect)
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §7 — dispatcher subscribes via _scrml_reactive_subscribe", () => {
  test("engine dispatcher uses subscribe-on-set, not _scrml_effect", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading>I</>
  <Loading rule=.Idle>L</>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "subscribe");
    expect(errors).toEqual([]);
    // Phase A10 re-wire (S78, 2026-05-10): the dispatcher body lives in
    // the NAMED function `__scrml_engine_phase_dispatch(_v)`. The subscribe
    // and DOMContentLoaded blocks both invoke it. Match the named function
    // body and assert it doesn't fall back to _scrml_effect.
    const dispatcherMatch = clientJs.match(/function __scrml_engine_phase_dispatch\(_v\) {[\s\S]*?_mount\.innerHTML[\s\S]*?\n\}/);
    expect(dispatcherMatch).not.toBeNull();
    // Subscribe registration passes the dispatch fn by reference.
    expect(clientJs).toMatch(/_scrml_reactive_subscribe\("phase", __scrml_engine_phase_dispatch\);/);
    // The dispatcher body does NOT use _scrml_effect — sanity check.
    if (dispatcherMatch) {
      expect(dispatcherMatch[0]).not.toContain("_scrml_effect");
    }
  });
});

// ---------------------------------------------------------------------------
// §8 — Tree-shake invariant
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §8 — tree-shake invariant", () => {
  test("all-empty bodies emit zero body-render code", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "shake-zero");
    expect(errors).toEqual([]);
    // No body-render section
    expect(clientJs).not.toContain("// --- engine body render");
    // No render fn declarations
    expect(clientJs).not.toMatch(/function _scrml_engine_phase_render_/);
    // No subscribe-with-mount-slot pattern
    const subscribeBodies = clientJs.match(/_scrml_reactive_subscribe\("phase",[\s\S]*?\}\);/g) ?? [];
    for (const b of subscribeBodies) {
      expect(b).not.toContain("data-scrml-engine-mount");
    }
    // No mount slot in HTML
    expect(html).not.toMatch(/data-scrml-engine-mount/);
  });
});

// ---------------------------------------------------------------------------
// §9 — Helper unit tests (direct exports)
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §9 — emit-variant-guard helper unit tests", () => {
  test("extractPayloadBindingsFromAttrs picks up bareword non-reserved attrs", () => {
    const attrs = [
      { name: "msg", value: { kind: "absent" } },
      { name: "rule", value: { kind: "absent" } }, // reserved
      { name: "history", value: { kind: "absent" } }, // reserved
      { name: "code", value: { kind: "absent" } }, // payload
      { name: "class", value: { kind: "string-literal", value: "x" } }, // not bareword
    ];
    expect(extractPayloadBindingsFromAttrs(attrs)).toEqual(["msg", "code"]);
  });

  test("extractPayloadBindingsFromAttrs handles undefined input", () => {
    expect(extractPayloadBindingsFromAttrs(undefined)).toEqual([]);
    expect(extractPayloadBindingsFromAttrs([])).toEqual([]);
  });

  test("filterRenderableChildren strips structural elements", () => {
    const children = [
      { kind: "markup", tag: "div" },
      { kind: "markup", tag: "onTimeout" },
      { kind: "markup", tag: "onTransition" },
      { kind: "markup", tag: "onIdle" },
      { kind: "markup", tag: "engine" },
      { kind: "markup", tag: "machine" },
      { kind: "text", value: "Hello" },
    ];
    const out = filterRenderableChildren(children);
    expect(out.length).toBe(2);
    expect(out[0].tag).toBe("div");
    expect(out[1].kind).toBe("text");
  });

  test("filterRenderableChildren trims leading + trailing whitespace text nodes", () => {
    const children = [
      { kind: "text", value: "  \n " },
      { kind: "markup", tag: "div" },
      { kind: "text", value: "\n" },
    ];
    const out = filterRenderableChildren(children);
    expect(out.length).toBe(1);
    expect(out[0].tag).toBe("div");
  });

  test("emitVariantGuardedRender returns empty triple when all arms have empty body (tree-shake)", () => {
    const ctx = makeStubCtx();
    const out = emitVariantGuardedRender(
      () => '_scrml_reactive_get("phase")',
      [
        { tag: "Idle", payloadBindings: [], body: [] },
        { tag: "Loading", payloadBindings: [], body: [] },
      ],
      ctx,
      { idPrefix: "phase", variantSubscribeName: "phase" },
    );
    expect(out.dispatcherJs).toBe("");
    expect(out.renderFunctionsJs).toBe("");
    expect(out.mountElementHtml).toBe("");
  });

  test("emitVariantGuardedRender Shape A subscribe path emits _scrml_reactive_subscribe", () => {
    const ctx = makeStubCtx();
    const out = emitVariantGuardedRender(
      () => '_scrml_reactive_get("phase")',
      [
        { tag: "Idle", payloadBindings: [], body: [{ kind: "text", value: "Hi" }] },
      ],
      ctx,
      { idPrefix: "phase", variantSubscribeName: "phase" },
    );
    // Phase A10 re-wire (S78, 2026-05-10): the dispatcher body is now a
    // NAMED function `__scrml_engine_phase_dispatch(_v)` invoked by both
    // the subscribe registration and the DOMContentLoaded initial-fire
    // block. The subscribe call passes the dispatch fn by reference.
    expect(out.dispatcherJs).toContain("function __scrml_engine_phase_dispatch(_v)");
    expect(out.dispatcherJs).toContain('_scrml_reactive_subscribe("phase", __scrml_engine_phase_dispatch)');
    // DOMContentLoaded initial-fire bridges the subscribe-doesn't-fire-on-init gap.
    expect(out.dispatcherJs).toContain("DOMContentLoaded");
    // Module-scope dispose handle for prior arm's wire fn.
    expect(out.dispatcherJs).toContain("let __scrml_engine_phase_dispose = null;");
    // The dispatcher body does NOT use _scrml_effect.
    expect(out.dispatcherJs).not.toContain("_scrml_effect(");
  });

  test("emitVariantGuardedRender Shape B effect path emits _scrml_effect when subscribeName is null", () => {
    const ctx = makeStubCtx();
    const out = emitVariantGuardedRender(
      () => '_some_expr()',
      [
        { tag: "X", payloadBindings: [], body: [{ kind: "text", value: "Hi" }] },
      ],
      ctx,
      { idPrefix: "match0", variantSubscribeName: null },
    );
    expect(out.dispatcherJs).toContain("_scrml_effect(function() {");
    expect(out.dispatcherJs).toContain("_some_expr()");
  });

  test("emitInitialArmHtmlForMount returns initial-arm HTML for the named variant", () => {
    const ctx = makeStubCtx();
    const arms = [
      { tag: "Idle", payloadBindings: [], body: [{ kind: "text", value: "Hello idle" }] },
      { tag: "Loading", payloadBindings: [], body: [{ kind: "text", value: "Loading..." }] },
    ];
    const idleHtml = emitInitialArmHtmlForMount(arms, "Idle", ctx);
    expect(idleHtml).toContain("Hello idle");
    expect(idleHtml).not.toContain("Loading...");
  });

  test("emitInitialArmHtmlForMount returns '' for empty initial body or null tag", () => {
    const ctx = makeStubCtx();
    expect(emitInitialArmHtmlForMount([], "Idle", ctx)).toBe("");
    expect(emitInitialArmHtmlForMount([{ tag: "X", payloadBindings: [], body: [] }], "X", ctx)).toBe("");
    expect(emitInitialArmHtmlForMount([{ tag: "X", payloadBindings: [], body: [{ kind: "text", value: "y" }] }], null, ctx)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §10 — Structural-element filter at arm-body construction
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §10 — structural-element filter at boundary", () => {
  test("<onTransition> inside arm body is NOT rendered into HTML", () => {
    // S142 gate-tail: the <onTransition> body is a code-default body (§51.0.H /
    // S111 quoted-text model). The pre-S142 fixture used bare prose `hook body`
    // (two bare idents = invalid JS the emit gate now catches). Use a valid
    // effect statement; the test asserts the structural-element FILTER (the
    // <onTransition> is stripped from the render fn + HTML), not the body text.
    const src = `\${
  type Phase:enum = { Idle, Loading }
  <transitionLog> = ""
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading>
    <div>Real markup</div>
    <onTransition to=.Loading>@transitionLog = "fired"</onTransition>
  </>
  <Loading rule=.Idle></>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "filter-onTrans");
    expect(errors).toEqual([]);
    // Render fn for Idle contains the div but NOT the <onTransition>
    const renderFnMatch = clientJs.match(/function _scrml_engine_phase_render_Idle\(\) {[\s\S]*?\n}/);
    expect(renderFnMatch).not.toBeNull();
    if (renderFnMatch) {
      expect(renderFnMatch[0]).toContain("Real markup");
      expect(renderFnMatch[0]).not.toContain("onTransition");
    }
    // HTML mount slot contains the div but not the onTransition element
    expect(html).toContain("Real markup");
    expect(html).not.toContain("onTransition");
  });

  test("<onTimeout/> sibling inside arm body is NOT rendered", () => {
    const src = `\${
  type Phase:enum = { Active, Stale }
}
<engine for=Phase initial=.Active>
  <Active rule=.Stale>
    <div>Active body</div>
    <onTimeout after=5m to=.Stale/>
  </>
  <Stale></>
</>
`;
    const { errors, clientJs, html } = compileToOutputs(src, "filter-onTimeout");
    expect(errors).toEqual([]);
    const renderFnMatch = clientJs.match(/function _scrml_engine_phase_render_Active\(\) {[\s\S]*?\n}/);
    expect(renderFnMatch).not.toBeNull();
    if (renderFnMatch) {
      expect(renderFnMatch[0]).toContain("Active body");
      expect(renderFnMatch[0]).not.toContain("onTimeout");
    }
    expect(html).toContain("Active body");
    expect(html).not.toContain("<onTimeout");
  });
});

// ---------------------------------------------------------------------------
// §11 — Mount slot HTML contains initial variant body
// ---------------------------------------------------------------------------

describe("Phase A10 Phase 3 §11 — mount slot HTML carries initial-arm body", () => {
  test("initial=.Loading places Loading body in the mount slot", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading, Done }
}
<engine for=Phase initial=.Loading>
  <Idle rule=.Loading>idle text</>
  <Loading rule=.Done>loading text</>
  <Done>done text</>
</>
`;
    const { errors, html } = compileToOutputs(src, "init-arm");
    expect(errors).toEqual([]);
    // Mount slot contains "loading text" (the Loading initial), not "idle text"
    expect(html).toMatch(/data-scrml-engine-mount="phase">[\s\S]*?loading text/);
    // The other arms' content is NOT in the static HTML — only render fns
    // contain it; rendered on variant change.
    const mountMatch = html.match(/data-scrml-engine-mount="phase">([\s\S]*?)<\/div>/);
    expect(mountMatch).not.toBeNull();
    if (mountMatch) {
      expect(mountMatch[1]).toContain("loading text");
      expect(mountMatch[1]).not.toContain("idle text");
      expect(mountMatch[1]).not.toContain("done text");
    }
  });

  test("default initial (no initial= attr) uses first state-child", () => {
    const src = `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase>
  <Idle rule=.Loading>idle here</>
  <Loading rule=.Idle>loading here</>
</>
`;
    const { errors, html, warnings } = compileToOutputs(src, "default-init");
    expect(errors).toEqual([]);
    // W-ENGINE-INITIAL-MISSING is expected — no `initial=` attr (first state-child fallback)
    expect(warnings.some((w) => /INITIAL-MISSING/.test(w?.code ?? ""))).toBe(true);
    // First state-child = Idle; mount slot has its body
    expect(html).toMatch(/data-scrml-engine-mount="phase">[\s\S]*?idle here/);
  });
});

// ---------------------------------------------------------------------------
// §12 — Per-arm wire-fn shape assertions (Phase A10 re-wire, S78 2026-05-10)
// ---------------------------------------------------------------------------
//
// These shape-level tests assert that the dispatcher emission carries the
// re-wire mechanism: per-arm wire functions, prior-dispose teardown,
// DOMContentLoaded initial-fire bridge, and the global-emission filter that
// prevents arm-tagged bindings from leaking into the file-level
// reactive-wiring block (which would bind to the wrong DOM handles).
//
// Integration tests (compile + happy-dom run) live below in §13.
// ---------------------------------------------------------------------------

describe("Phase A10 re-wire §12 — per-arm wire fn shape", () => {
  test("arm with ${@cell} emits a wire fn that queries within _root", () => {
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 0
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing>
    <div>Count: \${@count}</div>
  </>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "rewire-cell");
    expect(errors).toEqual([]);
    // Per-arm wire fn declared.
    expect(clientJs).toMatch(/function _scrml_engine_phase_wire_Showing\(_root\)/);
    expect(clientJs).toMatch(/function _scrml_engine_phase_wire_Idle\(_root\)/);
    // The Showing wire fn queries within _root, not document, and binds
    // textContent + _scrml_effect.
    const wireMatch = clientJs.match(
      /function _scrml_engine_phase_wire_Showing\(_root\) {[\s\S]*?_root\.querySelector\('\[data-scrml-logic=[\s\S]*?_scrml_effect\(function/,
    );
    expect(wireMatch).not.toBeNull();
    // Wire fn returns a dispose function.
    expect(clientJs).toMatch(
      /function _scrml_engine_phase_wire_Showing\(_root\) {[\s\S]*?return function\(\) { for \(const _d of _disposers\)/,
    );
    // The Idle wire fn (no arm bindings) is a no-op shell.
    expect(clientJs).toMatch(
      /function _scrml_engine_phase_wire_Idle\(_root\) { return function\(\) {}; }/,
    );
  });

  test("dispatcher tears down prior dispose before innerHTML replace, then re-wires", () => {
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 0
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing><div>Count: \${@count}</div></>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "rewire-dispose");
    expect(errors).toEqual([]);
    // Module-scope dispose handle for the currently-mounted arm.
    expect(clientJs).toMatch(/let __scrml_engine_phase_dispose = null;/);
    // Dispatcher: dispose-then-replace-then-rewire ordering.
    const dispatcherBody = clientJs.match(
      /function __scrml_engine_phase_dispatch\(_v\) {[\s\S]*?\n}/,
    );
    expect(dispatcherBody).not.toBeNull();
    if (dispatcherBody) {
      const body = dispatcherBody[0];
      const disposeIdx = body.indexOf("__scrml_engine_phase_dispose();");
      const innerHtmlIdx = body.indexOf("_mount.innerHTML =");
      const wireCallIdx = body.indexOf("_scrml_engine_phase_wire_");
      // Idempotency invariant: dispose precedes innerHTML, innerHTML
      // precedes the wire-call assignment that captures the new dispose.
      expect(disposeIdx).toBeGreaterThan(-1);
      expect(innerHtmlIdx).toBeGreaterThan(disposeIdx);
      expect(wireCallIdx).toBeGreaterThan(innerHtmlIdx);
    }
  });

  test("DOMContentLoaded initial-fire bridges subscribe-doesn't-fire-on-init gap", () => {
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 0
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing>Count: \${@count}</>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "rewire-domcl");
    expect(errors).toEqual([]);
    // The initial dispatch fires on DOM-ready. navigate-wave1c reshaped this into
    // a readyState-gated boot (`var _fire = ...; if (readyState === "loading")
    // addEventListener else _fire()`) so an injected route chunk still dispatches.
    expect(clientJs).toMatch(
      /var _fire = function\(\) { __scrml_engine_phase_dispatch\(_scrml_reactive_get\("phase"\)\); };/,
    );
    expect(clientJs).toMatch(/document\.readyState === "loading"/);
    expect(clientJs).toMatch(/document\.addEventListener\("DOMContentLoaded", _fire\)/);
  });

  test("arm-tagged logic-bindings are FILTERED OUT of global reactive-wiring block", () => {
    // The arm's `${@count}` should be wired ONLY by the per-arm wire fn,
    // not by the file-level "Reactive display wiring" block — otherwise
    // the file-level pass would bind to a stale querySelector handle that
    // points at detached DOM after the first variant change.
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 0
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing>Count: \${@count}</>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "rewire-filter");
    expect(errors).toEqual([]);
    // The global wiring block exists for top-level bindings (currently
    // none here so it may be absent). Critically: the count-binding
    // should appear in the wire fn, NOT in a `document.querySelector(`
    // call — wire fns query via `_root.querySelector(`.
    const wireFnMatch = clientJs.match(
      /function _scrml_engine_phase_wire_Showing\(_root\) {[\s\S]*?_root\.querySelector\('\[data-scrml-logic=[^']+'\)/,
    );
    expect(wireFnMatch).not.toBeNull();
    // Sanity: the arm-tagged logic placeholder should NOT also appear in
    // a `document.querySelector('[data-scrml-logic="<id>"]')` call —
    // that's the global pattern. Extract the placeholder id from the
    // wire fn match and assert it's absent in document. context.
    if (wireFnMatch) {
      const idMatch = wireFnMatch[0].match(/data-scrml-logic="([^"]+)"/);
      if (idMatch) {
        const id = idMatch[1];
        // Allow the arm wire fn's _root.querySelector reference but NOT
        // a global document.querySelector reference.
        expect(clientJs).not.toMatch(
          new RegExp(`document\\.querySelector\\('\\[data-scrml-logic="${id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"\\]'\\)`),
        );
      }
    }
  });

  test("idempotency: re-rendering same variant calls dispose-then-wire (no double-bind)", () => {
    // The dispatcher logic does NOT short-circuit when _tag matches the
    // currently-active variant. Each fire executes the dispose-then-wire
    // sequence, which is the idempotency guarantee: re-rendering the same
    // variant tears down the prior subscriptions and re-establishes
    // fresh ones, never accumulating duplicates.
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 0
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing>Count: \${@count}</>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "rewire-idem");
    expect(errors).toEqual([]);
    // Single `if (_tag === "Idle")` path; no special guard short-circuiting
    // re-renders of the same variant. Every fire runs the dispose-then-wire
    // sequence.
    const dispatcherBody = clientJs.match(
      /function __scrml_engine_phase_dispatch\(_v\) {[\s\S]*?\n}/,
    );
    expect(dispatcherBody).not.toBeNull();
    if (dispatcherBody) {
      // Exactly one prior-dispose teardown (above the if-chain).
      const disposeMatches = dispatcherBody[0].match(
        /if \(__scrml_engine_phase_dispose\) { __scrml_engine_phase_dispose\(\); __scrml_engine_phase_dispose = null; }/g,
      );
      expect(disposeMatches).not.toBeNull();
      expect(disposeMatches.length).toBe(1);
    }
  });

  test("tree-shake invariant — empty-body engine emits zero re-wire code", () => {
    // Phase A10 re-wire MUST NOT regress the empty-body tree-shake invariant.
    // No render fns, no wire fns, no dispatcher, no dispose handle.
    const src = `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>
`;
    const { errors, clientJs } = compileToOutputs(src, "rewire-shake");
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/_scrml_engine_phase_wire_/);
    expect(clientJs).not.toMatch(/__scrml_engine_phase_dispose/);
    expect(clientJs).not.toMatch(/_scrml_engine_phase_render_/);
    expect(clientJs).not.toMatch(/__scrml_engine_phase_dispatch/);
  });
});

// ---------------------------------------------------------------------------
// §13 — Integration tests via happy-dom (Phase A10 re-wire, S78 2026-05-10)
// ---------------------------------------------------------------------------
//
// These tests compile a scrml source, load the resulting HTML + client.js
// into happy-dom, and assert that:
//   - reactive `${@cell}` interpolation in the INITIAL arm responds to
//     subsequent cell changes (initial-fire via DOMContentLoaded);
//   - after a variant change to a non-initial arm, the new arm's
//     `${@cell}` interpolation is wired and responds to subsequent cell
//     changes (the v1 limitation closed by Phase A10 re-wire);
//   - re-rendering the same variant doesn't leak (idempotency).
//
// Conversion from the prior `.skip` block: see the SCOPE doc and the
// pre-rewire JSDoc-documented limitation in emit-variant-guard.ts.
// ---------------------------------------------------------------------------

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

if (!globalThis.document) GlobalRegistrator.register();

// Compile + load helper — writes a temp .scrml, compiles, reads HTML +
// client.js, loads them into happy-dom, fires DOMContentLoaded, and
// returns reactive-set/get handles.
function compileAndLoad(source, suffix) {
  const { errors, clientJs, html } = compileToOutputs(source, suffix);
  if (errors.length > 0) {
    throw new Error(
      `compile errors: ${errors.map((e) => e.code + ": " + e.message).join(", ")}`,
    );
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = cleanHtml;

  // Wrap runtime + client in an IIFE that exposes reactive handles to window.
  // eslint-disable-next-line no-eval
  const code =
    `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n` +
    `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n` +
    `window._scrml_reactive_subscribe = _scrml_reactive_subscribe;\n` +
    `})();`;
  // eslint-disable-next-line no-eval
  eval(code);

  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (name) => window._scrml_reactive_get(name),
    set: (name, val) => window._scrml_reactive_set(name, val),
  };
}

describe("Phase A10 re-wire §13 — DOM integration via happy-dom", () => {
  // happy-dom quirk: `el.textContent = 0` (falsy number) renders as empty
  // string; only stringified values render. To dodge this, integration
  // tests below use non-zero initial values and stringified payloads where
  // possible. See compiler/tests/browser/browser-reactive-arrays.test.js
  // for prior documentation of the quirk.

  test("initial-arm reactive interp responds to cell change", () => {
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 5
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing>Count: \${@count}</>
</>
`;
    const api = compileAndLoad(src, "dom-initial");
    // Initial render: the Showing arm body is in the static HTML inside
    // the mount slot. The DOMContentLoaded initial-fire calls the
    // dispatcher with `phase = "Showing"`, which dispatches to wire_Showing
    // — binding _scrml_effect for `${@count}`. Initial textContent ⇒ "5".
    const mount = document.querySelector('[data-scrml-engine-mount="phase"]');
    expect(mount).not.toBeNull();
    // Assert that the placeholder span's textContent reflects @count = 5.
    const span = mount.querySelector("[data-scrml-logic]");
    expect(span).not.toBeNull();
    expect(span.textContent).toBe("5");
    // Mutate @count → reactive effect fires, span text updates.
    api.set("count", 7);
    // Re-query the span — the wire fn binds the original handle, so its
    // textContent is now 7.
    expect(span.textContent).toBe("7");
  });

  test("post-variant-change reactive interp updates on cell change (v1 limitation closed)", () => {
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 5
}
<engine for=Phase initial=.Idle>
  <Idle></>
  <Showing>Count: \${@count}</>
</>
`;
    const api = compileAndLoad(src, "dom-postchange");
    // Initial: phase = Idle, mount innerHTML is empty (Idle has empty body).
    const mount = document.querySelector('[data-scrml-engine-mount="phase"]');
    expect(mount).not.toBeNull();
    // Initial-arm wire_Idle is a no-op (no arm bindings). No span in DOM.
    expect(mount.querySelector("[data-scrml-logic]")).toBeNull();
    // Transition to Showing.
    api.set("phase", "Showing");
    // Showing arm body is now in the mount via innerHTML replace.
    // wire_Showing fired, binding the new span's _scrml_effect.
    const span = mount.querySelector("[data-scrml-logic]");
    expect(span).not.toBeNull();
    expect(span.textContent).toBe("5");
    // Mutate @count → effect fires → textContent updates. THIS IS THE
    // CASE THAT WAS BROKEN IN v1 (the documented limitation).
    api.set("count", 42);
    expect(span.textContent).toBe("42");
  });

  test("idempotency: re-rendering same variant doesn't double-bind or leak", () => {
    const src = `\${
  type Phase:enum = { Idle, Showing }
  <count> = 5
}
<engine for=Phase initial=.Showing>
  <Idle></>
  <Showing>Count: \${@count}</>
</>
`;
    const api = compileAndLoad(src, "dom-idem");
    const mount = document.querySelector('[data-scrml-engine-mount="phase"]');
    const span0 = mount.querySelector("[data-scrml-logic]");
    expect(span0).not.toBeNull();
    expect(span0.textContent).toBe("5");
    // Re-render Showing several times. Each transition tears down the
    // prior dispose, then re-wires fresh. If subscriptions leaked, the
    // _scrml_effect call count would grow unbounded — and the span
    // textContent would still be correct but old detached spans would
    // also be receiving updates. We can't directly observe leak count
    // via happy-dom without internals, but we can sanity-check that
    // textContent stays correct across transitions.
    api.set("phase", "Idle");
    api.set("phase", "Showing");
    api.set("phase", "Idle");
    api.set("phase", "Showing");
    // Mount has the FRESH Showing innerHTML + a freshly-bound span.
    const spanN = mount.querySelector("[data-scrml-logic]");
    expect(spanN).not.toBeNull();
    expect(spanN.textContent).toBe("5");
    // Bump count — only the latest span should reflect the new value.
    api.set("count", 99);
    expect(spanN.textContent).toBe("99");
  });
});

// ---------------------------------------------------------------------------
// Test helper — minimal CompileContext stub for direct helper tests
// ---------------------------------------------------------------------------

function makeStubCtx() {
  // BindingRegistry import is lazy to avoid pulling the full codegen module
  // graph into test load time when only the stub is needed.
  const { BindingRegistry } = require("../../src/codegen/binding-registry.ts");
  return {
    filePath: "test.scrml",
    fileAST: { children: [], nodes: [], filePath: "test.scrml" },
    routeMap: null,
    depGraph: null,
    protectedFields: new Set(),
    authMiddleware: null,
    middlewareConfig: null,
    csrfEnabled: false,
    encodingCtx: null,
    mode: "browser",
    testMode: false,
    dbVar: "",
    workerNames: [],
    errors: [],
    registry: new BindingRegistry(),
    derivedNames: new Set(),
    analysis: null,
    usedRuntimeChunks: new Set(["core"]),
    exportRegistry: null,
  };
}
