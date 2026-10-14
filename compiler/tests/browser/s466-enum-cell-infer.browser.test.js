/**
 * s466-enum-cell-infer — EXECUTES the emitted client JS for an unannotated enum cell
 * declared with a qualified variant (`<col> = Col.Red`), then written with bare
 * variants from a handler and from a function body.
 *
 * §14.10 / §66.3 rule 5 (ruling user-voice-scrml.md S464 "(a) Infer from initializer"):
 * the cell has type `Col`, so the bare writes resolve. Pre-fix the function-body write
 * was E-VARIANT-AMBIGUOUS and nothing compiled.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-s466-enum-cell-infer");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = bodyHtml;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__s466_get = _scrml_reactive_get;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const SRC = `\${
  type Col:enum = { Red, Blue }
}
<col> = Col.Red
\${ function flip() { @col = .Red } }
<button id="blue" onclick={ @col = .Blue }>b</button>
<button id="red" onclick={ flip() }>r</button>
<p id="out">\${@col}</p>
`;

describe("<col> = Col.Red — inferred enum cell, executed", () => {
  test("compiles, starts at Red, a handler write sets Blue, a function-body write sets Red", async () => {
    const { errors } = compileAndMount(SRC, "enum-cell-infer");
    expect(errors).toEqual([]);
    expect(globalThis.__s466_get("col")).toBe("Red");
    document.querySelector("#blue").click();
    await flush();
    expect(globalThis.__s466_get("col")).toBe("Blue");
    expect(document.querySelector("#out").textContent).toContain("Blue");
    document.querySelector("#red").click();
    await flush();
    expect(globalThis.__s466_get("col")).toBe("Red");
    expect(document.querySelector("#out").textContent).toContain("Red");
  });
});
