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

import { basename } from "path";
import { emitLogicNode } from "./emit-logic.ts";
import { needsUrlShapeHelper, SERVER_URL_SHAPE_HELPER, appendJudgeDefinitions } from "./emit-predicates.ts";
import { CGError } from "./errors.ts";
import { SERVER_VALUE_NATIVE_MAP_HELPER, SERVER_STRUCTURAL_EQ_SOURCE } from "../runtime-template.js";

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
  errors?: CGError[],
  filePath?: string,
): string {
  const workerName = name;
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
    lines.push(`  self.postMessage({ replyTo: replyTo, data: data });`);
    lines.push(`}`);
    lines.push(`self.onmessage = function(event) {`);
    lines.push(`  const _scrml_reply_to = event.data.id;`);
    lines.push(`  var ${binding} = event.data.data;`);

    // Indent body lines
    for (const bodyLine of body.split("\n")) {
      lines.push(`  ${bodyLine}`);
    }

    lines.push(`};`);
  }

  // A worker has NO scrml runtime: every `_scrml_*` helper its functions call has to
  // ride in the bundle itself (S458 F3, gap g-worker-bundle-runtime-helpers-not-inlined-s457).
  //   - §53.6.1 (S457 "6a") — the `url` shape judge (runtime-url-guard.js) as a HEADER,
  //     right after the banner: the source declares `const` sets the judge reads.
  //   - the shared helper table (structural `==`, the §59 map/set family) as a footer —
  //     every entry is a function declaration, which hoists.
  // Then FAIL CLOSED: a `_scrml_*(` call the bundle neither defines nor inlines is a
  // compile error, not a ReferenceError on the first message.
  let body = lines.join("\n");
  body = appendJudgeDefinitions(body); // S458 2a-fix F3 — the hoisted §53 judges the worker calls
  const footer: string[] = [];
  for (const { sig, src } of WORKER_RUNTIME_HELPERS) {
    if (body.includes(sig) && !body.includes(`function ${sig}`)) footer.push(src);
  }
  if (MAP_HELPER_REFERENCED.test(body) && !/function _scrml_map_/.test(body)) footer.push(SERVER_VALUE_NATIVE_MAP_HELPER);
  if (footer.length) body = body + "\n" + footer.join("\n");
  if (needsUrlShapeHelper(body)) {
    const [banner, ...rest] = body.split("\n");
    body = [banner, SERVER_URL_SHAPE_HELPER.replace(/^\n/, ""), "", ...rest].join("\n");
  }
  if (errors) {
    for (const name of unmetWorkerHelperRefs(body)) {
      errors.push(new CGError(
        "E-CODEGEN-INVALID-LOGIC",
        `E-CODEGEN-INVALID-LOGIC: the compiler could not lower this construct to valid output.\n` +
          `  artifact: the worker bundle of <program name="${workerName}">\n` +
          `  The worker bundle calls the runtime helper \`${name}\`, which a worker (it has no scrml runtime) ` +
          `does not carry and the compiler does not inline. This is a compiler defect; please report it. (§4.12.4)`,
        { file: filePath ?? "", start: 0, end: 0, line: 1, col: 1 } as never,
      ));
    }
  }
  return body;
}

/**
 * Runtime helpers a worker bundle inlines on use (S458 F3). Environment-neutral
 * ones only: a worker runs in the browser's worker scope, with no server, no DB.
 */
const WORKER_RUNTIME_HELPERS: Array<{ sig: string; src: string }> = [
  {
    sig: "_scrml_structural_eq(",
    src: "\n// --- §45 Structural equality helper (inlined: a worker has no scrml runtime) ---\n" + SERVER_STRUCTURAL_EQ_SOURCE + "\n",
  },
];

const MAP_HELPER_REFERENCED = /\b_scrml_map_[a-z]/;

/**
 * The `_scrml_*(` calls in a finished worker bundle that it does not define —
 * each would be a ReferenceError at run time. `_scrml_reply` and every helper
 * the bundle inlined are defined in it by then.
 */
function unmetWorkerHelperRefs(bundle: string): string[] {
  const defined = new Set<string>();
  for (const m of bundle.matchAll(/\bfunction\s+(_scrml_[A-Za-z0-9_$]*)\s*\(/g)) defined.add(m[1]);
  for (const m of bundle.matchAll(/\b(?:const|let|var)\s+(_scrml_[A-Za-z0-9_$]*)\s*=/g)) defined.add(m[1]);
  // A call guarded by `typeof NAME === "function"` is optional by construction
  // (the url guard reports through `_scrml_error_boundary_log` only when a
  // runtime provides it) — not a missing helper.
  for (const m of bundle.matchAll(/\btypeof\s+(_scrml_[A-Za-z0-9_$]*)/g)) defined.add(m[1]);
  const unmet = new Set<string>();
  // calls, not mentions: strip string literals and comments first
  const code = bundle
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  for (const m of code.matchAll(/(?<![\w$.])(_scrml_[A-Za-z0-9_$]*)\s*\(/g)) {
    if (!defined.has(m[1])) unmet.add(m[1]);
  }
  return [...unmet];
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
