/**
 * CONF-AUTH-005 | §34 / §52.11
 *
 * Catalog: E-AUTH-005 — `server @var` declared inside a client-only context
 * (no `db=` on the enclosing `<program>`).
 * Normative: SPEC §52.11. Server-authoritative variables require a server
 * context.
 *
 * Firing site: type-system.ts. Triggered by a `state-decl` whose `isServer`
 * flag is true when `hasServerContext(fileAST)` returns false. TWO shapes
 * satisfy "has a server context" and both are covered below:
 *   1. `<program db=...>` in the file          -> NEG
 *   2. a `<db src=...>` state block in the file -> DB-CONTEXT NEG
 * Shape 2 is the canonical MULTI-FILE page shape (§40.8 / S85 Q2): the single
 * `<program>` lives in the ENTRY file, so a page/component file has none at all.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return { errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("CONF-AUTH-005: server @var in client-only context", () => {
  test("POS: `server @count = 0` in file with no <program db=...> fires E-AUTH-005", () => {
    const src = `\${
    server @count = 0
}
<p>x</>`;
    const { errors } = compile(src, "auth005-pos");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(true);
  });

  test("NEG: `server @count = load()` in a file with <program db=...> does NOT fire E-AUTH-005", () => {
    const src = `<program db="postgres"></>
\${
    server @count = loadCount()
}
<p>x</>`;
    const { errors } = compile(src, "auth005-neg");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(false);
  });

  // Regression: before `hasServerContext`, the check searched only for a
  // `<program db=>` node in THIS file. A multi-file page has no `<program>` at
  // all (§40.8 / S85 Q2), so every `<var server>` in one fired E-AUTH-005 — and
  // the diagnostic's own remedy ("add db= to the enclosing <program>") was
  // unreachable, because the layout forbids a `<program>` there. Since §52.4.2
  // pt 5 makes `<var server>` the only route to an SSR-prerendered cell, that
  // over-fire made server-rendered page data unavailable to every multi-file app.
  test("DB-CONTEXT NEG: `server @var` in a file with a <db src=> block and NO <program> does NOT fire E-AUTH-005", () => {
    const src = `<db src="./items.db" tables="items">
\${
    function loadItems() {
        ?{\`CREATE TABLE IF NOT EXISTS items (id integer primary key, label text)\`}.run()
        return ?{\`SELECT id, label FROM items\`}.all()
    }
    server @items = loadItems()
}
<ul>
    <each in=@items key=@.id><li>\${@.label}</li></each>
</ul>
</>`;
    const { errors } = compile(src, "auth005-dbctx-neg");
    expect(errors.some(e => e.code === "E-AUTH-005")).toBe(false);
  });
});
