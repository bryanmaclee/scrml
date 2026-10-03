/**
 * @module commands/listen
 * The ONE place a scrml CLI command opens a listening socket.
 *
 * g-dev-server-binds-all-interfaces (S432): `Bun.serve()` with no `hostname`
 * binds EVERY interface (`netstat` shows `0.0.0.0:<port>` + `[::]:<port>`), so
 * `scrml dev` — whose compile-error overlay renders diagnostics — and
 * `scrml serve` — whose `/compile` reads and writes arbitrary paths and whose
 * `/shutdown` stops it — were reachable from anyone on the network.
 *
 * Every CLI listener goes through `listen(config, host)`, which REQUIRES an
 * explicit host, so a future server cannot silently fall back to all-interfaces.
 * `compiler/tests/unit/cli-listen-host.test.js` pins that no other listener
 * call (`Bun.serve`, `Bun.listen`, `createServer`, …) exists in compiler/src.
 *
 * Address families (measured with Bun 1.3.14 on Windows 11):
 *   - `hostname: "localhost"` binds `[::1]` ONLY — a client that dials
 *     `127.0.0.1` gets ECONNREFUSED — so "localhost" is never handed to Bun.
 *   - `hostname: "127.0.0.1"` binds IPv4 loopback only — a client that dials
 *     `::1` (`curl -6`, Node with autoSelectFamily off) gets ECONNREFUSED.
 *   - `hostname: "::"` + a second `0.0.0.0` on the same port → EADDRINUSE
 *     (`::` is dual-stack by default); with `ipv6Only: true` the pair coexists.
 * So an IPv4 loopback / wildcard address is served on BOTH families: the IPv4
 * listener is required, its IPv6 twin (`::1` / `::` with ipv6Only) is
 * best-effort — silently skipped on a machine without IPv6. `localhost` is an
 * alias for `127.0.0.1` (+ `::1`), which is exactly what the printed
 * `http://localhost:<port>` URL resolves to.
 */

import { networkInterfaces } from "os";

/** Default bind address for `scrml dev` / `scrml serve`: loopback (+ its ::1 twin). */
export const DEFAULT_HOST = "127.0.0.1";

/** What a bare `--host` (no value) means — every interface (+ its :: twin). */
export const ALL_INTERFACES_HOST = "0.0.0.0";

/** Thrown when the REQUIRED listener cannot bind. `message` is user-facing. */
export class ListenError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ListenError";
    this.code = "E_SCRML_LISTEN";
    if (cause) this.cause = cause;
  }
}

/**
 * Parse a `--host` flag at `args[i]`. Accepted shapes:
 *   --host=<addr>     explicit value (always unambiguous)
 *   --host <addr>     explicit value
 *   --host            bare → ALL_INTERFACES_HOST
 *
 * A bare `--host` is recognised when the next token is absent, is another flag
 * (starts with `-`), or is an input the command takes positionally
 * (`isPositional(next)` — for `scrml dev`, a `.scrml` file or an existing
 * path), so `scrml dev --host src/app.scrml` exposes the app rather than trying
 * to bind a host named `src/app.scrml`.
 *
 * Returns null when `args[i]` is not a host flag.
 *
 * @param {string[]} args
 * @param {number} i
 * @param {(token: string) => boolean} [isPositional]
 * @returns {{ host: string, next: number } | { error: string } | null}
 */
export function parseHostFlag(args, i, isPositional = () => false) {
  const arg = args[i];
  if (arg.startsWith("--host=")) {
    const value = arg.slice("--host=".length);
    if (!value) return { error: "--host= requires an address (e.g. --host=0.0.0.0), or pass bare --host" };
    return { host: value, next: i };
  }
  if (arg !== "--host") return null;
  const peek = args[i + 1];
  if (peek === undefined || peek.startsWith("-") || isPositional(peek)) {
    return { host: ALL_INTERFACES_HOST, next: i };
  }
  return { host: peek, next: i + 1 };
}

/*
 * SELF-CONTAINED FUNCTIONS. `isLoopbackHost`, `isLegacyNumericIPv4`,
 * `hostRefusal`, `bindPlan`, `displayUrlFor` and `bindListeners` reference
 * nothing at module scope (each inlines what it needs), because
 * `codegen/emit-tool.ts` serializes their source into every generated headless
 * serve-target (§64.9 — a `kind="tool" serve=` program, which runs as a plain
 * `bun <file>.js` with no compiler beside it). The generated server and the CLI
 * therefore run the SAME validation and the SAME IPv4/IPv6 bind code; nothing is
 * restated. `compiler/tests/unit/headless-serve-bind-host.test.js` pins that the
 * serialized copies stay self-contained.
 */

/** Strip IPv6 brackets and lowercase. */
function norm(host) {
  return String(host).toLowerCase().replace(/^\[|\]$/g, "");
}

/**
 * True when `host` binds a loopback interface only (not reachable from the
 * network). Unknown names are treated as NOT loopback so the notice errs on
 * the side of telling the user. Self-contained (see above).
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * True for an all-numeric host that is NOT a canonical dotted quad: `0`,
 * `127.1`, `2130706433`, `0x7f.1`, `010.0.0.1` (octal), `1.2.3.4.5`. The OS
 * resolver reads these inet_aton-style forms differently per platform (Linux
 * binds `0` as 0.0.0.0 — every interface; Windows refuses it), so a value the
 * user may have meant as a typo could silently expose the server. Refused.
 * Self-contained (see above).
 *
 * @param {string} h   normalized host
 * @returns {boolean}
 */
export function isLegacyNumericIPv4(h) {
  const octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  const canonical = new RegExp(`^${octet}(?:\\.${octet}){3}$`);
  return /^(?:0x[0-9a-f]*|\d+)(?:\.(?:0x[0-9a-f]*|\d+))*$/i.test(h) && !canonical.test(h);
}

/**
 * Why `host` is refused as a bind address, or null when it may be tried.
 * Calls `isLegacyNumericIPv4` (serialized beside it). Self-contained otherwise.
 *
 * - whitespace / control characters are refused, never trimmed: trimming would
 *   silently reinterpret the input, and glibc inet_aton accepts trailing
 *   whitespace ("0 " → 0.0.0.0, every interface) — so this runs BEFORE the
 *   shorthand check, which a padded value would otherwise slip past;
 * - a legacy numeric IPv4 shorthand (inet_aton form) is refused on every OS.
 *
 * @param {string} host
 * @returns {{ code: string, message: string, primary: string } | null}
 *   `primary` is the address named in the failure message.
 */
export function hostRefusal(host) {
  if (/[\s\x00-\x1f\x7f]/.test(host)) {
    return {
      code: "E_SCRML_HOST_WHITESPACE",
      primary: host,
      message:
        `${JSON.stringify(host)} contains whitespace or a control character. ` +
        `It is refused rather than trimmed — write the address exactly (e.g. 127.0.0.1, or 0.0.0.0 for every interface).`,
    };
  }
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (isLegacyNumericIPv4(h)) {
    return {
      code: "E_SCRML_HOST_SHORTHAND",
      primary: h,
      message:
        `"${host}" is a legacy numeric IPv4 shorthand (inet_aton form), not a dotted-quad address. ` +
        `Its meaning is platform-dependent — on Linux "0" binds every interface — so it is refused on every OS. ` +
        `Write the full address (e.g. 127.0.0.1, or 0.0.0.0 for every interface).`,
    };
  }
  return null;
}

function isWildcardHost(host) {
  const h = norm(host);
  return h === "0.0.0.0" || h === "::";
}

/**
 * Addresses `listen()` actually bound, by port (cleared on `stop()`), so the
 * printed URL describes what IS listening — not what was planned. A failed
 * `::1` twin must not print `localhost`: clients resolve it `::1`-first and
 * would reach whatever other process holds `[::1]:<port>`.
 * @type {Map<number, string[]>}
 */
const boundOnPort = new Map();

/**
 * The URL to print for a bound server. `localhost` only when BOTH loopbacks are
 * served by us (127.0.0.1 or 0.0.0.0, AND ::1 or ::) — `localhost` resolves to
 * both. Otherwise the literal bound address, IPv6 bracketed; a lone wildcard
 * prints its loopback (0.0.0.0 → 127.0.0.1, :: → [::1]).
 *
 * `bound` defaults to what `listen()` recorded for `port`, else to the plan for
 * `host` (every planned socket assumed bound).
 *
 * @param {string} host
 * @param {number} port
 * @param {string[]} [bound]
 * @returns {string}
 */
export function displayUrl(host, port, bound) {
  return displayUrlFor(bound ?? boundOnPort.get(port) ?? plannedAddresses(host), host, port);
}

/**
 * `displayUrl` over an explicit list of bound addresses. Self-contained (see
 * the note above `norm`).
 *
 * @param {string[]} bound
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export function displayUrlFor(bound, host, port) {
  const norm = (x) => String(x).toLowerCase().replace(/^\[|\]$/g, "");
  const addrs = bound.map(norm);
  const v4Loop = addrs.includes("127.0.0.1") || addrs.includes("0.0.0.0");
  const v6Loop = addrs.includes("::1") || addrs.includes("::");
  if (v4Loop && v6Loop) return `http://localhost:${port}`;
  const a = addrs[0] ?? norm(host);
  if (a === "0.0.0.0") return `http://127.0.0.1:${port}`;
  if (a === "::") return `http://[::1]:${port}`;
  return `http://${a.includes(":") ? `[${a}]` : a}:${port}`;
}

function plannedAddresses(host) {
  const plan = bindPlan(host);
  return plan.twin ? [plan.primary, plan.twin.host] : [plan.primary];
}

/**
 * The one-line "reachable from the network" notice for a non-loopback bind, or
 * null for a loopback bind. For a wildcard bind it lists this machine's
 * non-internal IPv4 addresses (`ifaces` injectable for tests).
 *
 * @param {string} label   command tag, e.g. "[dev]" or "scrml serve:"
 * @param {string} host
 * @param {number} port
 * @param {ReturnType<typeof networkInterfaces>} [ifaces]
 * @returns {string|null}
 */
export function networkNotice(label, host, port, ifaces) {
  if (isLoopbackHost(host)) return null;
  let where;
  if (isWildcardHost(host)) {
    const urls = lanIPv4Addresses(ifaces).map((a) => `http://${a}:${port}`);
    where = urls.length > 0 ? urls.join(", ") : `every interface on port ${port}`;
  } else {
    where = displayUrl(host, port);
  }
  return `${label} listening on ${hostLabel(host)} — reachable from the network at ${where}. Anyone who can reach this machine can use it.`;
}

/** Human label for the bind address, naming the IPv6 twin when one is opened. */
function hostLabel(host) {
  const plan = bindPlan(host);
  const addrs = plan.twin ? `${plan.primary} + ${plan.twin.host}` : plan.primary;
  return isWildcardHost(host) ? `every interface (${addrs})` : addrs;
}

/**
 * This machine's non-internal IPv4 addresses.
 *
 * @param {ReturnType<typeof networkInterfaces>} [ifaces]
 * @returns {string[]}
 */
export function lanIPv4Addresses(ifaces) {
  let table = ifaces;
  if (!table) {
    try { table = networkInterfaces(); } catch { table = {}; }
  }
  const out = [];
  for (const list of Object.values(table || {})) {
    for (const a of list || []) {
      const v4 = a.family === "IPv4" || a.family === 4;
      if (v4 && !a.internal && a.address) out.push(a.address);
    }
  }
  return out;
}

/**
 * Which sockets a host means: the primary address handed to Bun, and the
 * best-effort IPv6 twin (null when the host has none). Self-contained (see the
 * note above `norm`).
 *
 * @param {string} host
 * @returns {{ primary: string, twin: { host: string, ipv6Only: boolean } | null }}
 */
export function bindPlan(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1") return { primary: "127.0.0.1", twin: { host: "::1", ipv6Only: false } };
  if (h === "0.0.0.0") return { primary: "0.0.0.0", twin: { host: "::", ipv6Only: true } };
  return { primary: h, twin: null };
}

/**
 * Whether this machine can bind an IPv6 socket at all, using `serve` (a
 * `Bun.serve`-shaped function). Self-contained (see the note above `norm`).
 *
 * @param {(config: object) => import("bun").Server} serve
 * @returns {boolean}
 */
export function probeIPv6(serve) {
  try {
    const probe = serve({ port: 0, hostname: "::1", fetch: () => new Response(null) });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Whether this machine can bind an IPv6 socket at all (probed once). */
let ipv6Available;
function canBindIPv6() {
  if (ipv6Available === undefined) ipv6Available = probeIPv6((c) => Bun.serve(c));
  return ipv6Available;
}

/** Test hook: override the IPv6-availability probe (undefined = re-probe). */
export function _setIPv6AvailableForTest(v) {
  ipv6Available = v;
}

/**
 * Open the sockets `plan` names: the REQUIRED primary, and the best-effort IPv6
 * twin (`twin`, or null for none) on the same port with the same handlers.
 * Self-contained (see the note above `norm`) — every dependency is a parameter:
 *
 * - `serve(config)` opens one socket (`Bun.serve`);
 * - `canBindIPv6()` says whether IPv6 exists at all (a twin failure on a machine
 *   without it is not a failure — IPv4 alone is complete);
 * - `warn(msg)` reports a twin that could not bind on a machine that has IPv6;
 * - `primaryFailed(err)` is called when the primary cannot bind and MUST throw.
 *
 * A requested port of 0 (ephemeral) that is free on IPv4 but taken on IPv6
 * retries with another pair, up to 5 times. When both sockets bind, the primary
 * acts for both: `stop()` closes both, `publish()` reaches both, and
 * `scrmlListeners` lists them.
 *
 * @returns {{ server: import("bun").Server, bound: string[] }}
 */
export function bindListeners(serve, config, plan, twin, canBindIPv6, warn, primaryFailed) {
  const requestedPort = config.port ?? 0;
  for (let attempt = 0; ; attempt++) {
    let primary;
    try {
      primary = serve({ ...config, hostname: plan.primary });
    } catch (err) {
      primaryFailed(err);
      throw err;
    }
    if (!twin) return { server: primary, bound: [plan.primary] };

    let second = null;
    try {
      second = serve({ ...config, port: primary.port, hostname: twin.host, ipv6Only: twin.ipv6Only });
    } catch {
      if (!canBindIPv6()) return { server: primary, bound: [plan.primary] }; // no IPv6 on this machine — IPv4 alone is complete
      if (requestedPort === 0 && attempt < 5) {
        // An ephemeral port free on IPv4 but taken on IPv6 — pick another pair.
        primary.stop(true);
        continue;
      }
      warn(
        `[scrml] listening on ${plan.primary}:${primary.port} only — could not also listen on ` +
        `[${twin.host}]:${primary.port} (in use by another process?). http://localhost:${primary.port} ` +
        `may reach that process over IPv6; use http://127.0.0.1:${primary.port}.`,
      );
      return { server: primary, bound: [plan.primary] };
    }
    // Make `primary` act for both sockets: stop() closes both, publish() reaches both.
    const stop1 = primary.stop.bind(primary);
    const publish1 = primary.publish.bind(primary);
    primary.stop = (closeActive) => {
      try { second.stop(closeActive); } catch { /* already stopped */ }
      return stop1(closeActive);
    };
    primary.publish = (...a) => {
      try { second.publish(...a); } catch { /* no subscribers there */ }
      return publish1(...a);
    };
    primary.scrmlListeners = [primary, second];
    return { server: primary, bound: [plan.primary, twin.host] };
  }
}

/**
 * Open a listening server bound to `host`. The ONLY listener call site for the
 * CLI's own servers. `host` is required (no default here) so every caller
 * states which interface it binds; a config that already carries a `hostname`
 * is rejected so the two can never disagree.
 *
 * `127.0.0.1` / `localhost` / `0.0.0.0` also open their IPv6 twin (`::1` / `::`)
 * on the same port with the same handlers, best-effort (see the module doc).
 * `opts.ipv6Twin: false` opts out (the dev app child, which only the parent
 * proxy dials, by IPv4 literal). The returned server's `stop()` and
 * `publish()` act on both sockets; `server.scrmlListeners` lists them.
 *
 * @param {object} config   a Bun.serve config WITHOUT `hostname`
 * @param {string} host
 * @param {{ ipv6Twin?: boolean, warn?: (msg: string) => void }} [opts]
 * @returns {import("bun").Server}
 * @throws {ListenError} when the host is refused or the required (primary) socket cannot bind
 */
export function listen(config, host, opts = {}) {
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("listen(): an explicit host is required (use DEFAULT_HOST for loopback)");
  }
  if (config && Object.prototype.hasOwnProperty.call(config, "hostname")) {
    throw new Error("listen(): pass the host as listen()'s argument, not config.hostname");
  }
  const refused = hostRefusal(host);
  if (refused) {
    const cause = new Error(refused.message);
    cause.code = refused.code;
    throw new ListenError(listenFailureMessage(host, refused.primary, config.port ?? 0, null, cause), cause);
  }
  const warn = opts.warn ?? ((m) => console.warn(m));
  const plan = bindPlan(host);
  const twin = opts.ipv6Twin === false ? null : plan.twin;
  const requestedPort = config.port ?? 0;
  const { server, bound } = bindListeners(
    (c) => Bun.serve(c),
    config,
    plan,
    twin,
    canBindIPv6,
    warn,
    (err) => { throw new ListenError(listenFailureMessage(host, plan.primary, requestedPort, twin, err), err); },
  );
  return record(server, bound);
}

/** Remember what `server` bound (for displayUrl) until it is stopped. */
function record(server, addrs) {
  const port = server.port;
  boundOnPort.set(port, addrs);
  const stop = server.stop.bind(server);
  server.stop = (closeActive) => {
    if (boundOnPort.get(port) === addrs) boundOnPort.delete(port);
    return stop(closeActive);
  };
  return server;
}

function listenFailureMessage(host, primary, port, twin, cause) {
  const families = twin ? `${primary} (IPv4; its IPv6 twin ${twin.host} was not reached)` : primary;
  const portText = port === 0 ? "an ephemeral port" : `port ${port}`;
  return (
    `Could not listen on host "${host}" at ${portText} — tried ${families}. ` +
    `The address is not one of this machine's, the name does not resolve, or the port is already in use. ` +
    `Use --host with an address this machine owns (bare --host = every interface), or pick another --port.` +
    // R2-3: keep the runtime's own reason, so a failure that is NOT about the
    // host/port (a bad TLS config, a resource limit) is not misattributed.
    (cause ? ` Underlying error: ${[cause.code, cause.message].filter(Boolean).join(" ")}` : "")
  );
}

/**
 * `listen()` for a CLI entry point: a ListenError prints its message (naming
 * the host, port and address families tried) and exits 1 instead of surfacing
 * Bun's raw "Is port 0 in use?" stack.
 *
 * @param {string} label   e.g. "[dev]" or "scrml serve:"
 * @param {object} config
 * @param {string} host
 * @param {Parameters<typeof listen>[2]} [opts]
 */
export function listenOrExit(label, config, host, opts) {
  try {
    return listen(config, host, opts);
  } catch (err) {
    if (!(err instanceof ListenError)) throw err;
    console.error(`${label} ${err.message}`);
    process.exit(1);
  }
}
