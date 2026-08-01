/**
 * engine-audit-statechild-port-s307.test.js — §51.11 audit on the MODERN engine.
 *
 * WHY THIS EXECUTES rather than inspecting the emit. The port's whole failure
 * mode is "the marker is present but nothing happens": before S307 the clause
 * was parsed and dropped, emitting no audit sites and no diagnostic. Grepping
 * the output for a registration would have passed on a build where the runtime
 * never pushed an entry — the same "emitted ≠ runs" trap that hid the S265
 * theme-switch DOA and the S268 component-root ReferenceError. So this drives a
 * real transition in happy-dom and reads the audit cell back.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

function compileToOutputs(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${name}.client.js`);
  const htmlPath = resolve(outDir, `${name}.html`);
  return {
    result,
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function run(clientJs, html) {
  // The engine's transitions table is a chunk-local const with a hashed name;
  // capture it by name so the test can drive the REAL write path.
  const tbl = (clientJs.match(/const (__scrml_engine_[A-Za-z0-9_]*_transitions) =/) || [])[1];
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code =
    `(function() {\n${SCRML_RUNTIME}\n` +
    captureInsideChunkScope(
      clientJs,
      `window._scrml_reactive_get = _scrml_reactive_get;\n` +
      `window._scrml_reactive_set = _scrml_reactive_set;\n` +
      `window.__engineDirectSet = _scrml_engine_direct_set;\n` +
      (tbl ? `window.__engineTable = ${tbl};\n` : ``),
    ) +
    `\n})();`;
  // eslint-disable-next-line no-eval
  eval(code);
}

const WITH_AUDIT = `\${ type Light:enum = { Red, Green } }
<program>
<engine for=Light initial=.Red>
  <Red rule=.Green></>
  <Green rule=.Red></>
  audit @slog
</>
<slog> = []
\${ function go() { @light = .Green } }
<p id="s">\${@light}</p>
<button id="b" onclick=go()>go</button>
</program>`;

describe("S307 §51.11 — audit on a MODERN <engine> state-child body", () => {
  test("the clause COMPILES (it used to be an error, and before that a no-op)", () => {
    const { result, cleanup } = compileToOutputs(WITH_AUDIT, "audit-compiles");
    const fatal = (result.errors || []).filter((e) => e.severity !== "warning");
    expect(fatal.map((e) => e.code)).toEqual([]);
    cleanup();
  });

  test("the audit target is REGISTERED in the emitted bundle", () => {
    const { clientJs, cleanup } = compileToOutputs(WITH_AUDIT, "audit-registered");
    // Registered as a CLOSURE built inside the chunk scope — so its reactive
    // get/set are the namespaced wrappers and the audit cell resolves in the
    // same key space as every other cell. Registering a raw cell NAME instead
    // read/wrote the wrong key space and left the log empty.
    expect(clientJs).toContain('_scrml_cs_engine_audit_register("light"');
    expect(clientJs).toContain('_scrml_cs_reactive_set("slog"');
    cleanup();
  });

  test("EXECUTES: a committed transition appends a §51.11.4 entry to the audit cell", () => {
    const { clientJs, html, cleanup } = compileToOutputs(WITH_AUDIT, "audit-runtime");
    run(clientJs, html);

    // Nothing recorded before any transition.
    expect(window._scrml_reactive_get("slog")).toEqual([]);

    // Drive a REAL transition through the engine's OWN write path — the same
    // `_scrml_engine_direct_set` the compiled `@light = .Green` lowers to,
    // captured inside the chunk scope so the cell keys match. (The button is
    // present but this harness does not install the runtime's event
    // delegation, so clicking it commits nothing — asserted below.)
    expect(typeof window.__engineDirectSet).toBe("function");
    window.__engineDirectSet("light", "Green", window.__engineTable, null, null, null, null, false);

    // Isolate: did the transition itself commit? If this fails the audit
    // assertion below would be blaming the wrong thing.
    expect(window._scrml_reactive_get("light")).toBe("Green");

    const log = window._scrml_reactive_get("slog");
    expect(Array.isArray(log)).toBe(true);
    expect(log).toHaveLength(1);
    // §51.11.4 entry shape — same tuple the legacy arrow-rules body records.
    expect(log[0].from).toBe("Red");
    expect(log[0].to).toBe("Green");
    expect(typeof log[0].at).toBe("number");
    expect(log[0].rule).toBe("Red:Green");
    cleanup();
  });

  test("tree-shake: an engine with NO audit clause registers nothing", () => {
    const noAudit = WITH_AUDIT.replace("  audit @slog\n", "");
    const { clientJs, cleanup } = compileToOutputs(noAudit, "audit-treeshake");
    expect(clientJs).not.toContain("engine_audit_register(");
    cleanup();
  });
});
