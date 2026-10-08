/**
 * §64.9 bind address of a generated headless serve-target — S447 ruling (iv):
 * "generated headless serve targets default to loopback, prod stays
 * all-interfaces." (g-generated-headless-and-prod-servers-bind-all-interfaces)
 *
 *   §1  EMITTED SOURCE — a `kind="tool" serve=` module resolves its host from
 *       SCRML_HOST (default 127.0.0.1) at the TOP of the module, before any of its
 *       own top-level statements, and binds through `_scrml_bind.listen`, whose
 *       functions are commands/listen.js's exports as the runtime's
 *       Function.prototype.toString() prints them (Bun's re-print, not the source
 *       text — so the copy is checked BEHAVIOURALLY in §2, not textually).
 *   §2  SELF-CONTAINED + EQUIVALENT — the copied functions, lifted out of their
 *       module with every other listen.js top-level name shadowed by a trap, run
 *       and agree with the listen.js originals (no module-scope reference).
 *   §3  RUNTIME — the generated server, run as `bun <file>`: loopback by default
 *       (IPv4 + its ::1 twin; not reachable on a LAN address), SCRML_HOST=0.0.0.0
 *       opts in to every interface, and an invalid SCRML_HOST (empty, padded,
 *       inet_aton shorthand) exits 1 without listening.
 *   §4  PROD — the `scrml build` production server entry still binds every
 *       interface (the ruling's other half).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { createConnection, createServer } from "net";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as acorn from "acorn";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry } from "../../src/commands/build.js";
import { aliasHostGlobalsInRuntimeText } from "../../src/codegen/host-global-alias.ts";
import {
  isLoopbackHost, isLegacyNumericIPv4, hostRefusal, bindPlan, displayUrlFor, probeIPv6, bindListeners,
  lanIPv4Addresses, DEFAULT_HOST,
} from "../../src/commands/listen.js";

const TMP = mkdtempSync(join(tmpdir(), "headless-bind-"));
afterAll(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
let seq = 0;

const SERIALIZED = { isLoopbackHost, isLegacyNumericIPv4, hostRefusal, bindPlan, displayUrlFor, probeIPv6, bindListeners };

function compileTool(src) {
  const p = join(TMP, `t-${seq++}.scrml`);
  writeFileSync(p, src);
  const r = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
  let toolJs = "";
  for (const [, e] of (r.outputs ?? new Map())) if (e && typeof e.toolJs === "string") toolJs += e.toolJs;
  return { codes: (r.errors ?? []).map((e) => e.code), toolJs };
}

const ENUM = "type Ping:enum = { Hello, Echo(text: string) }";
const EP =
  '<endpoint path="/ping" method="POST" accepts=Ping>\n' +
  '  <Hello      : { ok: true }>\n' +
  '  <Echo(text) : { ok: true, text: text }>\n' +
  "</endpoint>";
const TOOL = (port = 0, logic = "") =>
  `<program kind="tool" serve=${port}>\n\${\n  ${ENUM}\n  ${logic}\n}\n${EP}\n</program>\n`;

// ---------------------------------------------------------------------------
// §1 emitted source
// ---------------------------------------------------------------------------

describe("§1 emitted source — loopback default, SCRML_HOST opt-in, listen.js functions reused", () => {
  const { codes, toolJs } = compileTool(TOOL(7878));

  test("compiles clean and parses as a module", () => {
    expect(codes).toEqual([]);
    expect(() => acorn.parse(toolJs, { ecmaVersion: "latest", sourceType: "module" })).not.toThrow();
  });

  test("the host is resolved from SCRML_HOST and passed to _scrml_bind.listen", () => {
    expect(toolJs).toContain("const _scrml_serve_host = _scrml_bind.host(_scrml_g.process.env.SCRML_HOST);");
    expect(toolJs).toContain("const _scrml_server = _scrml_bind.listen({");
    expect(toolJs).toContain("}, _scrml_serve_host);");
    expect(toolJs).toContain("port: _scrml_serve_port,");
  });

  test("the IPv6-twin collision warning is re-prefixed `scrml serve-target:` like the module's other lines", () => {
    expect(toolJs).toContain('(m) => _scrml_g.console.error(m.replace(/^\\[scrml\\]/, "scrml serve-target:"))');
    const warn = (m) => m.replace(/^\[scrml\]/, "scrml serve-target:");
    expect(warn("[scrml] listening on 127.0.0.1:1 only")).toBe("scrml serve-target: listening on 127.0.0.1:1 only");
  });

  test("the default host is DEFAULT_HOST (127.0.0.1), the #1207 loopback literal", () => {
    expect(DEFAULT_HOST).toBe("127.0.0.1");
    expect(toolJs).toContain(`if (raw === undefined) return ${JSON.stringify(DEFAULT_HOST)};`);
  });

  test("every Bun.serve in the module passes a hostname (no all-interfaces fallback)", () => {
    const ast = acorn.parse(toolJs, { ecmaVersion: "latest", sourceType: "module" });
    const calls = [];
    (function visit(n) {
      if (!n || typeof n.type !== "string") return;
      // `Bun.serve(…)`, spelled through the host-global alias (S457 2a): `_scrml_g.Bun.serve(…)`.
      const o = n.type === "CallExpression" && n.callee.type === "MemberExpression" ? n.callee.object : null;
      const isBun = o && (o.name === "Bun" || (o.type === "MemberExpression" && o.object.name === "_scrml_g" && o.property.name === "Bun"));
      if (isBun && n.callee.property.name === "serve") calls.push(n);
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") visit(v);
      }
    })(ast);
    // The only direct Bun.serve is `serve = (c) => Bun.serve(c)`, whose configs all
    // come from bindListeners / probeIPv6 — each of which sets `hostname`.
    expect(calls.length).toBe(1);
    expect(toolJs).toContain("const serve = (c) => _scrml_g.Bun.serve(c);");
    expect(bindListeners.toString()).toMatch(/hostname: plan\.primary/);
    expect(bindListeners.toString()).toMatch(/hostname: twin\.host/);
    expect(probeIPv6.toString()).toMatch(/hostname: "::1"/);
  });

  test("the copy mechanism: each copied function is the runtime's toString() of the listen.js export", () => {
    // This pins HOW the copy is made (Function.prototype.toString, i.e. Bun's
    // re-print — not listen.js's source text). That the copies BEHAVE like the
    // originals, with no module-scope reference, is §2.
    // S457 2a: the copy's host globals are spelled through the module's alias
    // (`_scrml_g.String(…)`, `new _scrml_g.Response(…)`), since it shares the module
    // scope with the program's own bindings; that respelling is the only change.
    for (const [name, fn] of Object.entries(SERIALIZED)) {
      expect({ name, present: toolJs.includes(aliasHostGlobalsInRuntimeText(fn.toString())) }).toEqual({ name, present: true });
    }
  });

  test("the host is validated at the TOP of the module — before user top-level statements and a composing main", () => {
    const { codes: c2, toolJs: js } = compileTool(
      TOOL(7878, 'log("TOPLEVEL-RAN")\n  function main(args) {\n    log("setup")\n  }'),
    );
    expect(c2).toEqual([]);
    const hostAt = js.indexOf("const _scrml_serve_host = _scrml_bind.host(");
    expect(hostAt).toBeGreaterThan(-1);
    expect(hostAt).toBeLessThan(js.indexOf("TOPLEVEL-RAN"));
    expect(hostAt).toBeLessThan(js.indexOf("await main("));
    // Nothing but comments, the static imports, the host-global alias (S457 2a) and the
    // _scrml_bind helper precede it.
    const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module" });
    const before = ast.body.filter((n) => n.start < hostAt && n.type !== "ImportDeclaration");
    expect(before.map((n) => n.declarations?.[0]?.id?.name ?? n.type)).toEqual(["_scrml_g", "_scrml_bind"]);
  });
});

// ---------------------------------------------------------------------------
// §2 self-contained
// ---------------------------------------------------------------------------

describe("§2 the copied listen.js functions are self-contained and behave like the originals", () => {
  // Every OTHER top-level binding of listen.js, shadowed by a trap: a copied
  // function that reached one of them (a module-scope reference) would throw.
  const LISTEN_SRC = readFileSync(join(import.meta.dir, "../../src/commands/listen.js"), "utf8");
  const topNames = [];
  for (const n of acorn.parse(LISTEN_SRC, { ecmaVersion: "latest", sourceType: "module" }).body) {
    const d = n.type === "ExportNamedDeclaration" ? n.declaration : n;
    if (!d) continue;
    if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") topNames.push(d.id.name);
    if (d.type === "VariableDeclaration") for (const v of d.declarations) if (v.id.type === "Identifier") topNames.push(v.id.name);
  }
  const traps = topNames.filter((n) => !(n in SERIALIZED))
    .map((n) => `const ${n} = new Proxy(function () {}, { get() { throw new Error("module-scope ref: ${n}"); }, apply() { throw new Error("module-scope ref: ${n}"); } });`)
    .join("\n");

  test("listen.js has other top-level names for the trap to catch (the check bites)", () => {
    expect(topNames).toContain("norm");
    expect(topNames).toContain("boundOnPort");
  });

  test("lifted out of their module, they validate + plan exactly as listen.js does", () => {
    const src = Object.values(SERIALIZED).map((f) => f.toString()).join("\n");
    // eslint-disable-next-line no-new-func
    const lifted = new Function(`${traps}\n${src}\nreturn { isLoopbackHost, hostRefusal, bindPlan, displayUrlFor, bindListeners, probeIPv6 };`)();
    for (const h of ["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]", "192.168.1.5", "0", "127.1", "0 ", "\t127.0.0.1", "0x7f.1"]) {
      expect({ h, r: lifted.hostRefusal(h) }).toEqual({ h, r: hostRefusal(h) });
      expect({ h, p: lifted.bindPlan(h) }).toEqual({ h, p: bindPlan(h) });
      expect({ h, l: lifted.isLoopbackHost(h) }).toEqual({ h, l: isLoopbackHost(h) });
    }
    expect(lifted.displayUrlFor(["127.0.0.1", "::1"], "127.0.0.1", 9)).toBe("http://localhost:9");
    expect(lifted.displayUrlFor(["::1"], "::1", 9)).toBe("http://[::1]:9");
    // bindListeners / probeIPv6 against a fake serve(): same sockets requested.
    const fake = (log) => (c) => { log.push(`${c.hostname}:${c.port}`); return { port: 4321, stop() {}, publish() {} }; };
    const a = [], b = [];
    const ra = lifted.bindListeners(fake(a), { port: 0 }, bindPlan("127.0.0.1"), bindPlan("127.0.0.1").twin, () => true, () => {}, (e) => { throw e; });
    const rb = bindListeners(fake(b), { port: 0 }, bindPlan("127.0.0.1"), bindPlan("127.0.0.1").twin, () => true, () => {}, (e) => { throw e; });
    expect(a).toEqual(b);
    expect(ra.bound).toEqual(rb.bound);
    expect(lifted.probeIPv6(fake([]))).toBe(true);
    expect(lifted.probeIPv6(() => { throw new Error("no v6"); })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 runtime
// ---------------------------------------------------------------------------

/** Resolve "connected" | "refused" | "timeout" for a raw TCP connect. */
function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((done) => {
    const sock = createConnection({ host, port });
    const finish = (v) => { try { sock.destroy(); } catch { /* gone */ } done(v); };
    const t = setTimeout(() => finish("timeout"), timeoutMs);
    sock.once("connect", () => { clearTimeout(t); finish("connected"); });
    sock.once("error", () => { clearTimeout(t); finish("refused"); });
  });
}

const RUNNABLE = (() => {
  const { codes, toolJs } = compileTool(TOOL(0));
  if (codes.length) throw new Error(`fixture failed to compile: ${codes.join(",")}`);
  const f = join(TMP, "runnable.mjs");
  writeFileSync(f, toolJs);
  return f;
})();

/**
 * Run the generated server with SCRML_HOST = `host` (undefined = unset). Resolves
 * when it prints its listening line ({ port, line, proc }) or exits ({ code, stderr }).
 */
async function runServer(host, file = RUNNABLE) {
  const env = { ...process.env };
  delete env.SCRML_HOST;
  if (host !== undefined) env.SCRML_HOST = host;
  const proc = Bun.spawn(["bun", file], { env, stdout: "pipe", stderr: "pipe" });
  const reader = proc.stderr.getReader();
  const dec = new TextDecoder();
  let err = "";
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 250)),
    ]);
    if (value) err += dec.decode(value);
    const m = err.match(/scrml serve-target listening on [^\n]*?(?:port |:)(\d+)/);
    if (m) {
      reader.releaseLock();
      return { port: Number(m[1]), line: err, proc };
    }
    if (done || proc.exitCode !== null) {
      const code = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      return { code, stderr: err, stdout };
    }
  }
  proc.kill();
  throw new Error(`generated server neither listened nor exited: ${err}`);
}

async function stop(proc) {
  proc.kill(); // by captured PID
  await proc.exited;
}

const LAN = lanIPv4Addresses()[0] ?? null;

describe("§3 runtime — the generated server's bind address", () => {
  test("default (SCRML_HOST unset): loopback IPv4 + ::1 twin, not the LAN address", async () => {
    const r = await runServer(undefined);
    expect(r.code).toBeUndefined();
    try {
      expect(r.line).toContain(`http://localhost:${r.port}`);
      expect(await tcpProbe("127.0.0.1", r.port)).toBe("connected");
      if (probeIPv6((c) => Bun.serve(c))) expect(await tcpProbe("::1", r.port)).toBe("connected");
      if (LAN) expect(await tcpProbe(LAN, r.port)).not.toBe("connected");
    } finally {
      await stop(r.proc);
    }
  }, 30_000);

  test("SCRML_HOST=0.0.0.0 opts in to every interface and says so", async () => {
    const r = await runServer("0.0.0.0");
    expect(r.code).toBeUndefined();
    try {
      expect(r.line).toContain("reachable from the network");
      expect(await tcpProbe("127.0.0.1", r.port)).toBe("connected");
      if (LAN) expect(await tcpProbe(LAN, r.port)).toBe("connected");
    } finally {
      await stop(r.proc);
    }
  }, 30_000);

  for (const [label, host, needle] of [
    ["inet_aton shorthand \"0\"", "0", "legacy numeric IPv4 shorthand"],
    ["shorthand \"127.1\"", "127.1", "legacy numeric IPv4 shorthand"],
    ["padded \"0 \"", "0 ", "contains whitespace or a control character"],
    ["empty", "", "is set but empty"],
  ]) {
    test(`an invalid SCRML_HOST (${label}) exits 1 without listening`, async () => {
      if (host === "" && process.platform === "win32") {
        // Windows cannot hold an empty environment variable (setting one deletes
        // it), so the empty case is the unset case there — covered above.
        return;
      }
      const r = await runServer(host);
      if (r.proc) { await stop(r.proc); throw new Error(`listened on ${JSON.stringify(host)}: ${r.line}`); }
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("scrml serve-target: SCRML_HOST");
      expect(r.stderr).toContain(needle);
      expect(r.stderr).not.toContain("listening on");
      // The REFUSAL fired — not a bind failure ("could not listen") on an address
      // the OS rejected (Windows refuses "0" at bind time; the refusal must come first).
      expect(r.stderr).not.toContain("could not listen");
    }, 30_000);
  }

  test("a refused SCRML_HOST exits before ANY user top-level statement runs (and the statement does run otherwise)", async () => {
    const { codes, toolJs } = compileTool(TOOL(0, 'log("TOPLEVEL-RAN")'));
    expect(codes).toEqual([]);
    const f = join(TMP, "toplevel.mjs");
    writeFileSync(f, toolJs);
    const refused = await runServer("127.1", f);
    if (refused.proc) { await stop(refused.proc); throw new Error("listened on 127.1"); }
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("legacy numeric IPv4 shorthand");
    expect(refused.stdout + refused.stderr).not.toContain("TOPLEVEL-RAN");
    // Positive control: with the default host the same statement runs.
    const ok = await runServer(undefined, f);
    expect(ok.code).toBeUndefined();
    await stop(ok.proc);
    const out = (await new Response(ok.proc.stdout).text()) + ok.line;
    expect(out).toContain("TOPLEVEL-RAN");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// §4 prod
// ---------------------------------------------------------------------------

describe("§4 the `scrml build` production server still binds every interface", () => {
  test("its Bun.serve config carries no hostname (Bun's default: every interface)", () => {
    const entry = generateServerEntry([]);
    const ast = acorn.parse(entry, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true });
    const configs = [];
    (function visit(n) {
      if (!n || typeof n.type !== "string") return;
      if (n.type === "CallExpression" && n.callee.type === "MemberExpression"
        && n.callee.object.name === "Bun" && n.callee.property.name === "serve") configs.push(n.arguments[0]);
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") visit(v);
      }
    })(ast);
    expect(configs.length).toBe(1);
    const keys = configs[0].properties.map((p) => p.key.name ?? p.key.value);
    expect(keys).toContain("port");
    expect(keys).not.toContain("hostname");
  });

  test("run, it accepts a connection on a LAN address (when this machine has one)", async () => {
    if (!LAN) return;
    const port = await new Promise((done) => {
      const s = createServer().listen(0, "0.0.0.0", () => { const p = s.address().port; s.close(() => done(p)); });
    });
    const f = join(TMP, "prod-entry.mjs");
    writeFileSync(f, generateServerEntry([]));
    const proc = Bun.spawn(["bun", f], { env: { ...process.env, PORT: String(port) }, stdout: "pipe", stderr: "pipe" });
    try {
      const reader = proc.stdout.getReader();
      const dec = new TextDecoder();
      let out = "";
      const deadline = Date.now() + 20_000;
      while (!out.includes("listening") && Date.now() < deadline && proc.exitCode === null) {
        const { value, done } = await reader.read();
        if (done) break;
        out += dec.decode(value);
      }
      expect(out).toContain("scrml server listening");
      expect(await tcpProbe(LAN, port)).toBe("connected");
    } finally {
      await stop(proc);
    }
  }, 30_000);
});
