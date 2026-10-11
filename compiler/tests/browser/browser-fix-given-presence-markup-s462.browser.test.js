/**
 * browser-fix-given-presence-markup-s462 — EXECUTES a markup `given` guard and the
 * `scrml fix` given-presence rewrite of it, side by side, in happy-dom.
 *
 * The rule refused a markup guard over a cell while its `if` rewrite rendered stale
 * (g-impl1-markup-if-branch-memo-stale-render-s462, resolved by #1397). The refusal is
 * lifted (s462-fix-rule-followups); this file is the proof that the rewrite renders what
 * the guard renders — including a read that changes while the presence test stays true.
 *
 * SPEC §42.2.3 (S462): "`${ given @u :> { <p>…</p> } }` | `${ if (@u is given) { <p>…</p> } }`"
 * — the canonical replacement, which "narrows what the deprecated form narrows".
 * SPEC §7.4.2: "the interpolation site SHALL re-render whenever any referenced cell changes".
 *
 * Each program is run through `fixGivenPresence` (the real rule, verify on); the test
 * asserts the rule rewrote every markup guard, then compiles → mounts → drives BOTH the
 * original and the rewrite and compares the DOM after every step.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { fixGivenPresence } from "../../src/commands/fix-given-presence.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-fix-given-presence-markup-s462");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__fgp_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  )(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = (name, v) => globalThis.__fgp_set(name, v);
/** The DOM a step leaves, as text: every element with an id or a class under `root`. */
const snapshot = (root) =>
  [...document.querySelectorAll(`${root} [id], ${root} [class]`)]
    .map((el) => `${el.tagName.toLowerCase()}#${el.id}.${el.className}=${el.textContent}`)
    .join(" | ") + ` || ${document.querySelector(root)?.textContent ?? "(no root)"}`;

/**
 * Rewrite `source` with the rule, then run `steps` against the original and the rewrite.
 * Each step is `{ do: () => void, expect?: string-snapshot-check }`. Returns both runs' snapshots.
 */
async function runBoth(source, baseName, steps, root = "main") {
  const fixed = fixGivenPresence(source, { filePath: resolve(tmpRoot, `${baseName}.scrml`) });
  const runs = {};
  for (const [label, src] of [["given", source], ["if", fixed.output]]) {
    const { errors, clientJs } = compileAndMount(src, `${baseName}-${label}`);
    expect(errors).toEqual([]);
    const shots = [snapshot(root)];
    for (const step of steps) {
      step();
      await flush();
      shots.push(snapshot(root));
    }
    runs[label] = { shots, clientJs };
  }
  return { fixed, runs };
}

describe("scrml fix given-presence — a markup guard and its rewrite render alike (s462-fix-rule-followups)", () => {
  test("a read of the tested cell that changes while the cell stays present re-renders in both", async () => {
    const src = `<user>: { name: string } | not = { name: "ada" }
<main>
    <div id="host">\${ given @user :> { <p id="name">\${@user.name}</p> } }</div>
</main>
`;
    const { fixed, runs } = await runBoth(src, "rename", [
      () => set("user", { name: "bob" }),
      () => set("user", { name: "cy" }),
      () => set("user", null),
      () => set("user", { name: "dee" }),
    ]);
    expect(fixed.blockers).toEqual([]);
    expect(fixed.output).toContain("${ if (@user is given) { <p id=\"name\">${@user.name}</p> } }");
    // The rewrite takes the arm-selector group (#1397), the guard the plain group.
    expect(runs.if.clientJs).toContain("_scrml_lift_if_group(");
    expect(runs.given.clientJs).not.toContain("_scrml_lift_if_group(");
    expect(runs.if.shots).toEqual(runs.given.shots);
    // The fresh value, not the stale "ada": the claim the gap made false before #1397.
    expect(runs.if.shots[1]).toContain("p#name.=bob");
    expect(runs.if.shots[2]).toContain("p#name.=cy");
    expect(runs.if.shots[3]).not.toContain("p#name");
    expect(runs.if.shots[4]).toContain("p#name.=dee");
  });

  test("a read of ANOTHER cell inside the guard re-renders while the guard stays true", async () => {
    const src = `<user>: { name: string } | not = { name: "ada" }
<greeting> = "hi"
<main>
    <div id="host">\${ given @user :> { <p id="g">\${@greeting} \${@user.name}</p> } }</div>
</main>
`;
    const { fixed, runs } = await runBoth(src, "other", [
      () => set("greeting", "yo"),
      () => set("user", { name: "bob" }),
      () => set("greeting", "hey"),
    ]);
    expect(fixed.applied.length).toBe(1);
    expect(runs.if.shots).toEqual(runs.given.shots);
    // (The space between the two interpolations is dropped by both forms alike.)
    expect(runs.if.shots[1]).toContain("p#g.=yoada");
    expect(runs.if.shots[3]).toContain("p#g.=heybob");
  });

  test("the multi-name guard is all-or-nothing in both (`@a is given && @b is given`)", async () => {
    const src = `type Item:struct = { name: string }
<a>: Item | not = not
<b>: Item | not = not
<main>
    <div id="guard">\${ given @a, @b :> { <p class="pair">\${@a.name}\${@b.name}</p> } }</div>
</main>
`;
    const { fixed, runs } = await runBoth(src, "multi", [
      () => set("a", { name: "x" }),
      () => set("b", { name: "y" }),
      () => set("b", { name: "z" }),
      () => set("a", null),
    ]);
    expect(fixed.output).toContain("if (@a is given && @b is given)");
    expect(runs.if.shots).toEqual(runs.given.shots);
    expect(runs.if.shots[1]).not.toContain("pair");
    expect(runs.if.shots[2]).toContain("p#.pair=xy");
    expect(runs.if.shots[3]).toContain("p#.pair=xz");
    expect(runs.if.shots[4]).not.toContain("pair");
  });

  test("`lift` in the guard body, and two guards in one `${ }` (the plain group) render alike", async () => {
    const src = `<u>: { name: string } | not = { name: "a" }
<w>: { name: string } | not = not
<main>
    <div id="one">\${ given @u :> { lift <p id="l">\${@u.name}</p> } }</div>
    <div id="two">\${ given @u :> { <p id="a">\${@u.name}</p> }
       given @w :> { <p id="b">\${@w.name}</p> } }</div>
</main>
`;
    const { fixed, runs } = await runBoth(src, "shapes", [
      () => set("u", { name: "b" }),
      () => set("w", { name: "c" }),
      () => set("u", null),
      () => set("w", { name: "d" }),
    ]);
    expect(fixed.applied.length).toBe(3);
    expect(fixed.blockers).toEqual([]);
    expect(runs.if.shots).toEqual(runs.given.shots);
    expect(runs.if.shots[1]).toContain("p#l.=b");
    expect(runs.if.shots[1]).toContain("p#a.=b");
    expect(runs.if.shots[4]).toContain("p#b.=d");
  });

  test("the conformance fixture the rule refused before (given-presence-deprecated-markup) renders \"bob\" both ways", async () => {
    const src = readFileSync(resolve(import.meta.dir, "../../../conformance/cases/condition/given-presence-deprecated-markup/case.scrml"), "utf8");
    const { fixed, runs } = await runBoth(src, "conf", [() => document.querySelector("#go").click()]);
    expect(fixed.applied.length).toBe(1);
    expect(runs.if.shots).toEqual(runs.given.shots);
    expect(runs.if.shots[0]).toContain("p#name.=ada");
    expect(runs.if.shots[1]).toContain("p#name.=bob");
  });
});
