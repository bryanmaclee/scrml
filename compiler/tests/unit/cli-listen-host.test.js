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
  bindPlan,
  ListenError,
  isLegacyNumericIPv4,
  _setIPv6AvailableForTest,
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

// Bun's NATIVE Response, independent of the global: several browser-tier unit
// files register happy-dom globally and never unregister, so by the time this
// file runs in a full `bun test` process `globalThis.Response` can be
// happy-dom's. Bun.serve rejects that object ("Expected a Response object") and
// answers with its own fallback page — which is what made "the ::1 twin serves
// the same handler" red on CI (Linux + Windows). `Bun.fetch` is not replaced by
// the registrator, so the constructor of its result is the native class.
const NativeResponse = (await Bun.fetch("data:text/plain,x")).constructor;
const okFetch = () => new NativeResponse("ok");

let HAS_V6 = false;
try { const p = Bun.serve({ port: 0, hostname: "::1", fetch: okFetch }); p.stop(true); HAS_V6 = true; } catch { /* no IPv6 */ }

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
  test("displayUrl prints localhost only when BOTH loopbacks are served (the planned pairs; harnesses parse it)", () => {
    expect(displayUrl("127.0.0.1", 3000)).toBe("http://localhost:3000");
    expect(displayUrl("localhost", 3000)).toBe("http://localhost:3000");
    expect(displayUrl("0.0.0.0", 3000)).toBe("http://localhost:3000");
  });
  test("displayUrl prints the literal address when only one family is bound (R2-1 / R2-2)", () => {
    expect(displayUrl("::1", 3000)).toBe("http://[::1]:3000");
    expect(displayUrl("[::1]", 3000)).toBe("http://[::1]:3000");
    expect(displayUrl("::", 3000)).toBe("http://[::1]:3000");
    // what was actually bound wins over the plan:
    expect(displayUrl("127.0.0.1", 3000, ["127.0.0.1"])).toBe("http://127.0.0.1:3000");
    expect(displayUrl("0.0.0.0", 3000, ["0.0.0.0"])).toBe("http://127.0.0.1:3000");
    expect(displayUrl("127.0.0.1", 3000, ["127.0.0.1", "::1"])).toBe("http://localhost:3000");
    expect(displayUrl("0.0.0.0", 3000, ["0.0.0.0", "::"])).toBe("http://localhost:3000");
  });
  test("displayUrl prints any other address as itself, incl. other 127.x (F3)", () => {
    expect(displayUrl("127.0.0.2", 3000)).toBe("http://127.0.0.2:3000");
    expect(displayUrl("127.1.2.3", 3000)).toBe("http://127.1.2.3:3000");
    expect(displayUrl("192.168.1.20", 3000)).toBe("http://192.168.1.20:3000");
    expect(displayUrl("fe80::1", 3000)).toBe("http://[fe80::1]:3000");
    expect(displayUrl("[fe80::1]", 3000)).toBe("http://[fe80::1]:3000");
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
    expect(n).toContain("every interface (0.0.0.0 + ::)");
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
  test("bindPlan: 127.0.0.1/localhost → +::1, 0.0.0.0 → +:: (ipv6Only), others exact", () => {
    expect(bindPlan("127.0.0.1")).toEqual({ primary: "127.0.0.1", twin: { host: "::1", ipv6Only: false } });
    expect(bindPlan("localhost")).toEqual({ primary: "127.0.0.1", twin: { host: "::1", ipv6Only: false } });
    expect(bindPlan("0.0.0.0")).toEqual({ primary: "0.0.0.0", twin: { host: "::", ipv6Only: true } });
    expect(bindPlan("192.168.1.20")).toEqual({ primary: "192.168.1.20", twin: null });
    expect(bindPlan("[::1]")).toEqual({ primary: "::1", twin: null });
  });
  test("binds the given host; ipv6Twin:false opens exactly one socket", () => {
    const s = listen({ port: 0, fetch: okFetch }, "127.0.0.1", { ipv6Twin: false });
    try {
      expect(s.hostname).toBe("127.0.0.1");
      expect(s.port).toBeGreaterThan(0);
      expect(s.scrmlListeners).toBeUndefined();
    } finally {
      s.stop(true);
    }
  });
});

describe("§5b unbindable host → a ListenError naming the host (F2)", () => {
  // "0" and the other inet_aton shorthands are refused BEFORE any bind, on every
  // OS: Linux would bind "0" as 0.0.0.0 (every interface), Windows refuses it —
  // the CI gate (Linux) caught this test assuming the Windows behaviour.
  for (const host of ["192.168.99.99", "myhost.invalid", "0", "127.1", "2130706433", "0x7f.0.0.1", "010.0.0.1", "00.0.0.0"]) {
    test(`--host ${host}`, () => {
      let err;
      try { listen({ port: 0, fetch: okFetch }, host).stop(true); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ListenError);
      expect(err.code).toBe("E_SCRML_LISTEN");
      expect(err.message).toContain(`host "${host}"`);
      expect(err.message).toContain(`tried ${host}`);
      expect(err.message.startsWith(`Could not listen on host "${host}"`)).toBe(true);
      // R2-3: the runtime's own reason is kept, after the host attribution.
      expect(err.message).toContain("Underlying error:");
      expect(err.message).toContain(err.cause.message);
    });
  }
  test("numeric shorthand is refused by classification, not by an OS bind failure", () => {
    for (const h of ["0", "127.1", "2130706433", "0x7f.0.0.1", "010.0.0.1", "00.0.0.0", "1.2.3.4.5", "0x7f000001"]) {
      expect(isLegacyNumericIPv4(h)).toBe(true);
    }
    for (const h of ["127.0.0.1", "0.0.0.0", "192.168.1.10", "255.255.255.255", "localhost", "::1", "::", "deadbeef", "my-host.local"]) {
      expect(isLegacyNumericIPv4(h)).toBe(false);
    }
    let err;
    try { listen({ port: 0, fetch: okFetch }, "0").stop(true); } catch (e) { err = e; }
    expect(err.cause.code).toBe("E_SCRML_HOST_SHORTHAND");
  });

  test("a taken port names host, port and both families tried", () => {
    const hog = listen({ port: 0, fetch: okFetch }, "127.0.0.1", { ipv6Twin: false });
    try {
      let err;
      try { listen({ port: hog.port, fetch: okFetch }, DEFAULT_HOST).stop(true); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ListenError);
      expect(err.message).toContain(`port ${hog.port}`);
      expect(err.message).toContain("127.0.0.1 (IPv4; its IPv6 twin ::1");
    } finally {
      hog.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 EMPIRICAL
// ---------------------------------------------------------------------------

const LAN = lanIPv4Addresses();

/** One raw HTTP/1.1 GET over TCP; resolves the full response text. */
function rawGet(host, port) {
  return new Promise((done, fail) => {
    const sock = createConnection({ host, port }, () => {
      sock.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    let buf = "";
    sock.on("data", (d) => { buf += d; });
    sock.on("end", () => done(buf));
    sock.on("error", fail);
  });
}

describe("§5c the printed URL follows what listen() actually bound", () => {
  test.skipIf(!HAS_V6)("both loopbacks bound → localhost; after stop() the record is dropped", () => {
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    const port = s.port;
    expect(displayUrl(DEFAULT_HOST, port)).toBe(`http://localhost:${port}`);
    s.stop(true);
    // no record → falls back to the plan (unchanged text), proving the entry is gone
    expect(displayUrl("127.0.0.1", port, undefined)).toBe(`http://localhost:${port}`);
  });

  test.skipIf(!HAS_V6)("R2-1: ::1 twin held by another process → http://127.0.0.1:<port>, never localhost", () => {
    const hog = Bun.serve({ port: 0, hostname: "::1", fetch: okFetch });
    let s;
    try {
      s = listen({ port: hog.port, fetch: okFetch }, DEFAULT_HOST, { warn: () => {} });
      expect(displayUrl(DEFAULT_HOST, s.port)).toBe(`http://127.0.0.1:${s.port}`);
    } finally {
      s?.stop(true);
      hog.stop(true);
    }
  });

  test.skipIf(!HAS_V6)("R2-2: --host=::1 → http://[::1]:<port>", () => {
    const s = listen({ port: 0, fetch: okFetch }, "::1");
    try {
      expect(displayUrl("::1", s.port)).toBe(`http://[::1]:${s.port}`);
    } finally {
      s.stop(true);
    }
  });

  test("ipv6Twin:false (the dev child) → http://127.0.0.1:<port>", () => {
    const s = listen({ port: 0, fetch: okFetch }, "127.0.0.1", { ipv6Twin: false });
    try {
      expect(displayUrl("127.0.0.1", s.port)).toBe(`http://127.0.0.1:${s.port}`);
    } finally {
      s.stop(true);
    }
  });
});

describe("§6 empirical: loopback on both families by default, never the network", () => {
  test("default bind accepts 127.0.0.1", async () => {
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    try {
      expect(await tcpProbe("127.0.0.1", s.port)).toBe("connected");
    } finally {
      s.stop(true);
    }
  });

  test.skipIf(!HAS_V6)("default bind ALSO accepts ::1 (F1); stop() closes both sockets", async () => {
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    const port = s.port;
    expect(s.scrmlListeners.length).toBe(2);
    expect(await tcpProbe("::1", port)).toBe("connected");
    s.stop(true);
    expect(await tcpProbe("127.0.0.1", port)).not.toBe("connected");
    expect(await tcpProbe("::1", port)).not.toBe("connected");
  });

  // Skipped only when this machine cannot bind ::1 at all (HAS_V6 probe above).
  test.skipIf(!HAS_V6)("the ::1 twin serves the same handler", async () => {
    // A per-run nonce: a foreign responder on [::1]:<port> (another process, or
    // Bun's own fallback page) can never produce it.
    const nonce = `same-handler-${crypto.randomUUID()}`;
    const s = listen({ port: 0, fetch: () => new NativeResponse(nonce) }, DEFAULT_HOST);
    try {
      // Both sockets are OURS — not a best-effort twin that silently failed.
      expect(s.scrmlListeners?.length).toBe(2);
      expect(await rawGet("::1", s.port)).toContain(nonce);
      expect(await rawGet("127.0.0.1", s.port)).toContain(nonce);
    } finally {
      s.stop(true);
    }
  });

  test.skipIf(!HAS_V6)("twin port taken by another process → one warning, IPv4 still served", async () => {
    const hog = Bun.serve({ port: 0, hostname: "::1", fetch: okFetch });
    const warnings = [];
    let s;
    try {
      s = listen({ port: hog.port, fetch: okFetch }, DEFAULT_HOST, { warn: (m) => warnings.push(m) });
      expect(await tcpProbe("127.0.0.1", s.port)).toBe("connected");
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain(`[::1]:${hog.port}`);
    } finally {
      s?.stop(true);
      hog.stop(true);
    }
  });

  test.skipIf(!HAS_V6)("no IPv6 on the machine → the twin is skipped silently", () => {
    const hog = Bun.serve({ port: 0, hostname: "::1", fetch: okFetch });
    const warnings = [];
    _setIPv6AvailableForTest(false);
    let s;
    try {
      s = listen({ port: hog.port, fetch: okFetch }, DEFAULT_HOST, { warn: (m) => warnings.push(m) });
      expect(warnings).toEqual([]);
      expect(s.scrmlListeners).toBeUndefined();
    } finally {
      _setIPv6AvailableForTest(undefined);
      s?.stop(true);
      hog.stop(true);
    }
  });

  test.skipIf(LAN.length === 0)("default bind REFUSES this machine's LAN address; the bare --host control ACCEPTS it (and both loopbacks)", async () => {
    const lan = LAN[0];
    const control = listen({ port: 0, fetch: okFetch }, ALL_INTERFACES_HOST);
    try {
      // If the control cannot be reached on the LAN address, the probe cannot
      // see exposure at all and the negative result below would be meaningless.
      expect(await tcpProbe(lan, control.port)).toBe("connected");
      expect(await tcpProbe("127.0.0.1", control.port)).toBe("connected");
      if (HAS_V6) expect(await tcpProbe("::1", control.port)).toBe("connected");
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

  test.skipIf(process.platform !== "win32")("Windows netstat: default rows are 127.0.0.1 (+ [::1]), never a wildcard; bare --host rows are 0.0.0.0 + [::]", () => {
    const rowsFor = (port) => {
      const out = Bun.spawnSync(["netstat", "-ano", "-p", "TCP"]).stdout.toString()
        + Bun.spawnSync(["netstat", "-ano", "-p", "TCPv6"]).stdout.toString();
      const re = new RegExp(`:${port}\\s`);
      return out.split(/\r?\n/)
        .filter((l) => /LISTENING/.test(l) && re.test(l))
        .map((l) => l.trim().split(/\s+/)[1])
        .sort();
    };
    const s = listen({ port: 0, fetch: okFetch }, DEFAULT_HOST);
    try {
      expect(rowsFor(s.port)).toEqual(HAS_V6 ? [`127.0.0.1:${s.port}`, `[::1]:${s.port}`] : [`127.0.0.1:${s.port}`]);
    } finally {
      s.stop(true);
    }
    const w = listen({ port: 0, fetch: okFetch }, ALL_INTERFACES_HOST);
    try {
      expect(rowsFor(w.port)).toEqual(HAS_V6 ? [`0.0.0.0:${w.port}`, `[::]:${w.port}`] : [`0.0.0.0:${w.port}`]);
    } finally {
      w.stop(true);
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

const NET_MODULES = new Set(["http", "https", "net", "tls", "http2", "dgram"]);
const isNetModule = (spec) => typeof spec === "string" && NET_MODULES.has(spec.replace(/^node:/, ""));
const LISTENER_PROPS = new Set(["serve", "listen"]);
const CREATE_SERVER = new Set(["createServer", "createSecureServer"]);

/** Static string value of a property key / literal / no-substitution template, else null. */
function staticName(n, computed) {
  if (!n) return null;
  if (!computed && n.type === "Identifier") return n.name;
  if (n.type === "Literal" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral" && n.expressions.length === 0) return n.quasis[0].value.cooked;
  return null;
}

/** `Bun`, `globalThis.Bun`, `globalThis["Bun"]`. */
function isBunObject(o) {
  if (!o) return false;
  if (o.type === "Identifier") return o.name === "Bun";
  if (o.type === "MemberExpression") return staticName(o.property, o.computed) === "Bun";
  return false;
}

/** Cheap SOUND prefilter: every form the detector flags carries one of these tokens. */
const PREFILTER = /\bBun\b|create(?:Secure)?Server|['"`](?:node:)?(?:https?|net|tls|http2|dgram)['"`]/;

/**
 * Every place a source can open a listening socket, as `line:kind`:
 *   Bun.serve / Bun.listen — dotted, computed (`Bun["serve"]`), via
 *     `globalThis.Bun`, as a call OR a bare reference (`const s = Bun.serve`);
 *   `const { serve } = Bun` / `{ listen: l } = globalThis.Bun` destructuring;
 *   createServer / createSecureServer — any reference (call, import specifier);
 *   importing / requiring / dynamically importing http, https, net, tls, http2, dgram.
 * Strings and comments are not code, so emitted-program text (`lines.push("Bun.serve({")`)
 * is not flagged.
 */
function listenerSites(code, isTs = false) {
  if (!PREFILTER.test(code)) return [];
  const js = isTs ? new Bun.Transpiler({ loader: "ts" }).transformSync(code) : code;
  const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true, allowReturnOutsideFunction: true });
  const hits = [];
  const hit = (n, kind) => hits.push(`${n.loc.start.line}:${kind}`);
  const visit = (n) => {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "MemberExpression": {
        const name = staticName(n.property, n.computed);
        if (LISTENER_PROPS.has(name) && isBunObject(n.object)) hit(n, `Bun.${name}`);
        if (CREATE_SERVER.has(name)) hit(n, name);
        break;
      }
      case "VariableDeclarator":
      case "AssignmentExpression": {
        const pat = n.type === "VariableDeclarator" ? n.id : n.left;
        const src = n.type === "VariableDeclarator" ? n.init : n.right;
        if (pat && pat.type === "ObjectPattern" && isBunObject(src)) {
          for (const pr of pat.properties) {
            const key = pr.type === "Property" ? staticName(pr.key, pr.computed) : null;
            if (LISTENER_PROPS.has(key)) hit(pr, `destructured Bun.${key}`);
          }
        }
        break;
      }
      case "Identifier":
        if (CREATE_SERVER.has(n.name)) hit(n, n.name);
        break;
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        if (n.source && isNetModule(n.source.value)) hit(n, `import ${n.source.value}`);
        break;
      case "ImportExpression":
        if (isNetModule(staticName(n.source, true))) hit(n, `import() ${staticName(n.source, true)}`);
        break;
      case "CallExpression":
        if (n.callee.type === "Identifier" && n.callee.name === "require" && isNetModule(staticName(n.arguments[0], true))) {
          hit(n, `require ${staticName(n.arguments[0], true)}`);
        }
        break;
    }
    for (const k of Object.keys(n)) {
      if (k === "loc") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && typeof v.type === "string") visit(v);
    }
  };
  visit(ast);
  return [...new Set(hits)];
}

describe("§7 every CLI listener goes through listen()", () => {
  test("no listener site in compiler/src outside commands/listen.js (which has at least one)", () => {
    const outside = [];
    let inListen = 0;
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      const sites = listenerSites(readFileSync(f, "utf8"), f.endsWith(".ts"));
      if (rel === "commands/listen.js") inListen = sites.length;
      else for (const s of sites) outside.push(`${rel}:${s}`);
    }
    expect(outside).toEqual([]);
    expect(inListen).toBeGreaterThan(0);
  }, 60_000);

  test("the detector catches every listener form (fixtures)", () => {
    const caught = {
      "Bun.serve({ port: 1 })": "Bun.serve",
      "globalThis.Bun.serve({})": "Bun.serve",
      'Bun["serve"]({})': "Bun.serve",
      "Bun[`serve`]({})": "Bun.serve",
      'globalThis["Bun"].serve({})': "Bun.serve",
      "const s = Bun.serve; s({});": "Bun.serve",
      "const { serve } = Bun; serve({});": "destructured Bun.serve",
      "const { serve: sv } = globalThis.Bun;": "destructured Bun.serve",
      "let l; ({ listen: l } = Bun);": "destructured Bun.listen",
      "Bun.listen({ hostname: 'x', port: 1, socket: {} })": "Bun.listen",
      'import { createServer } from "node:http";': "createServer",
      'import http from "http"; http.createServer(() => {});': "createServer",
      'import * as net from "node:net";': "import node:net",
      'const https = require("https");': "require https",
      'const m = await import("node:http2");': "import() node:http2",
      "require('tls').createSecureServer({})": "createSecureServer",
      'export { createServer } from "node:net";': "createServer",
    };
    for (const [code, kind] of Object.entries(caught)) {
      const sites = listenerSites(code);
      expect({ code, found: sites.some((s) => s.endsWith(`:${kind}`)) }).toEqual({ code, found: true });
    }
    // TypeScript source goes through the transpiler first.
    // (line numbers are of the transpiled JS, so match the kind only).
    const ts = listenerSites("const port: number = 1; Bun.serve({ port } as any);", true);
    expect(ts.length).toBe(1);
    expect(ts[0]).toMatch(/^\d+:Bun\.serve$/);
  });

  test("the detector ignores non-code mentions (emitted-program strings, comments, look-alikes)", () => {
    const clean = [
      'lines.push("const _scrml_server = Bun.serve({");',
      "out.push(`Bun.serve({ port: ${p} })`);",
      "// Bun.serve({ port }) in a comment",
      "/* const { serve } = Bun */",
      "export function createServerIR() { return {}; }",
      "const x = Bun.file('a'); Bun.spawn(['x']);",
      'const u = "http://localhost"; import("./net-helpers.js");',
    ];
    for (const code of clean) expect({ code, sites: listenerSites(code) }).toEqual({ code, sites: [] });
  });
});
