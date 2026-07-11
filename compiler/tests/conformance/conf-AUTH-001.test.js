/**
 * CONF-AUTH-001 | §34 / §52.4.4 / §52.4.6 / §52.11
 *
 * Catalog: E-AUTH-001 — a client-local `@var` used as a bound parameter in a
 * server-side `?{}` INSERT / UPDATE / DELETE write, outside a server function.
 * A client-controlled value reaching a DB write with no server-authority
 * mediation (SECURITY: a false-negative LEAKS).
 *
 * Normative: SPEC §52.4.4 (the E-AUTH-001 rule) + §52.4.6 (the worked leak +
 * remedy) + §52.11 (the code table). The remedy is to pass the value to a
 * server function first; INSIDE the fn the bound param is a plain parameter
 * (`${id}`), not the client-local cell (`${@id}`), so the `@`-sigil
 * disambiguates the direct leak from the laundered form.
 *
 * Firing site: type-system.ts `checkClientLocalWriteParams` (sibling of the
 * E-AUTH-002/005 authority checks). E-AUTH-001 REPLACES the E-DG-002
 * "never consumed" warning per the §52.4.6 Expected-compiler-output: the value
 * IS consumed by the write, just illegally (dependency-graph.ts credits the
 * `${@var}` bound-param read).
 *
 * NOTE — cross-stream: E-AUTH-001 is an Error (result.errors); E-DG-002 is a
 * warning (result.warnings). The `all` helper unions both streams so the
 * REPLACE assertion (E-DG-002 absent) is honest per the diagnostic-partition
 * rule (S92/S93).
 */
import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    const errors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    return { errors, warnings, all: [...errors, ...warnings] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const has = (diags, code) => diags.some((d) => d.code === code);

describe("CONF-AUTH-001: client-local @var as a bound param in a `?{}` write", () => {
  test("POS INSERT (§52.4.6 leak): top-level `?{}` INSERT with `${@editingId}` fires E-AUTH-001", () => {
    const src = `<program db="sqlite:./kanban.db">
<editingId> = not
\${ ?{\`INSERT INTO audit_log (object_id) VALUES (\${@editingId})\`}.run() }
</program>`;
    const { errors, all } = compile(src, "auth001-insert");
    expect(has(errors, "E-AUTH-001")).toBe(true);
    // E-AUTH-001 REPLACES E-DG-002 (the value IS consumed by the write).
    expect(has(all, "E-DG-002")).toBe(false);
  });

  test("POS UPDATE: `${@editingId}` bound in an UPDATE fires E-AUTH-001", () => {
    const src = `<program db="sqlite:./kanban.db">
<editingId> = not
\${ ?{\`UPDATE audit_log SET object_id = \${@editingId} WHERE id = 1\`}.run() }
</program>`;
    const { errors } = compile(src, "auth001-update");
    expect(has(errors, "E-AUTH-001")).toBe(true);
  });

  test("POS DELETE: `${@editingId}` bound in a DELETE fires E-AUTH-001", () => {
    const src = `<program db="sqlite:./kanban.db">
<editingId> = not
\${ ?{\`DELETE FROM audit_log WHERE object_id = \${@editingId}\`}.run() }
</program>`;
    const { errors } = compile(src, "auth001-delete");
    expect(has(errors, "E-AUTH-001")).toBe(true);
  });

  test("POS compound: a derived expression `${@editingId + 1}` over a client-local var fires", () => {
    const src = `<program db="sqlite:./kanban.db">
<editingId> = not
\${ ?{\`INSERT INTO audit_log (object_id) VALUES (\${@editingId + 1})\`}.run() }
</program>`;
    const { errors } = compile(src, "auth001-compound");
    expect(has(errors, "E-AUTH-001")).toBe(true);
  });

  test("POS shadowed currentUser: a user-declared client-local `<currentUser>` in a write fires", () => {
    const src = `<program db="sqlite:./kanban.db">
<currentUser> = not
\${ ?{\`INSERT INTO audit_log (user_id) VALUES (\${@currentUser})\`}.run() }
</program>`;
    const { errors } = compile(src, "auth001-shadow");
    expect(has(errors, "E-AUTH-001")).toBe(true);
  });

  test("NEG in-function CPS boundary: a `?{}` INSERT INSIDE a fn that reads `${@draft}` does NOT fire (the CPS-split server-call boundary marshals the client-local value, §12.2 — 'outside a server function' is load-bearing)", () => {
    const src = `<program db="sqlite:./kanban.db">
<draft> = ""
\${
    function add() { ?{\`INSERT INTO todos (text) VALUES (\${@draft})\`}.run() }
}
<button on:click=add()>Add</button>
</program>`;
    const { all } = compile(src, "auth001-cps-boundary");
    expect(has(all, "E-AUTH-001")).toBe(false);
  });

  test("NEG remedy (§52.4.6): the write inside a server fn using the param `${id}`, called with `@editingId`, does NOT fire", () => {
    const src = `<program db="sqlite:./kanban.db">
<editingId> = not
\${
    function logEdit(id) { ?{\`INSERT INTO audit_log (object_id) VALUES (\${id})\`}.run() }
    logEdit(@editingId)
}
</program>`;
    const { all } = compile(src, "auth001-remedy");
    expect(has(all, "E-AUTH-001")).toBe(false);
  });

  test("NEG server-authoritative: a Tier-2 `<count server>` used in an UPDATE does NOT fire", () => {
    const src = `<program db="sqlite:./kanban.db">
<count server> = 0
\${ ?{\`UPDATE stats SET count = \${@count} WHERE id = 1\`}.run() }
</program>`;
    const { all } = compile(src, "auth001-serverauth");
    expect(has(all, "E-AUTH-001")).toBe(false);
  });

  test("NEG server ambient: `@currentUser.id` (the §52.15 request identity) in an INSERT does NOT fire", () => {
    const src = `<program db="sqlite:./kanban.db">
\${ ?{\`INSERT INTO audit_log (user_id) VALUES (\${@currentUser.id})\`}.run() }
</program>`;
    const { all } = compile(src, "auth001-currentuser");
    expect(has(all, "E-AUTH-001")).toBe(false);
  });

  test("NEG SELECT read: a client-local var bound in a SELECT (a read, not a persisted write) does NOT fire", () => {
    const src = `<program db="sqlite:./kanban.db">
<editingId> = not
\${ ?{\`SELECT * FROM audit_log WHERE object_id = \${@editingId}\`}.get() }
</program>`;
    const { all } = compile(src, "auth001-select");
    expect(has(all, "E-AUTH-001")).toBe(false);
  });

  test("NEG string-literal @: an `@` inside a quoted value (an email) is NOT a reactive read", () => {
    const src = `<program db="sqlite:./kanban.db">
\${ ?{\`INSERT INTO audit_log (email) VALUES (\${"user@example.com"})\`}.run() }
</program>`;
    const { all } = compile(src, "auth001-email");
    expect(has(all, "E-AUTH-001")).toBe(false);
  });
});
