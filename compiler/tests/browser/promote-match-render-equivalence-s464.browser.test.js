/**
 * promote-match-render-equivalence-s464 — `scrml promote --match` SHALL NOT change what
 * renders (S464 Q24 fix rounds 1–2).
 *
 * Every chain promote accepts is rendered before and after the rewrite, in happy-dom,
 * for every variant of the scrutinee cell, and the two renders must be the same once the
 * compiler's own mount wrappers (`span[data-scrml-logic]`, `[data-scrml-match-mount]`)
 * are unwrapped. Every chain it must refuse is checked to leave the file untouched.
 * Measured on 868d1e414 (review N1): `<p id="host">Status: ${ if … } ok</p>` was
 * promoted and rendered `<p>Status: </p><div><b>a</b></div> ok`; duplicate variant arms
 * were promoted and the LATER arm rendered.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { promoteMatchOnFile } from "../../src/commands/promote.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-promote-render-eq-s464");
const D = "$" + "{";

function newDir() {
  const dir = resolve(tmpRoot, `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Compile + mount; returns a function that sets @m and returns the normalized #host render. */
function mount(filePath) {
  const outDir = join(filePath + ".out");
  const base = filePath.split("/").pop().replace(/\.scrml$/, "");
  const result = compileScrml({ inputFiles: [filePath], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  if (errors.length) throw new Error("compile errors: " + errors.join(","));
  const html = readFileSync(resolve(outDir, `${base}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${base}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  new Function("window", "document", `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
    `globalThis.__peq_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`))(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
}

function snapshot() {
  // The whole body: a parser restructure moves content OUT of #host.
  const c = document.body.cloneNode(true);
  for (const sel of ["span[data-scrml-logic]", "[data-scrml-match-mount]"]) {
    for (const el of [...c.querySelectorAll(sel)]) el.replaceWith(...el.childNodes);
  }
  return c.innerHTML.replace(/<!--[\s\S]*?-->/g, "").replace(/ data-scrml[a-z-]*="[^"]*"/g, "").replace(/\s+/g, " ").trim();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function renders(filePath, variants) {
  mount(filePath);
  const out = [];
  await flush();
  out.push(snapshot());
  for (const v of variants) {
    globalThis.__peq_set("m", v);
    await flush();
    out.push(snapshot());
  }
  return out;
}

const prog = (enumBody, body) => `<program>\ntype M:enum = { ${enumBody} }\n<m>: M = .A\n${body}\n</program>\n`;

const ACCEPTED = {
  "sole content of a `<section>`, `lift` arms":
    ["A, B", `<section id="host">\n  ${D} if (@m is .A) { lift <p>a</p> } else if (@m is .B) { lift <p>b</p> } }\n</section>`],
  "sole content of a `<div>`, bare arms, redundant else":
    ["A, B", `<div id="host">${D} if (@m is .A) { <p>a</p> } else if (@m is .B) { <p>b</p> } else { <p>never</p> } }</div>`],
  "block arms beside a sibling heading":
    ["A, B", `<div id="host">\n  <h1>t</h1>\n  ${D} if (@m is .A) { <p>a</p> } else if (@m is .B) { <p>b</p> } }\n</div>`],
};

const REFUSED = {
  "inline arms in a `<p>` with sibling text (review N1)":
    ["A, B, C", `<p id="host">Status: ${D} if (@m is .A) { <b>a</b> } else if (@m is .B) { <i>b</i> } else if (@m is .C) { <u>c</u> } } ok</p>`],
  "sole content of a `<span>`":
    ["A, B", `<span id="host">${D} if (@m is .A) { <b>a</b> } else if (@m is .B) { <i>b</i> } }</span>`],
  "inline arms beside sibling text in a `<div>`":
    ["A, B", `<div id="host">${D} if (@m is .A) { <b>a</b> } else if (@m is .B) { <i>b</i> } } tail</div>`],
  "duplicate variant arms (the source runs the first)":
    ["A, B", `<div id="host">${D} if (@m is .B) { <p>b</p> } else if (@m is .A) { <p>a1</p> } else if (@m is .A) { <p>a2</p> } }</div>`],
};

describe("promote --match never changes what renders (S464 Q24)", () => {
  for (const [label, [enumBody, body]] of Object.entries(ACCEPTED)) {
    test(`promoted, same render for every variant: ${label}`, async () => {
      const dir = newDir();
      const before = join(dir, "before.scrml");
      const after = join(dir, "after.scrml");
      writeFileSync(before, prog(enumBody, body));
      writeFileSync(after, prog(enumBody, body));
      const res = promoteMatchOnFile(after, null, {}, dir);
      expect(res.status).toBe("promoted");
      expect(readFileSync(after, "utf8")).toContain("<match for=M on=@m>");
      const variants = enumBody.split(",").map((s) => s.trim());
      expect(await renders(after, variants)).toEqual(await renders(before, variants));
    });
  }
  for (const [label, [enumBody, body]] of Object.entries(REFUSED)) {
    test(`refused, file untouched: ${label}`, () => {
      const dir = newDir();
      const f = join(dir, "app.scrml");
      const src = prog(enumBody, body);
      writeFileSync(f, src);
      const res = promoteMatchOnFile(f, null, {}, dir);
      expect(res.status).not.toBe("promoted");
      expect(readFileSync(f, "utf8")).toBe(src);
    });
  }
});
