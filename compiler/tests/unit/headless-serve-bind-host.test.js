/**
 * §64.9 bind address of a generated headless serve-target — S447 ruling (iv):
 * "generated headless serve targets default to loopback, prod stays
 * all-interfaces." (g-generated-headless-and-prod-servers-bind-all-interfaces)
 *
 *   §1  EMITTED SOURCE — a `kind="tool" serve=` module resolves its host from
 *       SCRML_HOST (default 127.0.0.1) before `main`'s setup runs, and binds
 *       through `_scrml_bind.listen`, whose functions are commands/listen.js's
 *       own (serialized verbatim, so nothing is restated).
 *   §2  SELF-CONTAINED — every serialized listen.js function runs when lifted
 *       out of its module (no module-scope reference).
 *   §3  RUNTIME — the generated server, run as `bun <file>`: loopback by default
 *       (IPv4 + its ::1 twin; not reachable on a LAN address), SCRML_HOST=0.0.0.0
 *       opts in to every interface, and an invalid SCRML_HOST (empty, padded,
 *       inet_aton shorthand) exits 1 without listening.
 *   §4  PROD — the `scrml build` production server entry still binds every
 *       interface (the ruling's other half).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { createConnection, createServer } from "net";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as acorn from "acorn";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry } from "../../src/commands/build.js";
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
    expect(toolJs).toContain("const _scrml_serve_host = _scrml_bind.host(process.env.SCRML_HOST);");
    expect(toolJs).toContain("const _scrml_server = _scrml_bind.listen({");
    expect(toolJs).toContain("}, _scrml_serve_host);");
    expect(toolJs).toContain("port: _scrml_serve_port,");
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
      if (n.type === "CallExpression" && n.callee.type === "MemberExpression"
        && n.callee.object.name === "Bun" && n.callee.property.name === "serve") calls.push(n);
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") visit(v);
      }
    })(ast);
    // The only direct Bun.serve is `serve = (c) => Bun.serve(c)`, whose configs all
    // come from bindListeners / probeIPv6 — each of which sets `hostname`.
    expect(calls.length).toBe(1);
    expect(toolJs).toContain("const serve = (c) => Bun.serve(c);");
    expect(bindListeners.toString()).toMatch(/hostname: plan\.primary/);
    expect(bindListeners.toString()).toMatch(/hostname: twin\.host/);
    expect(probeIPv6.toString()).toMatch(/hostname: "::1"/);
  });

  test("the serialized functions are listen.js's own source, verbatim", () => {
    for (const [name, fn] of Object.entries(SERIALIZED)) {
      expect({ name, present: toolJs.includes(fn.toString()) }).toEqual({ name, present: true });
    }
  });

  test("the host is validated BEFORE a composing main's setup runs", () => {
    const { codes: c2, toolJs: js } = compileTool(TOOL(7878, "function main(args) {\n    log(\"setup\")\n  }"));
    expect(c2).toEqual([]);
    const hostAt = js.indexOf("const _scrml_serve_host = _scrml_bind.host(");
    expect(hostAt).toBeGreaterThan(-1);
    expect(hostAt).toBeLessThan(js.indexOf("await main("));
  });
});

// ---------------------------------------------------------------------------
// §2 self-contained
// ---------------------------------------------------------------------------

describe("§2 the serialized listen.js functions are self-contained", () => {
  test("lifted out of their module, they validate + plan exactly as listen.js does", () => {
    const src = Object.values(SERIALIZED).map((f) => f.toString()).join("\n");
    // eslint-disable-next-line no-new-func
    const lifted = new Function(`${src}\nreturn { isLoopbackHost, hostRefusal, bindPlan, displayUrlFor };`)();
    for (const h of ["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]", "192.168.1.5", "0", "127.1", "0 ", "\t127.0.0.1", "0x7f.1"]) {
      expect({ h, r: lifted.hostRefusal(h) }).toEqual({ h, r: hostRefusal(h) });
      expect({ h, p: lifted.bindPlan(h) }).toEqual({ h, p: bindPlan(h) });
      expect({ h, l: lifted.isLoopbackHost(h) }).toEqual({ h, l: isLoopbackHost(h) });
    }
    expect(lifted.displayUrlFor(["127.0.0.1", "::1"], "127.0.0.1", 9)).toBe("http://localhost:9");
    expect(lifted.displayUrlFor(["::1"], "::1", 9)).toBe("http://[::1]:9");
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
async function runServer(host) {
  const env = { ...process.env };
  delete env.SCRML_HOST;
  if (host !== undefined) env.SCRML_HOST = host;
  const proc = Bun.spawn(["bun", RUNNABLE], { env, stdout: "ignore", stderr: "pipe" });
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
      return { code, stderr: err };
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
    }, 30_000);
  }
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
