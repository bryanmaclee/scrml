// ---------------------------------------------------------------------------
// Failable ARRAY-return server fn is promoted (GH #228 real root cause, S309)
// ---------------------------------------------------------------------------
//
// A failable server fn with an ARRAY return type — `function f() ! string[]` /
// `! Contact[]` — parsed with an EMPTY body. The bare `! Type` return-type parse
// (ast-builder.js) did not consume the `[]` array suffix, so after the type name
// the `[` `]` `{` dangled and the body-brace check failed. Empty body ⟹
// route-inference never saw the `?{}` SQL ⟹ the fn was NOT server-escalated ⟹
// its query leaked to the client (E-CG-006) and its value-position call got no
// auto-await. The FIX: treat a `[]` after the bare `! Type` name as a type
// continuation and consume it.
//
// This was mis-reported as GH #228's "reactive bindings in a hidden nested-
// <each> don't reconcile live" — a ghost; the reconcile paths work and are
// guarded (g-each-item-hidden-subtree-text-reconcile). The real defect is this
// parse bug, discriminated razor-clean: only failable (`!`) AND array return
// breaks — failable scalar, failable struct, and non-failable array all work.
//
// Asserts: a failable array-return server fn (a) is server-promoted (present in
// *.server.js), (b) does NOT leak SQL to the client, (c) does NOT fire E-CG-006,
// (d) its call lowers to an awaited fetch — and the failable-scalar twin and the
// non-failable array form are unchanged.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "farsp-"));
function compile(src) {
  const d = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(d, { recursive: true });
  const p = join(d, "app.scrml");
  writeFileSync(p, src);
  const r = compileScrml({ inputFiles: [p], write: true, outputDir: join(d, "out") });
  const g = (f) => (existsSync(join(d, "out", f)) ? readFileSync(join(d, "out", f), "utf8") : "");
  return { errors: r.errors ?? [], server: g("app.server.js"), client: g("app.client.js") };
}
const APP = (retType, sqlMethod, cell) => `<program>
<db src="notes.db" tables="notes">
\${
  type Note:struct = { id: int, body: string }
  type LoadError:enum = { QueryFailed(reason: string) }
  <r>: string = ""
  <rr>: string[] = []
  function loader() ! ${retType} { const x = ?{\`SELECT body FROM notes\`}.${sqlMethod}(); return x }
  function refresh() { @${cell} = loader() !{ | e :> { return } } }
}
<page><button onclick=refresh()>go</button></page>
</db>
</program>
`;
const codes = (r) => r.errors.map((e) => e.code);
const loaderInServer = (r) => /function _scrml_handler_loader/.test(r.server);
const sqlInClient = (r) => /_scrml_sql/.test(r.client);
const clientFetchesLoader = (r) => /_scrml_fetch_loader/.test(r.client);

describe("failable ARRAY-return server fn is promoted (GH #228 real root cause)", () => {
  test("`! string[]` — promoted, no client SQL leak, no E-CG-006", () => {
    const r = compile(APP("string[]", "all", "rr"));
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });

  test("`! Contact[]` (struct array) — promoted, no E-CG-006", () => {
    const r = compile(APP("Note[]", "all", "rr"));
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });

  test("arrow form `! -> T[]` also promoted (SPEC §19.4.1 normative-equivalent)", () => {
    const src = APP("string[]", "all", "rr").replace("! string[]", "! -> string[]");
    const r = compile(src);
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });

  test("the call lowers to an AWAITED fetch (auto-await restored)", () => {
    const r = compile(APP("string[]", "all", "rr"));
    expect(clientFetchesLoader(r)).toBe(true);      // RPC stub, not an inlined client fn
    expect(/await _scrml_fetch_loader/.test(r.client)).toBe(true);
  });
});

describe("failable ARRAY fix does not disturb the sibling forms", () => {
  test("failable SCALAR `! string` still promoted (regression guard)", () => {
    const r = compile(APP("string", "get", "r"));
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });

  test("NON-failable array return still promoted (regression guard)", () => {
    const src = APP("string[]", "all", "rr")
      .replace("function loader() ! string[]", "function loader()")
      .replace("@rr = loader() !{ | e :> { return } }", "@rr = loader()");
    const r = compile(src);
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });
});
