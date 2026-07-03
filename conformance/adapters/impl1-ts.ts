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
    clock.restore();
  }
}

// Re-export the anchored-assertion runner + types so the corpus runner imports a
// single adapter surface.
export { runAnchored };
export type { InputStep, AnchoredAssertion };
