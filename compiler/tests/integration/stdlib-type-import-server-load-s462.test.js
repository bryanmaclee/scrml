/**
 * S462 fix round 1 (item 4) — importing a stdlib TYPE must never take the
 * server bundle down.
 *
 * THE DEFECT. `import { KvStore } from 'scrml:store'` compiled clean, but the
 * emitted server bundle kept `KvStore` in its `import { … } from
 * "./_scrml/store.js"` line while the hand-written shim had no such export —
 * an ES link error ("Export named 'KvStore' not found") that kills EVERY route
 * of the bundle. W-TYPE-031 tells authors to annotate with exactly these types.
 *
 * THE FIX (structural, both halves):
 *   - a `:struct` / alias type has no run-time value → emit-server drops its
 *     specifier from a `scrml:` import (STDLIB-EXPORT-SEED records
 *     `typeHasRuntimeValue` per type export);
 *   - an `:enum` IS a run-time value (`KvError.ParseFailed(…)`) → its shim
 *     exports the frozen variant object.
 *
 * This test DERIVES the population: every `export type X:` declared in a
 * stdlib file that a `scrml:` specifier reaches (the module's index.scrml, a
 * by-name re-export there, or a submodule file with its own shim), imports each
 * in a server function, compiles, and LOADS the server bundle.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const STDLIB = join(ROOT, "stdlib");
const SHIMS = join(ROOT, "compiler", "runtime", "stdlib");
const TMP = mkdtempSync(join(tmpdir(), "s462-type-import-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const TYPE_RE = /^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*:\s*(\w+)/gm;
function declaredTypes(file) {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const m of readFileSync(file, "utf8").matchAll(TYPE_RE)) out.set(m[1], m[2]);
  return out;
}
function reExportedNames(file) {
  const names = new Set();
  for (const m of readFileSync(file, "utf8").matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w-]+)\.scrml['"]/g)) {
    for (const part of m[1].split(",")) {
      const t = part.trim().split(/\s+as\s+/);
      if (t[0]) names.add(JSON.stringify([t[0], t[1] ?? t[0], m[2]]));
    }
  }
  return [...names].map((s) => JSON.parse(s));
}

// specifier -> Map(typeName -> category)
const population = new Map();
for (const mod of readdirSync(STDLIB)) {
  const dir = join(STDLIB, mod);
  const index = join(dir, "index.scrml");
  if (!existsSync(index) || !existsSync(join(SHIMS, `${mod}.js`))) continue;
  const reach = new Map(declaredTypes(index));
  for (const [imported, local, sub] of reExportedNames(index)) {
    const cat = declaredTypes(join(dir, `${sub}.scrml`)).get(imported);
    if (cat) reach.set(local, cat);
  }
  if (reach.size) population.set(`scrml:${mod}`, reach);
  for (const f of readdirSync(dir)) {
    const sub = f.replace(/\.scrml$/, "");
    if (!f.endsWith(".scrml") || sub === "index" || !existsSync(join(SHIMS, mod, `${sub}.js`))) continue;
    const subTypes = declaredTypes(join(dir, f));
    if (subTypes.size) population.set(`scrml:${mod}/${sub}`, subTypes);
  }
}

describe("S462 — every reachable stdlib type import leaves a LOADABLE server bundle", () => {
  test("the derived population covers the S462 types and an enum per kind", () => {
    const all = new Map();
    for (const [spec, m] of population) for (const [n, c] of m) all.set(`${spec}#${n}`, c);
    for (const key of ["scrml:store#KvStore", "scrml:store#KvError", "scrml:auth#RateLimiter",
      "scrml:http#HttpClient", "scrml:oauth#OAuthStore", "scrml:crypto#CryptoError", "scrml:host#HostError"]) {
      expect({ key, present: all.has(key) }).toEqual({ key, present: true });
    }
  });

  let i = 0;
  for (const [spec, types] of population) {
    test(`${spec}: ${[...types.keys()].join(", ")}`, async () => {
      const names = [...types.keys()];
      const dir = join(TMP, `m${i++}`);
      const src = join(dir, "app.scrml");
      const params = names.map((n, k) => `p${k}: ${n}`).join(", ");
      const program =
        `<program>\n` +
        `import { ${names.join(", ")} } from '${spec}'\n` +
        `server function probe(${params}) {\n    return 1\n}\n` +
        `<p>\${probe(${names.map(() => "not").join(", ")})}</p>\n` +
        `</program>\n`;
      require("fs").mkdirSync(dir, { recursive: true });
      writeFileSync(src, program);
      const out = join(dir, "dist");
      const res = compileScrml({ inputFiles: [src], outputDir: out, write: true, log: () => {} });
      expect((res.errors || []).map((e) => e.code)).toEqual([]);
      const serverJs = join(out, "app.server.js");
      expect(existsSync(serverJs)).toBe(true);
      const text = readFileSync(serverJs, "utf8");
      for (const [n, cat] of types) {
        const importLine = text.split("\n").find((l) => /^import \{/.test(l) && l.includes("/_scrml/")) ?? "";
        // A struct / alias is erased from the import; an enum stays (run-time value).
        expect({ n, cat, imported: new RegExp(`\\b${n}\\b`).test(importLine) }).toEqual({ n, cat, imported: cat === "enum" });
      }
      // The load itself — the defect was a link error at import time.
      const mod = await import(serverJs);
      expect(mod).toBeTruthy();
    });
  }
});
