/**
 * errors-element-messages-chunk-gh234.browser.test.js — GH #234 EXECUTION
 * acceptance: a page carrying `<errors of=.../>` must ship the `messages`
 * runtime chunk that its emitted wiring references.
 *
 * Adopter symptom (network-captured, scrml 0.7.1):
 *
 *     ReferenceError: _scrml_message_for is not defined
 *         at _scrml_cs_message_for (login.client.js:19:44)
 *         at HTMLDocument._scrml_boot (login.client.js:266:7)
 *
 * The throw lands INSIDE `_scrml_boot`, so boot aborts and every wiring step
 * after the `<errors>` block never runs — the login form issued zero network
 * requests while every server route was green over `curl`.
 *
 * Root cause: the `messages` chunk (which defines `_scrml_message_for`) was
 * gated ONLY on a state-decl validator carrying a Level-1 `inlineOverride`.
 * The C11 `<errors>` wiring references the same helper but marked nothing, so
 * the tree-shaker dropped the definition and kept the reference.
 *
 * Why the emitted `typeof` guard did not save it: `_scrml_message_for` is a
 * CELL_SCOPE_ACCESSOR, so the post-hoc chunk-namespace rename rewrites BOTH
 * occurrences — including the one inside `typeof` — to `_scrml_cs_message_for`,
 * which the chunk prologue ALWAYS defines. The guard was therefore always true
 * and the ReferenceError fired one frame deeper, inside the wrapper body.
 *
 * WHY THIS TEST EXECUTES RATHER THAN GREPS: the emitted text looks correct at
 * every layer. Both the call site and the guard are present and well-formed;
 * only the tree-shaken runtime is missing the definition. A grep for the
 * emitted wiring is a false green — this is precisely how the defect reached
 * an adopter. The test therefore loads the EMITTED (tree-shaken) runtime file,
 * runs `_scrml_boot` with real error propagation, and asserts rendered DOM.
 *
 * The negative case is equally load-bearing: a page with NO `<errors>` must
 * still tree-shake the chunk away (§C10.1 payload budget). The fix is
 * demand-marking, not always-shipping.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve("/tmp", "scrml-gh234-errors-messages-chunk");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const htmlPath = resolve(outDir, `${baseName}.html`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

/**
 * Load the emitted bundle and run boot with REAL error propagation.
 *
 * `document.dispatchEvent(new Event("DOMContentLoaded"))` is not usable for
 * this assertion: happy-dom swallows a listener throw and reports it to the
 * console, so the harness would see a clean dispatch while boot was in fact
 * dead — a false green of exactly the kind this test exists to prevent.
 * Instead we intercept the `DOMContentLoaded` registration, then invoke the
 * captured `_scrml_boot` ourselves inside a try/catch.
 */
function mountAndBoot(compiled) {
  const { clientJs, runtimeJs, html } = compiled;

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .trim();

  const bootHandlers = [];
  const realAdd = document.addEventListener.bind(document);
  document.addEventListener = function (type, fn, opts) {
    if (type === "DOMContentLoaded" && typeof fn === "function") {
      bootHandlers.push(fn);
      return undefined;
    }
    return realAdd(type, fn, opts);
  };

  let loadError = null;
  let bootError = null;
  try {
    // The tree-shaken runtime FILE, not the SCRML_RUNTIME template — shipping
    // the full template here would mask every tree-shake defect by definition.
    new Function("window", "document", `${runtimeJs}\n${clientJs}\n`)(window, document);
  } catch (e) {
    loadError = e;
  } finally {
    delete document.addEventListener;
  }

  for (const fn of bootHandlers) {
    try {
      fn();
    } catch (e) {
      bootError = e;
      break;
    }
  }

  return {
    loadError,
    bootError,
    bootHandlerCount: bootHandlers.length,
    anchorHtml: () => {
      const el = document.querySelector("[data-scrml-errors-anchor]");
      return el ? el.innerHTML : null;
    },
  };
}

// The adopter's minimal reproducer, verbatim in shape: one validated compound
// field plus one `<errors of=…/>`. No inline message override anywhere — that
// absence is what left the `messages` chunk unmarked.
const ERRORS_SRC = `<page>
  <signupForm>
      <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
  </>
  <form>
    <input type="email" value="\${@signupForm.email}"/>
    <errors of=@signupForm.email/>
  </form>
</page>
`;

// Same page with an event handler wired after the form — the adopter's actual
// failure was "fill the form, click Sign in, zero network requests", i.e. boot
// aborting before handler binding.
const ERRORS_WITH_HANDLER_SRC = `<page>
  <signupForm>
      <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
  </>
  <clicks> = 0
  function signIn() {
      @clicks = @clicks + 1
  }
  <form>
    <input type="email" value="\${@signupForm.email}"/>
    <errors of=@signupForm.email/>
    <button id="go" onclick=signIn()>Sign in</>
  </form>
</page>
`;

// No `<errors>`, no inline override — the chunk must stay tree-shaken.
const NO_ERRORS_SRC = `<page>
  <email> = ""
  <form>
    <input type="email" value="\${@email}"/>
  </form>
</page>
`;

describe("GH #234 — <errors of=…/> ships the messages runtime chunk", () => {
  test("compiles clean", () => {
    const out = compileToOutputs(ERRORS_SRC, "gh234_errors");
    expect(out.errors).toEqual([]);
    expect(out.clientJs.length).toBeGreaterThan(0);
    expect(out.runtimeJs.length).toBeGreaterThan(0);
  });

  test("the emitted runtime DEFINES the helper the wiring references", () => {
    const out = compileToOutputs(ERRORS_SRC, "gh234_errors");
    // Necessary but NOT sufficient — the execution assertions below are the
    // real gate. Kept because it localises a regression to the chunk gate.
    expect(out.clientJs).toContain("message_for");
    expect(out.runtimeJs).toContain("function _scrml_message_for");
  });

  test("_scrml_boot runs to completion — no ReferenceError", () => {
    const out = compileToOutputs(ERRORS_SRC, "gh234_errors");
    const app = mountAndBoot(out);
    expect(app.loadError).toBeNull();
    expect(app.bootHandlerCount).toBeGreaterThan(0);
    expect(app.bootError).toBeNull();
  });

  test("the <errors> anchor renders the resolved Level-3 message", () => {
    const out = compileToOutputs(ERRORS_SRC, "gh234_errors");
    const app = mountAndBoot(out);
    // Pre-fix this was "" — the render effect threw before writing innerHTML.
    expect(app.anchorHtml()).toBe('<p class="scrml-error">email is required.</p>');
  });

  test("boot completes on a page that also wires a click handler", () => {
    const out = compileToOutputs(ERRORS_WITH_HANDLER_SRC, "gh234_errors_handler");
    expect(out.errors).toEqual([]);
    const app = mountAndBoot(out);
    expect(app.loadError).toBeNull();
    expect(app.bootError).toBeNull();
    expect(app.anchorHtml()).toBe('<p class="scrml-error">email is required.</p>');
  });

  test("a page with no <errors> still tree-shakes the messages chunk", () => {
    const out = compileToOutputs(NO_ERRORS_SRC, "gh234_no_errors");
    expect(out.errors).toEqual([]);
    expect(out.clientJs).not.toContain("message_for");
    expect(out.runtimeJs).not.toContain("_scrml_message_for");
    expect(out.runtimeJs).not.toContain("_SCRML_DEFAULT_MESSAGES");
  });
});
