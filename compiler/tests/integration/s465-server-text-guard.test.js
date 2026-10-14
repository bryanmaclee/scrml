/**
 * S465 r4 — THE CLASS GUARD: no server-emitted code containing a call comes from the
 * raw-text lowering path.
 *
 * Four review rounds each found one more server position whose code was emitted from
 * TEXT (match arm bodies → `!{}` handler arms → bare blocks → same-line bare blocks →
 * destructuring defaults → tagged templates), and each shipped an async call
 * un-awaited: a Promise, truthy — `if (!check(pass, hash))` let a wrong password in.
 * r4 closes the class at the rewriter (codegen/server-text-guard.ts): the server
 * string rewriter is reached through ONE function (emit-expr `serverTextLowering`),
 * which refuses any text holding a call.
 *
 * This file holds that in place two ways:
 *   1. STRUCTURE — nothing in codegen but `serverTextLowering` calls the server
 *      rewriters (`rewriteServerExpr` / `rewriteServerExprArrowBody` / `serverPasses`).
 *   2. OUTPUT — every server shape the S465 reviews probed (rv3 + rv6 + r4, in
 *      fixtures/s465-server-shapes/) is compiled; a shape the compiler refuses is
 *      fine (fail closed), but a shape that COMPILES must ship no call to a known
 *      async function outside an `await`, and none of the raw-token spacing the text
 *      path leaves behind (`check ( pass , row . pw )`).
 */
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { compileScrml } from "../../src/api.js";

const ROOT = join(import.meta.dir, "../..");
const CODEGEN = join(ROOT, "src/codegen");
const SHAPES_DIR = join(import.meta.dir, "fixtures/s465-server-shapes");

// The async callees the shapes call: the imported user helper and the stdlib export.
const ASYNC_CALLEES = new Set(["check", "verifyPassword"]);

const LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
  export function plain(x) { return x + "!" }
}
`;
const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";

function appSource(name, body) {
  const sig = body.sig ?? "(name: string, pass: string)";
  return `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  import { verifyPassword } from "scrml:auth"
  function ${name}${sig} {
    ${ROW}
    ${body.fn}
  }
}
<out> = ""
<button onclick={ @out = ${name}("bob","x") }>${name}</button>
<p>\${@out}</p>
</program>
`;
}

/** Un-awaited calls to a known async function, as `callee@line` strings. */
function unawaitedAsyncCalls(js) {
  const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const bad = [];
  const walk = (node, parent) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "CallExpression") {
      const c = node.callee;
      const name = c.type === "Identifier" ? c.name
        : c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" ? c.property.name
        : null;
      if (name && ASYNC_CALLEES.has(name) && !(parent && parent.type === "AwaitExpression")) {
        bad.push(`${name}@${node.loc.start.line}`);
      }
    }
    if (node.type === "TaggedTemplateExpression" && node.tag.type === "Identifier" && ASYNC_CALLEES.has(node.tag.name)) {
      bad.push(`${node.tag.name}\`\`@${node.loc.start.line}`);
    }
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") walk(c, node); }
      else if (v && typeof v.type === "string") walk(v, node);
    }
  };
  walk(ast, null);
  return bad;
}

const NOT_CALLEES = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "in", "of", "new", "else", "do"]);
/** Raw-token spacing the text path leaves (`check ( pass , row . pw )`). */
function rawTokenArtifacts(js) {
  const out = [];
  for (const m of js.matchAll(/([A-Za-z_$][\w$]*) \( /g)) if (!NOT_CALLEES.has(m[1])) out.push(m[0]);
  for (const m of js.matchAll(/[\w$)\]] \. [A-Za-z_$]/g)) out.push(m[0]);
  return out;
}

describe("S465 r4 — the server rewriters have exactly one caller", () => {
  test("only emit-expr serverTextLowering calls rewriteServerExpr / rewriteServerExprArrowBody", () => {
    const offenders = [];
    for (const f of readdirSync(CODEGEN)) {
      if (!/\.(ts|js)$/.test(f)) continue;
      const src = readFileSync(join(CODEGEN, f), "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (/^\s*\*/.test(line)) return;
        // Importing a server rewriter is allowed in emit-expr.ts only.
        if (/^\s*import\b/.test(code) && /\b(rewriteServerExpr|rewriteServerExprArrowBody)\b/.test(code)) {
          if (f !== "emit-expr.ts") offenders.push(`${f}:${i + 1}: imports a server rewriter`);
          return;
        }
        for (const m of code.matchAll(/\b(rewriteServerExpr|rewriteServerExprArrowBody|serverPasses)\b\s*[(,;\]]/g)) {
          const allowed =
            (f === "rewrite.ts" && /export function rewriteServerExpr|runPasses\(expr, serverPasses|const serverPasses/.test(code)) ||
            (f === "emit-expr.ts" && /\? rewriteServerExprArrowBody\(text, dbVar|: rewriteServerExpr\(text, dbVar/.test(code));
          if (!allowed) offenders.push(`${f}:${i + 1}: ${code.trim().slice(0, 120)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("serverTextLowering consults the guard before the rewriter", () => {
    const src = readFileSync(join(CODEGEN, "emit-expr.ts"), "utf8");
    const at = src.indexOf("function serverTextLowering(");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("\n}\n", at));
    expect(body.indexOf("refuseServerTextCall(")).toBeGreaterThan(0);
    expect(body.indexOf("refuseServerTextCall(")).toBeLessThan(body.indexOf("rewriteServerExpr("));
  });
});

describe("S465 r4 — every probed server shape compiles fail-closed", () => {
  const files = readdirSync(SHAPES_DIR).filter((f) => f.endsWith(".mjs")).sort();
  let compiledTotal = 0;
  test("the fixture corpus is the full probe set", () => {
    expect(files.length).toBe(22);
  });
  for (const file of files) {
    test(`${file}: no un-awaited async call, no raw-token spacing in a compiled server bundle`, async () => {
      const { S } = await import(join(SHAPES_DIR, file));
      const work = mkdtempSync(join(tmpdir(), "s465-guard-"));
      const findings = [];
      let compiled = 0;
      try {
        for (const [name, raw] of Object.entries(S)) {
          const body = typeof raw === "object" ? raw : { fn: raw };
          const dir = join(work, name);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "lib.scrml"), LIB);
          writeFileSync(join(dir, "app.scrml"), appSource(name, body));
          const outDir = join(dir, "dist");
          let result;
          try {
            result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: outDir, log: () => {} });
          } catch (e) {
            findings.push(`${name}: compiler threw ${String(e).slice(0, 120)}`);
            continue;
          }
          const errs = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
          if (errs.length) continue; // refused — fail closed
          const sp = join(outDir, "app.server.js");
          if (!existsSync(sp)) continue;
          compiled++;
          const js = readFileSync(sp, "utf8");
          for (const c of unawaitedAsyncCalls(js)) findings.push(`${name}: un-awaited ${c}`);
          for (const a of rawTokenArtifacts(js)) findings.push(`${name}: raw-token \`${a}\``);
        }
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
      compiledTotal += compiled;
      expect(findings).toEqual([]);
    }, 300_000);
  }
  // The scan bites only on shapes that compile: most of the corpus must compile
  // (a guard that refuses everything would pass the scan vacuously).
  test("most shapes compile (the scan is not vacuous)", () => {
    expect(compiledTotal).toBeGreaterThan(150);
  });
});
