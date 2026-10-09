/**
 * E-CHANNEL-006 — an `onclient:*` handler that §12.2 PLACES on the server is
 * refused, not only one DECLARED `server function` (SPEC §38.10.3, widened by
 * ruling:user-voice-scrml.md S462 "a"; change-id `s462-channel-006-inferred`).
 *
 * Before: route inference EXEMPTED an onclient handler from §12.2 Trigger 7, so
 * `onclient:open=onOpen(e)` with `function onOpen(e) { broadcast(…) }` stayed on
 * the client and called a bare `broadcast()` the client bundle does not define —
 * exit 0, no diagnostic. A handler placed by any OTHER trigger (`?{}` SQL, a
 * server-only stdlib import, caller-context) went the other way silently: the
 * browser's `ws.onopen` called a fetch stub — a POST round-trip on every socket
 * open, against §38.10.2 ("SHALL NOT emit any server-side code").
 *
 * After: the exemption is gone, and type-system.ts `checkClientHandlerNotServer`
 * reads the routeMap boundary — the SAME placement decision codegen acts on.
 * There is no second "does it broadcast" detector.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "channel-onclient-inferred-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const CODE = "E-CHANNEL-006";

/** Compile `files` (name → source); the first entry is the entry file. */
function compileFiles(files) {
  const dir = join(TMP, `d-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const names = Object.keys(files);
  for (const n of names) writeFileSync(join(dir, n), files[n]);
  return compileScrml({ inputFiles: [join(dir, names[0])], outputDir: join(dir, "dist"), write: false, log: () => {} });
}

const compile = (src) => compileFiles({ "app.scrml": src });

function hits(res) {
  return [...(res.errors || []), ...(res.warnings || [])].filter((d) => d.code === CODE);
}

function expectOneError(res) {
  const d = hits(res);
  expect(d.length).toBe(1);
  expect((res.errors || []).some((e) => e.code === CODE)).toBe(true);
  return d[0];
}

const FIXES = [
  "an `onserver:*` handler",
  "write a channel cell",
];

describe(`${CODE} — an onclient:* handler §12.2 places on the server`, () => {
  test("Trigger 7: `broadcast()` in a channel-body handler (the S462 reproducer)", () => {
    const res = compile(`<program>
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ function onOpen(e) { broadcast({ joined: true }) } }
</>
<p>\${@joined}</p>
</program>`);
    const d = expectOneError(res);
    expect(d.message).toContain("`onclient:open`");
    expect(d.message).toContain("§12.2 places `onOpen` on the server");
    expect(d.message).toContain("`broadcast()`");
    for (const f of FIXES) expect(d.message).toContain(f);
  });

  test("Trigger 7: `disconnect()` in an onclient:close handler", () => {
    const res = compile(`<program>
<channel name="c" onclient:close=onClose(e)>
    <joined> = 0
    \${ function onClose(e) { disconnect() } }
</>
<p>\${@joined}</p>
</program>`);
    const d = expectOneError(res);
    expect(d.message).toContain("`onclient:close`");
    expect(d.message).toContain("`disconnect()`");
  });

  test("Trigger 7: the handler is declared in a SIBLING channel's body", () => {
    const res = compile(`<program>
<channel name="a" onclient:open=onOpen(e)>
    <joined> = 0
</>
<channel name="b">
    <left> = 0
    \${ function onOpen(e) { broadcast({ joined: true }) } }
</>
<p>\${@joined} \${@left}</p>
</program>`);
    const d = expectOneError(res);
    expect(d.message).toContain("`broadcast()`");
  });

  test("Trigger 1: a `?{}` SQL query in the handler body", () => {
    const res = compile(`<program db="sqlite:./app.db">
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ function onOpen(e) { const rows = ?{\`SELECT id FROM users\`}.all(); @joined = rows.length } }
</>
<p>\${@joined}</p>
</program>`);
    const d = expectOneError(res);
    expect(d.message).toContain("a `?{}` SQL query");
    for (const f of FIXES) expect(d.message).toContain(f);
  });

  test("Trigger 3: a call to a binding imported from a server-only stdlib module", () => {
    const res = compile(`<program>
\${ import { hashPassword } from "scrml:auth" }
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ function onOpen(e) { const h = hashPassword("x"); @joined = 1 } }
</>
<p>\${@joined}</p>
</program>`);
    const d = expectOneError(res);
    expect(d.message).toContain("`scrml:auth`");
  });

  test("Trigger 2: a protected-field access in the handler body", () => {
    const res = compile(`<program db="./app.db">
<schema>
    users {
        id: integer primary key
        password_hash: text
    }
</>
< db src="./app.db" protect="password_hash" tables="users">
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ function onOpen(e) { const u = { password_hash: "x" }; @joined = u.password_hash.length } }
</>
<p>\${@joined}</p>
</>
</program>`);
    const d = hits(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("the protected field `password_hash`");
  });

  test("Trigger 5: the handler's only function caller is server-side", () => {
    const res = compile(`<program db="sqlite:./app.db">
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ function onOpen(e) { @joined = 1 } }
</>
\${
    function save() {
        const rows = ?{\`SELECT id FROM users\`}.all()
        onOpen(rows)
    }
}
<button onclick=save()>go</button>
<p>\${@joined}</p>
</program>`);
    const d = expectOneError(res);
    expect(d.message).toContain("§12.2 Trigger 5");
    expect(d.message).toContain("Do not call `onOpen` from server code");
  });

  test("an IMPORTED plain function whose body §12.2 places on the server", () => {
    const res = compileFiles({
      "app.scrml": `<program db="sqlite:./app.db">
\${ import { onOpenX } from "./lib.scrml" }
<channel name="c" onclient:open=onOpenX(e)>
    <joined> = 0
</>
<p>\${@joined}</p>
</program>`,
      "lib.scrml": `\${
    export function onOpenX(e) {
        const rows = ?{\`SELECT id FROM users\`}.all()
        return rows.length
    }
}
`,
    });
    const d = expectOneError(res);
    expect(d.message).toContain("(imported from `lib.scrml`)");
    expect(d.message).toContain("a `?{}` SQL query");
  });

  test("declared `server function` AND a broadcast body: one diagnostic naming both", () => {
    const res = compile(`<program>
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ server function onOpen(e) { broadcast({ joined: true }) } }
</>
<p>\${@joined}</p>
</program>`);
    const d = expectOneError(res);
    expect(d.message).toContain("`broadcast()`");
    expect(d.message).toContain("declared `server function`");
  });
});

describe(`${CODE} — handlers that stay on the client compile`, () => {
  test("a handler that writes a channel cell (client-side sync, §38.4)", () => {
    const res = compile(`<program>
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ function onOpen(e) { @joined = @joined + 1 } }
</>
<p>\${@joined}</p>
</program>`);
    expect(hits(res).length).toBe(0);
    expect((res.errors || []).length).toBe(0);
  });

  test("a pure-compute handler", () => {
    const res = compile(`<program>
<channel name="c" onclient:open=onOpen(e)>
    <status> = "x"
    \${ function onOpen(e) { const n = 2 + 3; @status = "open " + n } }
</>
<p>\${@status}</p>
</program>`);
    expect(hits(res).length).toBe(0);
    expect((res.errors || []).length).toBe(0);
  });

  test("a broadcasting channel function that is NOT an onclient handler still escalates silently", () => {
    const res = compile(`<program>
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${
        function onOpen(e) { @joined = @joined + 1 }
        function announce() { broadcast({ hello: true }) }
    }
    <button onclick=announce()>hi</button>
</>
<p>\${@joined}</p>
</program>`);
    expect(hits(res).length).toBe(0);
  });

  test("an onclient handler that calls a server function compiles (the round-trip is the callee's)", () => {
    const res = compile(`<program db="sqlite:./app.db">
<channel name="c" onclient:open=onOpen(e)>
    <joined> = 0
    \${ function onOpen(e) { load() } }
</>
\${
    function load() {
        const rows = ?{\`SELECT id FROM users\`}.all()
        return rows.length
    }
}
<p>\${@joined}</p>
</program>`);
    expect(hits(res).length).toBe(0);
  });
});
