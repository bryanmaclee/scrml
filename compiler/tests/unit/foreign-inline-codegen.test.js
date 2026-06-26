/**
 * Inline value-returning `_={ … }=` foreign-code in a logic context — codegen
 * (dpa-003, ratified S216 Approach B + the §23.2.4 amendment).
 *
 * The INLINE value-returning form `const out = _={ in:{…} … }=` in a server-fn
 * body (lang="ts"/"js" ONLY). Pre-build: `_={` was mis-tokenized as `_ = {`
 * (identifier + assign + object) → E-CODEGEN-INVALID-JS, and the §23.2.2
 * ForeignBlock node had NO producer and NO codegen consumer.
 *
 * The build:
 *   - block-splitter.js: matchForeignOpener + pushForeignContext + the opaque
 *     level-aware `}=` closer scan; topIsBraceContext/BLOCKREF wiring.
 *   - tokenizer.ts: BLOCKREF_TYPES += "foreign".
 *   - ast-builder.js: buildBlock case "foreign" (FIRST ForeignBlock producer —
 *     raw/body/crossings/level) + tryConsumeForeignInit wired into
 *     const/let-decl + return-stmt paths (foreignNode attachment).
 *   - emit-logic.ts: case "foreign" — `await (async (<in>) => { <slice> })(<in>)`
 *     (codegen-injected await at the §13180 boundary); const/let-decl foreignNode
 *     handling mirrors sqlNode.
 *   - route-inference.ts: a foreign node / foreignNode is a server trigger
 *     (dpa-004 C2; mirrors E-SQL-004) — keeps the opaque slice off the client.
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `fic-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_fic_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let serverJs = null;
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        serverJs = output.serverJs ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], serverJs, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

function runAst(src) {
  const bs = splitBlocks("foreign-inline.scrml", src);
  return buildAST(bs).ast;
}

function findForeign(node, hits = []) {
  if (!node || typeof node !== "object") return hits;
  if (node.kind === "foreign") hits.push(node);
  if (node.foreignNode && node.foreignNode.kind === "foreign") hits.push(node.foreignNode);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => findForeign(c, hits));
    else if (v && typeof v === "object") findForeign(v, hits);
  }
  return hits;
}

const DISPATCHER = `<program lang="ts" db="./flogence.db">
  function dispatchOne(prompt: string, path: string) {
    const out = _={ in: { prompt, path }
      await new Response(
        Bun.spawn(["claude","-p",prompt,"--output-format","text"], { cwd: path }).stdout
      ).text()
    }=
    return out
  }

  export function runDispatch(prompt: string, path: string) {
    return dispatchOne(prompt, path)
  }
</program>
`;

describe("inline _{} foreign-code codegen (dpa-003 / S216)", () => {
  test("§1 AST — `const out = _={ in:{…} … }=` produces a const-decl with a foreignNode (level 1, crossings, body)", () => {
    const ast = runAst(DISPATCHER);
    const hits = findForeign(ast);
    expect(hits.length).toBeGreaterThan(0);
    const fn = hits[0];
    expect(fn.kind).toBe("foreign");
    expect(fn.level).toBe(1);
    expect(fn.crossings).toEqual(["prompt", "path"]);
    // body is the header-stripped verbatim slice; the `in:{}` header is removed.
    expect(fn.body).not.toContain("in: {");
    expect(fn.body).toContain("Bun.spawn");
  });

  test("§2 codegen — server JS wraps the slice in an async IIFE with the named crossings + an injected await", () => {
    const { errors, serverJs } = compileSource(DISPATCHER, "disp");
    const cgErr = errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS");
    expect(cgErr.length).toBe(0);
    expect(serverJs).toBeTruthy();
    // `await (async (prompt, path) => { … })(prompt, path)` — boundary await injected.
    expect(serverJs).toMatch(/await \(async \(prompt, path\) =>/);
    expect(serverJs).toMatch(/\}\)\(prompt, path\)/);
    expect(serverJs).toContain("Bun.spawn");
  });

  test("§3 server-color — the opaque foreign slice NEVER appears in client.js (server-classified)", () => {
    const { clientJs, serverJs } = compileSource(DISPATCHER, "disp");
    expect(serverJs).toContain("Bun.spawn");
    expect(clientJs ?? "").not.toContain("Bun.spawn");
    expect(clientJs ?? "").not.toContain("claude");
    expect(clientJs ?? "").not.toContain("async (prompt, path)");
  });

  test("§4 server-color — the dispatcher fn is escalated to a server route, the client gets a fetch stub", () => {
    const { serverJs, clientJs } = compileSource(DISPATCHER, "disp");
    expect(serverJs).toMatch(/dispatchOne/);
    expect(clientJs ?? "").toMatch(/fetch/);
  });

  test("§5 compiles exit-0 (no E-CODEGEN-INVALID-JS — the pre-build failure mode)", () => {
    const { errors } = compileSource(DISPATCHER, "disp");
    const fatal = errors.filter(
      (e) => e.code === "E-CODEGEN-INVALID-JS" || e.code === "E-FOREIGN-004",
    );
    expect(fatal.length).toBe(0);
  });

  test("§6 OUT-typing — a call-site annotation `const out: string = _={…}=` flows + compiles clean", () => {
    const src = `<program lang="ts" db="./flogence.db">
  export function dispatchTyped(prompt: string, path: string) {
    const out: string = _={ in: { prompt, path }
      await new Response(Bun.spawn(["claude","-p",prompt],{cwd:path}).stdout).text()
    }=
    return out
  }
</program>
`;
    const { errors, serverJs } = compileSource(src, "typed");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS").length).toBe(0);
    expect(serverJs).toMatch(/await \(async \(prompt, path\) =>/);
  });

  test("§7 lang gate — a non-ts/js `lang=` on a value-returning _{} fires E-FOREIGN-005 (once)", () => {
    const src = `<program lang="go" db="./flogence.db">
  export function dispatchGo(prompt: string) {
    const out = _={ in: { prompt }
      doSomethingGo(prompt)
    }=
    return out
  }
</program>
`;
    const { errors } = compileSource(src, "go");
    const f5 = errors.filter((e) => e.code === "E-FOREIGN-005");
    expect(f5.length).toBe(1);
  });

  test("§8 lang gate — no `lang=` on any ancestor `<program>` fires E-FOREIGN-003 (once)", () => {
    const src = `<program db="./flogence.db">
  export function dispatchNoLang(prompt: string) {
    const out = _={ in: { prompt }
      doSomething(prompt)
    }=
    return out
  }
</program>
`;
    const { errors } = compileSource(src, "nolang");
    const f3 = errors.filter((e) => e.code === "E-FOREIGN-003");
    expect(f3.length).toBe(1);
  });

  test("§9 admitted form gate — a BARE (non-value-returning) `_{}` fires E-FOREIGN-004", () => {
    const src = `<program lang="ts">
  <count> = 0
  ${"${"}
    _={ in: {}
      console.log("bare foreign, not bound, not returned")
    }=
  }
</program>
`;
    const { errors } = compileSource(src, "bare");
    const f4 = errors.filter((e) => e.code === "E-FOREIGN-004");
    expect(f4.length).toBe(1);
  });

  test("§10 level-2 `_=={ … }==` — an embedded `}=` inside the slice does not prematurely close (opaque scan)", () => {
    const src = `<program lang="ts" db="./d.db">
  export function lvl2(p: string) {
    const out = _=={ in: { p }
      await Promise.resolve("contains }= inside safely")
    }==
    return out
  }
</program>
`;
    const { errors, serverJs } = compileSource(src, "lvl2");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS" || e.code === "E-CTX-001").length).toBe(0);
    expect(serverJs).toContain("contains }= inside safely");
    expect(serverJs).toMatch(/await \(async \(p\) =>/);
  });

  test("§11 mixed sigils — a `?{}` and a `_{}` in the same server fn both stay server, neither leaks to client", () => {
    const src = `<program lang="ts" db="./d.db">
  export function mix(prompt: string, id: string) {
    const row = ?{${"`"}SELECT name FROM users WHERE id = \${id}${"`"}}.get()
    const out = _={ in: { prompt }
      await Promise.resolve(prompt)
    }=
    return out
  }
</program>
`;
    const { serverJs, clientJs } = compileSource(src, "mix");
    expect(serverJs).toContain("_scrml_sql");
    expect(serverJs).toContain("Promise.resolve");
    expect(clientJs ?? "").not.toContain("_scrml_sql");
    expect(clientJs ?? "").not.toContain("Promise.resolve");
  });

  test("§12 value-flow — a SINGLE-expression slice is wrapped as `return (slice)` so the value flows", () => {
    const { serverJs, errors } = compileSource(DISPATCHER, "vf1");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS").length).toBe(0);
    // single-expression dispatcher slice → codegen-injected `return (…)`.
    expect(serverJs).toMatch(/return \(await new Response\(/);
  });

  test("§13 value-flow — a NESTED `return` (inside an arrow) is NOT mistaken for the slice's top-level return", () => {
    const src = `<program lang="ts" db="./d.db">
  export function nestedRet(items: string) {
    const out = _={ in: { items }
      const mapped = items.split(",").map((x) => { return x.trim() })
      return await Promise.resolve(mapped.join("|"))
    }=
    return out
  }
</program>
`;
    const { serverJs, errors } = compileSource(src, "vf2");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS").length).toBe(0);
    // The author's own top-level `return await Promise.resolve(...)` is preserved
    // verbatim — the multi-statement body is NOT re-wrapped as `return (…)`.
    expect(serverJs).toContain("return await Promise.resolve(mapped.join(\"|\"))");
    // and the nested-arrow return is untouched.
    expect(serverJs).toContain("(x) => { return x.trim() }");
  });

  // --- E-FOREIGN-006: crossing-shadow (ss23 item 3) ------------------------
  // The `in:{}` crossing names become the async-IIFE PARAMETERS. If the
  // verbatim slice ALSO declares a TOP-LEVEL binding of the same name, the
  // emitted IIFE redeclares the parameter — invalid JS. Pre-fix this surfaced
  // as the MISLEADING post-emit E-CODEGEN-INVALID-JS ("compiler defect, please
  // report it"), even though it is AUTHOR error. A pre-emit syntactic scan now
  // fires the clear E-FOREIGN-006 (naming the shadowed binding) instead.

  test("§14 crossing-shadow — a `const x` slice-local colliding with `in:{x}` fires E-FOREIGN-006, NOT the misleading E-CODEGEN-INVALID-JS", () => {
    const src = `<program lang="ts" db="./d.db">
  export function shadower(x: string) {
    const out = _={ in: { x }
      const x = "shadowed"
      return await Promise.resolve(x)
    }=
    return out
  }
</program>
`;
    const { errors } = compileSource(src, "shadow");
    const f6 = errors.filter((e) => e.code === "E-FOREIGN-006");
    const cg = errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS");
    expect(f6.length).toBe(1);
    // The clear diagnostic NAMES the shadowed binding (author error) ...
    expect(f6[0].message).toContain("`x`");
    expect(f6[0].message).toContain("§23.2.4a");
    // ... and the misleading "compiler defect" code does NOT cascade.
    expect(cg.length).toBe(0);
  });

  test("§15 crossing-shadow — a `function`/`class` slice-local colliding with `in:{}` also fires E-FOREIGN-006 (naming the binding)", () => {
    const fnSrc = `<program lang="ts" db="./d.db">
  export function fnS(handler: string) {
    const out = _={ in: { handler }
      function handler() { return 1 }
      return await Promise.resolve(handler())
    }=
    return out
  }
</program>
`;
    const fnRes = compileSource(fnSrc, "fnshadow");
    expect(fnRes.errors.filter((e) => e.code === "E-FOREIGN-006").length).toBe(1);
    expect(fnRes.errors.find((e) => e.code === "E-FOREIGN-006").message).toContain("`handler`");
    expect(fnRes.errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS").length).toBe(0);

    const clSrc = `<program lang="ts" db="./d.db">
  export function clS(Widget: string) {
    const out = _={ in: { Widget }
      class Widget {}
      return await Promise.resolve(new Widget())
    }=
    return out
  }
</program>
`;
    const clRes = compileSource(clSrc, "classshadow");
    expect(clRes.errors.filter((e) => e.code === "E-FOREIGN-006").length).toBe(1);
    expect(clRes.errors.find((e) => e.code === "E-FOREIGN-006").message).toContain("`Widget`");
    expect(clRes.errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS").length).toBe(0);
  });

  test("§16 NON-shadow — a crossing name distinct from every slice-local compiles clean (no E-FOREIGN-006)", () => {
    const src = `<program lang="ts" db="./d.db">
  export function ok(y: string) {
    const out = _={ in: { y }
      const z = y.trim()
      return await Promise.resolve(z)
    }=
    return out
  }
</program>
`;
    const { errors, serverJs } = compileSource(src, "nonshadow");
    expect(errors.filter((e) => e.code === "E-FOREIGN-006").length).toBe(0);
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS").length).toBe(0);
    // The non-colliding crossing still lowers to the canonical IIFE.
    expect(serverJs).toMatch(/await \(async \(y\) =>/);
  });

  test("§17 scope-precision — a NESTED `const x` (inside an arrow/block body) is NOT a top-level collision; compiles clean", () => {
    const src = `<program lang="ts" db="./d.db">
  export function nest(x: string) {
    const out = _={ in: { x }
      const mapped = x.split(",").map((s) => { const x = s.trim(); return x })
      return await Promise.resolve(mapped.join("|"))
    }=
    return out
  }
</program>
`;
    const { errors, serverJs } = compileSource(src, "nested");
    // The slice's only TOP-LEVEL binding is `mapped` (not in the crossing set);
    // the `const x` lives inside the `.map()` arrow body (nested), so it does
    // NOT collide with the `x` parameter — the scan is brace-depth-aware.
    expect(errors.filter((e) => e.code === "E-FOREIGN-006").length).toBe(0);
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS").length).toBe(0);
    expect(serverJs).toMatch(/await \(async \(x\) =>/);
  });
});
