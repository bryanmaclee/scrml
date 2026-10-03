/**
 * formfor-component-expand-in-arms-s177.browser.test.js — S177 g-formfor-in-match-arm.
 *
 * THE CANARY LESSON. This bug CLASS (silent non-render) hid because the existing
 * tests were compile-only / emit-string-only — none asserted the form/component
 * actually RENDERS. A compile-clean result was NOT acceptance.
 *
 * BUG (silent-non-render, broadened S177): the markup-expansion passes did NOT
 * recurse into engine `<engine>` state-child bodies OR `<match>` block-form arm
 * bodies, so a `<formFor>` / `<tableFor>` / a custom COMPONENT placed in those
 * contexts was emitted as a RAW tag (`<formFor .../>` / `<Badge .../>`) the
 * browser silently ignores. With a valid handler this was VALID-JS-but-silently-
 * wrong (the emitted-JS gate could not catch it); the empty-`onsubmit=${}`
 * sub-case additionally emitted invalid JS (`event.preventDefault(); ();`).
 *
 * ROOT (empirical, vs the brief's "walkers just need to recurse" framing):
 *   - engine state-children live in `engine-decl.bodyChildren` — walkable AST at
 *     CE/TS. formFor-in-engine already worked (r27-c6); component-in-engine did
 *     NOT (component-expander walkAndExpand never recursed bodyChildren).
 *   - match arm bodies are RAW TEXT (`armsRaw`) at the expansion stage, re-parsed
 *     to AST only at CODEGEN. So a walker had NOTHING to walk. The fix: ast-builder
 *     builds a walkable `match-block.armBodyChildren` (mirror of engine bodyChildren),
 *     the expansion passes recurse into it (formFor compound hoists to file scope
 *     at TS), and codegen `buildMatchArms` consumes the expanded wrapper body.
 *
 * Coverage (each slice asserts the EXPANDED output is in the RENDERED DOM, not a
 * literal `<formFor>`/`<tableFor>`/`<Badge>` tag):
 *   §1  formFor in a `<match>` arm (loud — empty onsubmit=${})  → real <form> + <input>, no invalid JS
 *   §2  formFor in a `<match>` arm (silent — valid handler)     → real <form> + <input> + wired cell
 *   §3  custom component in an `<engine>` state-child           → expanded <span class="badge">
 *   §4  custom component in a `<match>` arm                      → expanded <span class="badge">
 *   §5  tableFor in a `<match>` arm + an `<engine>` state-child  → real <table>, no raw <tableFor>
 *   §6  REGRESSION — formFor-in-engine (r27-c6) + top-level formFor + top-level component still render
 *   §7  emit-level — raw `<formFor`/`<tableFor`/`<Badge` ABSENT; cells wired
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

const tmpRoot = resolve(tmpdir(), "scrml-formfor-component-expand-in-arms-s177");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const serverPath = resolve(outDir, `${baseName}.server.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: (result.errors ?? []).filter((e) => e && e.severity !== "warning" && e.severity !== "info"),
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      serverJs: existsSync(serverPath) ? readFileSync(serverPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// §1 — formFor in a match arm, LOUD (empty onsubmit=${}).
const MATCH_FORMFOR_LOUD = `\${
    import { formFor } from 'scrml:data'
    type Cell:enum = { Draft, Submitted, Other }
    type NewExpense:struct = { merchant: string req length(>=2) }
    @cell = Cell.Draft
}
<program>
    <match for=Cell on=@cell>
        <Draft>
            <h2>Draft</h2>
            <formFor for=NewExpense onsubmit=\${} pick=["merchant"]>
                <slot name="merchant"><input bind:value=@newExpense.merchant /></slot>
            </formFor>
        </>
        <Submitted><h2>Submitted</h2></>
        <Other><h2>Other</h2></>
    </match>
</program>`;

// §2 — formFor in a match arm, SILENT (a valid typed onsubmit handler).
const MATCH_FORMFOR_SILENT = `\${
    import { formFor } from 'scrml:data'
    type Cell:enum = { Draft, Submitted, Other }
    type NewExpense:struct = { merchant: string req length(>=2) }
    @cell = Cell.Draft
    server function handleSubmit(values: NewExpense) ! string { return "ok" }
}
<program>
    <match for=Cell on=@cell>
        <Draft>
            <h2>Draft</h2>
            <formFor for=NewExpense onsubmit=handleSubmit pick=["merchant"]>
                <slot name="merchant"><input bind:value=@newExpense.merchant /></slot>
            </formFor>
        </>
        <Submitted><h2>Submitted</h2></>
        <Other><h2>Other</h2></>
    </match>
</program>`;

// §3 — custom component in an engine state-child.
const COMPONENT_IN_ENGINE = `\${
    type Cell:enum = { Draft, Submitted, Approved }
}
const Badge = <span class="badge" props={ label: string }>\${label}</span>
<program>
    <engine for=Cell initial=.Draft>
        <Draft rule=.Submitted>
            <h2>Draft</h2>
            <Badge label="hi"/>
        </>
        <Submitted rule=.Approved><h2>Submitted</h2></>
        <Approved><h2>Approved</h2></>
    </engine>
</program>`;

// §4 — custom component in a match arm.
const COMPONENT_IN_MATCH = `\${
    type Cell:enum = { Draft, Submitted, Other }
    @cell = Cell.Draft
}
const Badge = <span class="badge" props={ label: string }>\${label}</span>
<program>
    <match for=Cell on=@cell>
        <Draft>
            <h2>Draft</h2>
            <Badge label="hi"/>
        </>
        <Submitted><h2>Submitted</h2></>
        <Other><h2>Other</h2></>
    </match>
</program>`;

// §5 — tableFor in a match arm + an engine state-child.
const TABLEFOR_IN_MATCH = `\${
    import { tableFor } from 'scrml:data'
    type Cell:enum = { Draft, Submitted, Other }
    type Task:struct = { id: integer, title: string req, completed: boolean }
    @cell = Cell.Draft
    @tasks = []
}
<program>
    <match for=Cell on=@cell>
        <Draft>
            <h2>Draft</h2>
            <tableFor for=Task rows=@tasks/>
        </>
        <Submitted><h2>Submitted</h2></>
        <Other><h2>Other</h2></>
    </match>
</program>`;

const TABLEFOR_IN_ENGINE = `\${
    import { tableFor } from 'scrml:data'
    type Cell:enum = { Draft, Submitted, Approved }
    type Task:struct = { id: integer, title: string req, completed: boolean }
    @tasks = []
}
<program>
    <engine for=Cell initial=.Draft>
        <Draft rule=.Submitted>
            <h2>Draft</h2>
            <tableFor for=Task rows=@tasks/>
        </>
        <Submitted rule=.Approved><h2>Submitted</h2></>
        <Approved><h2>Approved</h2></>
    </engine>
</program>`;

// §6 regression sources.
const ENGINE_FORMFOR = `\${
    import { formFor } from 'scrml:data'
    type ReportStatus:enum = { Draft, Submitted, Approved }
    type NewExpense:struct = { merchant: string req length(>=2) }
}
<program>
    <engine for=ReportStatus initial=.Draft>
        <Draft rule=.Submitted>
            <h2>Draft</h2>
            <formFor for=NewExpense onsubmit=\${} pick=["merchant"]>
                <slot name="merchant"><input bind:value=@newExpense.merchant /></slot>
            </formFor>
        </>
        <Submitted rule=.Approved><h2>Submitted</h2></>
        <Approved><h2>Approved</h2></>
    </engine>
</program>`;

const TOP_FORMFOR = `\${
    import { formFor } from 'scrml:data'
    type NewExpense:struct = { merchant: string req length(>=2) }
}
<program>
    <formFor for=NewExpense onsubmit=\${} pick=["merchant"]>
        <slot name="merchant"><input bind:value=@newExpense.merchant /></slot>
    </formFor>
</program>`;

const TOP_COMPONENT = `\${
}
const Badge = <span class="badge" props={ label: string }>\${label}</span>
<program>
    <h2>Top</h2>
    <Badge label="hi"/>
</program>`;

// ---------------------------------------------------------------------------
// happy-dom mount: load the emitted client.js AS-IS, fire DOMContentLoaded.
// For a `<match>`, the initial arm renders client-side (the dispatcher's
// DOMContentLoaded fire). For an `<engine>`, the initial arm's body is the
// static HTML mount AND the dispatcher re-fires it. Either way the rendered
// DOM after DOMContentLoaded carries the EXPANDED markup.
// ---------------------------------------------------------------------------

function mount(source, baseName) {
  const { html, clientJs, runtimeJs, errors } = compileToOutputs(source, baseName);
  expect(errors).toEqual([]);
  document.documentElement.innerHTML = html;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n${clientJs}\n` +
      `globalThis.__scrml_set__ = typeof _scrml_reactive_set !== "undefined" ? _scrml_reactive_set : null;\n`,
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return {
    set: (name, val) => globalThis.__scrml_set__ && globalThis.__scrml_set__(name, val),
    body: () => document.body,
  };
}

describe("g-formfor-in-match-arm §1-5 — render verification (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  test("§1 formFor in a match arm (loud, empty onsubmit) renders a real <form> + <input>", () => {
    const app = mount(MATCH_FORMFOR_LOUD, "match-formfor-loud");
    const form = app.body().querySelector("form[data-scrml-formfor]");
    expect(form).not.toBeNull();
    expect(form.querySelector("input")).not.toBeNull();
    // The raw element MUST be gone from the rendered DOM.
    expect(app.body().innerHTML).not.toContain("<formfor");
  });

  test("§2 formFor in a match arm (silent, valid handler) renders a real <form> + <input>", () => {
    const app = mount(MATCH_FORMFOR_SILENT, "match-formfor-silent");
    const form = app.body().querySelector("form[data-scrml-formfor]");
    expect(form).not.toBeNull();
    expect(form.querySelector("input")).not.toBeNull();
    expect(app.body().innerHTML).not.toContain("<formfor");
  });

  test("§3 component in an engine state-child renders the expanded <span class='badge'>", () => {
    const app = mount(COMPONENT_IN_ENGINE, "component-in-engine");
    const badge = app.body().querySelector("span.badge");
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toBe("hi");
    expect(app.body().innerHTML).not.toContain("<badge");
  });

  test("§4 component in a match arm renders the expanded <span class='badge'>", () => {
    const app = mount(COMPONENT_IN_MATCH, "component-in-match");
    const badge = app.body().querySelector("span.badge");
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toBe("hi");
    expect(app.body().innerHTML).not.toContain("<badge");
  });

  test("§5a tableFor in a match arm renders a real <table>", () => {
    const app = mount(TABLEFOR_IN_MATCH, "tablefor-in-match");
    expect(app.body().querySelector("table")).not.toBeNull();
    expect(app.body().innerHTML).not.toContain("<tablefor");
  });

  test("§5b tableFor in an engine state-child renders a real <table>", () => {
    const app = mount(TABLEFOR_IN_ENGINE, "tablefor-in-engine");
    expect(app.body().querySelector("table")).not.toBeNull();
    expect(app.body().innerHTML).not.toContain("<tablefor");
  });

  test("§6a REGRESSION — formFor in an engine state-child (r27-c6) still renders", () => {
    const app = mount(ENGINE_FORMFOR, "engine-formfor");
    const form = app.body().querySelector("form[data-scrml-formfor]");
    expect(form).not.toBeNull();
    expect(form.querySelector("input")).not.toBeNull();
  });

  test("§6b REGRESSION — top-level formFor still renders", () => {
    const app = mount(TOP_FORMFOR, "top-formfor");
    expect(app.body().querySelector("form[data-scrml-formfor]")).not.toBeNull();
  });

  test("§6c REGRESSION — top-level component still renders", () => {
    const app = mount(TOP_COMPONENT, "top-component");
    const badge = app.body().querySelector("span.badge");
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toBe("hi");
  });
});

// ---------------------------------------------------------------------------
// §7 — emit-level: raw tag ABSENT from the shipped artifacts; cells wired.
// (No DOM needed — pure string assertions.)
// ---------------------------------------------------------------------------

describe("g-formfor-in-match-arm §7 — emit-level (raw tag absent; cells wired)", () => {
  test("§7a match-formfor (loud): no raw <formFor, no `preventDefault(); ()`, form wired", () => {
    const { clientJs, html, errors } = compileToOutputs(MATCH_FORMFOR_LOUD, "loud");
    expect(errors).toEqual([]);
    const out = clientJs + html;
    expect(out).not.toContain("<formFor ");
    expect(out).toContain("data-scrml-formfor");
    // The empty-onsubmit invalid JS must be gone (self-resolved by expansion).
    expect(clientJs).not.toContain("preventDefault(); ()");
  });

  test("§7b match-formfor (silent): no raw <formFor, @newExpense cell wired", () => {
    const { clientJs, errors } = compileToOutputs(MATCH_FORMFOR_SILENT, "silent");
    expect(errors).toEqual([]);
    expect(clientJs).not.toContain("<formFor ");
    expect(clientJs).toContain('"newExpense.merchant"');
  });

  test("§7c component-in-engine + component-in-match: no raw <Badge", () => {
    const a = compileToOutputs(COMPONENT_IN_ENGINE, "ce");
    const b = compileToOutputs(COMPONENT_IN_MATCH, "cm");
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(a.clientJs + a.html).not.toContain("<Badge ");
    expect(b.clientJs + b.html).not.toContain("<Badge ");
  });

  test("§7d tableFor-in-match + tableFor-in-engine: no raw <tableFor", () => {
    const a = compileToOutputs(TABLEFOR_IN_MATCH, "tm");
    const b = compileToOutputs(TABLEFOR_IN_ENGINE, "te");
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(a.clientJs + a.html).not.toContain("<tableFor ");
    expect(b.clientJs + b.html).not.toContain("<tableFor ");
  });
});
