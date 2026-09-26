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
 * Every CLI `Bun.serve` goes through `listen(config, host)`, which REQUIRES an
 * explicit host, so a future server cannot silently fall back to all-interfaces.
 * `compiler/tests/unit/cli-listen-host.test.js` pins that no other code-level
 * `Bun.serve(` call exists in compiler/src outside this module.
 *
 * Why the default is the IPv4 literal `127.0.0.1` and not `"localhost"`:
 * measured with Bun 1.3.14 on Windows 11, `hostname: "localhost"` binds `[::1]`
 * ONLY — a client that dials `127.0.0.1` (curl scripts, the dev parent proxy,
 * any tool that pre-resolves to IPv4) gets ECONNREFUSED. `hostname: "127.0.0.1"`
 * binds IPv4 loopback, and `http://localhost:<port>` still connects because
 * clients fall back from `::1` to `127.0.0.1` (Bun fetch, browsers' happy
 * eyeballs). The printed URL therefore stays `http://localhost:<port>`.
 */

import { networkInterfaces } from "os";

/** Default bind address for `scrml dev` / `scrml serve`: IPv4 loopback only. */
export const DEFAULT_HOST = "127.0.0.1";

/** What a bare `--host` (no value) means — every interface (Vite's convention). */
export const ALL_INTERFACES_HOST = "0.0.0.0";

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

/**
 * True when `host` binds a loopback interface only (not reachable from the
 * network). Unknown names are treated as NOT loopback so the notice errs on
 * the side of telling the user.
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * The URL to print for a bound server. Loopback prints `localhost` (what a
 * user types, and what existing harnesses parse from the "Serving" line); an
 * all-interfaces bind also prints `localhost` for the local user (the network
 * URLs are in the notice line); any other explicit address prints itself.
 *
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export function displayUrl(host, port) {
  const h = String(host);
  if (isLoopbackHost(h) || h === "0.0.0.0" || h === "::" || h === "[::]") {
    return `http://localhost:${port}`;
  }
  return `http://${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}:${port}`;
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
  const h = String(host);
  const wildcard = h === "0.0.0.0" || h === "::" || h === "[::]";
  let where;
  if (wildcard) {
    const urls = lanIPv4Addresses(ifaces).map((a) => `http://${a}:${port}`);
    where = urls.length > 0 ? urls.join(", ") : `every interface on port ${port}`;
  } else {
    where = displayUrl(h, port);
  }
  return `${label} --host ${h}: reachable from the network at ${where} — anyone who can reach this machine can use it.`;
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
 * Open a listening server bound to `host`. The ONLY `Bun.serve` call site for
 * the CLI's own servers. `host` is required (no default here) so every caller
 * states which interface it binds; a config that already carries a `hostname`
 * is rejected so the two can never disagree.
 *
 * @param {object} config   a Bun.serve config WITHOUT `hostname`
 * @param {string} host
 * @returns {import("bun").Server}
 */
export function listen(config, host) {
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("listen(): an explicit host is required (use DEFAULT_HOST for loopback)");
  }
  if (config && Object.prototype.hasOwnProperty.call(config, "hostname")) {
    throw new Error("listen(): pass the host as listen()'s argument, not config.hostname");
  }
  return Bun.serve({ ...config, hostname: host });
}
