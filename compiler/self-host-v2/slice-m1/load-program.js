// load-program.js — print a hand-built Core with the bootstrap printer and run
// the emitted program in happy-dom against the slice-M1 runtime.
//
// Each load writes the emitted `<name>.client.js` + a copy of the runtime into a
// FRESH directory and imports them, so every load gets its own runtime module
// instance (its own scope tree, registry, stats). The emitted page's templates
// are installed into <head>; its <script> tag is not (the test imports the
// module itself, as the browser would).
//
// `expose` lists program functions the TEST wants to call directly (functions a
// button does not reach, e.g. the reorder fixture's). Appending an export line
// is test scaffolding over a copy of the output — the printer never reads it.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBootstrap } from "./harness.js";

if (!globalThis.document) GlobalRegistrator.register();

// Exceptions thrown inside DOM event listeners do not propagate out of
// dispatchEvent — happy-dom (like a browser) reports them as a window `error`
// event. Capture them (and unhandled rejections) so a throwing handler FAILS the
// test instead of vanishing (review F1).
//
// ONE array for every instance of this module (s469): a combined run (`bun test
// ./slice-m1 ./slice-m2 …`) can load this file more than once, and the listeners
// are registered once per process — with a per-module array, every later
// instance's takePageErrors / expectNoPageErrors read an array nothing fills,
// so they silently checked NOTHING.
const pageErrors = (globalThis.__sliceM1PageErrors ??= []);
// The listeners are (re-)attached on EVERY use, never behind a once-per-process
// flag: in a combined run the window's listener registry was observed to lose
// them while every flag survived, so the capture silently stopped. The two
// listener functions are shared (one pair per process), and adding the same
// function again is a no-op (DOM `addEventListener`), so nothing is captured twice.
const listeners = (globalThis.__sliceM1PageListeners ??= {
  error: (e) => pageErrors.push(e.error ?? e.message),
  rejection: (e) => pageErrors.push(e.reason),
});
function ensureCapture() {
  window.addEventListener("error", listeners.error);
  window.addEventListener("unhandledrejection", listeners.rejection);
}
ensureCapture();

/** Drain the captured page errors. */
export function takePageErrors() {
  ensureCapture();
  return pageErrors.splice(0, pageErrors.length);
}

/** Throw if any page error was captured since the last drain (use in afterEach). */
export function expectNoPageErrors() {
  ensureCapture();
  const errs = takePageErrors();
  if (errs.length > 0) throw new Error("uncaught page error(s): " + errs.map((e) => String(e && e.stack ? e.message : e)).join(" | "));
}

const RUNTIME = join(import.meta.dir, "runtime", "runtime.js");

export function printCore(core, name) {
  const { mods } = loadBootstrap();
  return mods.print.printProgram(core, `${name}.client.js`, "scrml-runtime.js");
}

export async function loadProgram(core, name, expose = []) {
  const out = printCore(core, name);
  const dir = mkdtempSync(join(tmpdir(), `slice-m1-${name}-`));
  copyFileSync(RUNTIME, join(dir, "scrml-runtime.js"));
  const js = expose.length > 0 ? `${out.js}\nexport { ${expose.join(", ")} };\n` : out.js;
  writeFileSync(join(dir, `${name}.client.js`), js);
  writeFileSync(join(dir, `${name}.html`), out.html);

  const head = /<head>([\s\S]*)<\/head>/.exec(out.html)[1].replace(/<script[^>]*><\/script>/g, "");
  expectNoPageErrors();
  document.head.innerHTML = head;
  document.body.innerHTML = "";

  const rt = await import(join(dir, "scrml-runtime.js"));
  const program = await import(join(dir, `${name}.client.js`));
  return { rt, program, out, dir };
}

/** Click an element (a real bubbling DOM event); an error in a handler fails the caller. */
export function click(el) {
  expectNoPageErrors();
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  expectNoPageErrors();
}

/** All instances of the declaration named `declName` in the runtime registry, by id. */
export function instancesOf(rt, declName) {
  return [...rt.devtools.instances.values()].filter((i) => i.decl.name === declName).sort((a, b) => a.id - b.id);
}
