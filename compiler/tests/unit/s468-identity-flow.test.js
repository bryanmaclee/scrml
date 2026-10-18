/**
 * s468 (E-ARG-SERVER-IDENTITY) — unit pins for identity-flow.ts, the location-aware
 * value-source resolver the identity follower (free-name.ts
 * `identityReadInDefaultDeep`) runs over:
 *   - a name resolves in the scope that BINDS it where it is read (a same-named local
 *     of another function is a different binding);
 *   - a parameter's values are the arguments every call passes (call-ref attribute,
 *     plain call, spread);
 *   - a local's values include every mutating write (`Object.assign`, `.push`);
 *   - each binding carries a `key`, so the follower visits it once (no loop on a cycle);
 *   - raw text's server calls are found by parsing it (`rawCalledFreeNames`).
 */
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { buildIdentityFlow, rawCalledFreeNames } from "../../src/identity-flow.ts";
import { identityReadInDefaultDeep } from "../../src/free-name.ts";

const FP = "/t/app.scrml";

function flowOf(source) {
  const r = buildAST(splitBlocks(FP, source));
  const ast = r.ast ?? r;
  // a test stand-in for route-inference's writer set: assignment roots, mutating
  // method receivers, `Object.assign` targets
  const writesOf = (node) => {
    const out = new Set();
    const root = (t) => { while (t && (t.kind === "member" || t.kind === "index")) t = t.object; return t && t.kind === "ident" ? t.name : null; };
    if (node.kind === "assign") { const n = root(node.target); if (n) out.add(n); }
    if (node.kind === "call" && node.callee && node.callee.kind === "member") {
      const recv = root(node.callee.object);
      if (recv === "Object" && node.callee.property === "assign") { const n = root(node.args[0]); if (n) out.add(n); }
      else if (recv && node.callee.property === "push") out.add(recv);
    }
    return out;
  };
  const flow = buildIdentityFlow({ files: [{ filePath: FP, nodes: ast.nodes, imports: ast.imports ?? [] }], resolveImport: null, writesOf });
  return { flow, ast };
}

function findAll(root, pred) {
  const out = [];
  const seen = new WeakSet();
  const walk = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (pred(n)) out.push(n);
    for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
  };
  walk(root);
  return out;
}

/** The identity read reaching argument `index` of the (first) call of `callee` inside function `inFn`. */
function argIdentity(source, inFn, callee, index) {
  const { flow, ast } = flowOf(source);
  const fn = findAll(ast.nodes, (n) => n.kind === "function-decl" && n.name === inFn)[0];
  const call = findAll(fn.body, (n) => n.kind === "call" && n.callee && n.callee.name === callee)[0];
  const arg = call.args[index];
  return identityReadInDefaultDeep(arg, [], {
    currentUserAmbient: true, sessionProjection: true, helperSessionProjection: true,
    resolveName: flow.resolver(FP, { serverCellIsIdentity: false, followRawAssigned: true }),
    rootAt: arg,
  });
}

const PROG = (body, markup = "") => `<program>\n\${\n${body}\n}\n${markup}\n</program>\n`;

describe("identity-flow — scoping", () => {
  test("a local resolves in its own function, not a same-named local elsewhere", () => {
    const src = PROG(`function a() { const u = @session.userId
  log(u) }
function b() { const u = "x"
  log(u) }
function log(v) { }`);
    expect(argIdentity(src, "b", "log", 0)).toBeNull();
    expect(argIdentity(src, "a", "log", 0)?.read).toBe("@session.userId");
  });

  test("a parameter is followed into every caller's argument", () => {
    const src = PROG(`function go(u) { log(u) }
function log(v) { }`, `<button onclick=go(@session.userId)>g</button>`);
    const hit = argIdentity(src, "go", "log", 0);
    expect(hit?.read).toBe("@session.userId");
    expect(hit?.via).toBe("u");
  });

  test("a parameter whose callers pass no identity is not an identity", () => {
    const src = PROG(`function go(u) { log(u) }
function log(v) { }
function c() { go("plain") }`);
    expect(argIdentity(src, "go", "log", 0)).toBeNull();
  });

  test("mutating writes are value sources (`Object.assign`, `.push`)", () => {
    const a = PROG(`function g() { const o = {}
  Object.assign(o, { u: @session.userId })
  log(o) }
function log(v) { }`);
    expect(argIdentity(a, "g", "log", 0)?.read).toBe("@session.userId");
    const b = PROG(`function g() { const xs = []
  xs.push(@session.userId)
  log(xs) }
function log(v) { }`);
    expect(argIdentity(b, "g", "log", 0)?.read).toBe("@session.userId");
  });

  test("a cycle of bindings terminates (each binding visited once by key)", () => {
    const src = PROG(`function g() { let a = 1
  let b = a
  a = b
  log(a) }
function log(v) { }`);
    expect(argIdentity(src, "g", "log", 0)).toBeNull();
  });

  test("the call index records call-ref attribute calls with their arguments", () => {
    const { flow, ast } = flowOf(PROG(`function go(u) { }`, `<button onclick=go(@session.userId)>g</button>`));
    const go = findAll(ast.nodes, (n) => n.kind === "function-decl" && n.name === "go")[0];
    const sites = flow.callSitesOf(go);
    expect(sites.length).toBe(1);
    expect(sites[0].args.length).toBe(1);
    expect(sites[0].byRef).toBe(false);
  });
});

describe("identity-flow — raw text", () => {
  test("rawCalledFreeNames: free callees with arguments, `.call` / `.apply` included; bound and argument-less calls not", () => {
    expect(rawCalledFreeNames(`(x) => { add(x); f.call(null, 2); g.apply(null, [1]); h(); const k = (y) => y; k(1) }`)).toEqual(["add", "f", "g"]);
  });
  test("an unparseable fragment yields nothing (the caller checks the whole raw node)", () => {
    expect(rawCalledFreeNames(`(x) => { add(x`)).toEqual([]);
  });
});
