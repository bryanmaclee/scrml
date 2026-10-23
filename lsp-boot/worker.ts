/**
 * lsp-boot/worker.ts — the compile worker of the bootstrap LSP. change-id: s469-boot-lsp.
 *
 * The bootstrap compile is synchronous. Running it here, off the server's thread, is what lets the
 * server (a) keep reading the client while a compile runs, (b) really CANCEL a superseded compile
 * (terminate this worker; a fresh one reloads the cached bundle in ~0.15 s) and (c) survive a
 * compile that never returns (a hang on half-typed input) — it is timed out and reported.
 *
 * Protocol (postMessage):
 *   worker → server  { type: "ready", ms, cached }              the bundle is loaded
 *                    { type: "boot-failed", error }             loadBoot threw (e.g. impl#1 could not build it)
 *                    { type: "log", message }                   for window/logMessage
 *                    { type: "result", id, diagnostics, files } a compile finished
 *                    { type: "crash", id, error }               a compile threw
 *   server → worker  { type: "compile", id, path, overlay: [path, text][] }
 *
 * Nothing here writes to stdout: the server's stdout is the LSP channel.
 */

import { compileSource, loadBoot } from "../scripts/scrml-boot.ts";

declare const self: Worker;

// Anything the bootstrap prints must not reach the LSP channel.
console.log = console.error;
console.info = console.error;

const post = (m: unknown) => self.postMessage(m);

// TEST-ONLY fault injection (lsp-boot/server.test): enabled by the server for its own worker only
// when SCRML_BOOT_LSP_TEST_FAULTS=1 is in ITS environment. A buffer containing a marker then
// crashes, hangs, or is slow, so the crash / timeout / cancellation paths have a deterministic test.
let faults = false;
function injectFault(text: string) {
  if (!faults) return;
  if (text.includes("@@scrml-boot-lsp:crash@@")) throw new Error("injected crash (test fault)");
  if (text.includes("@@scrml-boot-lsp:hang@@")) for (;;) { /* never returns */ }
  const slow = /@@scrml-boot-lsp:slow=(\d+)@@/.exec(text);
  if (slow) { const end = performance.now() + Number(slow[1]); while (performance.now() < end) { /* busy, like a compile */ } }
}

let ready: Promise<void> | null = null;

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m?.type === "init") {
    faults = m.faults === true;
    ready = (async () => {
      try {
        const b = await loadBoot({ log: (s) => post({ type: "log", message: s }) });
        post({ type: "ready", ms: b.ms, cached: b.cached });
      } catch (e) {
        post({ type: "boot-failed", error: String((e as Error)?.stack ?? e) });
      }
    })();
    return;
  }
  if (m?.type !== "compile") return;
  await ready;
  const overlay = new Map<string, string>(m.overlay);
  try {
    injectFault(overlay.get(m.path) ?? "");
    const r = await compileSource(m.path, { overlay });
    post({ type: "result", id: m.id, diagnostics: r.diagnostics, files: r.files, ms: r.ms.compile });
  } catch (e) {
    const err = e as Error;
    post({ type: "crash", id: m.id, error: err?.message ?? String(e), stack: String(err?.stack ?? e) });
  }
};
