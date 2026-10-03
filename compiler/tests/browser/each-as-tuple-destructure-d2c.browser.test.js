/**
 * each-as-tuple-destructure-d2c.browser.test.js
 *
 * Runtime correctness gate for §59.8 / §14.11 (S169) `as (k, v)` positional
 * destructure on `<each>`. The unit test (each-as-tuple-destructure-d2c.test.js)
 * asserts the emitted-JS shape; this gate MOUNTS the emitted client.js in
 * happy-dom and asserts that k AND v actually bind to the entry struct's
 * `.key`/`.value` fields at runtime, across a 2-entry iteration — and that the
 * rendered text is byte-identical to the `as e` + `e.key`/`e.value` baseline
 * (the correctness anchor: the terse form is pure sugar).
 *
 * Covered BOTH parsers (legacy BS+TAB and `--parser=scrml-native`) until S449
 * retired the full-pipeline flag; the default pipeline remains. (impl#1 never
 * routes an each-bearing body through the native parser.)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

// {key,value} struct array — the destructure derives `.key`/`.value` regardless
// of whether the source is a real map (parser/codegen are field-name-agnostic).
const TUPLE_SRC = `<program>
type Entry:struct = { key: string, value: number }
<pairs>: Entry[] = [{ key: "DAL", value: 4500 }, { key: "HOU", value: 3200 }]
<ul>
    <each in=@pairs as (k, v)>
        <li>\${k}: \${v}</li>
    </each>
</ul>
</program>
`;

const SINGLE_SRC = `<program>
type Entry:struct = { key: string, value: number }
<pairs>: Entry[] = [{ key: "DAL", value: 4500 }, { key: "HOU", value: 3200 }]
<ul>
    <each in=@pairs as e>
        <li>\${e.key}: \${e.value}</li>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve(tmpdir(), "scrml-d2c-browser");

function compileToOutputs(source, baseName, parser) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function mountAndRead(source, baseName, parser) {
  const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName, parser);
  expect(errors).toEqual([]);
  document.documentElement.innerHTML = html;
  const exec = new Function("window", "document", `${runtimeJs}\n${clientJs}\n`);
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  const list = document.querySelector("ul");
  return (list ? list.textContent : document.body.textContent).replace(/\s+/g, " ").trim();
}

describe("each-as-tuple-destructure §runtime — k/v bind across iteration", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  for (const parser of [null]) {
    const label = parser ? "native" : "legacy";

    test(`(${label}) \`as (k, v)\` renders both bound fields for every entry`, () => {
      const out = mountAndRead(TUPLE_SRC, `tuple-${label}`, parser);
      // Both entries rendered, k=key and v=value bound correctly.
      expect(out).toContain("DAL: 4500");
      expect(out).toContain("HOU: 3200");
    });

    test(`(${label}) \`as (k, v)\` output == \`as e\`+e.key/e.value baseline`, () => {
      const tupleOut = mountAndRead(TUPLE_SRC, `tuple-eq-${label}`, parser);
      const singleOut = mountAndRead(SINGLE_SRC, `single-eq-${label}`, parser);
      expect(singleOut.length).toBeGreaterThan(0);
      expect(tupleOut).toBe(singleOut);
    });
  }
});
