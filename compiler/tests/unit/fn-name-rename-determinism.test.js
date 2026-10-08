/**
 * fn-name-rename-determinism.test.js
 *
 * S458 review of s457 (round 3) — a compile is a pure function of its inputs.
 *
 * The client user-function rename (codegen/fn-name-rename.ts) once kept a free
 * reference to a host global (`document`, `Math`, …) in the legacy call
 * positions only, so a compiler-emitted `document.…` was not captured by a user
 * `function document`. "Host global" was first decided by probing the
 * COMPILER's own process (`name in globalThis`): the same source compiled to
 * different client code depending on what ran the compiler —
 *
 *   plain Bun:                 _scrml_open_3.name + process.name + postMessage.name
 *   happy-dom globals present: open.name + process.name + postMessage.name
 *
 * (`open` is a window property in happy-dom; `process` / `postMessage` /
 * `reportError` / `Bun` differ between Bun and Node.) Every one of those left
 * the user's function un-renamed — a dangling reference to a name the bundle no
 * longer declares. S458 made the set a fixed list in source; S459 removed the
 * exception altogether (compiler host-global references go through `_scrml_g`,
 * S457 2a), so the rename consults no host-name set at all — `document` and
 * `Math` below are renamed like every other user function.
 *
 * Pinned here: the same source compiled (1) in-process with no DOM globals,
 * (2) in-process with happy-dom's globals registered, (3) by the CLI in a fresh
 * Bun process — byte-identical client code, with every user function renamed.
 */

import { describe, test, expect } from "bun:test";
import { resolve, join } from "path";
import { writeFileSync, readFileSync, rmSync, mkdtempSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");

// User functions named like globals of SOME host (happy-dom window property,
// Bun/Node global), each read as a member root inside a handler.
const SOURCE = `<program>
<v> = ""

function open(x) { return x }
function process(x) { return x }
function event(x) { return x }
function postMessage(x) { return x }
function reportError(x) { return x }
function document(x) { return x }
function Math(x) { return x }
function setV(s) { @v = s }

<div>
  <button id="b" onclick={ setV(open.name + process.name + event.name + postMessage.name + reportError.name + document.name + Math.name) }>go</button>
  <p id="out">\${@v}</p>
</div>
</program>
`;

async function withSource(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-det-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, SOURCE);
    return await fn(dir, file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compileInProcess(file) {
  const r = compileScrml({ inputFiles: [file], write: false, gather: true, log: () => {} });
  const errs = (r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? ""));
  expect(errs.map((e) => e.code)).toEqual([]);
  let js = "";
  for (const o of r.outputs.values()) js += o.clientJs ?? "";
  expect(js.length).toBeGreaterThan(0);
  return js;
}

describe("the client rename does not depend on the host running the compiler", () => {
  test("no DOM globals vs happy-dom globals vs the CLI in a fresh Bun process: byte-identical", async () => {
    const wasRegistered = GlobalRegistrator.isRegistered;
    if (wasRegistered) await GlobalRegistrator.unregister();
    try {
      await withSource(async (dir, file) => {
        expect("open" in globalThis).toBe(false);
        const plain = compileInProcess(file);

        GlobalRegistrator.register();
        let dom;
        try {
          expect("open" in globalThis).toBe(true);
          dom = compileInProcess(file);
        } finally {
          await GlobalRegistrator.unregister();
        }
        expect(dom).toBe(plain);

        const out = join(dir, "out");
        const p = Bun.spawnSync(["bun", CLI, "compile", file, "-o", out], { stdout: "pipe", stderr: "pipe" });
        expect(p.exitCode).toBe(0);
        const clientFile = readdirSync(out).find((f) => f.endsWith(".client.js"));
        expect(clientFile).toBeDefined();
        expect(readFileSync(join(out, clientFile), "utf8")).toBe(plain);

        // And the shared output is the RIGHT one: every user function is
        // renamed where the handler reads it as a member root.
        const line = plain.split("\n").find((l) => l.includes("_scrml_attr_onclick_"));
        expect(line).toBeDefined();
        for (const n of ["open", "process", "event", "postMessage", "reportError", "document", "Math"]) {
          expect(line).toMatch(new RegExp(`_scrml_${n}_\\d+\\.name`));
          expect(line).not.toMatch(new RegExp(`(?<![A-Za-z0-9_$.])${n}\\.name`));
        }
      });
    } finally {
      if (wasRegistered && !GlobalRegistrator.isRegistered) GlobalRegistrator.register();
    }
  });
});
