/**
 * @module codegen/emit-worker
 *
 * Generates self-contained worker JS bundles from extracted nested
 * <program name="..."> ASTs (§4.12.4).
 *
 * Each worker gets its own script with `self.onmessage` wiring.
 * Function declarations inside the worker are compiled and included.
 * `send(x)` calls in the `when message` body are rewritten to a reply that
 * names the parent `.send()` being answered (see WIRE FORMAT below).
 *
 * WIRE FORMAT (compiler-internal; both ends are compiler-generated):
 *   parent -> worker   { id, data }       `id` identifies the parent's pending
 *                                         `<#name>.send(data)` call (ids start at 1).
 *   worker -> parent   { replyTo, data }  `replyTo` is the `id` of the message the
 *                                         worker was handling when it called
 *                                         `send(data)`.
 * The parent resolves the `.send()` promise whose id matches `replyTo` (the
 * FIRST reply to that id; later ones only reach `when message from`), and runs
 * every `when message from <#name>` handler on EVERY message (§46.6). The
 * parent side lives in emit-client.ts ("worker instantiation").
 */

import { HOST_GLOBAL_ALIAS_SCRIPT_DECL } from "./host-global-alias.ts";
import { basename } from "path";
import { emitLogicNode } from "./emit-logic.ts";
import { needsUrlShapeHelper, SERVER_URL_SHAPE_HELPER } from "./emit-predicates.ts";

/**
 * The file a nested worker program is written to, next to its page's HTML, and
 * the URL the page's `new Worker(...)` loads (resolved against the page URL, the
 * same way the page's relative `<script src>` is).
 *
 * The page's basename is part of the name so two pages in one output directory
 * can each declare a worker with the same `name=`. The separator is `-`, not
 * `.`: the static-serve policy (§47.13) denies any file whose name contains
 * `.server.` or `.sqlite`, so `<page>.<name>.worker.js` would be unservable for
 * a worker named `server` or `sqlite`. Worker names are identifiers (no `-`),
 * so `<page>-<name>` cannot collide across pages.
 *
 * @param sourceFile - The page's `.scrml` source path
 * @param name - Worker name (from the `name=` attribute)
 */
export function workerBundleFilename(sourceFile: string, name: string): string {
  return `${basename(sourceFile, ".scrml")}${workerBundleSuffix(name)}`;
}

/** The part of {@link workerBundleFilename} after the page's basename. */
export function workerBundleSuffix(name: string): string {
  return `-${name}.worker.js`;
}

/**
 * Generate a self-contained worker JS string from the extracted worker AST.
 *
 * @param name - Worker name (from the `name=` attribute)
 * @param children - Child AST nodes of the worker program
 * @param whenMessage - The WhenMessageNode (kind: "when-message"), or null
 * @returns Complete worker JS source string
 */
export function generateWorkerJs(
  name: string,
  children: any[],
  whenMessage: any | null,
): string {
  const lines: string[] = [];
  lines.push(`// Generated worker: ${name}`);

  // Emit function declarations from the worker's children
  for (const child of children) {
    if (!child || typeof child !== "object") continue;

    if (child.kind === "logic") {
      for (const stmt of (child.body ?? [])) {
        if (stmt?.kind === "function-decl") {
          const fnCode = emitLogicNode(stmt);
          if (fnCode) {
            lines.push(fnCode);
          }
        }
      }
    }
  }

  // Emit the onmessage handler from the when-message node
  if (whenMessage) {
    const binding: string = whenMessage.binding ?? "data";
    let body: string = whenMessage.bodyRaw ?? "";

    // Rewrite send(...) → _scrml_reply(_scrml_reply_to, ...)
    body = rewriteWorkerSend(body);

    lines.push(`// Reply to the parent. \`replyTo\` names the parent's \`.send()\` being answered.`);
    lines.push(`function _scrml_reply(replyTo, data) {`);
    lines.push(`  _scrml_g.self.postMessage({ replyTo: replyTo, data: data });`);
    lines.push(`}`);
    // s457 3a — the listener's own parameter is `_scrml_event` (outside the
    // user namespace): the `when message (binding)` body gets its data through
    // `binding`, and a free `event` in it is E-EVENT-UNBOUND (listener-event-check).
    lines.push(`_scrml_g.self.onmessage = function(_scrml_event) {`);
    lines.push(`  const _scrml_reply_to = _scrml_event.data.id;`);
    lines.push(`  var ${binding} = _scrml_event.data.data;`);

    // Indent body lines
    for (const bodyLine of body.split("\n")) {
      lines.push(`  ${bodyLine}`);
    }

    lines.push(`};`);
  }

  // A worker bundle is a CLASSIC script: a top-level declaration in it becomes a property of the
  // worker's global object, so a worker function named `postMessage` / `self` / `onmessage`
  // would replace the host's own and the worker would never reply. The worker's code therefore
  // runs inside a function scope (as a client chunk's does), and everything the compiler needs
  // from the host is captured OUTSIDE that scope, first: the host-global alias (S457 2a), which
  // every compiler reference reads through. A classic IIFE rather than a module worker
  // (`new Worker(url, { type: "module" })`): the page constructs it as a classic worker today,
  // and the IIFE needs no change to the page, the bundle's MIME or the browsers it runs on.
  const [banner, ...rest] = lines;
  const out: string[] = [banner, HOST_GLOBAL_ALIAS_SCRIPT_DECL];
  // §53.6.1 (S457 "6a") — a worker has no scrml runtime, so a `string(url)` boundary check in a
  // worker function would call an undefined `_scrml_url_shape_ok`. Inline the judge's source
  // (runtime-url-guard.js) ahead of the worker's code: compiler text, outside the IIFE.
  if (needsUrlShapeHelper(rest.join("\n"))) out.push(SERVER_URL_SHAPE_HELPER.replace(/^\n/, ""), "");
  out.push("(function () {");
  for (const l of rest) out.push(l);
  out.push("})();");
  return out.join("\n");
}

/**
 * Rewrite `send(...)` calls in a worker `when message` body to
 * `_scrml_reply(_scrml_reply_to, ...)`, so the reply carries the id of the
 * message being handled. A `send()` with no argument becomes
 * `_scrml_reply(_scrml_reply_to)` (`data` undefined).
 *
 * Only a bare `send(` is rewritten: not `resend(` (identifier character before)
 * and not a method call such as `socket.send(` (`.` before).
 */
export function rewriteWorkerSend(body: string): string {
  return body
    .replace(/(?<![\w$.])send\s*\(\s*\)/g, "_scrml_reply(_scrml_reply_to)")
    .replace(/(?<![\w$.])send\s*\(\s*/g, "_scrml_reply(_scrml_reply_to, ");
}
