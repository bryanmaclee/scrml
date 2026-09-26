/**
 * g-dev-server-binds-all-interfaces — `scrml dev` / `scrml serve` bind loopback by
 * default; `--host` is the explicit opt-in to the network.
 *
 * Pre-fix, no CLI `Bun.serve` passed `hostname`, so every listener sat on
 * `0.0.0.0` + `[::]` and the dev server's compile-error overlay (and `scrml
 * serve`'s read/write `/compile` + `/shutdown`) were reachable from the LAN.
 *
 *   §1  parseHostFlag — `--host`, `--host <addr>`, `--host=<addr>`, bare-before-flag
 *   §2  `scrml dev` parseArgs — default 127.0.0.1, `--host` passthrough, bare
 *       `--host` before a positional input
 *   §3  `scrml serve` parseArgs — default 127.0.0.1, `--host` passthrough
 *   §4  loopback classification, display URL, the network notice
 *   §5  listen() — requires an explicit host; refuses config.hostname
 *   §6  EMPIRICAL — the default listener is NOT reachable on the LAN address
 *       (control: the 0.0.0.0 listener IS, so the probe can see exposure);
 *       on Windows also the netstat LISTENING row
 *   §7  STRUCTURAL — every code-level `Bun.serve(` in compiler/src is inside
 *       commands/listen.js, so a future CLI server cannot forget the host
 *
 * Connectivity is probed with raw TCP (node:net), never global fetch, so a
 * happy-dom fetch override elsewhere in the run cannot mask the result.
 */

import { describe, test, expect } from "bun:test";
import { createConnection } from "net";
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, relative } from "path";
import * as acorn from "acorn";
import {
  listen,
  parseHostFlag,
  isLoopbackHost,
  displayUrl,
  networkNotice,
  lanIPv4Addresses,
  DEFAULT_HOST,
  ALL_INTERFACES_HOST,
} from "../../src/commands/listen.js";
import { parseArgs as parseDevArgs } from "../../src/commands/dev.js";
import { parseArgs as parseServeArgs } from "../../src/commands/serve.js";

const SRC = resolve(import.meta.dir, "../../src");

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

const okFetch = () => new Response("ok");

// ---------------------------------------------------------------------------
// §1
// ---------------------------------------------------------------------------

describe("§1 parseHostFlag", () => {
  test("not a host flag → null", () => {
    expect(parseHostFlag(["--port", "3000"], 0)).toBeNull();
    expect(parseHostFlag(["--hostname", "x"], 0)).toBeNull();
  });
  test("bare --host at end → 0.0.0.0, consumes nothing", () => {
    expect(parseHostFlag(["--host"], 0)).toEqual({ host: ALL_INTERFACES_HOST, next: 0 });
  });
  test("bare --host before another flag → 0.0.0.0", () => {
    expect(parseHostFlag(["--host", "--port", "4000"], 0)).toEqual({ host: "0.0.0.0", next: 0 });
    expect(parseHostFlag(["--host", "-p", "4000"], 0)).toEqual({ host: "0.0.0.0", next: 0 });
  });
  test("--host <addr> consumes the value", () => {
    expect(parseHostFlag(["--host", "192.168.1.20"], 0)).toEqual({ host: "192.168.1.20", next: 1 });
    expect(parseHostFlag(["--host", "::1"], 0)).toEqual({ host: "::1", next: 1 });
  });
  test("--host=<addr>", () => {
    expect(parseHostFlag(["--host=0.0.0.0"], 0)).toEqual({ host: "0.0.0.0", next: 0 });
    expect(parseHostFlag(["--host=::"], 0)).toEqual({ host: "::", next: 0 });
  });
  test("--host= with no value is an error, not a silent default", () => {
    expect(parseHostFlag(["--host="], 0).error).toMatch(/requires an address/);
  });
  test("a positional input after bare --host is NOT taken as the address", () => {
    const isPos = (t) => t.endsWith(".scrml");
    expect(parseHostFlag(["--host", "app.scrml"], 0, isPos)).toEqual({ host: "0.0.0.0", next: 0 });
  });
});

// ---------------------------------------------------------------------------
// §2 / §3
// ---------------------------------------------------------------------------

describe("§2 scrml dev parseArgs", () => {
  test("default host is 127.0.0.1 (loopback), not all-interfaces", () => {
    const o = parseDevArgs(["app.scrml"]);
    expect(o.host).toBe("127.0.0.1");
    expect(o.host).toBe(DEFAULT_HOST);
    expect(o.port).toBe(3000);
  });
  test("--host <addr> passes through", () => {
    expect(parseDevArgs(["app.scrml", "--host", "192.168.1.20"]).host).toBe("192.168.1.20");
    expect(parseDevArgs(["--host=10.0.0.5", "app.scrml"]).host).toBe("10.0.0.5");
  });
  test("bare --host → 0.0.0.0 and the next flag still parses", () => {
    const o = parseDevArgs(["app.scrml", "--host", "--port", "4000"]);
    expect(o.host).toBe("0.0.0.0");
    expect(o.port).toBe(4000);
  });
  test("bare --host BEFORE the input file keeps the file as input", () => {
    const o = parseDevArgs(["--host", "app.scrml"]);
    expect(o.host).toBe("0.0.0.0");
    expect(o.inputFiles).toEqual([resolve("app.scrml")]);
  });
  test("bare --host before an existing directory keeps it as input", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-host-dir-"));
    try {
      writeFileSync(join(dir, "a.scrml"), "<p>a</>\n");
      const o = parseDevArgs(["--host", dir]);
      expect(o.host).toBe("0.0.0.0");
      expect(o.inputFiles.length).toBe(1);
      expect(o.inputFiles[0].endsWith("a.scrml")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("§3 scrml serve parseArgs", () => {
  test("default host is 127.0.0.1", () => {
    const o = parseServeArgs([]);
    expect(o.host).toBe("127.0.0.1");
  });
  test("--host passthrough + bare --host", () => {
    expect(parseServeArgs(["--host", "192.168.1.20"]).host).toBe("192.168.1.20");
    expect(parseServeArgs(["--host"]).host).toBe("0.0.0.0");
    const o = parseServeArgs(["--host", "--port", "4100"]);
    expect(o.host).toBe("0.0.0.0");
    expect(o.port).toBe(4100);
  });
});

// ---------------------------------------------------------------------------
// §4
// ---------------------------------------------------------------------------

describe("§4 loopback classification, display URL, network notice", () => {
  test("isLoopbackHost", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "[::1]"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ["0.0.0.0", "::", "192.168.1.20", "10.0.0.1", "mybox.local", "128.0.0.1"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
  test("displayUrl keeps http://localhost:<port> for loopback + wildcard (harnesses parse it)", () => {
    expect(displayUrl("127.0.0.1", 3000)).toBe("http://localhost:3000");
    expect(displayUrl("0.0.0.0", 3000)).toBe("http://localhost:3000");
    expect(displayUrl("192.168.1.20", 3000)).toBe("http://192.168.1.20:3000");
    expect(displayUrl("fe80::1", 3000)).toBe("http://[fe80::1]:3000");
  });
  test("no notice for a loopback bind", () => {
    expect(networkNotice("[dev]", "127.0.0.1", 3000)).toBeNull();
    expect(networkNotice("[dev]", "localhost", 3000)).toBeNull();
    expect(networkNotice("[dev]", "::1", 3000)).toBeNull();
  });
  test("one-line notice for a wildcard bind, listing LAN IPv4 URLs", () => {
    const ifaces = {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      eth0: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
    };
    const n = networkNotice("[dev]", "0.0.0.0", 3000, ifaces);
    expect(n).toContain("reachable from the network");
    expect(n).toContain("http://192.168.1.20:3000");
    expect(n).not.toContain("127.0.0.1");
    expect(n.includes("\n")).toBe(false);
  });
  test("wildcard bind with no LAN interface still warns", () => {
    expect(networkNotice("[dev]", "0.0.0.0", 3000, {})).toContain("every interface on port 3000");
  });
  test("notice for an explicit non-loopback address", () => {
    expect(networkNotice("scrml serve:", "192.168.1.20", 3100, {})).toContain("http://192.168.1.20:3100");
  });
});

// ---------------------------------------------------------------------------
// §5
// ---------------------------------------------------------------------------

describe("§5 listen() contract", () => {
  test("an explicit host is required", () => {
    expect(() => listen({ port: 0, fetch: okFetch })).toThrow(/explicit host/);
    expect(() => listen({ port: 0, fetch: okFetch }, "")).toThrow(/explicit host/);
  });
  test("config.hostname is refused (one source of truth)", () => {
    expect(() => listen({ port: 0, hostname: "0.0.0.0", fetch: okFetch }, DEFAULT_HOST)).toThrow(/not config.hostname/);
  });
  test("binds the given host", () => {
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    try {
      expect(s.hostname).toBe("127.0.0.1");
      expect(s.port).toBeGreaterThan(0);
    } finally {
      s.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 EMPIRICAL
// ---------------------------------------------------------------------------

const LAN = lanIPv4Addresses();

describe("§6 empirical: the default listener is not on the network", () => {
  test("default bind accepts 127.0.0.1", async () => {
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    try {
      expect(await tcpProbe("127.0.0.1", s.port)).toBe("connected");
    } finally {
      s.stop(true);
    }
  });

  test.skipIf(LAN.length === 0)("default bind REFUSES this machine's LAN address; the 0.0.0.0 control ACCEPTS it", async () => {
    const lan = LAN[0];
    const control = listen({ port: 0, fetch: okFetch }, ALL_INTERFACES_HOST);
    try {
      // If the control cannot be reached on the LAN address, the probe cannot
      // see exposure at all and the negative result below would be meaningless.
      expect(await tcpProbe(lan, control.port)).toBe("connected");
    } finally {
      control.stop(true);
    }
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    try {
      expect(await tcpProbe(lan, s.port)).not.toBe("connected");
    } finally {
      s.stop(true);
    }
  });

  test.skipIf(process.platform !== "win32")("Windows netstat: the default listener row is 127.0.0.1, never 0.0.0.0/[::]", () => {
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    try {
      const out = Bun.spawnSync(["netstat", "-ano", "-p", "TCP"]).stdout.toString()
        + Bun.spawnSync(["netstat", "-ano", "-p", "TCPv6"]).stdout.toString();
      const rows = out.split(/\r?\n/)
        .filter((l) => /LISTENING/.test(l) && new RegExp(`:${s.port}\\s`).test(l))
        .map((l) => l.trim().split(/\s+/)[1]);
      expect(rows).toEqual([`127.0.0.1:${s.port}`]);
    } finally {
      s.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 STRUCTURAL
// ---------------------------------------------------------------------------

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(js|ts|mjs)$/.test(name)) yield p;
  }
}

/** Real `Bun.serve(...)` / `globalThis.Bun.serve(...)` CALL expressions (not strings/comments). */
function bunServeCalls(file) {
  const raw = readFileSync(file, "utf8");
  if (!raw.includes("Bun.serve")) return [];
  const js = file.endsWith(".ts") ? new Bun.Transpiler({ loader: "ts" }).transformSync(raw) : raw;
  const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true });
  const hits = [];
  const visit = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "CallExpression") {
      const c = n.callee;
      if (c && c.type === "MemberExpression" && !c.computed && c.property.name === "serve") {
        const o = c.object;
        const isBun = (o.type === "Identifier" && o.name === "Bun")
          || (o.type === "MemberExpression" && !o.computed && o.property.name === "Bun");
        if (isBun) hits.push(n.loc.start.line);
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && typeof v.type === "string") visit(v);
    }
  };
  visit(ast);
  return hits;
}

describe("§7 every CLI Bun.serve goes through listen()", () => {
  test("the only code-level Bun.serve( call in compiler/src is inside commands/listen.js", () => {
    const found = [];
    for (const f of walk(SRC)) {
      for (const line of bunServeCalls(f)) found.push(`${relative(SRC, f).replace(/\\/g, "/")}:${line}`);
    }
    expect(found.length).toBe(1);
    expect(found[0]).toMatch(/^commands\/listen\.js:\d+$/);
  });
});
