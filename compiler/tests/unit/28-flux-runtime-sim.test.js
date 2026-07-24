/**
 * 28-flux-runtime-sim.test.js — Runtime simulation for the Flux dog-food game.
 *
 * Flux (examples/28-flux.scrml) is a shifting-labyrinth explorer whose whole
 * design rests on REACTIVE rendering of a derived ASCII board. Pure-codegen
 * unit tests can't prove the board re-renders on state change; this loads the
 * runtime + compiled client.js in happy-dom and exercises the real mechanics:
 *   - the derived <board> renders (player + fog) and RE-RENDERS on move,
 *   - collision blocks walls,
 *   - SHIFT: a cell re-rolls after it leaves + re-enters vision (nonce bump),
 *   - MEMORY: Remember world-locks + decrements budget; Pin Home persists in fog,
 *   - reaching the seed-fixed exit wins.
 *
 * Fixed @seed=42 makes the world reproducible. This test is the primary
 * dog-food instrument — it pins the reactivity the §6.6 derived-cell path gives.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { storeByAuthorName, chunkCellKey } from "../helpers/chunk-scope.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-28-flux-runtime-sim");

// Compile once — the fixture is static.
let COMPILED = null;
function compileFlux() {
  if (COMPILED) return COMPILED;
  const fixturePath = resolve(__dirname, "../../../examples/28-flux.scrml");
  const src = readFileSync(fixturePath, "utf-8");
  const tmpDir = resolve(tmpRoot, `case-${process.pid}`);
  const tmpInput = resolve(tmpDir, "28-flux.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const html = readFileSync(resolve(outDir, "28-flux.html"), "utf-8");
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(resolve(outDir, "28-flux.client.js"), "utf-8")));
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf-8");
    COMPILED = { html, clientJs, runtimeJs };
    return COMPILED;
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Fresh game state in a fresh DOM for each test.
function boot() {
  const { html, clientJs: __cjRaw, runtimeJs } = compileFlux(); const clientJs = foldChunkNamespacing(__cjRaw);
  document.documentElement.innerHTML = html;
  new Function("window", "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__s = _scrml_state;\n` +
    `globalThis.__d = _scrml_derived_get;\n`)
  )(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  // The board is the reactive-display element holding the player glyph — find it by
  // content (its data-scrml-logic index shifts as other interpolations are added).
  const boardEl = Array.from(document.querySelectorAll("[data-scrml-logic]"))
    .find((e) => (e.textContent || "").includes("@"));
  return {
    S: () => storeByAuthorName(globalThis.__s),
    D: (k) => globalThis.__d(chunkCellKey(clientJs)(k)),
    boardDom: () => boardEl.textContent,
    btn: (label) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim().startsWith(label)),
  };
}

beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) {}
  GlobalRegistrator.register();
});
afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) {}
});

describe("28-flux runtime simulation", () => {
  test("initial board renders the player in a fog bubble; exit hint points east", () => {
    const g = boot();
    expect(g.S().px).toBe(7);
    expect(g.S().py).toBe(4);
    const dom = g.boardDom();
    expect(dom).toContain("@");          // player drawn
    expect(dom).toContain(" ");          // fog void outside vision
    // seed-42 exit is at (12,4) — out of initial vision (dist 5 > radius 2)
    expect(g.D("goalDir")).toBe("E");
    expect(g.D("goalDist")).toBe(5);
  });

  test("moving re-renders the board and advances the player (the keystone)", () => {
    const g = boot();
    const before = g.boardDom();
    // find an open direction
    let moved = null;
    for (const d of ["N", "S", "E", "W"]) {
      const a = [g.S().px, g.S().py];
      g.btn(d).click();
      if (g.S().px !== a[0] || g.S().py !== a[1]) { moved = d; break; }
    }
    expect(moved).toBeTruthy();
    expect(g.boardDom()).not.toBe(before);   // derived board re-rendered
    expect(g.S().xp).toBe(1);                 // exploring earns XP
  });

  test("collision: a wall blocks movement", () => {
    const g = boot();
    // (7,3) is open (spawn clearing); (7,2) above it is wall at nonce 0
    g.btn("N").click();
    expect([g.S().px, g.S().py]).toEqual([7, 3]);
    g.btn("N").click();                       // into the wall at (7,2)
    expect([g.S().px, g.S().py]).toEqual([7, 3]);  // blocked — unchanged
  });

  test("SHIFT: a cell re-rolls after leaving and re-entering vision", () => {
    const g = boot();
    const b0 = g.boardDom();
    // round-trip via the first open dir and back
    let d = null;
    for (const dir of ["N", "S", "E", "W"]) {
      const a = [g.S().px, g.S().py];
      g.btn(dir).click();
      if (g.S().px !== a[0] || g.S().py !== a[1]) { d = dir; break; }
    }
    const back = { N: "S", S: "N", E: "W", W: "E" }[d];
    g.btn(back).click();
    expect([g.S().px, g.S().py]).toEqual([7, 4]);     // back at spawn
    expect(Math.max(...g.S().nonce)).toBeGreaterThan(0); // cells left vision -> bumped
    expect(g.boardDom()).not.toBe(b0);                 // re-rolled on return
  });

  test("MEMORY: Remember world-locks + costs 1; Pin Home costs +1 and persists in fog", () => {
    const g = boot();
    expect(g.S().budget).toBe(6);
    g.btn("REMEMBER").click();
    expect(g.S().budget).toBe(5);
    expect(g.S().memories.length).toBe(1);
    expect(g.S().memories[0].home).toBe(false);
    g.btn("PIN").click();
    expect(g.S().budget).toBe(4);
    expect(g.S().memories[0].home).toBe(true);
    // walk the open y=4 corridor west until (7,4) is out of vision; it persists as "."
    let inFog = false, glyph = null;
    for (let i = 0; i < 6 && !inFog; i++) {
      const a = [g.S().px, g.S().py];
      g.btn("W").click();
      if (g.S().px === a[0] && g.S().py === a[1]) break;
      if (Math.max(Math.abs(g.S().px - 7), Math.abs(g.S().py - 4)) > g.D("vision")) {
        inFog = true;
        glyph = (g.boardDom().split("\n")[4] || "")[7];
      }
    }
    expect(inFog).toBe(true);
    expect(glyph).toBe(".");   // home memory still drawn through the fog
  });

  test("reaching the seed-fixed exit wins and grows the player", () => {
    const g = boot();
    const gx = g.D("goalX"), gy = g.D("goalY");
    let steps = 0;
    while (!g.S().won && steps < 100) {
      const dx = gx - g.S().px, dy = gy - g.S().py;
      const pref = Math.abs(dx) >= Math.abs(dy)
        ? [dx > 0 ? "E" : "W", dy > 0 ? "S" : "N"]
        : [dy > 0 ? "S" : "N", dx > 0 ? "E" : "W"];
      const a = [g.S().px, g.S().py];
      for (const d of [...pref, "N", "S", "E", "W"]) {
        g.btn(d).click();
        if (g.S().px !== a[0] || g.S().py !== a[1]) break;
      }
      if (g.S().px === a[0] && g.S().py === a[1]) break;  // stuck
      steps++;
    }
    expect(g.S().won).toBe(true);
    expect([g.S().px, g.S().py]).toEqual([gx, gy]);
    expect(g.S().level).toBeGreaterThanOrEqual(2);  // exploration leveled the player up
    expect(g.D("vision")).toBeGreaterThanOrEqual(3); // vision grew with level
  });
});
