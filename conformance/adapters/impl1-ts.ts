/**
 * Conformance adapter — impl#1 (the TypeScript/Bun reference compiler).
 *
 * This is the (a) "which diagnostic codes fire" HALF of the SCOPE's adapter
 * interface (docs/changes/conformance-suite-d3-2026-06-29/SCOPE.md §2):
 *
 *     compile(source) -> { codes: string[] }
 *
 * The (b) runtime-effect half — `run(artifact, input[]) -> { dom, state }` —
 * is being designed in a parallel deliberation (W3) and is NOT built here.
 *
 * `compile()` writes the source to a throwaway temp file, runs the reference
 * compiler (`compileScrml`, src/api.js), and returns the SORTED UNIQUE set of
 * `.code` values across BOTH diagnostic streams:
 *
 *   - result.errors   — fatal diagnostics (E-* / severity:"error" / no-prefix)
 *   - result.warnings — non-fatal diagnostics (W-* / I-* / severity:warning|info)
 *
 * Unioning both streams is load-bearing: per the api.js partition rule, a
 * W-/I- code (e.g. W-CG-001) lands in result.warnings, NEVER result.errors.
 * The conformance contract is "this source fires exactly this code-set"
 * (presence, not line/col — SCOPE OQ3), so the stream a code arrives on is an
 * impl detail the adapter normalizes away.
 */
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
// api.js is the reference compiler's public entry (plain ESM .js).
import { compileScrml } from "../../compiler/src/api.js";

export type Severity = "error" | "warning" | "info";

export interface CompileResult {
  /** Sorted, de-duplicated diagnostic codes across errors + warnings. */
  codes: string[];
  /**
   * Per-code severity ("error" | "warning" | "info") — the §34 normative
   * partition. The errors stream is the fatal partition (CLI exit 1); the
   * warnings stream carries both "warning" and "info" severities. Backs the
   * case schema's `expect.severity` (a case may assert a code fires AS error
   * vs warning — the cross-stream rule: a W-/I- code never lands in errors).
   */
  byCode: Record<string, Severity>;
}

/** The diagnostic's own severity wins; the stream is authoritative fallback. */
function normalizeSeverity(sev: string | undefined, streamSev: "error" | "warning"): Severity {
  if (sev === "error" || sev === "warning" || sev === "info") return sev;
  return streamSev;
}

/**
 * Write the entry `case.scrml` plus any aux `.scrml` fixtures (the `files`
 * multi-file convention — sibling modules a case.scrml imports) into a temp dir.
 * Only the entry file is passed to compileScrml; the compiler auto-gathers the
 * imported siblings from the same dir (§21.3).
 */
function writeCaseFiles(dir: string, source: string, auxFiles: Record<string, string>): string {
  const file = join(dir, "case.scrml");
  writeFileSync(file, source);
  for (const name of Object.keys(auxFiles)) {
    writeFileSync(join(dir, name), auxFiles[name]);
  }
  return file;
}

interface Diagnostic {
  code?: string;
  severity?: string;
  message?: string;
}

/**
 * Compile a single scrml source string and return its diagnostic code-set.
 * Side-effect free from the caller's perspective: the temp dir is removed
 * before return (success OR throw).
 */
export function compile(source: string, auxFiles: Record<string, string> = {}): CompileResult {
  const dir = mkdtempSync(join(tmpdir(), "scrml-conf-impl1-"));
  try {
    const file = writeCaseFiles(dir, source, auxFiles);
    const result = compileScrml({
      inputFiles: [file],
      write: false,
      outputDir: join(dir, "out"),
      log: () => {},
    }) as { errors?: Diagnostic[]; warnings?: Diagnostic[] };

    // Build the per-code severity map. The errors stream wins (the §34 fatal
    // partition): a code present as an error is never downgraded to a warning.
    const byCode: Record<string, Severity> = {};
    const record = (d: Diagnostic, streamSev: "error" | "warning") => {
      const c = d?.code;
      if (typeof c !== "string" || c.length === 0) return;
      if (byCode[c] === "error") return;
      byCode[c] = normalizeSeverity(d.severity, streamSev);
    };
    for (const d of result.errors ?? []) record(d, "error");
    for (const d of result.warnings ?? []) record(d, "warning");
    const codes = Object.keys(byCode).sort();
    return { codes, byCode };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ===========================================================================
// (b) runtime-effect half — run(source, input[]) -> { dom, state } (DD W3).
// ===========================================================================
//
// impl#1 realizes the W1 adapter's `run()` over `compileScrml` + happy-dom:
//   (OQ1) execute the artifact in a DOM + serialize the normalized post-run
//         <body>  +  (OQ2) drive the selector-addressed event sequence  +
//   (OQ3) read globalThis.__scrml_conformance.snapshot().
//
// The OQ3 conformance hook is the ratified contract: "in conformance mode an
// impl publishes globalThis.__scrml_conformance with snapshot()+settled()."
// impl#1's ZERO-PRODUCTION-BYTE realization injects the shim below INSIDE the
// eval'd IIFE — the existing browser-harness reach-in idiom (the harness already
// appends `window._scrml_reactive_get = _scrml_reactive_get;` the same way). The
// shim therefore sees the runtime's module-scoped `_scrml_state` / `flush` /
// `_scrml_derived_*` by closure, WITHOUT baking ~978 B gzip into every shipped
// runtime (the SPA shared-runtime budget has only ~188 B headroom under its
// 16 KB gzip cap — a runtime-baked hook would regress v0-3-x-spa-tree-shake §1).
// The snapshot/settled signatures are byte-for-byte the ratified contract; only
// the BYTES' home differs, which is impl#1 freedom. (See the W3 report for the
// runtime-baked-vs-injected placement fork surfaced to PA.)

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../compiler/src/runtime-template.js";
import { driveInputs, type InputStep, type ConformanceHook } from "../driver.ts";
import { normalizeDom, runAnchored, type AnchoredAssertion } from "../normalize.ts";
import { FakeClock } from "../fake-clock.ts";

/**
 * The conformance introspection shim — impl#1's realization of the OQ3 contract.
 * Keyed by scrml-SOURCE cell names (author-visible: `_scrml_state` holds plain
 * reactive cells under their declared names; engine cells use the §51.0.C
 * auto-derived camelCase name, also author-visible). Absence collapses to JS
 * `null` per SPEC §42.5/§42.8 — never `undefined`.
 */
const CONFORMANCE_SHIM = `
;(function () {
  if (typeof globalThis === "undefined") return;
  function _conf_json(v) { return (v === undefined || v === null) ? null : v; }
  globalThis.__scrml_conformance = {
    snapshot: function () {
      if (typeof flush === "function") flush();
      var cells = {}, derived = {};
      for (var c in _scrml_state) cells[c] = _conf_json(_scrml_state[c]);
      for (var d in _scrml_derived_fns) derived[d] = _conf_json(_scrml_derived_get(d));
      return { cells: cells, derived: derived };
    },
    settled: function () {
      return new Promise(function (resolve) {
        Promise.resolve().then(function () {
          setTimeout(function () { if (typeof flush === "function") flush(); resolve(); }, 0);
        });
      });
    }
  };
})();
`;

export interface RunResult {
  /** Whole-tree canonical serialization of the post-run <body> (OQ1 default mode). */
  dom: string;
  /** Final scrml-semantic state, keyed by source cell names (OQ3 snapshot). */
  state: { cells: Record<string, unknown>; derived: Record<string, unknown> };
  /** The live post-run <body> node — fed to runAnchored() for anchored-mode cases. */
  body: unknown;
}

// ---------------------------------------------------------------------------
// Server-fn stub boundary (§52 — call → server route → state hydrate).
// ---------------------------------------------------------------------------
//
// A scrml `function` that touches a server resource auto-escalates to server
// (§12): the client call compiles to a `fetch` to a COMPILER-EMITTED server
// route. In the conformance harness (happy-dom, no real server) there is no
// server to answer that fetch, so `run()` installs a deterministic mock
// `globalThis.fetch` that intercepts the server-fn route and returns a
// CASE-DECLARED response, then `settled()` drains the pending promise so the
// state hydrate completes before the snapshot.
//
// THE IMPL-NEUTRAL KEYING (D3 impl-freedom). A case's `serverStub` is keyed by
// the **scrml-SOURCE server-fn name** (`loadTasks`), NEVER by impl#1's emitted
// route encoding (`/_scrml/__ri_route_loadTasks_1`). Keying by the route would
// bake impl#1 internals into the agnostic case — impl#2 may encode routes
// differently. impl#1's route name is `__ri_route_<sourceFnName>_<counter>`
// (route-inference.ts `generateRouteName`); the ADAPTER (impl#1-specific, free
// to know impl#1's encoding) maps source-fn-name → route by extracting the name
// back out of that pattern at fetch time. impl#2's adapter would map by its own
// route convention; the case stays neutral.
//
// THE ERROR-DIRECTIVE (the SPEC-vs-impl wire divergence, FLAGGED in the W3
// report). §57.2 defines a NORMATIVE absence envelope `{"__scrml_absent":true}`
// that impl#1 matches — so a `T | not` absent response is declared DIRECTLY as
// that envelope (impl-neutral; both impls round-trip it via §57.4). But the
// server-`!` ERROR wire shape DIVERGES: §19.9.1 normatively specifies
// `{__variant, __data}`, while impl#1 actually emits/detects
// `{__scrml_error, type, variant, data}` (the runtime errorBoundary gate). To
// keep the agnostic case off impl#1's divergent envelope, an error response is
// declared with the IMPL-NEUTRAL directive `{ "__serverError": { type, variant,
// data?, status? } }` (names the scrml error TYPE + VARIANT, not any wire keys);
// the impl#1 ADAPTER translates it to impl#1's wire envelope + HTTP status.
// impl#2's adapter translates the same directive to ITS wire shape.

/** A case-declared server-fn response: a plain JSON wire value (success / the
 *  §57.2 absence envelope), OR the impl-neutral error directive below. */
export type ServerStub = Record<string, unknown>;

interface ServerErrorDirective {
  __serverError: { type: string; variant: string; data?: unknown; status?: number };
}

function isServerErrorDirective(v: unknown): v is ServerErrorDirective {
  return (
    v !== null &&
    typeof v === "object" &&
    Object.prototype.hasOwnProperty.call(v, "__serverError")
  );
}

// §6.7.7 / §19.9.2 (Peter #20) — the RAW (non-scrml-typed) HTTP failure directive:
// a transport / host / upstream error that is NOT a scrml `!`/`fail` envelope. The
// server returns `body` VERBATIM (e.g. `{"error":"Internal server error","detail":
// "..."}`) with the given non-2xx status — modeling the common real-world case
// (an uncaught host throw, an upstream API 500) that must settle a `<request>` to
// `.error`, never the success cell. Impl-neutral: names an HTTP status + a raw
// body, no wire-envelope keys. `body` defaults to a generic error object.
interface HttpErrorDirective {
  __httpError: { status: number; body?: unknown };
}

function isHttpErrorDirective(v: unknown): v is HttpErrorDirective {
  return (
    v !== null &&
    typeof v === "object" &&
    Object.prototype.hasOwnProperty.call(v, "__httpError")
  );
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Install a deterministic mock `globalThis.fetch` over the server-fn routes for
 * the duration of one `run()`. Returns a restore thunk. Keyed by the impl-neutral
 * scrml-source fn name (extracted from impl#1's `__ri_route_<name>_<counter>`
 * route encoding — adapter-internal impl#1 knowledge); the case never names a
 * route. An unstubbed server route resolves to a deterministic empty 200 (never
 * a real network call — the harness is hermetic).
 */
function installServerStubFetch(serverStub: ServerStub): () => void {
  const g = globalThis as any;
  const realFetch = g.fetch;
  const RealResponse = g.Response;
  // impl#1 route: `/_scrml/__ri_route_<sourceFnName>_<counter>` (utils.routePath
  // + route-inference.generateRouteName), optionally `__batch_<i>` for a CPS
  // multi-batch split. The captured group is the scrml-source fn name.
  const ROUTE_RE = /^\/_scrml\/__ri_route_(.+)_\d+(?:__batch_\d+)?$/;
  g.fetch = async (input: any): Promise<any> => {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const m = String(url).match(ROUTE_RE);
    const fnName = m ? m[1] : null;
    let body: unknown = fnName !== null && fnName in serverStub ? serverStub[fnName] : null;
    let status = 200;
    if (isServerErrorDirective(body)) {
      const e = body.__serverError;
      // impl#1 wire error envelope — the runtime errorBoundary gate keys on
      // `.__scrml_error` (see runtime-template.js `_scrml_error_boundary_log`).
      body = { __scrml_error: true, type: e.type, variant: e.variant, data: e.data ?? null };
      status = typeof e.status === "number" ? e.status : 500; // §19.9.2 default
    } else if (isHttpErrorDirective(body)) {
      // Peter #20 — a RAW non-2xx (no scrml envelope). The body rides verbatim; a
      // `<request>` must settle it to `.error`, not the success cell.
      const h = body.__httpError;
      status = typeof h.status === "number" ? h.status : 500;
      body = h.body === undefined
        ? { error: "Internal server error", detail: "" }
        : h.body;
    }
    return new RealResponse(JSON.stringify(body === undefined ? null : body), {
      status,
      headers: JSON_HEADERS,
    });
  };
  return () => {
    g.fetch = realFetch;
  };
}

/**
 * Install a minimal, NEVER-FIRING `globalThis.EventSource` for the duration of
 * one `run()`. happy-dom provides no EventSource, so a client that opens an SSE
 * stream (a `server function*` reactive binding, §37.5) throws `EventSource is
 * not defined` at module-init. This hermetic stub lets that construction succeed
 * and models the PRE-FIRST-EVENT window: it opens no connection and dispatches no
 * message, so the bound cell shows its declaration SEED until (in a real browser)
 * the first stream event arrives. That pre-event window is exactly the GITI-035
 * seed-survival contract (the seed must not be clobbered to null). Returns a
 * restore thunk. Installed ONLY when the emitted client constructs an
 * EventSource, so the global env is byte-identical for every non-SSE case.
 *
 * NOTE (future extension): driving actual SSE events into a case would build on
 * this stub (a registry of live instances + a driver verb); no case does today.
 */
function installNoopEventSource(): () => void {
  const g = globalThis as any;
  const real = g.EventSource;
  class NoopEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    url: string;
    readyState: number;
    withCredentials: boolean;
    onmessage: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    onopen: ((ev: any) => void) | null = null;
    _listeners: Record<string, Array<(ev: any) => void>> = {};
    constructor(url: string, init?: { withCredentials?: boolean }) {
      this.url = String(url);
      // CONNECTING — never advances to OPEN (there is no server); never fires.
      this.readyState = 0;
      this.withCredentials = !!(init && init.withCredentials);
    }
    addEventListener(type: string, cb: (ev: any) => void): void {
      (this._listeners[type] = this._listeners[type] || []).push(cb);
    }
    removeEventListener(type: string, cb: (ev: any) => void): void {
      const a = this._listeners[type];
      if (a) this._listeners[type] = a.filter((f) => f !== cb);
    }
    close(): void {
      this.readyState = 2; // CLOSED
    }
  }
  g.EventSource = NoopEventSource;
  return () => {
    if (real === undefined) delete g.EventSource;
    else g.EventSource = real;
  };
}

function ensureFreshDom(): void {
  // A fresh window per run isolates DOMContentLoaded listeners + state from the
  // prior run (verified: re-register drops old listeners). unregister() is async.
  if (GlobalRegistrator.isRegistered) {
    // best-effort synchronous teardown is not exposed; the async unregister is
    // awaited by the caller (run) before re-register.
  }
  GlobalRegistrator.register();
}

/**
 * Execute a scrml source in a DOM, drive the input sequence, and return the
 * normalized post-run DOM + final state snapshot. HARD INVARIANT: reads the
 * POST-run LIVE DOM, never the static .html (DD OQ1 step 1).
 */
export async function run(
  source: string,
  input: InputStep[] = [],
  auxFiles: Record<string, string> = {},
  serverStub: ServerStub = {},
): Promise<RunResult> {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();

  // §52 server-fn boundary: when a case declares server-fn responses, install a
  // deterministic mock fetch over the compiler-emitted server routes for this
  // run (restored in finally). Absent serverStub → fetch is untouched.
  const restoreFetch =
    Object.keys(serverStub).length > 0 ? installServerStubFetch(serverStub) : null;
  // §37.5 SSE binding — a never-firing EventSource stub, installed below only
  // when the emitted client actually opens a stream (assigned inside the try).
  let restoreEventSource: (() => void) | null = null;

  // Virtual clock — installed just before the eval (so timer arming at module-
  // init + on DOMContentLoaded funnels through it) and restored in finally.
  // Declared out here so the finally can restore it even if the eval throws.
  const clock = new FakeClock();

  const dir = mkdtempSync(join(tmpdir(), "scrml-conf-run-"));
  const file = writeCaseFiles(dir, source, auxFiles);
  try {
    const result = compileScrml({
      inputFiles: [file],
      write: false,
      outputDir: join(dir, "out"),
      log: () => {},
    }) as { outputs?: Map<string, { html?: string; clientJs?: string }> };

    const out = result.outputs ? result.outputs.get(file) : undefined;
    const html = (out && out.html) || "";
    const clientJs = (out && out.clientJs) || "";

    // §37.5 SSE binding: happy-dom has no EventSource. Install a never-firing
    // stub for this run ONLY when the emitted client constructs one — models the
    // pre-first-event window (the cell shows its seed). See installNoopEventSource.
    if (clientJs.includes("new EventSource")) {
      restoreEventSource = installNoopEventSource();
    }

    // Mirror the browser harness: extract <body> inner, strip <script>, mount.
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;
    const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    (globalThis as any).document.body.innerHTML = cleanHtml;

    // Install the virtual clock LAST — after happy-dom's DOM setup (which may
    // use real timers internally) and immediately before the eval, so every
    // ms>0 timer the runtime arms (at module-init + on DOMContentLoaded) is
    // controller-driven. setTimeout(0) still passes through to the real timer
    // (the delay===0 rule) so settled()'s macrotask hop keeps working.
    clock.install();

    // Execute runtime + client + conformance shim in ONE IIFE so the shim sees
    // the runtime internals by closure (OQ3 zero-byte realization).
    const code = "(function () {\n" + SCRML_RUNTIME + "\n" + clientJs + "\n" + CONFORMANCE_SHIM + "\n})();";
    // eslint-disable-next-line no-eval
    (0, eval)(code);

    const doc = (globalThis as any).document;
    doc.dispatchEvent(new (globalThis as any).Event("DOMContentLoaded", { bubbles: true }));

    const hook = (globalThis as any).__scrml_conformance as ConformanceHook | undefined;
    if (hook && hook.settled) await hook.settled();

    await driveInputs(doc, input, hook, clock);

    if (hook && hook.settled) await hook.settled();

    const state = hook && hook.snapshot ? hook.snapshot() : { cells: {}, derived: {} };
    const dom = normalizeDom(doc.body);
    return { dom, state, body: doc.body };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete (globalThis as any).__scrml_conformance;
    if (restoreFetch) restoreFetch();
    if (restoreEventSource) restoreEventSource();
    clock.restore();
  }
}

// ===========================================================================
// E-ADAPTER — server-eval mode: run the REAL emitted route + SSR-compose handlers
// ===========================================================================
//
// The `run()` path above MOCKS the server: its `fetch` returns a case-declared
// `serverStub` VERBATIM, so the compiler-emitted route handler — and with it the
// §14.8.9 `_scrml_protect_redact` egress sink + the §52.8 `_scrml_ssr_compose_
// handler` — never execute. That makes the RUNTIME halves of protect-redaction
// (client-visible absence) and SSR first-paint UNOBSERVABLE (ss60 escalation).
//
// Server-eval mode WIDENS the existing seam. `result.outputs` already carries
// `serverJs` (the `run()` cast simply drops it); here the adapter EVALUATES that
// server bundle — stubbing `_scrml_sql` from a case-declared `serverDb` and the
// `Bun` / `Response` / `crypto` ambient globals (borrowing the D2 browser harness
// `ssr-a-terminus-hydration.browser.test.js` compose wrapper) — and then either:
//
//   (a) DISPATCHES the client's `/_scrml/*` fetches through the emitted WinterCG
//       `fetch(request)`, so the route handler's redaction sink actually runs and
//       the client observes the REDACTED response (protect item-2/4); and/or
//   (b) invokes `_scrml_ssr_compose_handler` to produce the first-paint HTML +
//       `window.__scrml_ssr_state` seed, mounts THAT, and hydrates the client
//       (SSR item-1/3).
//
// OPT-IN + NON-PERTURBING. Triggered ONLY by a case declaring `serverDb`. Absent
// it, `runCaseRuntime` uses the byte-identical `run()` path — the 165 existing
// cases (and the fetch-mock / fake-clock install) are untouched.
//
// NEW CONTRACT AXES (flagged for per-phase language-1.0 ratification, S235
// no-batch rule — the PA rules at landing):
//   • `serverDb`  — impl-neutral server-side DB seed, keyed by TABLE name → rows.
//                   Its presence is the request→response serverJs-eval directive.
//   • `firstPaint`— impl-neutral assertions ({contains,notContains}) on the
//                   composed SSR first-paint HTML (the §52.8 observation axis).

/** A case-declared server-side DB seed — impl-neutral, keyed by TABLE name
 *  (never impl#1's SQL/route encoding). Each `_scrml_sql\`... FROM <table> ...\``
 *  the emitted handler runs resolves to this table's rows (a fresh shallow copy
 *  per query so the redaction sink's Symbol-descriptor tagging never bleeds back
 *  into the seed). The WHERE clause is NOT evaluated — a conformance fixture
 *  controls its rows directly; `.get()` (→ row[0]) reads the first. */
export type ServerDb = Record<string, unknown[]>;

/** Assertions on the composed SSR first-paint HTML (§52.8). */
export interface FirstPaintAssertion {
  /** Every substring MUST appear in the first-paint (e.g. a rendered row). */
  contains?: string[];
  /** No substring may appear (e.g. a §14.8.9-protected column / its value). */
  notContains?: string[];
}

/** The subset of the emitted server module the harness drives. */
interface ServerModule {
  /** The WinterCG `fetch(request)` route dispatcher (null when no routes). */
  fetch: ((req: unknown) => Promise<unknown>) | null;
  /** `_scrml_ssr_compose_handler` (null when the app has no SSR authority). */
  compose: ((req: unknown) => Promise<{ text(): Promise<string> }>) | null;
}

/** The `_scrml_sql` tagged-template stub — parses the table out of the query and
 *  returns a fresh copy of the seed's rows for it (empty array when unseeded). */
function makeSqlStub(db: ServerDb): (strings: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]> {
  return (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    const m = /\bFROM\s+["'`]?(\w+)/i.exec(q);
    const table = m ? m[1] : null;
    const rows = table && Array.isArray(db[table]) ? db[table] : [];
    // Fresh shallow copies: the server's `_scrml_protect_tag` stamps a Symbol
    // descriptor onto each row object; copying keeps the seed pristine across
    // queries (and across the ×3 determinism re-run).
    return Promise.resolve(rows.map((r) => (r && typeof r === "object" ? { ...(r as object) } : r)));
  };
}

/**
 * Evaluate the emitted server bundle into its drivable surface. Mirrors the D2
 * browser harness compose wrapper: strip the `import { SQL } from "bun"` + the
 * `new SQL(...)` handle decl (both replaced by the `_scrml_sql` stub param),
 * strip `export ` (the wrapper `return`s the bindings instead), and neutralize
 * `import.meta.url` (the compose handler reads a sibling `.html` off it — the
 * `Bun.file` stub answers with the in-memory `html`). The emitted server code is
 * otherwise UNMODIFIED — the same bytes a real deploy ships.
 */
function evalServerModule(serverJs: string, html: string, db: ServerDb): ServerModule {
  const g = globalThis as any;
  const runnable = serverJs
    .replace(/^\s*import\s+\{\s*SQL\s*\}\s+from\s+"bun";\s*$/m, "")
    .replace(/^\s*const _scrml_sql = new SQL\([^)]*\);\s*$/m, "")
    .replace(/^export\s+/gm, "")
    .replace(/import\.meta\.url/g, JSON.stringify("file:///case.scrml"));
  const BunStub = { file: () => ({ text: async () => html }) };
  const wrapper = new Function(
    "_scrml_sql", "Bun", "Response", "crypto", "URL",
    `${runnable}\nreturn {` +
      ` fetch: typeof fetch !== "undefined" ? fetch : null,` +
      ` compose: typeof _scrml_ssr_compose_handler !== "undefined" ? _scrml_ssr_compose_handler : null` +
      ` };`,
  );
  return wrapper(makeSqlStub(db), BunStub, g.Response, g.crypto, g.URL) as ServerModule;
}

/**
 * Install a `globalThis.fetch` that DISPATCHES `/_scrml/*` requests through the
 * emitted server module's real `fetch(request)`. Returns a restore thunk.
 *
 * Two browser fidelities the real Fetch API would provide, re-created here so the
 * emitted handler's CSRF gate behaves as deployed:
 *   • COOKIE JAR — `document.cookie` is attached as the request `Cookie` header.
 *     (`Cookie` is a Fetch "forbidden header" the `Headers`/`Request` API silently
 *     drops, so the handler receives a DUCK-TYPED request whose `.headers.get`
 *     returns it verbatim — never a real `Request`.)
 *   • Set-Cookie WRITE-BACK — a response `Set-Cookie` is applied to the jar, so
 *     the baseline mint-on-403 → client-retry CSRF handshake completes.
 * A non-`/_scrml/` request resolves to a deterministic empty 200 (hermetic).
 */
function installServerDispatchFetch(mod: ServerModule): () => void {
  const g = globalThis as any;
  const realFetch = g.fetch;
  const RealResponse = g.Response;
  const emptyJson = () => new RealResponse("null", { status: 200, headers: JSON_HEADERS });
  g.fetch = async (input: any, init?: any): Promise<any> => {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (!String(url).startsWith("/_scrml/") || !mod.fetch) return emptyJson();
    // Fold the caller's headers (a plain object OR a Headers instance) down to a
    // lowercase map, then splice in the cookie jar.
    const hmap: Record<string, string> = {};
    const src = init?.headers;
    if (src && typeof src.forEach === "function") src.forEach((v: string, k: string) => { hmap[k.toLowerCase()] = v; });
    else if (src) for (const k of Object.keys(src)) hmap[k.toLowerCase()] = String(src[k]);
    const cookie = (g.document && g.document.cookie) || "";
    if (cookie) hmap["cookie"] = cookie;
    const bodyStr = init?.body != null ? String(init.body) : "";
    const req = {
      url: "http://localhost" + url,
      method: init?.method || "GET",
      headers: { get: (k: string) => hmap[String(k).toLowerCase()] ?? null },
      json: async () => JSON.parse(bodyStr || "null"),
      text: async () => bodyStr,
    };
    const resp = (await mod.fetch(req)) as any;
    const r = resp || emptyJson();
    const setCookie = r.headers && typeof r.headers.get === "function" ? r.headers.get("Set-Cookie") : null;
    if (setCookie && g.document) g.document.cookie = String(setCookie).split(";")[0];
    return r;
  };
  return () => { g.fetch = realFetch; };
}

// The E-CSRF harness runtime shim (ss60 E-CSRF-HELPER escalation). A client
// bundle emitted UNDER an auth middleware references `_scrml_fetch_with_csrf_
// retry(...)` but — on that path — does NOT emit its definition (the def is gated
// on the baseline/no-auth branch), so the mount throws `ReferenceError` when the
// server fn is called. This global FALLBACK resolves that bare reference. A client
// that DOES emit its own `function _scrml_fetch_with_csrf_retry` shadows this in
// its IIFE scope (a local decl wins the scope-chain), so the baseline path is
// unaffected. Mirrors the emitted baseline helper: cookie-token header + one
// mint-on-403 retry.
const CSRF_RETRY_FALLBACK = async function (path: string, method: string, body: unknown): Promise<unknown> {
  const g = globalThis as any;
  const token = (): string => {
    const doc = g.document;
    const m = doc && doc.cookie ? /(?:^|;\s*)scrml_csrf=([^;]+)/.exec(doc.cookie) : null;
    if (m) return decodeURIComponent(m[1]);
    const t = g.crypto && g.crypto.randomUUID ? g.crypto.randomUUID() : Math.random().toString(36).slice(2);
    if (doc) doc.cookie = `scrml_csrf=${t}; Path=/; SameSite=Strict`;
    return t;
  };
  const hdr = () => ({ "Content-Type": "application/json", "X-CSRF-Token": token() });
  let resp = await g.fetch(path, { method, headers: hdr(), body });
  if (resp && resp.status === 403) resp = await g.fetch(path, { method, headers: hdr(), body });
  return resp;
};

/** Install the E-CSRF fallback on globalThis; returns a restore thunk. */
function installCsrfRetryFallback(): () => void {
  const g = globalThis as any;
  const had = "_scrml_fetch_with_csrf_retry" in g;
  const prev = g._scrml_fetch_with_csrf_retry;
  g._scrml_fetch_with_csrf_retry = CSRF_RETRY_FALLBACK;
  return () => { if (had) g._scrml_fetch_with_csrf_retry = prev; else delete g._scrml_fetch_with_csrf_retry; };
}

/** Pull the inline B-substrate seed value out of composed first-paint HTML.
 *  `innerHTML=` does NOT execute the seed `<script>`, so the caller applies it by
 *  hand (exactly what that script would set on `window.__scrml_ssr_state`). */
function extractSsrSeed(firstPaint: string): unknown {
  const m = /window\.__scrml_ssr_state=([\s\S]*?);<\/script>/.exec(firstPaint);
  return m ? JSON.parse(m[1]) : null;
}

export interface ServerRunResult extends RunResult {
  /** The composed SSR first-paint HTML (SSR mode only; else undefined). */
  firstPaint?: string;
}

export interface ServerRunOptions {
  input?: InputStep[];
  auxFiles?: Record<string, string>;
  /** Impl-neutral server DB seed — the server-eval trigger. */
  serverDb: ServerDb;
  /** When true, compose the SSR first-paint, mount THAT + seed, then hydrate. */
  ssr?: boolean;
}

/**
 * Server-eval sibling of `run()` (E-ADAPTER). Compiles the source, evaluates the
 * emitted `serverJs`, and executes the client against the REAL route / SSR-compose
 * handlers. Returns the post-run DOM + state (+ the composed first-paint in SSR
 * mode). Determinism is preserved: rows come from the fixed `serverDb`, the seed
 * is deterministic, and CSRF tokens round-trip (cookie === header) so their
 * non-determinism never reaches asserted output.
 */
export async function runServer(source: string, opts: ServerRunOptions): Promise<ServerRunResult> {
  const { input = [], auxFiles = {}, serverDb, ssr = false } = opts;
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  // A real document URL is required for happy-dom's cookie jar (the baseline CSRF
  // double-submit reads/writes `document.cookie`); about:blank rejects cookies.
  GlobalRegistrator.register({ url: "http://localhost/" } as any);

  const clock = new FakeClock();
  const dir = mkdtempSync(join(tmpdir(), "scrml-conf-server-"));
  const file = writeCaseFiles(dir, source, auxFiles);
  let restoreFetch: (() => void) | null = null;
  const restoreCsrf = installCsrfRetryFallback();
  try {
    const result = compileScrml({
      inputFiles: [file],
      write: false,
      outputDir: join(dir, "out"),
      log: () => {},
    }) as { outputs?: Map<string, { html?: string; clientJs?: string; serverJs?: string }> };

    const out = result.outputs ? result.outputs.get(file) : undefined;
    const html = (out && out.html) || "";
    const clientJs = (out && out.clientJs) || "";
    const serverJs = (out && out.serverJs) || "";

    const mod = evalServerModule(serverJs, html, serverDb);
    restoreFetch = installServerDispatchFetch(mod);

    // SSR mode: compose the first-paint, mount THAT (its <body>), and seed
    // window.__scrml_ssr_state so the client hydrates the server rows in place.
    let firstPaint: string | undefined;
    let seedState: unknown = null;
    let mountSource = html;
    if (ssr) {
      if (!mod.compose) throw new Error("server-eval SSR: emitted serverJs has no _scrml_ssr_compose_handler");
      const resp = await mod.compose({});
      firstPaint = await resp.text();
      seedState = extractSsrSeed(firstPaint);
      mountSource = firstPaint;
    }

    const bodyMatch = mountSource.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : mountSource;
    const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    (globalThis as any).document.body.innerHTML = cleanHtml;
    if (ssr && seedState != null) (globalThis as any).window.__scrml_ssr_state = seedState;

    clock.install();
    const code = "(function () {\n" + SCRML_RUNTIME + "\n" + clientJs + "\n" + CONFORMANCE_SHIM + "\n})();";
    // eslint-disable-next-line no-eval
    (0, eval)(code);

    const doc = (globalThis as any).document;
    doc.dispatchEvent(new (globalThis as any).Event("DOMContentLoaded", { bubbles: true }));

    const hook = (globalThis as any).__scrml_conformance as ConformanceHook | undefined;
    if (hook && hook.settled) await hook.settled();
    await driveInputs(doc, input, hook, clock);
    if (hook && hook.settled) await hook.settled();

    const state = hook && hook.snapshot ? hook.snapshot() : { cells: {}, derived: {} };
    const dom = normalizeDom(doc.body);
    return { dom, state, body: doc.body, firstPaint };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete (globalThis as any).__scrml_conformance;
    try { delete (globalThis as any).window.__scrml_ssr_state; } catch { /* not seeded */ }
    if (restoreFetch) restoreFetch();
    restoreCsrf();
    clock.restore();
  }
}

// ===========================================================================
// (b) runtime-effect half — runTool(source) -> { stdout } (§20.7 / §64).
// ===========================================================================
//
// A `kind="tool"` program (§64) has no client boundary — it emits a single
// runnable module whose stdout IS the program output. The §20.7 print()/
// println() builtins write that stdout as RAW text (no [server] decoration).
// This runner compiles the tool, writes the emitted `.js`, RUNS it with `bun`
// (a real subprocess — the only way to observe host process.stdout faithfully),
// and returns the captured stdout for the case's `expect.stdout` assertion.

export interface ToolRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Compile a `kind="tool"` scrml program, run the emitted module with `bun`,
 * and capture its stdout/stderr/exit-code. The subprocess run is load-bearing:
 * print()/println() write host `process.stdout`, which an in-process DOM
 * harness cannot observe — only a real process boundary does.
 */
export function runTool(source: string, auxFiles: Record<string, string> = {}): ToolRunResult {
  const dir = mkdtempSync(join(tmpdir(), "scrml-conf-tool-"));
  try {
    const file = writeCaseFiles(dir, source, auxFiles);
    const result = compileScrml({
      inputFiles: [file],
      write: false,
      outputDir: join(dir, "out"),
      log: () => {},
    }) as { outputs?: Map<string, { toolJs?: string }> };
    const out = result.outputs ? result.outputs.get(file) : undefined;
    const toolJs = (out && out.toolJs) || "";
    if (!toolJs) {
      return { stdout: "", stderr: "no toolJs emitted (not a kind=\"tool\" program?)", exitCode: 1 };
    }
    const jsFile = join(dir, "case.tool.js");
    writeFileSync(jsFile, toolJs);
    const proc = Bun.spawnSync(["bun", jsFile], { cwd: dir });
    return {
      stdout: new TextDecoder().decode(proc.stdout),
      stderr: new TextDecoder().decode(proc.stderr),
      exitCode: proc.exitCode ?? 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Re-export the anchored-assertion runner + types so the corpus runner imports a
// single adapter surface.
export { runAnchored };
export type { InputStep, AnchoredAssertion };
