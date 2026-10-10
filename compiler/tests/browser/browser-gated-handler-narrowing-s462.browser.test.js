/**
 * browser-gated-handler-narrowing-s462 — the RUNTIME premise of S462 Q18.
 *
 * SPEC §42.3.5 (ruling:user-voice-scrml.md S462 "a", Q18): an event handler inside an
 * `if=` gate KEEPS the gate's narrowing — `<div if=@user><button onclick={ @out =
 * @user.name }>` compiles — BECAUSE render-gating removes the subtree and its listener
 * synchronously on the write that ends the condition. This EXECUTES the emitted client
 * JS (happy-dom, the pruned runtime the build ships) and checks exactly that premise:
 *   1. the gated button works while `@user` is present;
 *   2. another control sets `@user = not` — the gated subtree is gone;
 *   3. a click DISPATCHED ON THE DETACHED button (a reference held from before) runs no
 *      handler: no TypeError, `@out` unchanged.
 * (The conformance case `reactive/narrowing-gated-handler-keeps-rt` covers 1–2 through
 * the impl-neutral driver, whose selector verbs cannot address a removed element.)
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-gated-handler-s462");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  if (errors.length > 0) return { errors };
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = bodyHtml;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__s462q18_get = _scrml_reactive_get;\n`),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const SRC = `<program>
type User:struct = { name: string }
<user>: User | not = { name: "a" }
<out> = ""
\${
    function signOut() { @user = not }
}
<button id="clear" onclick=signOut()>sign out</button>
<div if=@user>
    <button id="go" onclick={ @out = @user.name }>show name</button>
</div>
<p id="o">\${@out}</p>
</program>
`;

describe("S462 Q18 — a gated handler cannot run once its gate removed it", () => {
  test("compiles clean; the detached button's click runs nothing", async () => {
    const { errors } = compileAndMount(SRC, "gated");
    expect(errors).toEqual([]);
    await flush();

    const go = document.querySelector("#go");
    expect(go).not.toBeNull();
    go.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(globalThis.__s462q18_get("out")).toBe("a");

    document.querySelector("#clear").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // SYNCHRONOUS: gone before any task / microtask boundary (the Q18 premise).
    expect(document.querySelector("#go")).toBeNull();
    expect(go.isConnected).toBe(false);
    await flush();
    expect(document.querySelector("#go")).toBeNull();

    // A click dispatched on the removed element (held from before). A listener that
    // survived the unmount would run `@out = @user.name` on `not` and throw.
    const seen = [];
    const onError = (e) => { seen.push(e?.error ?? e?.message ?? e); };
    window.addEventListener("error", onError);
    const origConsoleError = console.error;
    console.error = (...a) => { seen.push(a); };
    try {
      go.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    } finally {
      window.removeEventListener("error", onError);
      console.error = origConsoleError;
    }
    expect(seen).toEqual([]);
    expect(globalThis.__s462q18_get("out")).toBe("a");
  });
});
