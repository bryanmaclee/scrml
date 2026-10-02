/**
 * §14.8.9 provenance flow (`protect-flow.ts`) — the pure analysis over emitted
 * server JS, driven directly (S441, g-protected-column-escapes-redaction-as-scalar).
 * The end-to-end shape matrix lives in
 * compiler/tests/integration/protect-scalar-egress.test.js.
 */
import { describe, test, expect } from "bun:test";
import { analyzeProtectFlow, analyzeCompileProtectFlow, buildProtectFlowDiagnostics, sqlSkeleton } from "../../src/codegen/protect-flow.ts";

// A minimal module in the emitted shape: the compiler's SQL client, a tagged
// row, a handler whose capture IIFE returns `ret`, and the compiler's
// redact-then-serialize envelope. (S447 round 7: a tag is read as a query only
// when it IS that client — `new SQL(…)` from "bun" — so the fixture declares it,
// as every emitted server module does.)
const mod = (body, extra = "") => `
import { SQL } from "bun";
${extra}
const _scrml_sql = new SQL("sqlite:./app.db");
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
    const r = analyzeProtectFlow(mod("const ok = await verifyPassword(pw, u.passwordHash); return { ok };", 'import { verifyPassword } from "scrml:auth";'));
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
    const AUTH = 'import { verifyPassword } from "scrml:auth";';
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
    expect(leakCols(mod("const ok = await verifyPassword(pw, norm(u.passwordHash)); return norm(u.name);", 'import { verifyPassword } from "scrml:auth";' + helper))).toEqual([]);
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
    expect(leakCols(mod("return await verifyPassword(pw, u.passwordHash);", 'import { verifyPassword } from "scrml:auth";'))).toEqual([]);
    // N6: `Bun.*` is not on the allowlist (unreachable from scrml source; `Bun.hash` is not one-way).
    expect(leakCols(mod("return Bun.hash(u.passwordHash);"))).toEqual(["passwordHash"]);
  });

  test("round 3 N1: a protected value used as an object KEY is carried into the container", () => {
    expect(leakCols(mod("return { [u.passwordHash]: 1 };"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const o = {}; o[u.passwordHash] = 1; return o;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return Object.keys({ [u.passwordHash]: 1 });"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const m = new Map(); m.set(u.passwordHash, 1); return Object.fromEntries(m);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return [u].reduce((acc, r) => { acc[r.passwordHash] = r.id; return acc; }, {});"))).toEqual(["passwordHash"]);
    // A non-protected key is fine.
    expect(leakCols(mod("return [u].reduce((acc, r) => { acc[r.name] = r.id; return acc; }, {});"))).toEqual([]);
  });

  test("round 3 N2: a lookup KEYED by a protected value is protected", () => {
    expect(leakCols(mod('const labels = { a: "x" }; return labels[u.passwordHash];'))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const h = u.passwordHash; const t = {}; const out = []; for (let i = 0; i < h.length; i++) { out.push(t[h[i]]); } return out;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const h = u.passwordHash; const m = new Map(); const out = []; for (let i = 0; i < h.length; i++) { out.push(m.get(h[i])); } return out;"))).toEqual(["passwordHash"]);
  });

  test("round 4 F1: the value selected by a protected key is protected ALL THE WAY DOWN", () => {
    const TBL = 'const A = "abc"; const L = {}; for (const c of A) { L[c] = { v: c, test: () => c, [c]: 1 }; }';
    expect(leakCols(mod(TBL + ' return [...u.passwordHash].map((c) => L[c].v).join("");'))).toEqual(["passwordHash"]);
    expect(leakCols(mod(TBL + ' return [...u.passwordHash].map((c) => L[c].test()).join("");'))).toEqual(["passwordHash"]);
    expect(leakCols(mod(TBL + ' return [...u.passwordHash].map((c) => Object.keys(L[c])[0]).join("");'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('const M = new Map(); M.set("a", { v: "a" }); return [...u.passwordHash].map((c) => M.get(c).v).join("");'))).toEqual(["passwordHash"]);
    // A lookup keyed by a NON-protected value stays clean.
    expect(leakCols(mod('const L = { a: { v: 1 } }; return L[u.name].v;'))).toEqual([]);
  });

  test("round 4 F2: a write through an ALIAS or a helper PARAMETER lands in the shared object", () => {
    const H = "const h = u.passwordHash; ";
    expect(leakCols(mod(H + "const o = {}; const o2 = o; o2.x = h; return o;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod(H + "const o = {}; const o2 = o; o2[h] = 1; return Object.keys(o);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod(H + "const m = new Map(); const box = { m }; box.m.set(h, 1); return [...m.keys()];"))).toEqual(["passwordHash"]);
    expect(leakCols(mod(H + "const arr = [{}]; const first = arr[0]; first[h] = 1; return Object.keys(arr[0]);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod(H + "const o = {}; const r = [o]; r[0].x = h; return o;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod(H + "const o = {}; setv(o, h); return o;", "function setv(o, v) { o.x = v; }"))).toEqual(["passwordHash"]);
    expect(leakCols(mod(H + "const m = new Map(); put(m, h); return [...m.keys()];", "function put(m, k) { m.set(k, 1); }"))).toEqual(["passwordHash"]);
    expect(leakCols(mod(H + "const o = {}; Object.assign(o, { x: h }); return o;"))).toEqual(["passwordHash"]);
    // An alias that is never written through stays clean.
    expect(leakCols(mod(H + "const o = { n: u.name }; const o2 = o; return o2;"))).toEqual([]);
    // A comparison helper does not make its operands alias (`==` is derived).
    expect(leakCols(mod(H + 'const A = "AB"; let s = ""; for (const c of A) { if (_scrml_structural_eq(h, c)) { } s = s + c; } return s;'))).toEqual([]);
  });

  test("ruling (bryan, S441): arithmetic stays protected; reveal is the path to compute", () => {
    const P = (body) => mod(body).replace('["passwordHash"]', '["passwordHash", "pin"]');
    for (const e of ["u.pin * 1", "+u.pin", "u.pin - 0", "u.pin * qty", "-u.pin", "~u.pin", "u.pin | 0", "u.pin ** 1", "u.pin / 1", "u.pin % 1e12"]) {
      expect(leakCols(P(`const qty = 3; return ${e};`))).toEqual(["pin"]);
    }
    expect(leakCols(P("let t = 0; t += u.pin; return t;"))).toEqual(["pin"]);
    expect(leakCols(P("let t = u.pin; t++; return t;"))).toEqual(["pin"]);
    // Comparisons, `!` and `typeof` remain derived.
    expect(leakCols(P("return { a: u.pin == 1, b: u.pin > 10, c: !u.pin, d: typeof u.pin };"))).toEqual([]);
    // reveal, then arithmetic: declassified, clean.
    expect(leakCols(P('const r = _scrml_protect_reveal(u, "pin"); return r.pin * 3;'))).toEqual([]);
    // Arithmetic on a NON-protected column is clean.
    expect(leakCols(P("return u.id * 1000;"))).toEqual([]);
  });

  test("round 3: allowlisted method NAMES on an object carrying protected data are not trusted", () => {
    expect(leakCols(mod("const o = { digest: () => u.passwordHash }; return o.digest();"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("const o = { includes: (x) => u.passwordHash }; return o.includes(1);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("class Box { constructor(v) { this.v = v; } test() { return this.v; } } return new Box(u.passwordHash).test();"))).toEqual(["passwordHash"]);
    // getTime is the identity on a number: removed from the derived list (N3 bug).
    expect(leakCols(mod("return new Date(u.passwordHash).getTime();"))).toEqual(["passwordHash"]);
  });

  test("round 3 N5: Object.keys(row) is column names; scrml:data pick/omit are modelled", () => {
    const DATA = 'import { pick, omit } from "scrml:data";';
    expect(leakCols(mod("return Object.keys(u);"))).toEqual([]);
    expect(leakCols(mod('return pick(u, ["id", "name"]);', DATA))).toEqual([]);
    expect(leakCols(mod('return pick(u, ["id", "passwordHash"]);', DATA))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return omit(u, ["passwordHash"]);', DATA))).toEqual([]);
    expect(leakCols(mod('return omit(u, ["id"]);', DATA))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return pick(u, keys);", DATA))).toEqual(["passwordHash"]); // non-literal keys: fail closed
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

  // S441 round 5, F1 — `.length` is derived only where it is a known count.
  test("F1: `.length` of a receiver that is not a known string / array carries its protection", () => {
    for (const body of [
      "return ({ length: u.passwordHash }).length;",
      "return new Array(u.passwordHash).length;",
      "const o = { length: u.passwordHash }; return o.length;",
      "const { length } = { length: u.passwordHash }; return length;",
      'return "x".repeat(u.passwordHash).length;',
      'return "".padEnd(u.passwordHash).length;',
      "return Array.from({ length: u.passwordHash }).length;",
      "return [...Array(u.passwordHash)].length;",
      "const a = []; a.length = u.passwordHash; return a.length;",
      'return (new Array(u.passwordHash) + "").length;',
      "function mk(n) { return { length: n }; } return mk(u.passwordHash).length;",
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, ["passwordHash"]]);
    }
  });

  test("F1: `.length` of the column itself, a string built from it, an array of it, and rows stays derived", () => {
    for (const body of [
      "return u.passwordHash.length;",
      "const h = u.passwordHash; return h.length;",
      "return `a${u.passwordHash}`.length;",
      'return ("a" + u.passwordHash).length;',
      "return [u.passwordHash].length;",
      "return [u, u].length;",
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, []]);
    }
  });

  // S441 round 5, F2 — column names compare case-insensitively.
  test("F2: a descriptor column matches a member read of any case, and reveal is case-insensitive", () => {
    const upper = (body) => mod(body).replace('["passwordHash"]', '["PASSWORDHASH"]');
    expect(leakCols(upper("return u.passwordHash;"))).toEqual(["PASSWORDHASH"]);
    expect(leakCols(mod("return u.PASSWORDHASH;"))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return _scrml_protect_reveal(u, "PASSWORDHASH").passwordHash;'))).toEqual([]);
  });

  // S441 round 5, F4 — a write into an element a collection method hands back
  // lands in the collection.
  test("F4: element-returning methods join the container's alias class", () => {
    for (const body of [
      "const arr = [{ x: 1 }]; arr.find((e) => true).x = u.passwordHash; return arr;",
      "const arr = [{ x: 1 }]; arr.findLast((e) => true).x = u.passwordHash; return arr;",
      "const arr = [{ x: 1 }]; arr.filter((e) => true)[0].x = u.passwordHash; return arr;",
      "const arr = [{ x: 1 }]; arr.at(0).x = u.passwordHash; return arr;",
      "const e = { x: 1 }; const arr = [e]; arr.pop().x = u.passwordHash; return e;",
      "const arr = [{ x: 1 }]; arr.sort()[0].x = u.passwordHash; return arr;",
      "const m = new Map(); const o = { x: 1 }; m.set('k', o); m.get('k').x = u.passwordHash; return o;",
      "const k = {}; const o = { x: 1 }; const w = new WeakMap(); w.set(k, o); w.get(k).x = u.passwordHash; return o;",
      "const o = { a: { x: 1 } }; Object.values(o)[0].x = u.passwordHash; return o;",
      "const o = { a: { x: 1 } }; Object.entries(o)[0][1].x = u.passwordHash; return o;",
      "const arr = [{ x: 1 }]; arr.values().next().value.x = u.passwordHash; return arr;",
      "const o = { x: 1 }; const p = {}; Object.setPrototypeOf(o, p); p.h = u.passwordHash; return { v: o.h };",
      "const p = {}; const w = Object.create(p); p.h = u.passwordHash; return { v: w.h };",
      "const arr = [[]]; arr.find((e) => true).push(u.passwordHash); return arr;",
      "const arr = [{}]; Object.assign(arr.find((e) => true), { x: u.passwordHash }); return arr;",
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, ["passwordHash"]]);
    }
    expect(leakCols(mod("const arr = [{ x: 1 }]; arr.find((e) => true).x = u.name; return arr;"))).toEqual([]);
  });

  // ---- S443 round 6 — every shape below was served over HTTP on main --------
  const uniq = (xs) => [...new Set(xs)].sort();

  test("r6 L1: a callback handed to an UNMODELLED call receives everything the call can reach", () => {
    for (const body of [
      'let s = ""; u.passwordHash.replace(/.+/, (m) => { s = m; }); return s;',
      'let s = ""; JSON.stringify(u, (k, v) => { if (k === "passwordHash") s = v; return v; }); return s;',
      'let s = ""; String(u.passwordHash).replaceAll(/./g, (m) => { s += m; return m; }); return s;',
      // the callback's RETURN is part of the result
      'return "x".replace("x", () => u.passwordHash);',
      // host / npm callees, and a callback held inside an argument object
      'let s = ""; each(u, (v) => { s = v; }); return s;',
      'let s = ""; each([u.passwordHash], { cb: (v) => { s = v; } }); return s;',
      'let s = ""; queueMicrotask(() => { s = u.passwordHash; }); return s;',
    ]) {
      expect([body, leakCols(mod(body, 'import { each } from "some-npm-pkg";')).includes("passwordHash")]).toEqual([body, true]);
    }
    // A callback that touches nothing protected stays clean, and a MODELLED
    // callback method keeps its precise element model.
    expect(leakCols(mod('let s = ""; "abc".replace(/b/, (m) => { s = m; }); return s;'))).toEqual([]);
    expect(leakCols(mod("return [u].map((r) => r.name);"))).toEqual([]);
  });

  test("r6 L2: `arguments` carries every argument", () => {
    const H = "function pass() { return arguments[0]; }\nfunction all() { return arguments; }\nfunction n() { return arguments.length; }";
    expect(leakCols(mod("return pass(u.passwordHash);", H))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return all(1, u.passwordHash);", H))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return pass(u);", H))).toEqual([]); // the row itself — stripped at the sink
    expect(leakCols(mod("return n(u.passwordHash);", H))).toEqual([]); // the argument COUNT
    // An arrow reads its enclosing function's `arguments`.
    expect(leakCols(mod("return outer(u.passwordHash);", "function outer() { const f = () => arguments[0]; return f(); }"))).toEqual(["passwordHash"]);
  });

  test("r6 L3: a global store is one compile-wide cell, and writing a value into it is an egress", () => {
    for (const body of [
      "globalThis.x = u.passwordHash; return 1;",
      'globalThis["k"] = u.passwordHash; return 1;',
      "process.env.LEAK = u.passwordHash; return 1;",
      "const e = process.env; e.LEAK = u.passwordHash; return 1;",
      "Object.assign(globalThis, { x: u.passwordHash }); return 1;",
    ]) {
      const r = analyzeProtectFlow(mod(body));
      expect([body, r.leaks.some((l) => l.global && l.column === "passwordHash")]).toEqual([body, true]);
    }
    // Provenance on read, across functions (and modules): a reader elsewhere ships it.
    const js = mod("globalThis.cache = { h: u.passwordHash }; return 1;") + `
async function _scrml_handler_other_2(_scrml_req) {
  const _scrml_result = await (async () => { return globalThis.cache.h; })();
  return new Response(JSON.stringify(_scrml_protect_redact(_scrml_result) ?? null), { status: 200 });
}`;
    const leaks = analyzeProtectFlow(js).leaks;
    expect(leaks.some((l) => l.sinkFn === "other" && l.column === "passwordHash")).toBe(true);
    // A function kept in a global: what it returns is what a global call returns.
    expect(leakCols(mod("globalThis.peek = () => u.passwordHash; return globalThis.peek();"))).toEqual(["passwordHash"]);
    // … and one handed protected data through a global path is analysed with it.
    expect(leakCols(mod("let s = ''; globalThis.put = (v) => { s = v; }; globalThis.put(u.passwordHash); return s;"))).toEqual(["passwordHash"]);
    // A ROW kept in a global keeps its descriptor — not an egress on its own.
    expect(analyzeProtectFlow(mod("globalThis.last = u; return 1;")).leaks).toEqual([]);
    // Clean global use is untouched.
    expect(leakCols(mod("const t = Date.now(); return { id: u.id, t, n: Math.max(1, 2) };"))).toEqual([]);
  });

  test("r6b L4: a REMOVAL by an unreadable key from a row-bearing value ships every column — whatever the key's source", () => {
    for (const body of [
      'delete u[Symbol.for("scrml.protect.col:passwordhash")]; return u;',
      "for (const k of Object.getOwnPropertySymbols(u)) delete u[k]; return u;",
      "const c = { ...u }; for (const k of Object.getOwnPropertySymbols(c)) delete c[k]; return c;",
      'const c = { ...u }; Object.defineProperty(c, Symbol.for("scrml.protect.col:pin"), { enumerable: false }); return { ...c };',
      // Round-6b review: aliases walked past the round-6 Symbol-source list.
      'const S = Symbol; const k = S.for("scrml.protect.col:passwordhash"); const c = { ...u }; delete c[k]; return c;',
      'const k = globalThis.Symbol.for("scrml.protect.col:passwordhash"); const c = { ...u }; delete c[k]; return c;',
      "const O = Object; const c = { ...u }; for (const k of O.getOwnPropertySymbols(c)) { delete c[k]; } return c;",
      'const sf = Symbol.for.bind(Symbol); const c = { ...u }; delete c[sf("scrml.protect.col:pin")]; return c;',
      'const { for: sf } = Symbol; const c = { ...u }; delete c[sf("scrml.protect.col:pin")]; return c;',
      // any key at all, and every removal form
      "const c = { ...u }; delete c[someKey()]; return c;",
      "const c = { ...u }; Reflect.deleteProperty(c, someKey()); return c;",
      "const O = Object; const c = { ...u }; O.defineProperty(c, someKey(), { enumerable: false }); return { ...c };",
      "const c = { ...u }; Object.defineProperties(c, someDescs()); return { ...c };",
      "const { [someKey()]: _drop, ...rest } = u; return rest;",
      "const c = { ...u }; const d = c; delete d[someKey()]; return c;",
      "function strip(o, k) { delete o[k]; } const c = { ...u }; strip(c, someKey()); return c;",
    ]) {
      expect([body, uniq(leakCols(mod(body, "function someKey() { return 1; }\nfunction someDescs() { return {}; }")))]).toEqual([body, ["passwordHash"]]);
    }
    // WRITES cannot under-strip (the runtime floor reads marker PRESENCE), and a
    // removal by a literal key names a column, not a marker.
    for (const body of [
      "const S = Symbol; const c = { ...u, [S.for(\"scrml.protect.col:pin\")]: 0 }; return c;",
      'const rows = [u]; const i = 0; rows[i] = { ...rows[0], x: 1 }; const k = "name"; rows[0][k] = "n"; return rows;',
      'const c = { ...u }; delete c["passwordHash"]; delete c.pin; return c;',
      'const { name, ...rest } = u; return rest;',
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, []]);
    }
  });

  test("r6b MUST 1: a Symbol built from a protected value carries it (description, toString, keyFor, a keyed object)", () => {
    for (const body of [
      "return Symbol.for(u.passwordHash).description;",
      "return Symbol.for(u.passwordHash).toString();",
      "return Symbol.keyFor(Symbol.for(u.passwordHash));",
      "const o = { [Symbol.for(u.passwordHash)]: 1 }; return Object.getOwnPropertySymbols(o)[0].description;",
      "const o = { [Symbol(u.passwordHash)]: 1 }; return Object.getOwnPropertySymbols(o).map((s) => s.description);",
      "return String(Symbol.for(u.passwordHash));",
      "return Symbol.for(u.passwordHash).description;",
    ]) {
      expect([body, leakCols(mod(body)).length > 0]).toEqual([body, true]);
    }
  });

  test("r6b SHOULD 5: a function kept in a global is applied only through its own name — no blame on unrelated code", () => {
    const js = mod("return Math.abs(u.passwordHash) == 3;") + `
async function _scrml_handler_setup_2(_scrml_req) {
  const _scrml_result = await (async () => { globalThis.clamp = (v) => Math.max(v, 0); return 1; })();
  return new Response(JSON.stringify(_scrml_protect_redact(_scrml_result) ?? null), { status: 200, headers: { "X-T": String(Date.now()) } });
}`;
    expect(analyzeProtectFlow(js).leaks).toEqual([]);
    // …but through its name it is still analysed.
    expect(leakCols(mod("globalThis.clamp = (v) => v; return globalThis.clamp(u.passwordHash);"))).toEqual(["passwordHash"]);
    expect(leakCols(mod("clamp2 = (v) => v; return clamp2(u.passwordHash);"))).toEqual(["passwordHash"]);
    // A function stored where no name is readable reaches every global call.
    expect(leakCols(mod("const g = globalThis; g.f = (v) => v; return Math.abs(u.passwordHash) + globalThis.f(u.passwordHash);"))).toContain("passwordHash");
  });

  test("r6b SHOULD 6: many global-stored functions stay fast", () => {
    let extra = "";
    let body = "let t = 0; ";
    for (let i = 0; i < 16; i++) {
      extra += `function g${i}() { globalThis.fn${i} = (a, b) => Math.max(a, b, globalThis.fn${(i + 1) % 16}(a, b)); return 1; }\n`;
      body += `t = t + Math.min(u.passwordHash + ${i}, t); `;
    }
    body += "return t == 3;";
    const t0 = performance.now();
    const r = analyzeProtectFlow(mod(body, extra));
    const ms = performance.now() - t0;
    expect(r.saturated).toBe(false);
    expect(ms).toBeLessThan(5000); // base 0.4 s; round 6 took ~20 s at N=16 deep
  });

  test("r6 RULING S443 #7: only keyed / password-class hashes derive; a bare digest stays protected", () => {
    const C = 'import { hash, hmac, verifyHash } from "scrml:crypto";';
    expect(leakCols(mod('return hash("md5", u.passwordHash);', C))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return hash("sha256", u.passwordHash);', C))).toEqual(["passwordHash"]);
    expect(leakCols(mod("return hash(alg, u.passwordHash);", C))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return await crypto.subtle.digest("SHA-256", u.passwordHash);'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return hash("argon2", u.passwordHash);', C))).toEqual([]);
    expect(leakCols(mod('return await hmac(process.env.SERVER_KEY, u.passwordHash);', C))).toEqual([]);
    expect(leakCols(mod('return await hmac(u.passwordHash, "known message");', C))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return verifyHash("sha256", pw, u.passwordHash);', C))).toEqual([]);
  });

  test("r6e: `this` in a function stored on an object carries the object's provenance", () => {
    for (const body of [
      "u.toJSON = function () { return { pw: this.passwordHash }; }; return u;",
      "const c = { ...u, toJSON() { return { pw: this.passwordHash }; } }; return c;",
      "const c = { ...u, get pw2() { return this.passwordHash; } }; return c;",
      "const rs = [u]; for (const r of rs) { r.toJSON = function () { return [this.passwordHash]; }; } return rs;",
      'Object.defineProperty(u, "pw3", { get: function () { return this.passwordHash; }, enumerable: true }); return u;',
      "Object.assign(u, { toJSON() { return { pw: this.passwordHash }; } }); return u;",
      // an arrow inside the method reads the method's `this`
      "u.toJSON = function () { const f = () => this.passwordHash; return { pw: f() }; }; return u;",
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, ["passwordHash"]]);
    }
    // A method on a row that reads only clean columns is fine.
    expect(leakCols(mod("u.toJSON = function () { return { n: this.name }; }; return u;"))).toEqual([]);
  });

  test("r6e: `import.meta.env.X` is positive runtime evidence for an hmac key", () => {
    const C = 'import { hmac } from "scrml:crypto";';
    expect(leakCols(mod("return await hmac(import.meta.env.HMAC_KEY, String(u.passwordHash));", C))).toEqual([]);
  });

  test("r6c: a removal keyed by a const-bound literal is literal; otherwise the error names the fix", () => {
    for (const body of [
      "const byId = { 1: u }; const gone = 1; delete byId[gone]; return byId;",
      'const c = { ...u }; const k = "name"; delete c[k]; return c;',
      'const k = "name"; const { [k]: _n, ...rest } = u; return rest;',
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, []]);
    }
    // `let` can be rebound, and a const shadowed in another block is ambiguous: still flagged.
    expect(leakCols(mod('const c = { ...u }; let k = "name"; delete c[k]; return c;'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('const c = { ...u }; { const k = "name"; } { const k = someKey(); delete c[k]; } return c;', "function someKey() { return 1; }"))).toEqual(["passwordHash"]);
    const errs = buildProtectFlowDiagnostics(mod("const byId = { 1: u }; delete byId[u.id]; return byId;"), [], "<m>", () => null);
    expect(errs.map((e) => e.code)).toContain("E-PROTECT-006");
    expect(errs.find((e) => e.code === "E-PROTECT-006").message).toContain("LITERAL key");
    expect(errs.find((e) => e.code === "E-PROTECT-006").message).toContain("filter");
  });

  test("r6c RULING S445 #4: a constant imported from another server module is still a constant", () => {
    const keys = { filePath: "/p/keys.server.js", js: 'export const HMAC_KEY = "public-key";\nexport const ENV_KEY = process.env.HMAC_KEY;\n' };
    const app = (k) => ({
      filePath: "/p/app.server.js",
      js: `import { hmac } from "scrml:crypto";\nimport { ${k} } from "./keys.server.js";\n` + mod(`return await hmac(${k}, String(u.passwordHash));`),
      infos: [],
      spanOf: () => null,
    });
    const resolve = (from, spec) => (spec === "./keys.server.js" ? "/p/keys.server.js" : null);
    const codes = (k) => (analyzeCompileProtectFlow([keys, app(k)], resolve).get("/p/app.server.js") ?? []).map((e) => e.code);
    expect(codes("HMAC_KEY")).toContain("E-PROTECT-006");
    expect(codes("ENV_KEY")).not.toContain("E-PROTECT-006");
  });

  test("r6b RULING S445 #4: an HMAC keyed by a compile-time CONSTANT is a digest; a runtime key declassifies", () => {
    const C = 'import { hmac } from "scrml:crypto";';
    const CH = 'import { hmac, hash } from "scrml:crypto";\nimport { normalize, basename } from "scrml:path";\nimport { capitalize, truncate, padLeft } from "scrml:format";\nimport { getSecret } from "secret-store";';
    for (const body of [
      'return await hmac("public-key", String(u.passwordHash));',
      'const K = "public-key"; return await hmac(K, String(u.passwordHash));',
      'const K = `pub-${"key"}`; return await hmac(K, String(u.passwordHash));',
      'const K = "pub" + "-key"; return await hmac(K, String(u.passwordHash));',
      'function sign(k, m) { return hmac(k, m); } return await sign("public-key", String(u.passwordHash));',
      'return await hmac(process.env.K ?? "dev-key", String(u.passwordHash));', // may be the constant
      // Round 6c: a constant built THROUGH a call is still a constant, and a key
      // with NO evidence of a runtime source is not a secret.
      "return await hmac(String.fromCharCode(107, 101, 121), String(u.passwordHash));",
      "return await hmac(JSON.parse('\"key\"'), String(u.passwordHash));",
      "return await hmac(String(Math.PI), String(u.passwordHash));",
      "return await hmac(SERVER_KEY, String(u.passwordHash));",
      // A concatenation with a constant part: `"k" + undefined` when unset.
      'return await hmac("k" + process.env.K, String(u.passwordHash));',
      'return await hmac(process.env.HMAC_KEY + "-v2", String(u.passwordHash));',
      // Round 6d: a PURE stdlib helper of constants is a constant, and an npm
      // function the compiler has no model for is not evidence of a secret.
      'return await hmac(normalize("public-key"), String(u.passwordHash));',
      'return await hmac(basename("/x/public-key"), String(u.passwordHash));',
      'return await hmac(capitalize("public-key"), String(u.passwordHash));',
      'return await hmac(truncate("public-key", 99), String(u.passwordHash));',
      'return await hmac(padLeft("k", 3, "x"), String(u.passwordHash));',
      'return await hmac(hash("sha256", "public"), String(u.passwordHash));',
      'return await hmac(process.env.K ?? normalize("dev"), String(u.passwordHash));',
      "return await hmac(await getSecret(), String(u.passwordHash));",
    ]) {
      expect([body, leakCols(mod(body, CH))]).toEqual([body, ["passwordHash"]]);
    }
    const CS = C + '\nimport { env } from "scrml:process";\nimport { get } from "scrml:http";\nimport { normalize } from "scrml:path";';
    for (const body of [
      "return await hmac(process.env.HMAC_KEY, String(u.passwordHash));",
      "return await hmac(Bun.env.HMAC_KEY, String(u.passwordHash));",
      'return await hmac(env("HMAC_KEY"), String(u.passwordHash));', // the configuration read (scrml:process)
      'return await hmac((await get("https://vault/key")).body, String(u.passwordHash));', // a network read
      'return await hmac(normalize(env("HMAC_KEY")), String(u.passwordHash));', // pure helper of a runtime source
      'const s = ?{`SELECT k FROM secrets`}; return await hmac(s[0].k, String(u.passwordHash));'.replace("?{`SELECT k FROM secrets`}", "_scrml_sql`SELECT k FROM secrets`"),
    ]) {
      expect([body, leakCols(mod(body, CS))]).toEqual([body, []]);
    }
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

// S447 round 7 — the MECHANISMS, driven on raw JS (several of these shapes —
// object-literal method shorthand, accessors — do not survive scrml codegen
// today, so only raw JS reaches them; the flow must still be right on them).
describe("analyzeProtectFlow — round 7: `this` is the receiver", () => {
  test("a write through `this` lands in the receiver, whichever route supplied it", () => {
    for (const body of [
      // stored on the object, called as a method
      "u.stash = function () { this.x = this.passwordHash; }; u.stash(); return u;",
      "const c = { ...u }; c.stash = function () { this.x = this.passwordHash; }; c.stash(); return c;",
      "const rs = [u]; for (const r of rs) { r.stash = function () { this.x = this.passwordHash; }; r.stash(); } return rs;",
      "u.stash = function () { this.name = this.passwordHash; }; u.stash(); return u;",
      // a user method named like a built-in mutator (`set`) is still CALLED
      'const o = { h: "" }; o.set = function (r) { this.h = r.passwordHash; }; o.set(u); return o;',
      'const o = { h: "" }; o.set = function (r) { const self = this; self.h = r.passwordHash; }; o.set(u); return o;',
      "const o = { inner: {} }; o.set = function (r) { this.inner.h = r.passwordHash; }; o.set(u); return o.inner;",
      // object-literal method / spread-copied / assigned / inherited
      'const o = { h: "", set(r) { this.h = r.passwordHash; } }; o.set(u); return o;',
      'const p = { set(r) { this.h = r.passwordHash; } }; const o = { ...p, h: "" }; o.set(u); return o;',
      'const p = { set(r) { this.h = r.passwordHash; } }; const o = Object.assign({ h: "" }, p); o.set(u); return o;',
      "const p = { set(r) { this.h = r.passwordHash; } }; const o = Object.create(p); o.set(u); return o;",
      'const o = { h: "" }; Object.setPrototypeOf(o, { set(r) { this.h = r.passwordHash; } }); o.set(u); return o;',
      // call / apply / bind / Reflect.apply / an array callback's thisArg
      "function stash() { this.x = this.passwordHash; } stash.call(u); return u;",
      'const o = { h: "" }; function st(r) { this.h = r.passwordHash; } st.apply(o, [u]); return o;',
      'const o = { h: "" }; const st = function (r) { this.h = r.passwordHash; }.bind(o); st(u); return o;',
      'const o = { h: "" }; function st(r) { this.h = r.passwordHash; } Reflect.apply(st, o, [u]); return o;',
      'const o = { h: "" }; [u].forEach(function (r) { this.h = r.passwordHash; }, o); return o;',
      // `new`
      "const F = function (r) { this.h = r.passwordHash; }; return new F(u);",
      "function F(r) { this.h = r.passwordHash; } const x = new F(u); return x;",
    ]) {
      expect([body, leakCols(mod(body)).length > 0]).toEqual([body, true]);
    }
  });

  test("clean writes through `this` stay clean (no alias unification)", () => {
    for (const body of [
      'u.greet = function () { this.label = "hi " + this.name; }; u.greet(); return u;',
      "const c = { n: 0, inc() { this.n = this.n + 1; } }; c.inc(); return { id: u.id, n: c.n };",
      "const o = { n: u.name, show() { return this.n; } }; return o.show();",
      // a setter-named method on an object that never sees protected data
      'const store = { m: {}, set(k, v) { this.m[k] = v; } }; store.set("a", u.name); return { a: store.m.a, id: u.id };',
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, []]);
    }
  });
});

describe("analyzeProtectFlow — round 7: implicit invocation", () => {
  test("a function stored where the language calls it is analysed as called", () => {
    for (const body of [
      // tagged templates (the strings array is the first argument)
      "const tag = (s, v) => v; return tag`${u.passwordHash}`;",
      "const t = { f: (s, v) => v }; return t.f`${u.passwordHash}`;",
      "const t = { f(s) { return this.p; } }; t.p = u.passwordHash; return t.f`x`;",
      // coercion hooks
      "const o = { toString: () => u.passwordHash }; return `${o}`;",
      "const o = { valueOf: () => u.pin }; return o + 0;",
      "const o = { valueOf: () => u.pin }; return +o;",
      "const o = { [Symbol.toPrimitive]: () => u.passwordHash }; return `${o}`;",
      "const S = Symbol; const o = { [S.toPrimitive]: () => u.passwordHash }; return `${o}`;",
      "u.toString = function () { return this.passwordHash; }; return `${u}`;",
      "u.valueOf = function () { return this.pin; }; return u + 0;",
      "const k = { toString: () => u.passwordHash }; const o = {}; o[k] = 1; return o;",
      "const o = { toString() { globalThis.q1 = u.passwordHash; return 'x'; } }; const s = `${o}`; return 1;",
      "let s = ''; const o = { valueOf() { s = u.passwordHash; return 1; } }; const b = o == 1; return s;",
      // iterators
      "const o = { [Symbol.iterator]: function* () { yield u.passwordHash; } }; return [...o];",
      "const o = { [Symbol.iterator]: function* () { yield u.passwordHash; } }; let s = ''; for (const x of o) { s = x; } return s;",
      "const o = { [Symbol.iterator]: function* () { yield u.passwordHash; } }; const [a] = o; return a;",
      "const o = { [Symbol.iterator]: function* () { yield u.passwordHash; } }; const id = (a) => a; return id(...o);",
      "const o = { [Symbol.iterator]: function* () { yield u.passwordHash; } }; function* g() { yield* o; } return [...g()];",
      "let i = 0; const o = { [Symbol.iterator]() { return { next: () => ({ value: u.passwordHash, done: i++ > 0 }) }; } }; return [...o];",
      "u[Symbol.iterator] = function* () { yield this.passwordHash; }; return [...u];",
      // accessors
      "const o = { get x() { return u.passwordHash; } }; return { ...o };",
      "const o = { set x(v) { globalThis.k9 = v; } }; o.x = u.passwordHash; return 1;",
      // instanceof → Symbol.hasInstance(left)
      "let s = ''; const C = { [Symbol.hasInstance]: (x) => { s = x.passwordHash; return true; } }; const b = u instanceof C; return s;",
      // thenables — `await` resolves them, and so does a server function's own return
      "const o = { then: (res) => res(u.passwordHash) }; const v = await o; return v;",
      "u.then = function (res) { res(this.passwordHash); }; return await u;",
      "async function mk() { return { then: (res) => res(u.passwordHash) }; } return await mk();",
      // a tag the analysis holds no function for (a host-made function) fails closed
      "const t = String.raw.bind(String); return t`${u.passwordHash}`;",
      "return String.raw`${u.passwordHash}`;",
    ]) {
      // `pin` is protected here too (the numeric coercion shapes read it).
      const js = mod(body).replace('["passwordHash"]', '["passwordHash", "pin"]');
      expect([body, leakCols(js).length > 0]).toEqual([body, true]);
    }
  });

  test("the compiler's SQL client stays a query; unrelated hooks and methods stay clean", () => {
    for (const body of [
      "const tag = (s, v) => s[0] + v; return tag`id ${u.id}`;",
      "const o = { toString: () => u.name }; return `${o}`;",
      "const o = { [Symbol.iterator]: function* () { yield u.name; } }; return [...o];",
      "const o = { describe: () => u.passwordHash }; return { id: u.id };", // a non-hook method nobody calls
      "const r = await _scrml_sql`SELECT name FROM users WHERE passwordHash = ${u.passwordHash}`; return r.length;",
    ]) {
      expect([body, leakCols(mod(body))]).toEqual([body, []]);
    }
  });

  test("a tx handle from the SQL client's .begin() is a query too", () => {
    const body = "return await _scrml_sql.begin(async (tx) => { const r = await tx`SELECT 1 AS x WHERE ${u.passwordHash} != ''`; return r.length; });";
    expect(leakCols(mod(body))).toEqual([]);
  });

  test("round 7 item 3: only the compiler's own `scrml:` stdlib is a deriver — a look-alike path is not", () => {
    for (const spec of ["./_scrml/auth.js", "../_scrml/auth.js", "_scrml/auth.js", "/x/_scrml/auth.js", "scrml:auth.js", "my-scrml:auth"]) {
      const C = `import { verifyPassword, hashPassword } from "${spec}";`;
      expect([spec, leakCols(mod("return verifyPassword(pw, u.passwordHash);", C))]).toEqual([spec, ["passwordHash"]]);
      expect([spec, leakCols(mod("return hashPassword(u.passwordHash);", C))]).toEqual([spec, ["passwordHash"]]);
    }
    // a spoofed crypto `hmac` / process `env` cannot declassify, nor a spoofed `pick` select
    expect(leakCols(mod('return await hmac(env("K"), String(u.passwordHash));', 'import { hmac } from "./_scrml/crypto.js";\nimport { env } from "./_scrml/process.js";'))).toEqual(["passwordHash"]);
    expect(leakCols(mod('return pick(u, ["id"]);', 'import { pick } from "./_scrml/data.js";'))).toEqual(["passwordHash"]);
    // the genuine article still derives
    expect(leakCols(mod("return verifyPassword(pw, u.passwordHash);", 'import { verifyPassword } from "scrml:auth";'))).toEqual([]);
  });

  test("a host function handed to a host call does not recurse (base overflowed the stack)", () => {
    const r = analyzeProtectFlow(`import { a, b } from "some-npm";\nexport async function f() { return a(b); }\n`);
    expect(r.saturated).toBe(false);
  });
});

// S447 round 8 — the two ROOTS (raw JS; every LEAK shape below served or was
// accepted on base f9cd63d86 — a module with no session middleware, so the
// global heap's name scoping is not masked by the compiler's own round trip).
const r8 = (body) => mod(body).replace('["passwordHash"]', '["passwordHash", "pin"]');
describe("analyzeProtectFlow — round 8: a row held in a field is a row", () => {
  test("a named read off a value that HOLDS a row yields the row, not a column of it", () => {
    for (const body of [
      "const t = { h: u }; return t.h.passwordHash;",
      "const t = { h: u }; const { h } = t; return h.passwordHash;",
      "const t = { h: u }; return JSON.stringify(t.h);",
      "const t = { h: u }; return Object.values(t.h);",
      "const rs = [u]; const t = { rs }; return t.rs.map((r) => r.passwordHash);",
      "const t = { a: { b: u } }; return t.a.b.pin;",
      "const t = { h: u, f() { return this.h.passwordHash; } }; return t.f();",
      "const t = { h: u }; Object.defineProperty(t, 'z', { get: function () { return this.h.passwordHash; }, enumerable: true }); return { z: t.z };",
      "const t = {}; t.h = u; return t.h.passwordHash;",
      "const t = { a: {} }; t.a.b = u; return t.a.b.passwordHash;",
      "const a = {}; const t = { a }; a.b = u; return t.a.b.passwordHash;",
      "const t = { h: u }; return { ...t }.h.passwordHash;",
      "const t = { h: u }; return Object.assign({}, t).h.passwordHash;",
      "const t = { h: u }; const f = (o) => o.h; return f(t).passwordHash;",
      "function g() { return { h: u }; } return g().h.passwordHash;",
      "const o = Object.create({ h: u }); return o.h.passwordHash;",
      "const p = Promise.resolve({ h: u }); return (await p).h.passwordHash;",
      "function* g() { yield { h: u }; } for (const x of g()) { return x.h.passwordHash; } return 1;",
      "const t = { h: [u] }; return t.h[0].passwordHash;",
      "const t = { h: u }; const o = {}; o.t = t; return o.t.h.passwordHash;",
      "const t = { h: u }; return [t][0].h.passwordHash;",
      "const t = { h: u }; const { h: { passwordHash: x } } = t; return x;",
      "const t = { h: u }; return t?.h?.passwordHash;",
      "const t = { h: u }; globalThis.st8 = t; return globalThis.st8.h.passwordHash;",
      // the shapes that already failed closed stay closed
      "const m = new Map([['k', u]]); return m.get('k').passwordHash;",
      "const t = [[u]]; return t[0][0].passwordHash;",
      "return [1].flatMap(() => [u])[0].passwordHash;",
    ]) {
      expect([body, leakCols(r8(body)).length > 0]).toEqual([body, true]);
    }
  });

  test("a field that does not hold the row stays clean; the row itself is still stripped", () => {
    for (const body of [
      "const t = { user: u, n: u.name }; return { n: t.n, id: t.user.id };",
      "const t = { h: u }; return t;",
      "const t = { h: u }; return t.h;",
      "const t = { h: u, meta: { count: 1 } }; return { c: t.meta.count };",
      "const t = { h: u }; return { id: t.h.id, n: t.h.name };",
      "const rs = [u]; const t = { rs }; return t.rs.map((r) => ({ id: r.id }));",
      "const t = { user: u, label: 'x' }; return { l: String(t.label), id: t.user.id };",
    ]) {
      expect([body, leakCols(r8(body))]).toEqual([body, []]);
    }
  });
});

describe("analyzeProtectFlow — round 8: an aliased global resolves to its named path", () => {
  test("a function stored in the global heap is reached through an alias, whatever its name", () => {
    for (const body of [
      "globalThis.box17 = { h: '', set: function (r) { this.h = r.passwordHash; } }; const g = globalThis.box17; g.set(u); return g;",
      "globalThis.box22 = { h: '', set: function (r) { this.h = r.passwordHash; } }; const g = globalThis.box22; g.set(u); return { v: g.h };",
      "globalThis.C31 = { set: function (x) { return x.passwordHash; } }; const C = globalThis.C31; return C.set(u);",
      "globalThis.C32 = { map: function (x) { return x.passwordHash; } }; const C = globalThis.C32; return C.map(u);",
      "globalThis.C34 = { get: function (x) { return x.passwordHash; } }; const P = globalThis; return P.C34.get(u);",
      "globalThis.box40 = { h: '', set: function (r) { this.h = r.passwordHash; } }; const w = { g: globalThis.box40 }; w.g.set(u); return w.g;",
      "globalThis.box42 = { forEach: function (r) { return r.passwordHash; } }; const g = globalThis.box42; return g.forEach(u);",
      "const g = globalThis; g.bx = { set(r) { this.h = r.passwordHash; } }; g.bx.set(u); return { v: globalThis.bx.h };",
      "globalThis.bx2 = { h: '', set(r) { this.h = r.passwordHash; } }; const k = 'bx2'; globalThis[k].set(u); return { v: 1 };",
      // instanceof through an alias — destructured, a const, a namespace alias
      "let s = ''; globalThis.C10 = { [Symbol.hasInstance]: function (x) { s = x.passwordHash; return true; } }; const C = globalThis.C10; const b = u instanceof C; return s;",
      "let s = ''; globalThis.C14 = { [Symbol.hasInstance]: function (x) { s = x.passwordHash; return true; } }; const { C14 } = globalThis; const b = u instanceof C14; return s;",
      "let s = ''; process.C24 = { [Symbol.hasInstance]: function (x) { s = x.passwordHash; return true; } }; const P = process; const b = u instanceof P.C24; return s;",
      // a path the compiler cannot name fails closed
      "let s = ''; const k = 'C' + '9'; globalThis[k] = { [Symbol.hasInstance]: function (x) { s = x.passwordHash; return true; } }; const C = globalThis[k]; const b = u instanceof C; return s;",
    ]) {
      expect([body, leakCols(r8(body)).length > 0]).toEqual([body, true]);
    }
  });

  test("a clean value through the same aliases stays clean", () => {
    for (const body of [
      "globalThis.box50 = { h: '', set: function (r) { this.h = r.name; } }; const g = globalThis.box50; g.set(u); return { v: g.h };",
      "const m = new Map(); m.set('k', u.name); return { v: m.get('k') };",
      "return { n: Math.max(u.id, 1) };",
      "let s = ''; globalThis.C51 = { [Symbol.hasInstance]: function (x) { s = x.name; return true; } }; const C = globalThis.C51; const b = u instanceof C; return { s };",
    ]) {
      expect([body, leakCols(r8(body))]).toEqual([body, []]);
    }
  });
});

describe("analyzeProtectFlow — round 8: adversarial follow-ups (self-review)", () => {
  test("prototypes, platform mutators with an explicit receiver, element-aliasing built-ins, mixed global names", () => {
    for (const body of [
      // `__proto__:` in a literal sets the prototype — its properties are read off the object
      "return { __proto__: { h: u } }.h.passwordHash;",
      "const p = { h: u }; const o = { __proto__: p }; return o.h.passwordHash;",
      // a platform method run with an explicit receiver writes into it
      "const arr = []; Array.prototype.push.call(arr, u); return arr[0].passwordHash;",
      "const arr = []; arr.push.call(arr, u); return arr[0].passwordHash;",
      "const arr = []; Reflect.apply(Array.prototype.push, arr, [u]); return arr[0].passwordHash;",
      // `Reflect.get` / `Object.values` hand back members WITH their functions
      "globalThis.box60 = { h: '', set(r) { this.h = r.passwordHash; } }; Reflect.get(globalThis, 'box60').set(u); return { v: globalThis.box60.h };",
      "globalThis.box61 = { h: '', set(r) { this.h = r.passwordHash; } }; Object.values(globalThis)[0].set(u); return { v: globalThis.box61.h };",
      // a global object reached WITHOUT a name, joined with a named one: the names no longer cover it
      "const o = { h: '', stash(r) { this.h = r.passwordHash; } }; globalThis.box62 = o; const p = u.id > 0 ? o : globalThis.other62; p.stash(u); return o;",
      // further row-in-field shapes
      "const o = {}; o.__proto__ = { h: u }; return o.h.passwordHash;",
      "const o = { get h() { return u; } }; return o.h.passwordHash;",
      "return Object.defineProperty({}, 'h', { value: u }).h.passwordHash;",
      "const t = { h: u }; for (const k in t) { return t[k].passwordHash; } return 1;",
      "const t = { h: u }; return [t].concat([])[0].h.passwordHash;",
      "try { throw { h: u }; } catch (e) { return e.h.passwordHash; }",
      "function f() { return arguments[0].h; } return f({ h: u }).passwordHash;",
      "const t = { 1: u }; return t[1].passwordHash;",
      "const t = { h: u }; const k = 'h'; const { [k]: v } = t; return v.passwordHash;",
      "const t = { a: { b: { c: { d: { e: { f: u } } } } } }; return t.a.b.c.d.e.f.passwordHash;",
      "const t = { h: u }; return t.h.PASSWORDHASH;",
    ]) {
      expect([body, leakCols(r8(body)).length > 0]).toEqual([body, true]);
    }
    expect(leakCols(r8("const t = { h: u }; t.h = null; return { id: 1 };"))).toEqual([]);
  });
});

describe("analyzeProtectFlow — round 8: logical assignment and element positions", () => {
  test("`a ||= b` / `a ??= b` evaluate to a's current value", () => {
    for (const body of [
      "let a = u; const x = (a ||= 1); return x.passwordHash;",
      "const t = { h: u }; const x = (t.h ??= 1); return x.passwordHash;",
      "let a = u; const x = (a &&= a); return x.pin;",
      "globalThis.k70 = u; const x = (globalThis.k70 ??= {}); return x.passwordHash;",
    ]) {
      expect([body, leakCols(r8(body)).length > 0]).toEqual([body, true]);
    }
  });

  test("a function stored in an ELEMENT of a global container is reached by element reads, not by every named call", () => {
    // Base: writing a global-derived value into a container recorded every global
    // function as "stored where no name is readable", so `Math.min(u.pin, 1)`
    // applied `keep` with the pin — a false global store (g2-deep on main).
    expect(leakCols(r8('globalThis.keep = function (v) { globalThis.kept = v; }; const S = new Map(); S.set("k", globalThis.cfg); return Math.min(u.pin, 1) == 3;'))).toEqual([]);
    for (const body of [
      'globalThis.keep = function (v) { globalThis.kept = v; }; const S = new Map(); S.set("k", globalThis.cfg); globalThis.keep(u.pin); return 1;',
      'const S = new Map(); S.set("k", globalThis.cfg); S.set("f", function (v) { globalThis.kept = v; }); S.get("f")(u.pin); return 1;',
      "globalThis.arr = []; globalThis.arr.push(function (v) { return v; }); return globalThis.arr[0](u.passwordHash);",
      "globalThis.arr2 = []; globalThis.arr2.push({ m(v) { return v; } }); return globalThis.arr2[0].m(u.passwordHash);",
      'globalThis.m3 = new Map(); globalThis.m3.set("k", { m(v) { return v; } }); const g = globalThis.m3.get("k"); return g.m(u.passwordHash);',
      "globalThis.arr4 = []; globalThis.arr4.push({ m(v) { return v; } }); for (const g of globalThis.arr4) { return g.m(u.passwordHash); } return 1;",
    ]) {
      expect([body, leakCols(r8(body)).length > 0]).toEqual([body, true]);
    }
  });
});

describe("analyzeProtectFlow — r8b: a spelled path through an element is not a name", () => {
  test("functions stored in global array elements are reached by spelled index paths, iterators and tags", () => {
    // S239 review of round 8 (DO-NOT-LAND): all served the hash at the round-8 head.
    for (const body of [
      "globalThis.arrA = []; globalThis.arrA.push({ m: function (r) { s = r.passwordHash; } }); globalThis.arrA[0].m(u); return { v: s };",
      "globalThis.arrB = []; globalThis.arrB.push({ m: function (r) { return r.passwordHash; } }); return { v: globalThis.arrB[0].m(u) };",
      "globalThis.arrC = []; globalThis.arrC.push(function (r) { s = r.passwordHash; }); const it = globalThis.arrC[Symbol.iterator](); it.next().value(u); return { v: s };",
      "globalThis.arrD = []; globalThis.arrD.push(function (strs, r) { s = r.passwordHash; }); globalThis.arrD[0]`${u}`; return { v: s };",
      "globalThis.a8 = []; globalThis.a8.push({ m: { n: function (r) { s = r.passwordHash; } } }); globalThis.a8[0].m.n(u); return { v: s };",
      "const loc = { m: function (r) { s = r.passwordHash; } }; globalThis.a19 = []; globalThis.a19.push(loc); globalThis.a19[0].m(u); return { v: s };",
    ]) {
      expect([body, leakCols(r8("let s = ''; " + body)).length > 0]).toEqual([body, true]);
    }
  });
});

describe("analyzeProtectFlow — round 8: the round-7 performance cliff", () => {
  // Review-measured on round 7: a 240-object `toString` chain took 13.7 s
  // (0.47 s on base); a shared `this`-writing method on 240 receivers 40.5 s.
  const chain = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join("\n");
  test("a long toString-hook chain finishes fast and clean", () => {
    const body = chain(240, (i) => `const o${i} = { f${i}: ${i === 0 ? "u.name" : `o${i - 1}`}, toString: function () { return String(this.f${i}); } };`) +
      "\nreturn { id: u.id, s: `${o239}` };";
    const t0 = performance.now();
    const r = analyzeProtectFlow(r8(body));
    expect(r.saturated).toBe(false);
    expect(r.leaks).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(10000);
  }, 30000);

  test("a this-writing method shared by many receivers finishes fast and clean", () => {
    const body = "const w = function (v) { this.x = v; return this; };\n" +
      chain(240, (i) => `const o${i} = { f${i}: ${i}, toString: function () { return String(this.f${i}); } }; o${i}.w = w; o${i}.w(o${i === 0 ? 0 : i - 1});`) +
      "\nreturn { id: u.id, s: `${o239}` };";
    const t0 = performance.now();
    const r = analyzeProtectFlow(r8(body));
    expect(r.saturated).toBe(false);
    expect(r.leaks).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(10000);
  }, 30000);

  test("coercions still carry their argument's hooks (they are analysed where stored)", () => {
    for (const body of [
      "const o = { toString: function () { return u.passwordHash; } }; return String(o);",
      "const o = { valueOf: function () { return u.pin; } }; return Number(o);",
      "const o = { [Symbol.toPrimitive]: function () { return u.pin; } }; return Number(o);",
      "const o = { toString: function () { return this.s; }, s: '' }; o.s = u.passwordHash; return String(o);",
      "return String(u.passwordHash);",
      "return Number(u.pin);",
    ]) {
      expect([body, leakCols(r8(body)).length > 0]).toEqual([body, true]);
    }
  });
});

describe("sqlSkeleton", () => {
  test("holes replace interpolations (balanced braces), whitespace collapses", () => {
    expect(sqlSkeleton("SELECT *  FROM t\n WHERE a = ${ f({ x: 1 }) } AND b = ${y}"))
      .toBe("SELECT * FROM t WHERE a = \u0000 AND b = \u0000");
  });
});
