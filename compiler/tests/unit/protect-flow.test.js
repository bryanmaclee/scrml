/**
 * §14.8.9 provenance flow (`protect-flow.ts`) — the pure analysis over emitted
 * server JS, driven directly (S441, g-protected-column-escapes-redaction-as-scalar).
 * The end-to-end shape matrix lives in
 * compiler/tests/integration/protect-scalar-egress.test.js.
 */
import { describe, test, expect } from "bun:test";
import { analyzeProtectFlow, buildProtectFlowDiagnostics, sqlSkeleton } from "../../src/codegen/protect-flow.ts";

// A minimal module in the emitted shape: a tagged row, a handler whose capture
// IIFE returns `ret`, and the compiler's redact-then-serialize envelope.
const mod = (body, extra = "") => `
${extra}
async function _scrml_handler_getIt_1(_scrml_req) {
  const _scrml_result = await (async () => {
    const u = _scrml_protect_tag((await _scrml_sql\`SELECT * FROM users WHERE id = \${1}\`)[0] ?? null, ["passwordHash"]);
    ${body}
  })();
  const _scrml_resp_body = JSON.stringify(_scrml_protect_redact(_scrml_result) ?? null);
  return new Response(_scrml_resp_body, { status: 200 });
}`;
const leakCols = (js) => analyzeProtectFlow(js).leaks.map((l) => l.column);

describe("analyzeProtectFlow", () => {
  test("a member read off a tagged row reaching the sink is a leak", () => {
    const r = analyzeProtectFlow(mod("return u.passwordHash;"));
    expect(r.parseError).toBeNull();
    expect(r.leaks).toHaveLength(1);
    expect(r.leaks[0]).toMatchObject({ sinkFn: "getIt", column: "passwordHash" });
    expect(r.leaks[0].site).toContain("`u.passwordHash` in `getIt`");
  });

  test("the row itself is not a leak, and is recorded as STRIPPED", () => {
    const r = analyzeProtectFlow(mod("return u;"));
    expect(r.leaks).toEqual([]);
    expect(r.tagSites).toHaveLength(1);
    expect(r.tagSites[0].stripped).toBe(true);
  });

  test("a row that never reaches a sink is NOT recorded as stripped", () => {
    const r = analyzeProtectFlow(mod("const ok = Bun.password.verifySync(pw, u.passwordHash); return { ok };"));
    expect(r.leaks).toEqual([]);
    expect(r.tagSites[0].stripped).toBe(false);
  });

  test("a non-protected field flows", () => {
    expect(leakCols(mod("return { n: u.name, id: u.id };"))).toEqual([]);
  });

  test("re-housing, concatenation, templates and destructuring all carry provenance", () => {
    expect(leakCols(mod("return { h: u.passwordHash };"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return [u.passwordHash];"))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return "x" + u.passwordHash;'))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return `x${u.passwordHash}`;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const { passwordHash } = u; return passwordHash;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const { passwordHash: h, ...rest } = u; return [rest, h];"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("let acc = ''; acc += u.passwordHash; return acc;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const m = new Map(); m.set('k', u.passwordHash); return m;"))).toEqual(["passwordHash"]);
  });

  test("the row survives spread and object-rest (the descriptor is copied)", () => {
    expect(leakCols(mod("return { ...u, x: 1 };"))).toEqual([]);
    expect(leakCols(mod("const { name, ...rest } = u; return rest;"))).toEqual([]);
  });

  test("serializing built-ins strip the Symbol descriptor — the row comes out naked", () => {
    expect(leakCols(mod("return JSON.stringify(u);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return Object.values(u);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return structuredClone(u);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return String(u.passwordHash);"))).toEqual(["passwordHash"]);
    // String of a ROW is "[object Object]" — nothing embedded.
    expect(leakCols(mod("return String(u);"))).toEqual([]);
  });

  test("derived values are the §14.8.9 bound, not leaks", () => {
    expect(leakCols(mod('return u.passwordHash === "x";'))).toEqual([]);
    expect(leakCols(mod("return u.passwordHash.length;"))).toEqual([]);
    expect(leakCols(mod('return u.passwordHash.startsWith("$");'))).toEqual([]);
    // `verifyPassword` from `scrml:auth` is on the DERIVER allowlist …
    const AUTH = 'import { verifyPassword } from "./_scrml/auth.js";';
    expect(leakCols(mod("return await verifyPassword(pw, u.passwordHash);", AUTH))).toEqual([]);
  });

  test("F2: a callee the compiler cannot see into FAILS CLOSED — only the allowlist is derived", () => {
    // … the same call to a function NOT on the allowlist keeps the value protected.
    expect(leakCols(mod("return await verifyPassword(pw, u.passwordHash);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return mystery(u.passwordHash);", 'import { mystery } from "some-npm-pkg";'))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return mystery(u);", 'import { mystery } from "some-npm-pkg";'))).toEqual(["passwordHash"]);
    // The reversible encodings the review used on the first cut.
    expect(leakCols(mod('return Buffer.from(u.passwordHash).toString("base64");'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return new URL("http://x/?h=" + u.passwordHash).search;'))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return new Error(u.passwordHash).message;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const h = u.passwordHash; return String.fromCharCode(...Array.from(h, (c) => c.charCodeAt(0)));"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return u.passwordHash.charCodeAt(0);"))).toEqual(["passwordHash"]);
    // F4 — no special case needed once the default is inverted.
    expect(leakCols(mod('return String.prototype.concat.call("", u.passwordHash);'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return Array.prototype.join.call([u.passwordHash], "");'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return Object.getOwnPropertyDescriptor(u, "passwordHash").value;'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('const o = {}; Object.defineProperty(o, "x", { get: () => u.passwordHash, enumerable: true }); return o;'))).toEqual(["passwordHash"]);
  });

  test("F3: response HEADERS are egress — a null-body Response is checked too", () => {
    expect(leakCols(mod('return new Response(null, { status: 302, headers: { Location: "/x?h=" + u.passwordHash } });'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return new Response(null, { status: 204, headers: { "Set-Cookie": "h=" + u.passwordHash } });'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return Response.redirect("/x?h=" + u.passwordHash, 302);'))).toEqual(["passwordHash"]);
  });

  test("F6: call-site sensitive — a helper used on the hash does not poison a clean call", () => {
    const helper = "function norm(s) { return s.trim(); }";
    expect(leakCols(mod("const ok = Bun.password.verifySync(pw, norm(u.passwordHash)); return norm(u.name);", helper))).toEqual([]);
    expect(leakCols(mod("const a = norm(u.name); return norm(u.passwordHash);", helper))).toEqual(["passwordHash"]);
  });

  test("string transforms of the value are NOT derived — they carry it", () => {
    expect(leakCols(mod("return u.passwordHash.slice(0, 4);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return u.passwordHash.toUpperCase();"))).toEqual(["passwordHash"]);
  });

  test("reveal declassifies exactly the named column", () => {
    const rev = (col) => `const r = _scrml_protect_reveal(u, "${col}"); return r.passwordHash;`;
    expect(leakCols(mod(rev("passwordHash")))).toEqual([]);
    expect(leakCols(mod(rev("email")))).toEqual(["passwordHash"]);
    // An UNLOWERED `.reveal("col")` (scrml written inside a `_{}` foreign block)
    // is read the same way — column-keyed.
    expect(leakCols(mod('return JSON.stringify(u.reveal("passwordHash"));'))).toEqual([]);
    expect(leakCols(mod('return JSON.stringify(u.reveal("email"));'))).toEqual(["passwordHash"]);
  });

  test("interprocedural: a module helper that extracts from its parameter", () => {
    const js = mod("return await pick(u);", "async function pick(r) { return r.passwordHash; }");
    const r = analyzeProtectFlow(js);
    expect(r.leaks.map((l) => [l.column, l.siteFn])).toEqual([["passwordHash", "pick"]]);
  });

  test("array callbacks: map / find / reduce", () => {
    expect(leakCols(mod("return [u].map((r) => r.passwordHash);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return [u].map((r) => r.name);"))).toEqual([]);
    expect(leakCols(mod("return [u].find((r) => r.id === 1).passwordHash;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return [u].reduce((a, r) => a + r.passwordHash, '');"))).toEqual(["passwordHash"]);
  });

  test("adversarial round 2 — laundering shapes that initially slipped through", () => {
    // Each of these compiled clean and SHIPPED the hash on the first cut (measured).
    expect(leakCols(mod("return JSON.parse(JSON.stringify(u));"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return JSON.parse(JSON.stringify(u)).passwordHash;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return "".concat(u.passwordHash);'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return "X".replace("X", u.passwordHash);'))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return Array.from([u], (r) => r.passwordHash);"))).toEqual(["passwordHash"]);
    // …and the ones found while closing them.
    expect(leakCols(mod("return await new Promise((res) => res(u.passwordHash));"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("try { throw u.passwordHash; } catch (e) { return e; }"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return await Promise.reject(u.passwordHash).catch((e) => e);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return { get h() { return u.passwordHash; } };"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return { toJSON() { return u.passwordHash; } };"))).toEqual(["passwordHash"]);
    // A clean receiver's method with a protected ARGUMENT is still derived
    // unless the method embeds its argument.
    expect(leakCols(mod("return Bun.password.verifySync(pw, u.passwordHash);"))).toEqual([]);
  });

  test("a dynamic key reads any column; a numeric index is still a row", () => {
    expect(leakCols(mod("return u[k];"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return [u][0];"))).toEqual([]);
  });

  test("a strip-all row: every column read off it is protected", () => {
    const js = mod("return u2.name;").replace(
      "const u = ",
      "const u2 = _scrml_protect_tag([], \"*\"); const u = ",
    );
    expect(leakCols(js)).toEqual(["*"]);
  });

  test("serializer sinks are checked even WITHOUT a redact in front (enumerated over serializers)", () => {
    const js = `
async function h() {
  const u = _scrml_protect_tag({}, ["passwordHash"]);
  return new Response(JSON.stringify({ cell: u }));
}`;
    expect(leakCols(js)).toEqual(["passwordHash"]);
    const pub = `function b(srv) { const u = _scrml_protect_tag({}, ["pw"]); srv.publish("t", u.pw); }`;
    expect(leakCols(pub)).toEqual(["pw"]);
    const json = `function j() { const u = _scrml_protect_tag({}, ["pw"]); return Response.json(u); }`;
    expect(leakCols(json)).toEqual(["pw"]);
  });

  test("the §37 SSE frame loop is a sink as a whole (event / id are serialized outside the redact)", () => {
    const js = `
async function _scrml_handler_s_1(req) {
  async function* _scrml_gen() {
    const u = _scrml_protect_tag({}, ["pw"]);
    yield { event: u.pw, data: 1 };
  }
  for await (const _scrml_val of _scrml_gen()) {
    const c = \`event: \${_scrml_val.event}\` + JSON.stringify(_scrml_protect_redact(_scrml_val.data));
  }
}`;
    expect(analyzeProtectFlow(js).leaks.map((l) => [l.sinkFn, l.column])).toContainEqual(["s", "pw"]);
  });

  test("an unparseable module is reported, not passed", () => {
    expect(analyzeProtectFlow("function (").parseError).not.toBeNull();
  });
});

describe("buildProtectFlowDiagnostics", () => {
  const info = (sql, cols = ["passwordHash"]) => ({ cols, sql, skeleton: sqlSkeleton(sql) });
  const SQL = "SELECT * FROM users WHERE id = ${1}";

  test("a leak is E-PROTECT-006 (error) and the query is NOT reported as stripped", () => {
    const d = buildProtectFlowDiagnostics(mod("return u.passwordHash;"), [info(SQL)], "a.scrml", () => null);
    expect(d.map((x) => [x.code, x.severity])).toEqual([["E-PROTECT-006", "error"]]);
  });

  test("I-PROTECT-STRIP-001 fires only when the row reached a sink", () => {
    const stripped = buildProtectFlowDiagnostics(mod("return u;"), [info(SQL)], "a.scrml", () => null);
    expect(stripped.map((x) => x.code)).toEqual(["I-PROTECT-STRIP-001"]);
    const unused = buildProtectFlowDiagnostics(mod("return 1;"), [info(SQL)], "a.scrml", () => null);
    expect(unused).toEqual([]);
  });

  test("an unparseable module fails CLOSED", () => {
    const d = buildProtectFlowDiagnostics("function (", [], "a.scrml", () => null);
    expect(d.map((x) => x.code)).toEqual(["E-PROTECT-006"]);
  });

  test("one error per extraction, even when it reaches several sinks", () => {
    const js = mod("return u.passwordHash;") + `
async function _scrml_ssr() { const v = await (async () => { const u = 0; })(); }`;
    const d = buildProtectFlowDiagnostics(js, [], "a.scrml", () => null);
    expect(d.filter((x) => x.code === "E-PROTECT-006")).toHaveLength(1);
  });
});

describe("sqlSkeleton", () => {
  test("holes replace interpolations (balanced braces), whitespace collapses", () => {
    expect(sqlSkeleton("SELECT *  FROM t\n WHERE a = ${ f({ x: 1 }) } AND b = ${y}"))
      .toBe("SELECT * FROM t WHERE a = \u0000 AND b = \u0000");
  });
});
