/**
 * ss22 #4 (g-peer-call-in-raw-template-unawaited) — a sibling server-fn ("peer")
 * call, or an `@cell` read, that appears INSIDE a `${...}` interpolation bypassed
 * the ss19 #8 statement-level structured emit and was emitted UNAWAITED /
 * UNREWRITTEN → invalid or silently-wrong JS.
 *
 * THREE shapes, all inside a `server function` body:
 *   (a) a template literal      `` `… ${peer()} …` ``     → peer must be `await`ed.
 *   (b) a SQL `?{}` param interp `?{`… ${peer()} …`}`      → peer must be `await`ed.
 *   (c) an `@cell` in a template `` `… ${@cell} …` ``      → must lower to
 *       `_scrml_body["cell"]`, not leak the bare `@cell` (invalid JS).
 *
 * ROOT CAUSE. A template literal is a single `lit` node (litType "template")
 * whose interpolations are NEVER decomposed into AST nodes — `emitLit` returned
 * `node.raw` VERBATIM. A SQL `?{}` param took `emitExprField(null, …)`, the
 * TEXTUAL `rewriteServerExpr` rewriter, which has no notion of the ss19 #8
 * peer-await lowering. Both positions therefore skipped the #8 pass: the async
 * peer call stringified into the template as a Promise, and the bare `@cell`
 * leaked as invalid JS. The peer callable was ALSO not emitted, because the
 * emit-server `_calledPeerNames` walk never descended into a `lit`'s / `sql`
 * node's raw text → `await peer()` referenced an undefined symbol.
 *
 * FIX. emit-expr.ts:emitServerTemplateLit decomposes a server-mode template
 * literal's `${...}` interpolations and routes each through the structured
 * `emitExpr` (the SAME #8 machinery); emit-logic.ts:taggedFromParams routes a
 * peer-bearing SQL `?{}` param through `emitExpr`; emit-server.ts's
 * `_calledPeerNames` walk textually recovers peer callees from `lit`-template /
 * `sql` raw text so the peer callable is emitted.
 *
 * This file asserts the emit-shape (always), JS validity (node:vm parse), and
 * the live round-trip (guarded against happy-dom global pollution — same
 * rationale as server-fn-calls-server-fn.test.js).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import vm from "node:vm";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_peer_in_template");

let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function compileToFiles(scrmlSource, testName, seedFiles = {}) {
  const tag = `${testName}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);

  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const dbPath = resolve(tmpDir, fileName);
    const db = new Database(dbPath, { create: true });
    for (const stmt of stmts) db.exec(stmt);
    db.close();
  }

  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  return {
    errors: result.errors ?? [],
    serverJsPath: join(outDir, `${tag}.server.js`),
    tmpDir,
  };
}

// `node --check` equivalent that doesn't shell out — parse the emitted module as
// an ES module; a syntax error throws (the RED state's `${@cell}` is invalid JS).
function assertValidJs(src) {
  // new vm.SourceTextModule is gated behind a flag; a plain Script parse with the
  // top-level `await`/`import` stripped to a wrapper proves syntactic validity of
  // the bodies. Simpler + flag-free: `new Function` on the source inside an async
  // wrapper would reject `import`. Use the SourceTextModule-free parse check.
  expect(() => new vm.Script(`async function __wrap(){\n${stripModuleSyntax(src)}\n}`)).not.toThrow();
}

// Strip top-level `import`/`export` lines so the bodies parse inside an async
// wrapper (we only care about statement/template syntax validity here).
function stripModuleSyntax(src) {
  return src
    .split("\n")
    .map((l) => (/^\s*(import|export)\b/.test(l) ? "" : l))
    .join("\n");
}

const REPRO_SRC = `
<program>

<db src="./items.db" tables="items">

  \${
    server function nextOrder() {
      const row = ?{\`SELECT COALESCE(MAX(ord),0)+1 AS n FROM items\`}.get()
      return row.n
    }

    server function label() {
      const msg = \`order #\${nextOrder()} ready\`
      return msg
    }

    server function sqlParam(name) {
      ?{\`INSERT INTO items (ord, name) VALUES (\${nextOrder()}, \${name})\`}.run()
      return name
    }
  }

  <div>Items</div>

</>

</program>
`;

const SEED = {
  "items.db": [
    "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, ord INTEGER, name TEXT NOT NULL)",
  ],
};

describe("ss22 #4 — peer call / @cell inside a ${} interpolation", () => {
  test("(a) template literal: ${peer()} lowers to ${await peer()}", () => {
    const { errors, serverJsPath } = compileToFiles(REPRO_SRC, "shape-a", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");

    // GREEN: the peer in the template literal is awaited.
    expect(js).toContain("const msg = `order #${await nextOrder()} ready`;");
    // RED guard: a BARE (unawaited) peer in the template would be a Promise leak.
    expect(js).not.toContain("`order #${nextOrder()} ready`");

    // The peer callable MUST be emitted for the awaited reference to resolve —
    // the emit-server `_calledPeerNames` walk recovers it from the template raw.
    expect(js).toMatch(/async function nextOrder\(\) \{/);

    assertValidJs(js);
  });

  test("(b) SQL ?{} param: ${peer()} lowers to ${await peer()}", () => {
    const { errors, serverJsPath } = compileToFiles(REPRO_SRC, "shape-b", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");

    // GREEN: the peer in the SQL param is awaited; the plain `name` param is not.
    expect(js).toContain(
      "await _scrml_sql`INSERT INTO items (ord, name) VALUES (${await nextOrder()}, ${name})`;",
    );
    // RED guard: bare peer param.
    expect(js).not.toContain("VALUES (${nextOrder()}, ${name})");

    assertValidJs(js);
  });

  test("(c) @cell inside a server template lowers to _scrml_body[...]", () => {
    const src = `
<program db="./items.db">

  \${
    server @cnt = 0

    server function tag() {
      const s = \`count=\${@cnt} done\`
      return s
    }
  }

  <div>Tag</div>

</program>
`;
    const { errors, serverJsPath } = compileToFiles(src, "shape-c", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");

    // GREEN: the cell read is rewritten to the server body accessor.
    expect(js).toContain('`count=${_scrml_body["cnt"]} done`');
    // RED guard: a bare `@cnt` in the template is invalid JS.
    expect(js).not.toContain("`count=${@cnt} done`");

    assertValidJs(js);
  });

  // Adversarial (S215): multiple peers in one template, a peer + a plain expr
  // mixed, and a nested template — each must emit valid awaited JS, and every
  // referenced peer callable must be emitted.
  test("adversarial: multiple peers, peer+plain mixed, nested template", () => {
    const src = `
<program>

<db src="./items.db" tables="items">

  \${
    server function pa() {
      const row = ?{\`SELECT COALESCE(MAX(ord),0)+1 AS n FROM items\`}.get()
      return row.n
    }
    server function pb() { return 7 }

    server function multi() {
      return \`x \${pa()} y \${pb()} z\`
    }
    server function mixed(n) {
      return \`\${pa()} and \${42 + n}\`
    }
    server function nested() {
      return \`outer \${pa()} \${\`inner \${pb()}\`}\`
    }
  }

  <div>Adv</div>

</>

</program>
`;
    const { errors, serverJsPath } = compileToFiles(src, "adv", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");

    // Multiple peers in one template — both awaited.
    expect(js).toContain("`x ${await pa()} y ${await pb()} z`");
    // Peer + plain mixed — peer awaited, plain unchanged.
    expect(js).toContain("`${await pa()} and ${42 + n}`");
    // Nested template — BOTH the outer interpolation's peer AND the inner
    // nested template's peer are awaited. (ss22 #4's emit-expr fix —
    // emitServerTemplateLit — handled nested templates correctly, but the
    // UPSTREAM legacy tokenizer pre-mangled a nested template's raw:
    // `${`inner ${pb()}`}` arrived as `${` inner $ { pb ( ) } `}` BEFORE codegen.
    // That upstream half was fixed in ss39 #2 (tokenizer.ts:readBacktickString —
    // see nested-template-raw-mangle.test.js), so the inner template now survives
    // verbatim and its peer is awaited too.)
    expect(js).toContain("`outer ${await pa()} ${`inner ${await pb()}`}`");

    // Both peer callables emitted (the _calledPeerNames walk recovers `pa`/`pb`
    // from the template + SQL raw text).
    expect(js).toMatch(/async function pa\(\) \{/);
    expect(js).toMatch(/async function pb\(\) \{/);

    // The emitted module is still syntactically valid JS.
    assertValidJs(js);
  });

  // Regression: a plain (non-peer, non-cell) interpolation re-emits
  // byte-identical — the fix is a no-op for everything the raw pass handled.
  test("regression: plain interpolation re-emits byte-identical", () => {
    const src = `
<program>

  \${
    server function plain(n) {
      return \`value=\${n + 1} end\`
    }
  }

  <div>Plain</div>

</program>
`;
    const { errors, serverJsPath } = compileToFiles(src, "plain");
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");
    expect(js).toContain("`value=${n + 1} end`");
    assertValidJs(js);
  });

  test("runtime: label() interpolates the AWAITED value, not a Promise", async () => {
    // happy-dom-polluted globals strip the CSRF headers (see
    // sql-server-fn-runtime.test.js). Skip the live round-trip in that case —
    // the emit-shape tests above are the guard there.
    if (typeof globalThis.document !== "undefined") return;

    const { errors, serverJsPath, tmpDir } = compileToFiles(REPRO_SRC, "runtime", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);

    const absDbPath = resolve(tmpDir, "items.db");
    const patched = readFileSync(serverJsPath, "utf-8").replace(
      'const _scrml_sql = new SQL("sqlite:./items.db");',
      `const _scrml_sql = new SQL(${JSON.stringify("sqlite:" + absDbPath)});`,
    );
    writeFileSync(serverJsPath, patched);

    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const labelRoute = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("label"),
    );
    expect(labelRoute).toBeDefined();

    const TOKEN = "ss22-csrf-token";
    const mkReq = (path, body) =>
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": TOKEN,
          "Cookie": `scrml_csrf=${TOKEN}`,
        },
        body: JSON.stringify(body ?? {}),
      });

    const r = await labelRoute.handler(mkReq(labelRoute.path, {}));
    expect(r.status).toBe(200);
    const txt = await r.json();
    // The awaited peer value (the next order #, 1 on an empty table) lands in
    // the template — NOT a stringified Promise.
    expect(txt).toBe("order #1 ready");
    expect(String(txt)).not.toContain("[object Promise]");
  });
});
