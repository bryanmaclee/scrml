import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/**
 * Phase A1c Step C7 — pull the validator predicate runtime catalog into
 * SCRML_RUNTIME at module-load time. The validator runtime is authored as a
 * standalone ESM module (compiler/src/runtime-validators.js) so C6's tests can
 * import its functions directly. The compiled client runtime (the SCRML_RUNTIME
 * string emitted alongside every .client.js) needs the SAME functions inlined
 * as plain JavaScript so the runner emitted by C7 codegen can call them.
 *
 * Strategy: read the validator-runtime source verbatim and strip the leading
 * `export ` keyword from each top-level declaration. The result is plain JS
 * suitable for inlining inside the runtime template literal. This keeps
 * `runtime-validators.js` as the single source-of-truth — there is no
 * duplication; the chunk content is the live module's source bytes (sans
 * `export `).
 *
 * The `^export ` regex strip is safe — every `export` in `runtime-validators.js`
 * appears at column 0 (verified by grep at S73 land).
 */
const __runtime_template_dir = dirname(fileURLToPath(import.meta.url));
const _VALIDATOR_RUNTIME_SOURCE = readFileSync(
  join(__runtime_template_dir, "runtime-validators.js"),
  "utf8",
).replace(/^export /gm, "");

/**
 * Stdlib shim loader. Reads a hand-written `compiler/runtime/stdlib/<name>.js`
 * shim, strips `export ` prefixes, collects the exported names, and produces
 * a runtime chunk string that registers the names on `_scrml_stdlib.<name>`.
 *
 * The emitted shape is an IIFE so the inlined function declarations stay
 * scoped — they don't pollute the global classic-script namespace.
 *
 * Mirrors the validator-runtime pattern (line 23-27 above): the on-disk
 * shim file is the single source of truth. Server-emit consumes it via
 * `compileScrml`'s `bundleStdlibForRun` (copies the file into
 * `<outputDir>/_scrml/<name>.js`); client-emit consumes it through this
 * inline path so the browser does not see a bare `import { x } from
 * "scrml:NAME"` (which fails — see Bug 18, S95).
 *
 * Const-named export support: a shim may export non-function bindings via
 * `export const Name = ...`. The loader collects both forms.
 */
function _loadStdlibChunk(name) {
  const shimPath = join(__runtime_template_dir, "../runtime/stdlib", `${name}.js`);
  const source = readFileSync(shimPath, "utf8");
  const exportedNames = [];
  const fnRe = /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = fnRe.exec(source)) !== null) exportedNames.push(m[2]);
  const constRe = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = constRe.exec(source)) !== null) exportedNames.push(m[1]);

  // Process the importing shim's body. `export ` is stripped from its own
  // top-level declarations. Its top-level `import` statements are classified:
  //
  //   - SIBLING-SHIM import (a relative `./X.js`): the imported symbols are
  //     INLINED — their definitions are read out of the sibling file and
  //     prepended to this IIFE body so they resolve as plain locals. This is
  //     what lets a client-inlined shim route its arithmetic through
  //     `scrml:math` (e.g. `import { min, max, ceil } from "./math.js"`)
  //     without leaving a bare `import` that the classic-script runtime
  //     cannot parse. Inlining is TRANSITIVE (a sibling may import its own
  //     siblings) and DEDUPED (a helper is emitted at most once per IIFE).
  //
  //   - EXTERNAL import (`bun`, `bun:sqlite`, `node:*`, any bare specifier):
  //     STRIPPED, preserving today's loud-failure pattern. The referenced
  //     symbol will ReferenceError at first call in the browser, which is
  //     intended for server-only stdlib surfaces reaching client emission.
  const emitted = new Set();
  const { prelude, body } = _inlineSiblingShimImports(
    source,
    dirname(shimPath),
    emitted,
  );
  const stripped = (prelude ? prelude + "\n" : "") + body.replace(/^export /gm, "");
  return (
    `// --- chunk: stdlib-${name} ---\n` +
    `_scrml_stdlib.${name} = (function() {\n` +
    stripped + "\n" +
    `  return { ${exportedNames.join(", ")} };\n` +
    `})();\n`
  );
}

// Match a single top-level `import { ... } from "<spec>";` statement.
// Captures the named-binding clause (group 1) and the module specifier
// (group 2). We only handle the named-import form — every stdlib sibling
// import is `import { a, b as c } from "./x.js"`; there are no default or
// namespace imports in the shims.
const _SHIM_IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']\s*;[ \t]*$/gm;

// Strip an `import` statement that is NOT a named-binding form (catches a
// bare side-effect `import "x";`, default, or namespace import — none exist
// in the shims today, but keep the loud-fail strip robust).
const _ANY_IMPORT_RE = /^import[\s\S]*?;[ \t]*$\n?/gm;

/**
 * Inline sibling-shim imports for one shim source.
 *
 * Returns `{ prelude, body }`:
 *   - `prelude` — the inlined sibling definitions (export-stripped), in
 *     dependency order, to be prepended to the IIFE body.
 *   - `body`    — the shim's own source with every `import` statement removed
 *     (sibling imports replaced by the prelude; external imports stripped).
 *
 * `emitted` is a shared Set of already-defined symbol names so a helper is
 * never double-defined within one IIFE (dedup across the transitive graph).
 *
 * Exported for the S177 inliner test (drive the classifier with synthetic
 * shims in a temp dir without touching the real stdlib directory).
 */
export function _inlineSiblingShimImports(source, shimDir, emitted) {
  // Names this source DEFINES itself — used for the collision guard: if a
  // sibling import asks for a name this shim already defines, the shim's own
  // definition wins and the inline is skipped (no shadow / double-define).
  const ownNames = _collectTopLevelDefinedNames(source);

  const preludeParts = [];

  // Replace each top-level import. Sibling imports → "" here (their defs go
  // into the prelude); external imports → "" too (loud-fail strip).
  let body = source.replace(_SHIM_IMPORT_RE, (full, clause, spec) => {
    if (!_isRelativeSiblingSpec(spec)) {
      // External (`bun:sqlite`, `node:*`, bare): strip. Referenced symbols
      // will ReferenceError on the client (intended for server-only surfaces).
      return "";
    }
    const siblingPath = join(shimDir, spec);
    const siblingSource = readFileSync(siblingPath, "utf8");
    const siblingDir = dirname(siblingPath);
    // The sibling file's OWN top-level defined names (its exports AND its
    // unexported private helpers). Feeds the same-file private-helper closure
    // below so a def like `get` drags in the `_request` it calls.
    const siblingDefinedNames = _collectTopLevelDefinedNames(siblingSource);

    for (const binding of _parseImportBindings(clause)) {
      const { imported, local } = binding;
      // Each sibling symbol is inlined UNDER ITS LOCAL NAME (renamed in place
      // for an `as`-alias). This is what keeps a name like `min` collision-safe:
      // `import { min as mathMin }` defines `function mathMin`, never a duplicate
      // `function min` that would clash with the importing shim's own `min`.
      if (emitted.has(local)) continue; // dedup — already in this IIFE
      if (ownNames.has(local)) continue; // collision: importing shim's def wins

      // Recurse FIRST so a sibling's own transitive deps land before it.
      const nested = _inlineSiblingShimImports(siblingSource, siblingDir, emitted);
      if (nested.prelude && !preludeParts.includes(nested.prelude)) {
        preludeParts.push(nested.prelude);
      }

      // Extract the sibling's definition of `imported`, RENAMED to `local`.
      const def = _extractTopLevelDefinition(siblingSource, imported, local);
      if (def === null) {
        // Imported symbol not found in the sibling — leave a build-time
        // breadcrumb. It will ReferenceError if actually called, surfacing
        // the missing export loudly rather than silently.
        preludeParts.push(
          `  // [scrml stdlib-inline] missing export "${imported}" from ${spec}`,
        );
        emitted.add(local);
        continue;
      }
      // Same-file private-helper closure (S245 — g-http-client-inline-private-
      // helper-drop). The recursion above only follows the sibling's cross-file
      // `import` statements; it never scans the extracted def's BODY for the
      // sibling's OWN top-level helpers. But `get`/`post`/… call an unexported
      // `_request`; `uploadFile` calls `multipart`; `withDefaults`/`withAuth`
      // reference the sibling exports `get`/`post`/… — none via an `import`. So
      // inline the transitive closure of same-file top-level names this def
      // references, in dependency order, BEFORE the importing def itself.
      for (const helperDef of _collectSameFilePrivateHelpers(
        siblingSource,
        def,
        siblingDefinedNames,
        new Set([imported, local]),
        emitted,
        ownNames,
      )) {
        preludeParts.push(helperDef);
      }
      preludeParts.push(def);
      emitted.add(local);
    }
    return "";
  });

  // Strip any remaining (non-named-form) imports — loud-fail.
  body = body.replace(_ANY_IMPORT_RE, "");

  return { prelude: preludeParts.join("\n"), body };
}

// A sibling-shim specifier is a relative path ending in `.js` (`./math.js`,
// `./sub/y.js`, `../x.js`). Anything else (`bun`, `bun:sqlite`, `node:fs`,
// a bare package name) is external.
function _isRelativeSiblingSpec(spec) {
  return /^\.\.?\//.test(spec) && /\.js$/.test(spec);
}

// Parse a named-import clause `a, b as c, d` into [{imported, local}].
function _parseImportBindings(clause) {
  return clause
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(s);
      if (asMatch) return { imported: asMatch[1], local: asMatch[2] };
      return { imported: s, local: s };
    });
}

// Collect the names declared by top-level `export? (function|const|let|var)`
// declarations in a shim source.
function _collectTopLevelDefinedNames(source) {
  const names = new Set();
  let m;
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm;
  while ((m = fnRe.exec(source)) !== null) names.add(m[1]);
  const constRe = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = constRe.exec(source)) !== null) names.add(m[1]);
  return names;
}

/**
 * Collect the transitive closure of SAME-FILE top-level definitions that an
 * extracted sibling definition references but that the import-recursion never
 * inlines (they arrive via a same-file reference, not an `import` statement).
 *
 * `get`/`post`/… call an unexported `_request`; `uploadFile` calls the exported
 * `multipart`; `withDefaults`/`withAuth` reference the sibling exports
 * `get`/`post`/… . Without this pass a client-inlined `get` emits a call to an
 * undefined `_request` — `ReferenceError: _request is not defined` (S245 bug
 * g-http-client-inline-private-helper-drop).
 *
 * Each helper is extracted UNDER ITS ORIGINAL NAME (the def body references it
 * by original name — only the imported symbol itself is `as`-renamed) and
 * returned in dependency order (a helper's own deps precede it, so const/arrow
 * helpers resolve top-to-bottom). `emitted` is mutated for dedup and cycle
 * termination; a name already in `emitted`, in the importing shim's `ownNames`
 * (that def wins — mirrors the :143 collision rule), or in `skipNames` (the
 * imported symbol plus its local alias) is not re-inlined.
 *
 * Over-approximation is SAFE and under-approximation is the bug, so the body
 * scan is a deliberately conservative word-boundary identifier scan — it may
 * harmlessly pull a helper mentioned only in a string/comment; it must never
 * MISS one. No string/comment-aware cleverness here.
 */
function _collectSameFilePrivateHelpers(
  siblingSource,
  seedDef,
  siblingDefinedNames,
  skipNames,
  emitted,
  ownNames,
) {
  const parts = [];
  const visit = (body) => {
    for (const name of _scanIdentifierRefs(body)) {
      if (!siblingDefinedNames.has(name)) continue; // not a same-file top-level def
      if (skipNames.has(name)) continue;            // the imported symbol / its alias
      if (emitted.has(name)) continue;              // already inlined (dedup / cycle)
      if (ownNames.has(name)) continue;             // importing shim's def wins (:143)
      const helperDef = _extractTopLevelDefinition(siblingSource, name, name);
      if (helperDef === null) continue;             // defensive — name has no extractable def
      emitted.add(name);     // mark BEFORE recursing so a helper cycle terminates
      visit(helperDef);      // a private helper may call further same-file privates
      parts.push(helperDef); // post-order push → a helper's deps land before it
    }
  };
  visit(seedDef);
  return parts;
}

// Collect the set of identifier-like tokens `text` references BARE. Deliberately
// NOT string/comment-aware — over-approximation there is safe for the same-file
// private-helper closure (S245) and under-approximation is the bug.
//
// It DOES skip member-access-position identifiers (`obj.name`, `obj?.name`): a
// top-level binding is only ever referenced BARE, never after a property `.`, so
// excluding those removes false positives (e.g. `_request`'s `opts.retry` token
// spuriously matching the exported `retry` — whose body carries raw `Math.*`,
// which would breach the §26/S176 single-`scrml:math`-source runtime invariant)
// WITHOUT ever missing a real reference. A leading `.` that is part of a `...`
// spread is NOT member access, so `...defaults` still references top-level
// `defaults`.
function _scanIdentifierRefs(text) {
  const names = new Set();
  const idRe = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = idRe.exec(text)) !== null) {
    const i = m.index;
    // Member access `X.name` / `X?.name` — skip. A single leading `.` whose own
    // predecessor is also `.` is a `...` spread (a bare reference) — keep it.
    if (i > 0 && text[i - 1] === "." && text[i - 2] !== ".") continue;
    names.add(m[0]);
  }
  return names;
}

/**
 * Extract the full source text of a top-level definition named `symbol`,
 * with any leading `export ` removed and indented two spaces so it nests
 * cleanly inside the IIFE. Handles both forms:
 *
 *   export function NAME(...) { ... }     — balanced-brace body
 *   export const NAME = ...;              — statement-terminated (incl.
 *                                            multi-line object/array RHS)
 *
 * `renameTo` (optional) emits the definition under a DIFFERENT identifier
 * than its source name — used to honor `as`-aliases and to side-step a
 * name collision with the importing shim's own definitions. The rename is a
 * single-token rewrite of the declared identifier only (the body is left
 * verbatim — leaf math/random helpers do not self-reference by name).
 *
 * Returns null if the symbol is not found as a top-level definition.
 */
function _extractTopLevelDefinition(source, symbol, renameTo) {
  const target = renameTo || symbol;

  // --- function form ---
  const fnDeclRe = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${_escapeRe(symbol)}\\b`,
    "m",
  );
  const fnMatch = fnDeclRe.exec(source);
  if (fnMatch) {
    const declStart = fnMatch.index;
    // Find the opening brace of the function body.
    const braceOpen = source.indexOf("{", declStart);
    if (braceOpen !== -1) {
      const bodyEnd = _matchBalancedBrace(source, braceOpen);
      if (bodyEnd !== -1) {
        let raw = source.slice(declStart, bodyEnd + 1).replace(/^export\s+/, "");
        if (target !== symbol) {
          // Rewrite only the declared name: `function <symbol>(` → `function <target>(`.
          raw = raw.replace(
            new RegExp(`^((?:async\\s+)?function\\s*\\*?\\s*)${_escapeRe(symbol)}\\b`),
            `$1${target}`,
          );
        }
        return _indent(raw);
      }
    }
  }

  // --- const/let/var form ---
  const constDeclRe = new RegExp(
    `^(?:export\\s+)?(?:const|let|var)\\s+${_escapeRe(symbol)}\\b`,
    "m",
  );
  const constMatch = constDeclRe.exec(source);
  if (constMatch) {
    const declStart = constMatch.index;
    const stmtEnd = _matchStatementEnd(source, declStart);
    if (stmtEnd !== -1) {
      let raw = source.slice(declStart, stmtEnd + 1).replace(/^export\s+/, "");
      if (target !== symbol) {
        raw = raw.replace(
          new RegExp(`^((?:const|let|var)\\s+)${_escapeRe(symbol)}\\b`),
          `$1${target}`,
        );
      }
      return _indent(raw);
    }
  }

  return null;
}

// Given the index of a `{`, return the index of its matching `}` (brace-aware,
// skipping braces inside strings / template literals / line + block comments).
function _matchBalancedBrace(source, openIdx) {
  let depth = 0;
  let i = openIdx;
  let inStr = null; // '"' | "'" | '`'
  while (i < source.length) {
    const ch = source[i];
    const prev = source[i - 1];
    if (inStr) {
      if (ch === inStr && prev !== "\\") inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close === -1) return -1;
      i = close + 2;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Find the end (index of the terminating `;`) of a `const`/`let`/`var`
// statement starting at `declStart`, tracking brace/bracket/paren depth and
// strings so a `;` inside a multi-line object/array/template literal does not
// end the statement early.
function _matchStatementEnd(source, declStart) {
  let depth = 0;
  let i = declStart;
  let inStr = null;
  while (i < source.length) {
    const ch = source[i];
    const prev = source[i - 1];
    if (inStr) {
      if (ch === inStr && prev !== "\\") inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close === -1) return -1;
      i = close + 2;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === ";" && depth === 0) return i;
    i++;
  }
  return -1;
}

function _escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Indent each line of an extracted definition by two spaces so it nests
// cleanly inside the IIFE body.
function _indent(text) {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? "  " + line : line))
    .join("\n");
}

// Inline a stdlib chunk for each shim that ships in compiler/runtime/stdlib/.
// `store` is intentionally excluded — its shim is a bun:sqlite wrapper with
// no browser-callable surface; client-side use is meaningless. Server-side
// access continues through the `bundleStdlibForRun` path (api.js) which
// copies the shim to `<outputDir>/_scrml/store.js`.
const _STDLIB_AUTH_CHUNK   = _loadStdlibChunk("auth");
const _STDLIB_CRYPTO_CHUNK = _loadStdlibChunk("crypto");
const _STDLIB_DATA_CHUNK   = _loadStdlibChunk("data");
const _STDLIB_HOST_CHUNK   = _loadStdlibChunk("host");

/**
 * scrml reactive runtime — shared runtime library.
 *
 * This module exports the runtime source as a string constant. The code generator
 * uses it in two modes:
 *
 *   1. External mode (default): The runtime is written once to `dist/scrml-runtime.js`.
 *      Each `.client.js` file starts with `// Requires: scrml-runtime.js` and does NOT
 *      embed the runtime. The HTML document wrapper includes a `<script>` tag for the
 *      runtime BEFORE the app script.
 *
 *   2. Embedded mode (`--embed-runtime`): The runtime is inlined at the top of every
 *      `.client.js` file. This is the legacy behavior, useful for single-file distribution.
 *
 * To modify the runtime, edit the SCRML_RUNTIME string below. All compiled output
 * shares this single source of truth.
 *
 * §6.6 implementation notes:
 *   - _scrml_derived_declare(name, fn) — registers derived node, marks dirty for initial eval
 *   - _scrml_derived_subscribe(derived, upstream) — registers dirty-propagation edge
 *   - _scrml_derived_get(name) — lazy pull: if dirty, re-evaluate + cache + clear flag; return cached
 *   - flush() — synchronous re-evaluation of all dirty derived nodes
 *   - _scrml_reactive_set now propagates dirty flags to downstream derived nodes (eager, synchronous)
 *   - _scrml_reactive_derived is RETIRED. Calling it will throw to fail loudly.
 *   - _scrml_reactive_subscribe now returns an unsubscribe function (() => void).
 *
 * §6.7.5/§6.7.6 implementation notes (timer/poll):
 *   - _scrml_timer_start(scopeId, timerId, intervalMs, bodyFn) — start interval timer
 *   - _scrml_timer_stop(scopeId, timerId) — stop (clearInterval)
 *   - _scrml_timer_pause(scopeId, timerId) — pause (suspend interval, preserve handle)
 *   - _scrml_timer_resume(scopeId, timerId) — resume (restart interval from now)
 *   - _scrml_destroy_scope now also cancels timers for that scope
 *
 * §6.7.7 implementation notes (animationFrame):
 *   - animationFrame(fn) — schedule fn via requestAnimationFrame, scope-registered
 *   - _scrml_animation_frame(fn) — internal implementation
 *   - _scrml_cancel_animation_frames(scopeId) — cancel all pending rAF for a scope
 *   - _scrml_destroy_scope now also cancels animation frames for that scope
 *
 * §22.5 meta.emit() runtime:
 *   - _scrml_meta_emit(scopeId, htmlString) — insert HTML at the ^{} block's placeholder position
 *
 * §22.5 meta reactive effects (4-argument form per SPEC §22.5):
 *   - _scrml_meta_effect(scopeId, fn, capturedBindings, typeRegistry)
 *     Run fn as a reactive effect. Auto-tracks @variable reads via a tracking stack.
 *     capturedBindings — frozen object with lexical bindings at ^{} breakout point.
 *     meta.types — { reflect(name) } accessor wrapping typeRegistry.
 *     Backward compatible: 2-argument calls still work (bindings/types default to null).
 *     Infinite loop guard: MAX_RUNS = 100. Scope cleanup registered with _scrml_register_cleanup.
 */

export const SCRML_RUNTIME = `// --- scrml reactive runtime ---
const _scrml_state = {};
const _scrml_subscribers = {};
// S103 Phase 3 select-row chip-away (Candidate A) — value-indexed sub-registry
// parallel to _scrml_subscribers. Predicate-shape binds emitted by emit-lift.js
// register here under their static valueKey (the constant they compare the cell
// to). At write time _scrml_reactive_set fires only the OLD-value bucket and
// the NEW-value bucket — O(2) per write instead of O(N) over all rows.
// Shape: { [name]: { [valueKey]: [fn, ...] } }
// TDZ-safe: declared next to _scrml_subscribers since state-decl substrates
// may write to cells during module-init before the helper functions resolve.
const _scrml_value_indexed_subscribers = {};
// scrml: stdlib registry — populated by per-stdlib chunks (see end of runtime).
// Client-emitted code rewrites \`import { x } from "scrml:NAME"\` to
// \`const { x } = _scrml_stdlib.NAME;\` (browser cannot resolve bare specifiers).
const _scrml_stdlib = {};

// ---------------------------------------------------------------------------
// P1.B — Per-op runtime instrumentation (SCOPING §2.2, S103).
//
// Gated on \`globalThis.__SCRML_DEBUG_PERF\`. When the flag is unset (the
// production path), \`__SCRML_PERF\` is null and every \`if (__SCRML_PERF)\`
// branch below collapses to a predictable null-check the JIT inlines away.
// When set, the runtime accumulates per-category ms + call counts and emits a
// breakdown via \`_scrml_perf_dump()\` on demand (or \`_scrml_perf_reset()\`
// between benchmark iterations).
//
// Categories tracked:
//   reactive_get        every _scrml_reactive_get call
//   reactive_set        every _scrml_reactive_set call (incl. timing-wrapped)
//   reconcile_list      every _scrml_reconcile_list call (keyed list diff)
//   notify_subscribers  the subscriber-fan-out loop inside _scrml_reactive_set
//   dom_write           DOM mutation calls inside _scrml_reconcile_list
//                       (appendChild / insertBefore / removeChild /
//                       replaceChildren)
//   effect_scheduling   reactive-effect re-runs (_scrml_trigger + _scrml_effect
//                       body)
//
// Verify zero-overhead empirically against AC1: warm-run delta < 1ms on a
// representative TodoMVC op.
const __SCRML_PERF = (typeof globalThis !== "undefined" && globalThis.__SCRML_DEBUG_PERF)
  ? {
      reactive_get:         { ms: 0, count: 0 },
      reactive_set:         { ms: 0, count: 0 },
      reconcile_list:       { ms: 0, count: 0 },
      notify_subscribers:   { ms: 0, count: 0 },
      notify_value_indexed: { ms: 0, count: 0 },
      dom_write:            { ms: 0, count: 0 },
      effect_scheduling:    { ms: 0, count: 0 },
    }
  : null;
const __SCRML_PERF_NOW = (typeof performance !== "undefined" && performance.now)
  ? function () { return performance.now(); }
  : function () { return Date.now(); };
function _scrml_perf_reset() {
  if (!__SCRML_PERF) return;
  for (const k in __SCRML_PERF) {
    __SCRML_PERF[k].ms = 0;
    __SCRML_PERF[k].count = 0;
  }
}
function _scrml_perf_snapshot() {
  if (!__SCRML_PERF) return null;
  const out = {};
  for (const k in __SCRML_PERF) {
    const c = __SCRML_PERF[k].count;
    const ms = __SCRML_PERF[k].ms;
    out[k] = { ms: ms, count: c, avgMs: c > 0 ? ms / c : 0 };
  }
  return out;
}
function _scrml_perf_dump(label) {
  if (!__SCRML_PERF) return;
  const snap = _scrml_perf_snapshot();
  const tag = label ? " [" + label + "]" : "";
  for (const k in snap) {
    const s = snap[k];
    if (s.count === 0) continue;
    console.log(
      "[SCRML-RUNTIME]" + tag + " " + k + ": " +
      s.ms.toFixed(3) + " (" + s.count + " calls, " +
      s.avgMs.toFixed(4) + " avg-ms-per-call)"
    );
  }
}
if (typeof globalThis !== "undefined") {
  globalThis._scrml_perf_reset = _scrml_perf_reset;
  globalThis._scrml_perf_snapshot = _scrml_perf_snapshot;
  globalThis._scrml_perf_dump = _scrml_perf_dump;
}

// S79 / §6.13 reactivity attribute registries — hoisted to module top to
// avoid TDZ when _scrml_reactive_set (called early during module-init by
// state-decl substrates) consults them. Implementations of the helpers
// that READ these registries live further down in the utilities chunk.
const _scrml_reactivity_timers = Object.create(null);
const _scrml_reactivity_rules = Object.create(null);
const _scrml_reactivity_bypass = Object.create(null);
const _scrml_throttle_state = Object.create(null);

// --- derived reactive state (§6.6) ---
// _scrml_derived_fns: name → () => value  (evaluation function for each derived node)
// _scrml_derived_cache: name → cached value
// _scrml_derived_dirty: name → boolean  (true = needs re-evaluation on next read)
// _scrml_derived_downstreams: upstream_name → Set of derived names  (dirty propagation edges)
const _scrml_derived_fns = {};
const _scrml_derived_cache = {};
const _scrml_derived_dirty = {};
const _scrml_derived_downstreams = {};

// --- default= storage (§6.8) ---
// _scrml_default_fns: name → () => default-value
// Registered by _scrml_default_set at module-init alongside the cell
// declaration. Read by reset(@cell) lowering (C5) to materialize the default
// when reset is invoked. Per SPEC §6.8.1 the default is the EXPRESSION (not
// a snapshot), so the closure is re-evaluated each reset.
//
// Parallel map (separate from _scrml_state / _scrml_derived_fns) so the
// existing reactive registries keep their shape stability.
//
// NOTE: this declaration LIVES in the 'core' chunk (no marker) so file-init
// _scrml_default_set(...) calls always resolve. The runtime helper that
// USES this map (_scrml_reset) lives in the 'reset' chunk further down.
const _scrml_default_fns = {};
function _scrml_default_set(name, fn) {
  _scrml_default_fns[name] = fn;
}

// --- init-thunk storage (§6.8 — C5) ---
// _scrml_init_fns: name -> () => init-value
// Registered by _scrml_init_set at module-init for each Shape 1 / Shape 2
// state-cell that does NOT carry a "default" attribute.
//
// Same chunk policy as _scrml_default_fns: declaration lives in 'core' so
// file-init _scrml_init_set(...) calls always resolve. The using helper
// (_scrml_reset) lives in 'reset' and is tree-shaken when no reset(@cell)
// occurs in the source.
const _scrml_init_fns = {};
function _scrml_init_set(name, fn) {
  _scrml_init_fns[name] = fn;
}

// --- machine temporal transitions (§51.12) ---
// _scrml_machine_timers: encodedVarName → timeout id for the currently-armed
// temporal transition. Transition-guard codegen clears any existing timer on
// state commit and arms a new one if the destination variant has outgoing
// temporal rules. Re-entering the same variant clears and re-arms (reset
// semantics per the deep-dive default).
const _scrml_machine_timers = {};
function _scrml_machine_clear_timer(name) {
  const id = _scrml_machine_timers[name];
  if (id !== undefined) {
    clearTimeout(id);
    delete _scrml_machine_timers[name];
  }
}
function _scrml_machine_arm_timer(name, ms, target, meta) {
  // meta (optional): { fromVariant, label, auditTarget, rulesJson, setterFn, getterName }
  //   fromVariant — the .From of the temporal rule being armed (used to
  //     build the audit 'rule' key on expiry: fromVariant + ":" + target).
  //   label — the rule's guard label if any, else null. Temporal rules
  //     currently do not take 'given' clauses, so this is conventionally
  //     null; the slot exists so a future temporal+guard syntax can slot
  //     straight in.
  //   auditTarget — the encoded reactive-var name of the machine's audit
  //     target (the 'audit @log' clause in the machine body), else null.
  //   rulesJson — the serialized temporal-rule list so the timer can
  //     re-arm on the downstream variant. Chained temporal rules
  //     (A after 1s => B, B after 1s => C) must continue automatically
  //     without the user driving transitions.
  //   setterFn  — A5-4 (§51.0.M onTimeout): an optional callback invoked
  //     INSTEAD of the bare _scrml_reactive_set(name, target) at expiry.
  //     Engine onTimeout codegen passes a function that routes the write
  //     through the engine's rule= contract guard (the engine helper in
  //     the 'engine' chunk; see §51.0.F + §51.0.G). When absent (the
  //     legacy machine path), the original _scrml_reactive_set write is
  //     used.
  //   getterName — A5-4: the encoded reactive-var name to read for the
  //     __prev audit entry. Defaults to name. Currently unused — reserved
  //     so a future shape (e.g., audit-target read) can opt out.
  //
  // S27 (§51.11): timer-fired transitions now push audit entries and
  // re-arm downstream temporal rules. Previously the timer invoked a
  // bare _scrml_reactive_set, bypassing both the audit clause and the
  // per-transition re-arm logic. This violated §51.11.6 "every
  // successful transition SHALL append" for temporal rules.
  _scrml_machine_clear_timer(name);
  _scrml_machine_timers[name] = setTimeout(function () {
    delete _scrml_machine_timers[name];
    const __prev = _scrml_reactive_get(name);
    if (meta && typeof meta.setterFn === "function") {
      // A5-4: engine-aware setter (routes through the engine's contract
      // guard so the rule= contract check fires; throws
      // E-ENGINE-INVALID-TRANSITION if the timer target violates the
      // contract — defensive, the compile-time check in A5-3 should already
      // have caught this).
      meta.setterFn(target);
    } else {
      _scrml_reactive_set(name, target);
    }
    if (meta && meta.auditTarget) {
      const entry = Object.freeze({
        from: __prev,
        to: target,
        at: Date.now(),
        rule: meta.fromVariant + ":" + target,
        label: meta.label != null ? meta.label : null,
      });
      _scrml_reactive_set(
        meta.auditTarget,
        (_scrml_reactive_get(meta.auditTarget) || []).concat([entry])
      );
    }
    if (meta && meta.rulesJson) {
      _scrml_machine_arm_initial(name, meta.rulesJson, meta.auditTarget);
    }
  }, ms);
}
function _scrml_machine_arm_initial(name, rulesJson, auditTarget) {
  // Called once per machine-bound reactive after its initial _scrml_reactive_set,
  // and also re-invoked from _scrml_machine_arm_timer's expiry path so that
  // chained temporal rules auto-advance. Inspects the current variant and arms
  // the first matching temporal rule, if any.
  //
  // auditTarget (optional, added S27) propagates the machine's audit target
  // through the re-arm cascade so chained temporal transitions keep auditing.
  const val = _scrml_reactive_get(name);
  const variant = (val != null && typeof val === "object" && val.variant != null) ? val.variant : val;
  const rules = JSON.parse(rulesJson);
  for (const r of rules) {
    if (r.from === variant) {
      const meta = {
        fromVariant: r.from,
        label: r.label != null ? r.label : null,
        auditTarget: auditTarget != null ? auditTarget : null,
        rulesJson: rulesJson,
      };
      _scrml_machine_arm_timer(name, r.afterMs, r.to, meta);
      return;
    }
  }
}

// --- §51.14 replay primitive ---
// _scrml_replay(name, log, endIdx?) jumps the machine-bound reactive 'name'
// to the state recorded at index endIdx of the audit array 'log'. Bypasses
// the transition guard (§51.5) and the audit push (§51.11), clears any
// pending temporal timer (§51.12), and emits a standard _scrml_reactive_set
// so subscribers, derived propagation, and effects all fire normally.
//
// Semantics (per SPEC.md §51.14.3):
//   - endIdx > 0         → state lands at log[endIdx - 1].to
//   - endIdx == 0        → state lands at log[0].from (or no-op if empty)
//   - endIdx undefined   → state lands at log[log.length - 1].to (full replay)
//   - endIdx < 0 or > length → throws E-REPLAY-001-RT
function _scrml_replay(name, log, endIdx) {
  const n = (endIdx != null) ? endIdx : log.length;
  if (n < 0 || n > log.length) {
    throw new Error("E-REPLAY-001-RT: replay index " + n +
      " out of bounds for log of length " + log.length +
      ". Index SHALL be in the range [0, log.length].");
  }
  _scrml_machine_clear_timer(name);
  if (n === 0) {
    if (log.length === 0) return;  // empty-log no-op (nothing to replay)
    _scrml_reactive_set(name, log[0].from);
    return;
  }
  _scrml_reactive_set(name, log[n - 1].to);
}

function _scrml_reactive_get(name) {
  if (__SCRML_PERF) {
    const __t0 = __SCRML_PERF_NOW();
    // Bridge with _scrml_effect auto-tracking: record _scrml_state[name] as a dependency
    if (typeof _scrml_track === "function") _scrml_track(_scrml_state, name);
    let __r;
    if (_scrml_derived_fns[name]) __r = _scrml_derived_get(name);
    else __r = _scrml_state[name];
    __SCRML_PERF.reactive_get.ms += __SCRML_PERF_NOW() - __t0;
    __SCRML_PERF.reactive_get.count++;
    return __r;
  }
  // Bridge with _scrml_effect auto-tracking: record _scrml_state[name] as a dependency
  if (typeof _scrml_track === "function") _scrml_track(_scrml_state, name);
  // Derived reactives are stored in _scrml_derived_cache, not _scrml_state.
  // Delegate to _scrml_derived_get for lazy re-evaluation when dirty.
  if (_scrml_derived_fns[name]) return _scrml_derived_get(name);
  return _scrml_state[name];
}

// markup-as-value display (§1.4/§7.4 Pillar 1) — node-aware interpolation.
// A markup-typed interpolation value is a real DOM node (built by the markup-value
// codegen: createElement + appendChild). Assigning a node to el.textContent would
// stringify it to "[object HTMLSpanElement]"; render it into the element instead.
// String / primitive values keep the byte-identical textContent path (null/undefined
// become "" per scrml's absence model — "" is itself a defined value and stringifies).
function _scrml_render_value(el, v) {
  if (v instanceof Node) {
    el.replaceChildren(v);
  } else {
    el.textContent = (v == null ? "" : String(v));
  }
}

function _scrml_reactive_set(name, value) {
  const __t_set_top = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
  // S79 / §6.13 — when a reactivity rule is registered for the cell, route
  // the write through the timing wrapper. Guarded so cells without a rule
  // (the common case) take zero overhead beyond a single property lookup.
  // The bypass-flag avoids infinite recursion (the timer helpers eventually
  // call back into _scrml_reactive_set with the resolved value).
  if (typeof _scrml_reactivity_rules === "object" && _scrml_reactivity_rules[name] && !_scrml_reactivity_bypass[name]) {
    const rule = _scrml_reactivity_rules[name];
    _scrml_reactivity_bypass[name] = true;
    try {
      if (rule.kind === "debounced") {
        _scrml_reactive_debounced(name, function () { return value; }, rule.ms);
      } else if (rule.kind === "throttled") {
        _scrml_reactive_throttled(name, function () { return value; }, rule.ms);
      } else {
        // Unknown rule kind — defensive: fall through to immediate set.
        const __oldValue_def = _scrml_state[name];
        _scrml_state[name] = value;
        const dirtied = _scrml_propagate_dirty(name);
        if (_scrml_subscribers[name]) {
          const __t_sub = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
          for (const fn of _scrml_subscribers[name]) {
            try { fn(value); } catch(e) { console.error("scrml subscriber error:", e); }
          }
          if (__SCRML_PERF) {
            __SCRML_PERF.notify_subscribers.ms += __SCRML_PERF_NOW() - __t_sub;
            __SCRML_PERF.notify_subscribers.count++;
          }
        }
        // S103 Phase 3 select-row chip-away — value-indexed fan-out
        if (_scrml_value_indexed_subscribers[name]) {
          const __t_vi = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
          _scrml_notify_value_indexed(name, __oldValue_def, value);
          if (__SCRML_PERF) {
            __SCRML_PERF.notify_value_indexed.ms += __SCRML_PERF_NOW() - __t_vi;
            __SCRML_PERF.notify_value_indexed.count++;
          }
        }
        if (typeof _scrml_trigger === "function") _scrml_trigger(_scrml_state, name);
        if (dirtied && dirtied.length > 0 && typeof _scrml_trigger === "function") {
          for (const derived of dirtied) _scrml_trigger(_scrml_state, derived);
        }
      }
    } finally {
      _scrml_reactivity_bypass[name] = false;
    }
    if (__SCRML_PERF) {
      __SCRML_PERF.reactive_set.ms += __SCRML_PERF_NOW() - __t_set_top;
      __SCRML_PERF.reactive_set.count++;
    }
    return value;
  }
  // S103 Phase 3 select-row chip-away — capture OLD value BEFORE the write
  // so value-indexed dispatch can fan out the OLD-value bucket alongside the
  // NEW-value bucket. Cheap read; never null-throws because _scrml_state is
  // a plain object initialized at runtime-template load.
  const __oldValue = _scrml_state[name];
  _scrml_state[name] = value;
  // §6.6.3 Phase 2: eagerly propagate dirty flags to all downstream derived nodes
  // before subscribers fire and before this call returns. Synchronous, no re-evaluation.
  const dirtied = _scrml_propagate_dirty(name);
  if (_scrml_subscribers[name]) {
    const __t_sub = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
    for (const fn of _scrml_subscribers[name]) {
      try { fn(value); } catch(e) { console.error("scrml subscriber error:", e); }
    }
    if (__SCRML_PERF) {
      __SCRML_PERF.notify_subscribers.ms += __SCRML_PERF_NOW() - __t_sub;
      __SCRML_PERF.notify_subscribers.count++;
    }
  }
  // S103 Phase 3 select-row chip-away — value-indexed fan-out. Fires only the
  // OLD-value bucket + NEW-value bucket; predicate-shape binds emitted by
  // emit-lift.js register here instead of the LEGACY _scrml_subscribers when
  // detectPredicateShapeBind matches. O(2) per write instead of O(N) over all
  // rows.
  if (_scrml_value_indexed_subscribers[name]) {
    const __t_vi = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
    _scrml_notify_value_indexed(name, __oldValue, value);
    if (__SCRML_PERF) {
      __SCRML_PERF.notify_value_indexed.ms += __SCRML_PERF_NOW() - __t_vi;
      __SCRML_PERF.notify_value_indexed.count++;
    }
  }
  // Bridge with _scrml_effect auto-tracking: fire effects tracking _scrml_state[name]
  if (typeof _scrml_trigger === "function") _scrml_trigger(_scrml_state, name);
  // Also trigger effects for derived nodes that were dirtied — they need to
  // re-evaluate and update any DOM bindings that read them.
  if (dirtied && dirtied.length > 0 && typeof _scrml_trigger === "function") {
    for (const derived of dirtied) {
      _scrml_trigger(_scrml_state, derived);
    }
  }
  if (__SCRML_PERF) {
    __SCRML_PERF.reactive_set.ms += __SCRML_PERF_NOW() - __t_set_top;
    __SCRML_PERF.reactive_set.count++;
  }
  return value;
}

// S79 / §6.13 — _scrml_reactivity_bypass is declared at the top of the
// runtime (next to _scrml_state) for TDZ safety; the bypass map short-
// circuits the timing wrapper when the timer helper itself calls back
// into _scrml_reactive_set, avoiding infinite recursion.

/**
 * Propagate dirty flags from a written upstream name to all downstream derived nodes.
 * Also propagates transitively: if A → B → C, writing A dirties B and C.
 * Uses iterative BFS to avoid stack overflow on deep chains.
 * @param {string} name — the upstream variable name that was just written
 */
function _scrml_propagate_dirty(name) {
  const queue = [name];
  const visited = new Set();
  const dirtied = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const downstreams = _scrml_derived_downstreams[current];
    if (downstreams) {
      for (const derived of downstreams) {
        if (!_scrml_derived_dirty[derived]) {
          _scrml_derived_dirty[derived] = true;
          dirtied.push(derived);
          // Also propagate from this derived node to its downstreams
          queue.push(derived);
        }
      }
    }
  }
  return dirtied;
}

/**
 * Subscribe fn to reactive changes for name.
 * Returns an unsubscribe function that, when called, removes fn from the subscriber list.
 * Required by _scrml_meta_effect for dependency cleanup between re-runs.
 *
 * @param {string} name — reactive variable name (without @ prefix)
 * @param {function} fn — subscriber callback, called with (newValue) on each set
 * @returns {() => void} unsubscribe function
 */
function _scrml_reactive_subscribe(name, fn) {
  if (!_scrml_subscribers[name]) _scrml_subscribers[name] = [];
  _scrml_subscribers[name].push(fn);
  return () => {
    const subs = _scrml_subscribers[name];
    if (subs) {
      const idx = subs.indexOf(fn);
      if (idx !== -1) subs.splice(idx, 1);
    }
  };
}

// S103 Phase 3 select-row chip-away — value-indexed subscription.
//
// Derive a stable property-key string for a primitive valueKey. The key must
// distinguish "5" from 5 and "true" from true so the wrong bucket never gets
// fired. JSON-style type prefixing is sufficient for the supported scope
// (string / number / boolean / null / undefined).
//
// Non-primitive values (objects, arrays, functions) MUST NOT reach here —
// the codegen detector rejects shapes that could yield a non-primitive
// valueKey at registration time. Defensive fallback uses String(v) so the
// runtime never throws, but the registration is effectively useless because
// object identity isn't stable across closures.
function _scrml_value_indexed_key(v) {
  if (v === null || v === undefined) return "\\u0000n";
  const t = typeof v;
  if (t === "string") return "s:" + v;
  if (t === "number") return "n:" + v;
  if (t === "boolean") return v ? "b:1" : "b:0";
  // Defensive fallback — not a supported registration path.
  return "x:" + String(v);
}

/**
 * Register fn under (name, valueKey) so it only fires when _scrml_reactive_set
 * for 'name' touches the OLD-value === valueKey OR the NEW-value === valueKey
 * bucket. Mirrors _scrml_reactive_subscribe's unsubscribe-closure shape.
 *
 * @param {string} name — reactive variable name (without @ prefix)
 * @param {string|number|boolean|null|undefined} valueKey — the constant the
 *     bind expression compares the cell to; must be a primitive that survives
 *     _scrml_value_indexed_key() stable derivation
 * @param {function} fn — subscriber callback, called with (newValue) when the
 *     bucket fires (same shape as _scrml_reactive_subscribe)
 * @returns {() => void} unsubscribe function
 */
function _scrml_reactive_subscribe_when(name, valueKey, fn) {
  const key = _scrml_value_indexed_key(valueKey);
  let nameMap = _scrml_value_indexed_subscribers[name];
  if (!nameMap) {
    nameMap = {};
    _scrml_value_indexed_subscribers[name] = nameMap;
  }
  let bucket = nameMap[key];
  if (!bucket) {
    bucket = [];
    nameMap[key] = bucket;
  }
  bucket.push(fn);
  return () => {
    const nm = _scrml_value_indexed_subscribers[name];
    if (!nm) return;
    const b = nm[key];
    if (!b) return;
    const idx = b.indexOf(fn);
    if (idx !== -1) b.splice(idx, 1);
    if (b.length === 0) delete nm[key];
  };
}

// Fire the OLD-value bucket + NEW-value bucket for 'name' (predicate-shape
// dispatch). Called from _scrml_reactive_set after the LEGACY fan-out.
// Bucket entries fire in registration order. Each fn is invoked with
// (newValue) for shape parity with the LEGACY callback contract — note that
// for OLD-bucket subscribers, the predicate result was previously true and
// has now flipped to false (the row that WAS editing is no longer editing).
// The subscriber recomputes its full predicate from current cell state on
// each call so the (newValue) argument is informational, not load-bearing.
function _scrml_notify_value_indexed(name, oldValue, newValue) {
  const nameMap = _scrml_value_indexed_subscribers[name];
  if (!nameMap) return;
  const oldKey = _scrml_value_indexed_key(oldValue);
  const newKey = _scrml_value_indexed_key(newValue);
  const oldBucket = nameMap[oldKey];
  if (oldBucket) {
    // Snapshot length to avoid disturbance from subscribers that mutate the
    // bucket during fire (e.g. via unsubscribe).
    const len = oldBucket.length;
    for (let i = 0; i < len; i++) {
      const fn = oldBucket[i];
      if (!fn) continue;
      try { fn(newValue); } catch(e) { console.error("scrml value-indexed subscriber error:", e); }
    }
  }
  // Skip the new bucket when keys collide (no-op write) — fires the same
  // subscribers twice otherwise.
  if (newKey !== oldKey) {
    const newBucket = nameMap[newKey];
    if (newBucket) {
      const len = newBucket.length;
      for (let i = 0; i < len; i++) {
        const fn = newBucket[i];
        if (!fn) continue;
        try { fn(newValue); } catch(e) { console.error("scrml value-indexed subscriber error:", e); }
      }
    }
  }
}

/**
 * RETIRED: _scrml_reactive_derived was the non-conformant stub from before §6.6.
 * It evaluated once at declaration time and registered no subscriptions.
 * It is superseded by _scrml_derived_declare + _scrml_derived_subscribe per §6.6.7.
 * Any compiled output calling this function was produced by an old compiler and must
 * be recompiled.
 */
function _scrml_reactive_derived(name, fn) {
  throw new Error(
    "scrml runtime: _scrml_reactive_derived is retired (§6.6). " +
    "Recompile this file with the current compiler to use _scrml_derived_declare."
  );
}

// ---------------------------------------------------------------------------
// §57 Wire Format dual-decoder (chunk: 'wire')
// ---------------------------------------------------------------------------
// --- §57 Wire Format dual-decoder (M-7C-D-12 Track 2) ---
// Accepts BOTH the canonical envelope { __scrml_absent: true } (encoder
// always emits this) AND raw JSON null (legacy / pre-v0.3 / foreign-client).
// Both lower to scrml \`not\` (JS null per §42.5 / §42.8). Any other value
// passes through unchanged. Dual-decoder retires at v1.0 (OQ-4 (a)).
//
// v0.3.x SPA tree-shake (Phase B 3.2): the dual-decoder moved out of
// 'core' into the dedicated 'wire' chunk so SPA-shape compile units
// (no server-fns + no \`use foreign:\` use-decls) ship without it.
// Activated by \`emit-client.ts:detectRuntimeChunks\` when ANY file in
// the compile unit contains a server \`function-decl\` OR a \`use foreign:\`
// use-decl. The chunk-side reference sites are the server-fn fetch
// stubs emitted by \`emit-functions.ts\` and \`atom-emitter.ts\`.
function _scrml_wire_decode(value) {
  if (value === null) return null;
  if (value !== null && typeof value === "object" && value.__scrml_absent === true) return null;
  return value;
}

// ---------------------------------------------------------------------------
// §6.8 reset+default runtime (chunk: 'reset')
// ---------------------------------------------------------------------------

// _scrml_reset(name) — SPEC §6.8.2 reset(@cell) keyword runtime.
//
// Three target shapes (per SPEC §6.8.2 lines 4848-4853):
//   - reset(@cell)            top-level cell or compound child by direct name
//   - reset(@compound)        whole compound (walks every child, declaration order)
//   - reset(@compound.field)  single compound child by qualified path (multi-level OK)
//
// Codegen passes the cell's encoded storage key (the same key used by
// _scrml_reactive_set / _scrml_default_set / _scrml_init_set). This helper
// consults the registries to decide:
//
//   1. Default thunk wins: if _scrml_default_fns[name] exists, evaluate it
//      and write the result via _scrml_reactive_set. (§6.8.2 line 4857.)
//   2. Otherwise init thunk: if _scrml_init_fns[name] exists, evaluate it
//      and write the result. (§6.8.1 line 4831.)
//   3. Otherwise compound walk: if neither thunk exists, treat name as a
//      compound parent and recursively reset every registered cell whose
//      key starts with name + dot. ECMAScript object-key-iteration order
//      preserves insertion order, and codegen registers compound children
//      in declaration order, so the walk respects §6.8.2 line 4863's
//      declaration-order requirement.
//   4. Otherwise no-op (defensive: unknown name, e.g. a future engine cell
//      whose B22 didn't reject — silent rather than throwing).
function _scrml_reset(name) {
  // S79 / §6.13 — cancel any pending debounced/throttled timer for this cell
  // BEFORE applying the reset value. The cancel-then-apply ordering ensures
  // a freshly-reset value isn't subsequently overwritten by an in-flight
  // debounced/throttled write. Guard the call so reset() on cells without
  // reactivity attributes (the common case) is a no-op + zero allocation.
  if (typeof _scrml_reactivity_cancel === "function") {
    _scrml_reactivity_cancel(name);
  }
  // Also clear any held throttle pending value so a delayed trailing-fire
  // (currently armed timer cancelled above) doesn't reappear on the next
  // throttled write within the window.
  if (typeof _scrml_throttle_state === "object" && _scrml_throttle_state[name]) {
    _scrml_throttle_state[name].pending = null;
  }
  // Default thunk wins per §6.8.2 line 4857.
  if (typeof _scrml_default_fns[name] === "function") {
    _scrml_reactive_set(name, _scrml_default_fns[name]());
    return;
  }
  // Otherwise re-evaluate init thunk per §6.8.1 line 4831.
  if (typeof _scrml_init_fns[name] === "function") {
    _scrml_reactive_set(name, _scrml_init_fns[name]());
    return;
  }
  // Otherwise: treat as a compound parent — walk every registered child
  // (key starts with name followed by a dot). Iteration order is insertion
  // order per ECMAScript 2015+ semantics; codegen emits children in
  // declaration order so this respects §6.8.2 line 4863.
  const prefix = name + ".";
  // Collect first to avoid mutation-during-iteration concerns when a child
  // reset writes through _scrml_reactive_set and triggers subscribers.
  const childKeys = [];
  for (const k of Object.keys(_scrml_init_fns)) {
    if (k.indexOf(prefix) === 0) childKeys.push(k);
  }
  for (const k of Object.keys(_scrml_default_fns)) {
    if (k.indexOf(prefix) === 0 && childKeys.indexOf(k) === -1) childKeys.push(k);
  }
  for (const k of childKeys) {
    _scrml_reset(k);
  }
  // No children + no thunk -> silent no-op (defensive).
}

// ---------------------------------------------------------------------------
// §55.1 Validator predicate runtime catalog (chunk: 'validators')
// ---------------------------------------------------------------------------
// The 14 universal-core validator predicates per SPEC §55.1 — same fire
// functions exported by compiler/src/runtime-validators.js (C6 land), inlined
// here verbatim (sans \`export\` keywords) for the compiled client runtime.
// C7's per-cell validator runner emits calls into _scrml_validator_fire below.
//
// Chunk-detection trigger: any state-decl whose validators[] array is
// non-empty (see emit-client.ts:detectRuntimeChunks). When no validators are
// declared in the source file, this chunk is tree-shaken out entirely.
${_VALIDATOR_RUNTIME_SOURCE}
// _scrml_validator_fire — thin alias matching the C7 codegen call shape.
// Distinct name from \`fireValidator\` so the runtime export surface is clearly
// scoped to the runtime (and so the C7 emitted code isn't tightly coupled to
// the C6 module's internal naming).
function _scrml_validator_fire(name, value, ...args) {
  return fireValidator(name, value, ...args);
}

// ---------------------------------------------------------------------------
// §6.6 Derived reactive runtime
// ---------------------------------------------------------------------------

/**
 * Register a derived reactive node.
 * Marks the node dirty so its first read triggers evaluation (§6.6.3 initial eval).
 *
 * @param {string} name — the derived value name (without @ prefix)
 * @param {() => *} fn — the evaluation function; reads upstream _scrml_reactive_get / _scrml_derived_get calls
 */
function _scrml_derived_declare(name, fn) {
  _scrml_derived_fns[name] = fn;
  _scrml_derived_cache[name] = undefined;
  _scrml_derived_dirty[name] = true; // §6.6.3: initial state is dirty
}

/**
 * Register a dirty-propagation edge: when upstream is written, derived is marked dirty.
 * Called once per upstream @variable reference in the derived expression at startup.
 *
 * @param {string} derived — the derived value name
 * @param {string} upstream — the upstream @variable name (or upstream derived name)
 */
function _scrml_derived_subscribe(derived, upstream) {
  if (!_scrml_derived_downstreams[upstream]) {
    _scrml_derived_downstreams[upstream] = new Set();
  }
  _scrml_derived_downstreams[upstream].add(derived);
}

/**
 * Read a derived reactive value. Implements lazy pull with dirty flags (§6.6.3 Phase 3).
 *
 * - If dirty: clear flag (before eval, per §6.6.4 re-entrance prevention), re-evaluate,
 *   cache, return cached value.
 * - If clean: return cached value immediately without re-evaluation.
 *
 * @param {string} name — the derived value name
 * @returns {*} the (possibly freshly evaluated) value
 */
function _scrml_derived_get(name) {
  // Bug 1 fix-D (S88 dispatch — 14-mario): track the derived name itself as
  // a dependency on the current effect. Without this, if the derived was
  // already evaluated (dirty=false) before the effect's first run, the body
  // path below short-circuits and the inner fn() never runs — meaning the
  // derived's upstream @-refs are never tracked AND the derived name itself
  // is never tracked. Result: an effect like
  //   _scrml_effect(() => el.textContent = _scrml_derived_get("marioName"));
  // ends up with EMPTY deps and never re-runs when marioState writes fire.
  //
  // _scrml_propagate_dirty already fires _scrml_trigger(_scrml_state, derived)
  // for each dirtied derived; tracking the derived name here completes the
  // contract so trigger has effects to wake. (Reactive cells already track
  // via _scrml_reactive_get; this closes the parity gap for derived cells.)
  if (typeof _scrml_track === "function") _scrml_track(_scrml_state, name);
  if (_scrml_derived_dirty[name]) {
    // §6.6.4: clear dirty flag BEFORE evaluating to prevent re-entrant re-evaluation
    _scrml_derived_dirty[name] = false;
    const fn = _scrml_derived_fns[name];
    if (fn) {
      _scrml_derived_cache[name] = fn();
    }
  }
  return _scrml_derived_cache[name];
}

/**
 * flush() — synchronous re-evaluation of all dirty derived nodes (§6.6.5).
 *
 * Forces all dirty derived nodes to re-evaluate immediately, before returning.
 * After flush() returns: all dirty flags are cleared and all cached values reflect
 * the most recent upstream writes.
 *
 * Uses lazy pull semantics: calls _scrml_derived_get on each dirty node, which
 * recursively pulls its dirty dependencies first. This naturally handles derived-of-derived
 * chains and diamond dependencies without requiring topological sort.
 *
 * Valid inside any logic context (\${} blocks) and any function body.
 * NOT valid inside a derived expression (E-REACTIVE-004 — checked at compile time).
 */
function flush() {
  // Collect all currently dirty names before iterating (snapshot).
  // New dirtiness caused by evaluation is handled by the recursive lazy pull
  // inside _scrml_derived_get — those nodes will be evaluated when read.
  const dirtyNames = Object.keys(_scrml_derived_dirty).filter(k => _scrml_derived_dirty[k]);
  for (const name of dirtyNames) {
    _scrml_derived_get(name);
  }
}

/**
 * Lift a DOM element (or factory function) into the nearest lift target.
 *
 * Accepts:
 *   _scrml_lift(factory)   — factory is () => Element, called to create the element
 *   _scrml_lift(element)   — element is a pre-created DOM node (for backward compat)
 *
 * The element is appended to the nearest [data-scrml-lift-target] ancestor, or
 * document.body as a fallback.
 */
function _scrml_lift(factoryOrElement) {
  const container = _scrml_lift_target || document.querySelector("[data-scrml-lift-target]") || document.body;
  const el = typeof factoryOrElement === "function" ? factoryOrElement() : factoryOrElement;
  if (el) container.appendChild(el);
}
// Shared lift-target ambient — MUST stay INSIDE the 'lift' chunk (runtime-chunks.ts
// marker = 'function _scrml_lift', the chunk runs to the next marker). Declared AFTER
// the function so this decl travels WITH the chunk that reads it. In an SPA build the
// previous chunk is tree-shaken; a decl placed BEFORE the marker vanishes and the
// first dynamic <each> insert throws "_scrml_lift_target is not defined" (GitHub #19).
// Module scope (not function scope) is required: generated client code assigns it via
// a bare _scrml_lift_target = ... (emit-reactive-wiring.ts); _scrml_lift reads it by
// closure at call-time (after module init, so no TDZ issue).
let _scrml_lift_target = null;

// ---------------------------------------------------------------------------
// §6.7.3 Scope-aware cleanup registry
// ---------------------------------------------------------------------------

const _scrml_cleanup_registry = new Map();

function _scrml_register_cleanup(fn, scopeId) {
  if (!scopeId) { window.addEventListener("beforeunload", fn); return; }
  if (!_scrml_cleanup_registry.has(scopeId)) _scrml_cleanup_registry.set(scopeId, []);
  _scrml_cleanup_registry.get(scopeId).push(fn);
}

function _scrml_destroy_scope(scopeId) {
  // Step 1: Run cleanup callbacks in LIFO order (§6.7.3)
  const callbacks = _scrml_cleanup_registry.get(scopeId) || [];
  for (let i = callbacks.length - 1; i >= 0; i--) callbacks[i]();
  _scrml_cleanup_registry.delete(scopeId);

  // Step 2: Stop all timers for this scope (§6.7.2, step 2)
  _scrml_stop_scope_timers(scopeId);

  // Step 4: Cancel all pending animation frames for this scope (§6.7.2, step 4)
  _scrml_cancel_animation_frames(scopeId);
}

// ---------------------------------------------------------------------------
// §6.7.2 / §17.1 if= mount/unmount runtime (Phase 2 of if/show split)
//
// _scrml_create_scope:        fresh scopeId for a mount cycle
// _scrml_mount_template:      clone <template id="..."> content, insert before
//                             a marker comment, return the mounted root node
// _scrml_unmount_scope:       destroy scope (LIFO cleanup, stop timers, cancel
//                             rAF) AND remove the mounted root from the DOM
//
// On each false → true transition of an if= condition, a fresh scope is
// created and the template is cloned and mounted. On each true → false,
// the scope is destroyed and the DOM nodes are removed. This satisfies
// SPEC §6.7.2 (scope-as-lifecycle-boundary, depth-first teardown, LIFO
// cleanup, remount re-runs bare expressions).
// ---------------------------------------------------------------------------

let _scrml_scope_counter = 0;

function _scrml_create_scope() {
  return "if_" + (++_scrml_scope_counter);
}

/**
 * Find the comment marker matching \`scrml-if-marker:N (HTML comment)\` in the document.
 * Returns the Comment node, or null if not found.
 *
 * Implementation: a TreeWalker over comment nodes is the cheapest scan when
 * the marker count is small. For larger documents the markers can be looked
 * up via a compile-time-emitted Map; deferred to a later sub-phase.
 */
function _scrml_find_if_marker(markerId, scope) {
  // M1 Phase 2/3 — search within scope (default document.body). A soft-nav
  // rehydrate passes the swapped outlet root so a re-invoked if= controller finds
  // the NEW region's marker, never a same-id marker elsewhere.
  const rootNode = (scope && (scope.nodeType === 1 || scope.nodeType === 11)) ? scope : document.body;
  if (!rootNode) return null;
  const needle = "scrml-if-marker:" + markerId;
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_COMMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.trim() === needle) return node;
  }
  return null;
}

/**
 * Mount: clone the template content, insert it before the marker
 * comment, and return the inserted root element.
 *
 * The caller is responsible for running any per-mount wiring (event
 * listeners, reactive subscriptions, lifecycle bare-expressions) under the
 * given scopeId. This function does only the DOM insertion; wiring is the
 * compile-time-emitted controller's job.
 *
 * @param {string} markerId — N from scrml-if-marker:N marker comment
 * @param {string} templateId — id of the template element holding the source
 * @returns {HTMLElement|null} — the mounted root element, or null on failure
 */
function _scrml_mount_template(markerId, templateId, scope) {
  const marker = _scrml_find_if_marker(markerId, scope);
  if (!marker || !marker.parentNode) return null;
  const tpl = document.getElementById(templateId);
  if (!tpl || !(tpl.content instanceof DocumentFragment)) return null;
  const fragment = tpl.content.cloneNode(true);
  // The mounted root is the first element child of the cloned fragment.
  // The compile-time emitter is responsible for wrapping the if= element
  // as the sole element child of the <template>.
  const root = fragment.firstElementChild;
  marker.parentNode.insertBefore(fragment, marker);
  return root;
}

/**
 * Unmount: destroy the scope (cleanup LIFO, stop timers, cancel rAF) and
 * remove the mounted root from the DOM.
 *
 * @param {HTMLElement|null} root — node returned by _scrml_mount_template
 * @param {string} scopeId — scope to destroy
 */
function _scrml_unmount_scope(root, scopeId) {
  if (scopeId) _scrml_destroy_scope(scopeId);
  if (root && root.parentNode) root.parentNode.removeChild(root);
}

// ---------------------------------------------------------------------------
// §6.7.5 / §6.7.6 Timer and Poll runtime
// ---------------------------------------------------------------------------

/**
 * Timer registry: scopeId → Map<timerId, { handle, intervalMs, bodyFn, paused }>
 * - handle: the setInterval return value (null when paused)
 * - paused: true when the timer is suspended
 */
const _scrml_timer_registry = new Map();

/**
 * Start an interval timer and register it under scopeId + timerId.
 * Called at element mount time from compiled output.
 *
 * Phase 2 async tick strategy (SPEC-ISSUE-012 safe default):
 *   Queue ticks — if a tick is in-flight, the next tick waits until it completes.
 *
 * @param {string} scopeId — compile-time generated scope identifier
 * @param {string} timerId — compile-time generated or user-supplied id
 * @param {number} intervalMs — tick interval in milliseconds (must be > 0)
 * @param {function} bodyFn — function to call on each tick
 */
function _scrml_timer_start(scopeId, timerId, intervalMs, bodyFn) {
  if (!_scrml_timer_registry.has(scopeId)) {
    _scrml_timer_registry.set(scopeId, new Map());
  }
  const scopeTimers = _scrml_timer_registry.get(scopeId);

  // If a timer with this ID already exists in this scope, stop it first
  if (scopeTimers.has(timerId)) {
    _scrml_timer_stop(scopeId, timerId);
  }

  let tickInFlight = false;

  async function tick() {
    // Queue tick: skip if previous async tick still running
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const result = bodyFn();
      // If bodyFn returns a Promise (async server call), await it
      if (result && typeof result.then === "function") {
        await result;
      }
    } catch (e) {
      console.error("scrml timer tick error:", e);
    } finally {
      tickInFlight = false;
    }
  }

  const handle = setInterval(tick, intervalMs);

  scopeTimers.set(timerId, { handle, intervalMs, bodyFn, paused: false, tickInFlight: false });
}

/**
 * Stop a timer (clearInterval) and remove it from the registry.
 *
 * @param {string} scopeId
 * @param {string} timerId
 */
function _scrml_timer_stop(scopeId, timerId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  const entry = scopeTimers.get(timerId);
  if (!entry) return;
  if (entry.handle !== null) clearInterval(entry.handle);
  scopeTimers.delete(timerId);
  if (scopeTimers.size === 0) _scrml_timer_registry.delete(scopeId);
}

/**
 * Pause a timer (stop the interval but keep the registry entry for resume).
 * In-flight async ticks complete before the timer is considered paused (§EC-3).
 *
 * @param {string} scopeId
 * @param {string} timerId
 */
function _scrml_timer_pause(scopeId, timerId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  const entry = scopeTimers.get(timerId);
  if (!entry || entry.paused) return;
  if (entry.handle !== null) clearInterval(entry.handle);
  entry.handle = null;
  entry.paused = true;
}

/**
 * Resume a paused timer. The interval restarts from the moment of resumption
 * (§6.7.5: "does not fire immediately on resume").
 *
 * @param {string} scopeId
 * @param {string} timerId
 */
function _scrml_timer_resume(scopeId, timerId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  const entry = scopeTimers.get(timerId);
  if (!entry || !entry.paused) return;

  let tickInFlight = false;

  async function tick() {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const result = entry.bodyFn();
      if (result && typeof result.then === "function") await result;
    } catch (e) {
      console.error("scrml timer tick error:", e);
    } finally {
      tickInFlight = false;
    }
  }

  entry.handle = setInterval(tick, entry.intervalMs);
  entry.paused = false;
}

/**
 * Stop all timers for a given scope (called by _scrml_destroy_scope, step 2).
 *
 * @param {string} scopeId
 */
function _scrml_stop_scope_timers(scopeId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  for (const [, entry] of scopeTimers) {
    if (entry.handle !== null) clearInterval(entry.handle);
  }
  _scrml_timer_registry.delete(scopeId);
}

// ---------------------------------------------------------------------------
// §6.7.7 animationFrame runtime
// ---------------------------------------------------------------------------

/**
 * Animation frame registry: scopeId → Set<requestId>
 * Tracks pending rAF handles for scope-aware cancellation on destroy.
 */
const _scrml_raf_registry = new Map();

/**
 * Schedule fn via requestAnimationFrame, registering the handle for scope teardown.
 *
 * animationFrame callbacks are NOT reactive subscribers (§6.7.7). Reads of
 * @variables inside the callback return the current value at frame time and
 * do NOT create reactive subscriptions.
 *
 * The global-accessible \`animationFrame\` function (defined below) delegates to this.
 *
 * @param {function} fn — the frame callback
 * @param {string} [scopeId] — optional scope for cancellation; if absent, global scope
 * @returns {number} the requestAnimationFrame handle
 */
function _scrml_animation_frame(fn, scopeId) {
  const rafId = requestAnimationFrame(fn);
  if (scopeId) {
    if (!_scrml_raf_registry.has(scopeId)) {
      _scrml_raf_registry.set(scopeId, new Set());
    }
    _scrml_raf_registry.get(scopeId).add(rafId);
  }
  return rafId;
}

/**
 * Cancel all pending animation frames for a given scope.
 * Called by _scrml_destroy_scope (step 4).
 *
 * @param {string} scopeId
 */
function _scrml_cancel_animation_frames(scopeId) {
  const rafIds = _scrml_raf_registry.get(scopeId);
  if (!rafIds) return;
  for (const rafId of rafIds) {
    cancelAnimationFrame(rafId);
  }
  _scrml_raf_registry.delete(scopeId);
}

/**
 * animationFrame(fn) — compiler-recognized built-in (§6.7.7).
 *
 * Schedules fn via requestAnimationFrame. When called from compiled scrml code,
 * this function is called directly (since animationFrame is in the KEYWORDS set,
 * compiled output contains \`animationFrame(fn)\` which calls this runtime function).
 *
 * NOTE: This function does NOT register @variable reactive subscriptions for reads
 * inside the callback. That is by design — animation loops run on frame timing,
 * not on reactive change events.
 *
 * @param {function} fn — the frame callback
 * @returns {number} the requestAnimationFrame handle
 */
function animationFrame(fn) {
  return _scrml_animation_frame(fn);
}

/**
 * Keyed DOM reconciliation for reactive for/lift loops (§6.5 optimization).
 *
 * Instead of clearing innerHTML and rebuilding all children on every reactive
 * update, this function diffs by key: reuses existing DOM nodes for items that
 * are still present, only creates nodes for new items, and removes nodes for
 * deleted items.
 *
 * @param {HTMLElement} container — the wrapper div that holds the list items
 * @param {Array} newItems — the new array of items to render
 * @param {function} keyFn — (item, index) => key — extracts a stable key from each item
 * @param {function} createFn — (item, index) => HTMLElement — creates a DOM node for a new item
 */
function _scrml_reconcile_list(container, newItems, keyFn, createFn) {
  const __t_rec_top = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
  // Defensive: tolerate an undefined / not-yet-initialized collection. The each
  // render fn can run once at module-init BEFORE the source cell's
  // _scrml_reactive_set(...) runs (same-file cell-init ordering), so newItems may
  // be undefined on the first call. Treat absence as the empty list (render
  // nothing); the each effect re-runs this once the cell-init fires. Also covers a
  // non-array value defensively. Without this, the newItems.length read below throws.
  if (!Array.isArray(newItems)) newItems = [];

  // Bug 64 (S159) — per-item content reactivity on reconcile. Build a fresh
  // key->item map on EVERY pass (before any fast-path bail) so per-item effects
  // (live-keyed text / class: / attr interpolation, created inside createFn)
  // resolve the CURRENT item for their create-time key via
  // _scrml_resolve_item(container, key). Without this, a same-key reconcile
  // (array-replace with stable ids, reorder, or the B2 no-op bail) leaves those
  // effects reading a create-time snapshot item — stale content. The map build
  // is O(n) per ACTUAL reconcile pass (same order as the diff itself) and does
  // NOT re-create nodes; Fast-path-B2 below still bails on a no-op.
  // Compute the key for every item ONCE here (the only keyFn pass for this
  // reconcile call). The map build, the B2 same-order check, and the LIS path
  // all reuse this \`newKeys\` array instead of re-invoking keyFn — so the total
  // keyFn-call count is exactly N per pass, not 2N/3N.
  const _prevItemMap = container._scrml_item_by_key;
  const newLen = newItems.length;
  const newKeys = new Array(newLen);
  const _itemMap = new Map();
  for (let _k = 0; _k < newLen; _k++) {
    const _kk = keyFn(newItems[_k], _k);
    newKeys[_k] = _kk;
    _itemMap.set(_kk, newItems[_k]);
  }
  container._scrml_item_by_key = _itemMap;
  // Re-fire per-item effects subscribed to this container's item slot so reused
  // nodes resolve the new item BY KEY. Skip the very first pass (no prior map):
  // createFn below creates each effect, which runs once on creation. On an
  // array-replace / reorder the array CELL change already re-ran the list effect
  // (which called us); this trigger propagates that to the per-item effects.
  if (_prevItemMap !== undefined) _scrml_trigger(container, "_scrml_items");
  // Fast path: clear all — avoid iterating old nodes one by one
  if (newItems.length === 0) {
    if (__SCRML_PERF) {
      const __t_dw = __SCRML_PERF_NOW();
      container.replaceChildren();
      __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
      __SCRML_PERF.dom_write.count++;
      __SCRML_PERF.reconcile_list.ms += __SCRML_PERF_NOW() - __t_rec_top;
      __SCRML_PERF.reconcile_list.count++;
      return;
    }
    container.replaceChildren();
    return;
  }

  // Pause dependency tracking for the rest of this function.
  // The list effect only needs to depend on the array itself (already tracked
  // by the _scrml_reactive_get("todos") call in the render function).
  // Without this, every item.id access through the Proxy adds a tracked dep,
  // causing O(n) subscription cleanup/rebuild on every update.
  const wasPaused = _scrml_tracking_paused;
  _scrml_tracking_paused = true;

  try {

  // SSR DOM-adoption (first reconcile only, §52.8 A-terminus D2). On the very
  // first reconcile for a container the mount may already hold server-rendered
  // rows (SSR D1): each row's ROOT element carries a data-scrml-key HTML
  // ATTRIBUTE but has NO _scrml_key JS property (that property is set only on
  // createFn-built nodes) and NO event listeners / reactive effects. We ADOPT
  // those server nodes into the keyed diff so they get UPGRADED IN PLACE below
  // (a fresh interactive node swapped into the same slot) instead of wiped —
  // this is what kills the SSR client-rebuild double-render. _prevItemMap ===
  // undefined is exactly the first-reconcile signal (container._scrml_item_by_key
  // is written at the top of this fn, so it is undefined only on pass 1); a
  // client-only each with an empty mount adopts nothing and stays byte-identical.
  //
  // KEY-TYPE NORMALIZATION (correctness-critical): the server attribute value is
  // always a STRING ("42"); the client keyFn may return a NUMBER (42) or other
  // type. We resolve this ONCE, here, by mapping each adopted server node back to
  // the correctly-typed client key via String(clientKey) === attr, then storing
  // that CLIENT-typed key as the node's _scrml_key. So oldNodes and every
  // downstream lookup stay byte-identical to the steady-state path — no coercion
  // leaks past this block. A server node whose key is absent from the client list
  // keeps its raw string key (never matched) and is removed by the normal diff.
  let adoptedAny = false;
  if (_prevItemMap === undefined) {
    let _ssrSeen = false;
    for (const child of container.childNodes) {
      if (child.nodeType === 1 && child._scrml_key === undefined
          && child.getAttribute?.("data-scrml-key") != null) { _ssrSeen = true; break; }
    }
    if (_ssrSeen) {
      const _strToClient = new Map();
      for (let _s = 0; _s < newLen; _s++) _strToClient.set(String(newKeys[_s]), newKeys[_s]);
      for (const child of container.childNodes) {
        if (child.nodeType !== 1 || child._scrml_key !== undefined) continue;
        const _attrKey = child.getAttribute?.("data-scrml-key");
        if (_attrKey == null) continue;
        child._scrml_key = _strToClient.has(_attrKey) ? _strToClient.get(_attrKey) : _attrKey;
        child._scrml_ssr_adopt = true;
        adoptedAny = true;
      }
    }
  }

  const oldNodes = new Map();
  for (const child of [...container.childNodes]) {
    const key = child._scrml_key;
    if (key !== undefined) oldNodes.set(key, child);
  }

  // Fast path: bulk create from empty — skip diffing, append directly
  if (oldNodes.size === 0) {
    // 6nz Bug AI — clear any stray NON-keyed content before bulk-appending.
    // oldNodes.size === 0 means this container holds ZERO keyed reconcile
    // children, so anything currently in it is stray: the <empty> fallback left
    // by the each render fn's empty branch (replaceChildren + append fallback +
    // return) on the empty -> non-empty edge, or nothing at all on first render.
    // Without this, the fallback survives beside the first real items. The keyed
    // reconcile path below (oldNodes.size > 0) is NOT affected — it owns its
    // keyed nodes and is reached only when keyed children already exist.
    container.replaceChildren();
    if (__SCRML_PERF) {
      for (let i = 0; i < newItems.length; i++) {
        const node = createFn(newItems[i], i);
        if (!node) continue; // createFn returned undefined (filtered item)
        node._scrml_key = newKeys[i];
        const __t_dw = __SCRML_PERF_NOW();
        container.appendChild(node);
        __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
        __SCRML_PERF.dom_write.count++;
      }
      return;
    }
    for (let i = 0; i < newItems.length; i++) {
      const node = createFn(newItems[i], i);
      if (!node) continue; // createFn returned undefined (filtered item)
      node._scrml_key = newKeys[i];
      container.appendChild(node);
    }
    return;
  }

  // Fast path B2 (S106 — same keys in same order): partial-update happy path.
  // When in-place mutations (e.g. toggling .completed on existing rows) leave
  // the key sequence unchanged, skip the LIS pipeline entirely. Per-row effects
  // fire separately via _scrml_prop_subscribers; this function only needs to
  // confirm DOM ordering matches and bail.
  // Single forward pass; bails on first mismatch; allocates nothing on hit.
  // Guard: when this pass ADOPTED server nodes, do NOT take the B2 no-op bail
  // (the adopted keys already match newKeys in order, so B2 would leave the
  // un-upgraded server nodes in place). Fall through to the diff so each
  // adopted node gets its in-place upgrade. Post-hydration passes hit B2 normally.
  if (newItems.length === oldNodes.size && !adoptedAny) {
    let i = 0;
    let sameOrder = true;
    for (const child of container.childNodes) {
      if (child._scrml_key === undefined) continue;
      if (i >= newItems.length) { sameOrder = false; break; }
      if (newKeys[i] !== child._scrml_key) { sameOrder = false; break; }
      i++;
    }
    if (sameOrder && i === newItems.length) {
      // All keys match in order — no LIS, no DOM moves. (finally block bumps perf.)
      return;
    }
  }

  const newKeySet = new Set(newKeys);
  // Remove nodes whose keys are no longer present
  if (__SCRML_PERF) {
    for (const [key, node] of oldNodes) {
      if (!newKeySet.has(key)) {
        const __t_dw = __SCRML_PERF_NOW();
        container.removeChild(node);
        __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
        __SCRML_PERF.dom_write.count++;
      }
    }
  } else {
    for (const [key, node] of oldNodes) {
      if (!newKeySet.has(key)) container.removeChild(node);
    }
  }

  // Build old key→position map for LIS computation
  const oldKeyPos = new Map();
  let pos = 0;
  for (const child of [...container.childNodes]) {
    if (child._scrml_key !== undefined) oldKeyPos.set(child._scrml_key, pos++);
  }

  // Build the desired node array and compute old positions for existing nodes
  const newNodes = new Array(newLen);
  const oldPositions = new Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const key = newKeys[i];
    let node = oldNodes.get(key);
    if (!node) {
      node = createFn(newItems[i], i);
      if (!node) { oldPositions[i] = -2; newNodes[i] = null; continue; } // filtered item
      node._scrml_key = key;
      oldPositions[i] = -1; // new node, no old position
    } else {
      if (node._scrml_ssr_adopt === true) {
        // Hydration upgrade: this node was server-rendered (adopted above) and
        // has NO event listeners / reactive effects. Build a fresh interactive
        // node and swap it into the server node's exact DOM slot — the mount is
        // never emptied, and (identical content) there is no visible flash.
        const _skey = node.getAttribute?.("data-scrml-key");
        const _fresh = createFn(newItems[i], i);
        if (!_fresh) { container.removeChild(node); oldPositions[i] = -2; newNodes[i] = null; continue; } // createFn filtered this item
        _fresh._scrml_key = key;
        // Preserve the server-origin key marker so the upgraded row stays a
        // faithful in-place continuation of the server row. Client-only rows
        // never carry data-scrml-key — its presence marks a server-rendered,
        // adopted-then-upgraded row (honestly absent on post-hydration new rows).
        if (_skey != null && _fresh.nodeType === 1) _fresh.setAttribute("data-scrml-key", _skey);
        container.replaceChild(_fresh, node);
        node = _fresh;
      }
      oldPositions[i] = oldKeyPos.get(key) ?? -1;
    }
    newNodes[i] = node;
  }

  // Compute Longest Increasing Subsequence of old positions.
  // Nodes in the LIS are already in correct relative order — don't move them.
  // Only move nodes NOT in the LIS.
  const lisIndices = _scrml_lis(oldPositions);
  const inLIS = new Set(lisIndices);

  // Place nodes: iterate in reverse so insertBefore targets are stable
  let nextSibling = null;
  if (__SCRML_PERF) {
    for (let i = newLen - 1; i >= 0; i--) {
      const node = newNodes[i];
      if (!node) continue; // filtered item (createFn returned undefined)
      if (!inLIS.has(i)) {
        const __t_dw = __SCRML_PERF_NOW();
        container.insertBefore(node, nextSibling);
        __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
        __SCRML_PERF.dom_write.count++;
      }
      nextSibling = node;
    }
  } else {
    for (let i = newLen - 1; i >= 0; i--) {
      const node = newNodes[i];
      if (!node) continue; // filtered item (createFn returned undefined)
      if (!inLIS.has(i)) {
        container.insertBefore(node, nextSibling);
      }
      nextSibling = node;
    }
  }

  } finally {
    _scrml_tracking_paused = wasPaused;
    if (__SCRML_PERF) {
      __SCRML_PERF.reconcile_list.ms += __SCRML_PERF_NOW() - __t_rec_top;
      __SCRML_PERF.reconcile_list.count++;
    }
  }
}

/**
 * Bug 64 (S159) — resolve the CURRENT item for a reconciled list node by its
 * stable create-time key. Per-item content bindings (live-keyed text / class: /
 * attr interpolation) call this on every effect run instead of closing over the
 * create-time \`item\` argument, so a same-key reconcile (array-replace with
 * stable ids, or reorder) reflects the new data for that key.
 *
 * The \`_scrml_track(container, "_scrml_items")\` read establishes a dependency on
 * the container's item slot: \`_scrml_reconcile_list\` triggers it after rebuilding
 * the key->item map, so this effect re-fires and re-resolves. Reading a field of
 * the resolved item (through the reactive Proxy) ALSO subscribes the effect to
 * that field, so an in-place field mutation re-fires it directly — no reconcile
 * needed. Returns null if the key is gone (the node is being removed).
 *
 * @param {HTMLElement} container — the reconcile wrapper holding _scrml_item_by_key
 * @param {*} key — the node's create-time key (keyFn output)
 * @returns {*} the live item for that key, or null (canonical absence)
 */
function _scrml_resolve_item(container, key) {
  _scrml_track(container, "_scrml_items");
  const _m = container._scrml_item_by_key;
  // Canonical compiled-output absence is null (SPEC §42.5) — never the JS
  // \`undefined\` keyword. The per-item effect guards with \`=== null\` (the
  // W-CG-UNDEFINED-INTERPOLATION lint forbids \`undefined\` in emitted JS).
  if (!_m) return null;
  const _v = _m.get(key);
  if (_v === undefined) return null;
  // Return the item as a deep-reactive Proxy so the per-item effect's field
  // reads (\`item.label\`, \`item.active\`) go through the get trap and subscribe to
  // \`(rawItem, field)\` — making in-place field mutation (\`@coll[i].f = x\`) re-
  // fire the effect. _items passed to _scrml_reconcile_list is the RAW cell value
  // (reactive wrapping is lazy), so without this wrap the stored item is raw and
  // field reads never trap. _scrml_deep_reactive is identity-stable per backing
  // object (proxy cache), so subscriptions + mutation triggers target the same
  // raw object.
  return _scrml_deep_reactive(_v);
}

/**
 * Compute the indices of the Longest Increasing Subsequence.
 * Used by reconcile_list to minimize DOM moves.
 * Ignores -1 values (new nodes with no old position).
 *
 * @param {number[]} arr — array of old positions
 * @returns {number[]} — indices into arr that form the LIS
 */
function _scrml_lis(arr) {
  const len = arr.length;
  if (len === 0) return [];

  // tails[i] = index in arr of smallest tail element for increasing subseq of length i+1
  const tails = [];
  // pred[i] = index of predecessor of arr[i] in the LIS
  const pred = new Array(len);

  for (let i = 0; i < len; i++) {
    if (arr[i] === -1) continue; // skip new nodes

    // Binary search for the position where arr[i] should go
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < arr[i]) lo = mid + 1; else hi = mid;
    }

    if (lo > 0) pred[i] = tails[lo - 1];
    tails[lo] = i;
  }

  // Reconstruct the LIS indices
  const result = new Array(tails.length);
  let k = tails[tails.length - 1];
  for (let i = result.length - 1; i >= 0; i--) {
    result[i] = k;
    k = pred[k];
  }
  return result;
}

// ---------------------------------------------------------------------------
// engine-gated-each-populate (S153) — each-renderer registry + arm-entry remount.
//
// An <each> whose mount lives inside a NON-\`initial=\` engine arm is absent from
// the DOM at module-init (the engine renders only the \`initial=\` arm). The each
// render fn (\`_scrml_each_render_N\`) registers itself here at module-init keyed
// by its mount id (\`each_N\`). When an arm later mounts (engine dispatcher writes
// the arm's innerHTML), \`_scrml_remount_each(armRoot)\` walks the freshly-inserted
// subtree and re-invokes the renderer for every each-mount it finds. The render
// fn's reactive dep was already established at module-init (the dep-first read in
// emit-each.ts runs even when the mount is absent), so re-invoking here renders
// the now-present mount WITHOUT re-subscribing — calling the render fn directly
// (not its \`_scrml_effect_static\` wrapper) means no new dep edge / no leak. This
// also makes re-entry (Loading->Browsing->Loading->Browsing) idempotent: each
// entry re-renders from the live cell; ongoing mutations while the arm is visible
// re-render via the existing effect subscription.
//
// querySelectorAll handles nested eaches (an each several levels deep inside the
// arm body is matched the same as a top-level one). Reusable by any dynamic-HTML
// insertion site (engine arm-entry today; match-block dispatch is a follow-up).
const _scrml_each_renderers = {};

function _scrml_remount_each(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const _mounts = root.querySelectorAll('[data-scrml-each-mount]');
  for (const _el of _mounts) {
    const _id = _el.getAttribute("data-scrml-each-mount");
    const _fn = _scrml_each_renderers[_id];
    if (typeof _fn === "function") _fn();
  }
}

function _scrml_deep_set(obj, path, value) {
  if (!path || path.length === 0) return value;
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  let current = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    current[key] = Array.isArray(current[key]) ? [...current[key]] : { ...current[key] };
    current = current[key];
  }
  current[path[path.length - 1]] = value;
  return result;
}

// S81 OQ-2 (2026-05-11): _scrml_debounce + _scrml_throttle RETIRED. These
// helpers supported the imperative debounce(fn, ms) / throttle(fn, ms)
// keyword-call form, which is itself retired. Adopters use stdlib
// scrml:time.debounce / scrml:time.throttle (regular function calls,
// shipped at stdlib/time/index.scrml). State-cell timing uses the SPEC
// section 6.13 attribute form ([x debounced=Nms]) which is served by the
// _scrml_throttle_state + _scrml_reactivity_* helpers below — NOT by the
// retired plain debounce/throttle helpers.

// ---------------------------------------------------------------------------
// §6.13 Reactivity attributes — debounced= / throttled= runtime helpers
// ---------------------------------------------------------------------------
//
// Registries (_scrml_reactivity_timers, _scrml_reactivity_rules,
// _scrml_reactivity_bypass, _scrml_throttle_state) live near the top of
// the runtime (next to _scrml_state / _scrml_subscribers) so
// _scrml_reactive_set can consult them during module-init without TDZ
// faults. The helper functions below READ those registries.
//
// _scrml_reactivity_register is the declarative registration API used by
// the state-decl substrate emitter — codegen emits one call per cell that
// carries debounced= or throttled=, and subsequent direct
// _scrml_reactive_set calls route through the timing wrapper without
// requiring per-assign-site rewrites.
function _scrml_reactivity_register(name, kind, ms) {
  _scrml_reactivity_rules[name] = { kind, ms };
}

// Cancel any pending debounced/throttled timer for the named cell. Called from:
//   - _scrml_reactive_debounced (each new write — coalesce)
//   - _scrml_reactive_throttled (when scheduling a trailing-fire after the
//     window expires; the leading-fire is immediate and doesn't arm)
//   - _scrml_reset (§6.13 normative cancel-on-reset)
function _scrml_reactivity_cancel(name) {
  const handle = _scrml_reactivity_timers[name];
  if (handle === undefined) return;
  clearTimeout(handle);
  delete _scrml_reactivity_timers[name];
}

// _scrml_reactive_debounced(name, valueFn, ms) — SPEC §6.13.1.
//
// Each call arms a timer for ms milliseconds. Re-armed if a new write lands
// within the window (the previous timer is cancelled; the new one starts).
// On timer expiry the value-thunk is evaluated and the result is written
// through _scrml_reactive_set, firing all downstream subscribers + derived
// recompute on the debounced schedule.
//
// ms may be a number (literal-form DURATION) OR a function returning a
// number (computed-form expr-with-unit lowering — mirror A5-5 codegen
// pattern). Negative / NaN runtime values clamp to 0 (matches
// parseAfterDuration runtime semantics for the computed form).
function _scrml_reactive_debounced(name, valueFn, ms) {
  _scrml_reactivity_cancel(name);
  let delay = typeof ms === "function" ? ms() : ms;
  if (typeof delay !== "number" || !isFinite(delay) || delay < 0) delay = 0;
  delay = Math.round(delay);
  const handle = setTimeout(function () {
    delete _scrml_reactivity_timers[name];
    // Commit the coalesced trailing value DIRECTLY. The bypass flag routes this
    // set past the timing wrapper — without it, _scrml_reactive_set would see
    // the still-registered rule and re-route back into _scrml_reactive_debounced,
    // re-arming the timer forever so the cell never commits (S236
    // g-debounce-throttle-trailing-no-commit).
    _scrml_reactivity_bypass[name] = true;
    try {
      _scrml_reactive_set(name, valueFn());
    } finally {
      _scrml_reactivity_bypass[name] = false;
    }
  }, delay);
  _scrml_reactivity_timers[name] = handle;
}

// _scrml_reactive_throttled(name, valueFn, ms) — SPEC §6.13.2.
//
// Standard leading+trailing throttle. The first write in any quiescent
// window emits immediately; subsequent writes within ms of the last emit
// are suppressed but the most recent suppressed value-thunk is held; at
// window-end a single trailing fire emits with the held thunk.
//
// Per-cell scheduling state lives in _scrml_throttle_state[name]:
//   { lastEmit: number, pending: valueFn | null }
// _scrml_reactivity_timers[name] holds the trailing-fire timer handle (so
// _scrml_reset can cancel it via _scrml_reactivity_cancel).
// _scrml_throttle_state declared at module top for TDZ safety.
function _scrml_reactive_throttled(name, valueFn, ms) {
  let delay = typeof ms === "function" ? ms() : ms;
  if (typeof delay !== "number" || !isFinite(delay) || delay < 0) delay = 0;
  delay = Math.round(delay);
  const now = Date.now();
  let st = _scrml_throttle_state[name];
  if (!st) {
    st = { lastEmit: 0, pending: null };
    _scrml_throttle_state[name] = st;
  }
  const sinceLast = now - st.lastEmit;
  if (sinceLast >= delay) {
    // Outside the window — leading-fire immediately.
    st.lastEmit = now;
    st.pending = null;
    _scrml_reactivity_cancel(name);
    _scrml_reactive_set(name, valueFn());
    return;
  }
  // Inside the window — hold the most recent thunk + arm trailing-fire.
  st.pending = valueFn;
  if (_scrml_reactivity_timers[name] === undefined) {
    const remaining = delay - sinceLast;
    const handle = setTimeout(function () {
      delete _scrml_reactivity_timers[name];
      const stNow = _scrml_throttle_state[name];
      if (!stNow || stNow.pending === null) return;
      const thunk = stNow.pending;
      stNow.pending = null;
      stNow.lastEmit = Date.now();
      // Commit the held trailing value DIRECTLY. Without the bypass flag,
      // _scrml_reactive_set re-routes into _scrml_reactive_throttled, sees
      // sinceLast≈0 (lastEmit was just stamped), and re-arms another trailing
      // timer forever so the cell never commits (S236
      // g-debounce-throttle-trailing-no-commit).
      _scrml_reactivity_bypass[name] = true;
      try {
        _scrml_reactive_set(name, thunk());
      } finally {
        _scrml_reactivity_bypass[name] = false;
      }
    }, remaining);
    _scrml_reactivity_timers[name] = handle;
  }
}

function _scrml_reactive_explicit_set(...args) {
  // Explicit reactive set with path
  if (args.length >= 3) {
    const [obj, path, value] = args;
    const parts = typeof path === "string" ? path.split(".") : path;
    _scrml_reactive_set(obj, _scrml_deep_set(_scrml_reactive_get(obj), parts, value));
  }
}

function _scrml_upload(file, url) {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(url, { method: "POST", body: formData }).then(r => r.json());
}

function _scrml_navigate(path) {
  window.location.href = path;
}

// ---------------------------------------------------------------------------
// §20.8.2 — the Client Router soft-navigation engine (navigate-wave1b).
//
// A CLIENT navigate() lowers to _scrml_navigate_soft(path) (emit-expr.ts). It
// performs the §20.8.2 in-place <outlet> swap over the persistent <program>
// shell instead of a full document reload:
//   1. pushState + history.scrollRestoration = "manual" (§20.8.5(1)/(2)).
//   2. fetch(path) the target route's SSR HTML — a superseded in-flight fetch is
//      aborted (last-nav-wins, §20.8.5(4)).
//   3. DOMParser-extract the target [data-scrml-outlet] subtree + the
//      window.__scrml_ssr_state seed the SSR document injects (§52.8).
//   4. Swap the live outlet's subtree (wrapped in startViewTransition where
//      available; instant otherwise — §20.8.5(7)), rehydrate the swapped region
//      (_scrml_rehydrate_region), move focus to the outlet (§20.8.5(3)), and
//      scroll to top / #hash / the restored position (§20.8.5(2)).
// A transport failure falls back to a hard navigation (§20.8.5(5)). SSR-first is
// preserved — the <a href> stays a real link, so no-JS degrades to a full
// navigation, and this whole engine is a browser-only enhancement (guarded on
// typeof window/document). It lives in the 'utilities' chunk beside
// _scrml_navigate (tree-shaken out when a page has no navigate() call).

// Registry of per-region rehydration callbacks. A file's boot registers its
// element-scoped wiring (non-delegated handlers + reactive-display re-binding)
// via _scrml_register_rehydrator so a swapped-in region can be re-wired WITHOUT
// re-booting the shell. Delegated (document-level) click/submit listeners
// survive a subtree swap on their own and are NOT re-registered.
var _scrml_rehydrators = [];
function _scrml_register_rehydrator(fn) {
  if (typeof fn === "function") _scrml_rehydrators.push(fn);
}

// AbortController for the currently in-flight soft-nav fetch (last-nav-wins).
var _scrml_nav_controller = null;
// Monotonic nav token — the last-nav-wins backstop when AbortController is
// unavailable (finding #10: a null controller made the identity check useless,
// so a slow first fetch could overwrite a fast second nav). Every fetch captures
// its token; a resolve/reject whose token is stale bails.
var _scrml_nav_token = 0;
var _scrml_nav_popstate_wired = false;
// The pathname currently rendered into the outlet — used to distinguish an
// in-page #hash popstate (same pathname) from a real route change (finding #8).
var _scrml_nav_pathname = (typeof window !== "undefined" && window.location) ? window.location.pathname : "";

function _scrml_nav_outlet() {
  return (typeof document !== "undefined")
    ? document.querySelector("[data-scrml-outlet]")
    : null;
}

// The pathname portion of a nav target (strip query + hash).
function _scrml_nav_pathname_of(path) {
  return String(path == null ? "" : path).replace(/[?#][\\s\\S]*$/, "");
}

// Persist the OUTGOING history entry's scroll position so a later back/forward
// to it can restore (§20.8.5(2)).
function _scrml_nav_save_scroll() {
  if (typeof history === "undefined" || typeof window === "undefined") return;
  try {
    var st = (history.state && typeof history.state === "object") ? history.state : {};
    var merged = Object.assign({}, st, { __scrml_scroll: [window.scrollX, window.scrollY] });
    history.replaceState(merged, "", window.location.href);
  } catch (e) { /* replaceState can throw in a sandboxed frame — non-fatal */ }
}

// §20.8.5(1) — wire the popstate handler once. Back/forward soft-navigates to
// the target, restoring the saved scroll position.
function _scrml_nav_ensure_popstate() {
  if (_scrml_nav_popstate_wired || typeof window === "undefined") return;
  _scrml_nav_popstate_wired = true;
  window.addEventListener("popstate", function (ev) {
    if (!_scrml_nav_outlet()) return; // no shell outlet → let the browser handle it
    var newPathname = window.location.pathname;
    // Finding #8 — an in-page #hash change to the SAME pathname is NOT a route
    // change: skip the fetch+swap and let native hash scrolling run.
    if (newPathname === _scrml_nav_pathname && window.location.hash) {
      _scrml_nav_scroll(null);
      return;
    }
    _scrml_nav_pathname = newPathname;
    var restore = (ev.state && ev.state.__scrml_scroll) ? ev.state.__scrml_scroll : null;
    _scrml_nav_fetch_and_swap(window.location.pathname + window.location.search, restore);
  });
}

function _scrml_navigate_soft(path) {
  // Not a browser (SSR / a test host without a DOM) → nothing to swap.
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // No <program> shell outlet on the page → soft-nav is inapplicable; degrade to
  // a full-document hard navigation (SSR-first, §20.8.5(6)).
  if (!_scrml_nav_outlet()) { _scrml_navigate(path); return; }

  _scrml_nav_ensure_popstate();
  if (typeof history !== "undefined" && "scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  // Fix #2 (S239) — an in-page #hash change is NOT a route change: a bare
  // navigate("#anchor") OR a target whose pathname equals the current one but
  // carries a #hash. Push the entry + scroll to the anchor; do NOT fetch+swap
  // (which would wipe the swapped region's form input / scroll / if= state) —
  // the same short-circuit the popstate handler already applies.
  var _hashAt = path.indexOf("#");
  if (_hashAt >= 0) {
    var _targetPath = _scrml_nav_pathname_of(path);
    if (path.charAt(0) === "#" || _targetPath === _scrml_nav_pathname) {
      _scrml_nav_save_scroll();
      try { history.pushState({ __scrml_soft: true }, "", path); }
      catch (e) { _scrml_navigate(path); return; }
      if (path.charAt(0) !== "#") _scrml_nav_pathname = _targetPath;
      _scrml_nav_scroll(null); // scroll to the #hash target (native anchor behavior)
      return;
    }
  }

  // Save the current entry's scroll before we leave it, then push the target.
  _scrml_nav_save_scroll();
  try {
    history.pushState({ __scrml_soft: true }, "", path);
  } catch (e) { _scrml_navigate(path); return; }
  _scrml_nav_pathname = _scrml_nav_pathname_of(path);

  // A fresh navigation scrolls to top / #hash (restore === null).
  _scrml_nav_fetch_and_swap(path, null);
}

// Fetch the target route's SSR HTML and swap it in. Shared by pushState navs
// (restore === null) and popstate (restore === saved [x, y]).
function _scrml_nav_fetch_and_swap(path, restore) {
  // Abort a superseded in-flight fetch — last-nav-wins (§20.8.5(4)).
  if (_scrml_nav_controller) { try { _scrml_nav_controller.abort(); } catch (e) { /* already settled */ } }
  var controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
  _scrml_nav_controller = controller;
  // Finding #10 — the monotonic token is the last-nav-wins backstop that works
  // even when AbortController is unavailable (controller === null).
  var myToken = ++_scrml_nav_token;

  var opts = { headers: { "X-Scrml-Soft-Nav": "1" }, credentials: "same-origin" };
  if (controller) opts.signal = controller.signal;

  fetch(path, opts)
    .then(function (res) {
      if (myToken !== _scrml_nav_token) return null; // a newer nav superseded us
      // Finding #3 — a non-OK (404/500/302→login) or a redirected-to-another-URL
      // response must NOT be swapped UNDER the pushed URL: hard-navigate to the
      // FINAL url so the address bar matches and auth/error flows run natively.
      if (!res.ok || res.redirected) { _scrml_navigate(res.url || path); return null; }
      return res.text();
    })
    .then(function (html) {
      if (html == null || myToken !== _scrml_nav_token) return;
      _scrml_nav_apply_html(html, path, restore, myToken);
    })
    .catch(function (err) {
      if (err && err.name === "AbortError") return;      // superseded — expected
      if (myToken !== _scrml_nav_token) return;
      _scrml_navigate(path);                             // transport failure → hard nav
    });
}

// Extract the target document's SSR state seed (the SSR doc injects
// <script>window.__scrml_ssr_state={…}</script>; DOMParser does NOT execute it,
// so parse the JSON out of the script text). Replaces the live seed wholesale so
// a stale prior-route seed does not leak into the new region.
function _scrml_nav_extract_seed(doc) {
  if (typeof window === "undefined") return;
  var scripts = doc.querySelectorAll("script");
  var prefix = "window.__scrml_ssr_state=";
  for (var i = 0; i < scripts.length; i++) {
    var text = scripts[i].textContent || "";
    var at = text.indexOf(prefix);
    if (at === -1) continue;
    var json = text.slice(at + prefix.length).replace(/;\\s*$/, "");
    try { window.__scrml_ssr_state = JSON.parse(json); }
    catch (e) { /* malformed seed — keep the prior seed rather than crash */ }
    return;
  }
  window.__scrml_ssr_state = null; // target has no seed → clear (seed_apply no-ops)
}

// The set of route client-chunk filenames (name.client.js) a document loads.
// Two routes served by the SAME <program> chunk share this set; a separate
// pages/ file references a DIFFERENT client chunk. The pattern matches BOTH the
// dev/unhashed form (name.client.js) AND the deploy content-hashed form
// (name.client.<hash>.js, §47.9.8) — the hash is deterministic per chunk content,
// so the shell chunk shares one basename across every route page.
function _scrml_nav_client_chunks(d) {
  var out = {};
  if (!d || typeof d.querySelectorAll !== "function") return out;
  var s = d.querySelectorAll("script[src]");
  for (var i = 0; i < s.length; i++) {
    var src = s[i].getAttribute("src") || "";
    if (_SCRML_CLIENT_CHUNK_RE.test(src)) out[src.split("/").pop()] = true;
  }
  return out;
}
// Matches a .client.js OR a content-hashed .client.HASH.js script src (§47.9.8).
var _SCRML_CLIENT_CHUNK_RE = /\\.client\\.(?:[0-9a-z]+\\.)?js(\\?|$)/i;

// Finding #4 — same-chunk iff every client chunk the target references is ALREADY
// loaded in the current document. A target needing a chunk we don't have is a
// CROSS-ROUTE navigation (a separate pages/ file): the current runtime has no
// wiring for it, so a soft swap would render frozen, dead markup. Cross-route
// chunk-loading is Wave-1c; until then, cross-route hard-navigates.
function _scrml_nav_same_chunk(doc) {
  var have = _scrml_nav_client_chunks(document);
  var need = _scrml_nav_client_chunks(doc);
  for (var k in need) { if (Object.prototype.hasOwnProperty.call(need, k) && !have[k]) return false; }
  return true;
}

// Finding #9 — sync a pragmatic head subset across a soft nav: <title>,
// <meta name="description">, <link rel="canonical">. Fuller head-diffing
// (arbitrary meta/link/preload) is a noted follow-on.
function _scrml_nav_sync_head(doc) {
  try {
    var t = doc.querySelector("title");
    if (t) document.title = t.textContent || document.title;
  } catch (e) { /* non-fatal */ }
  _scrml_nav_sync_head_el(doc, 'meta[name="description"]', "meta", "name", "content");
  _scrml_nav_sync_head_el(doc, 'link[rel="canonical"]', "link", "rel", "href");
}
// #9 — sync one head element (a <meta> or a <link>) from the fetched document into
// the live <head> across a soft nav: find (or create) it by selector, carry its
// identity attribute (keyAttr: name/rel) on create, then copy its value attribute
// (valueAttr: content/href). Dedupes the former _scrml_nav_sync_meta/_link twins.
function _scrml_nav_sync_head_el(doc, selector, tag, keyAttr, valueAttr) {
  try {
    var src = doc.querySelector(selector);
    if (!src) return;
    var live = document.head && document.head.querySelector(selector);
    if (!live && document.head) {
      live = document.createElement(tag);
      live.setAttribute(keyAttr, src.getAttribute(keyAttr) || "");
      document.head.appendChild(live);
    }
    if (live) live.setAttribute(valueAttr, src.getAttribute(valueAttr) || "");
  } catch (e) { /* non-fatal */ }
}

// navigate-wave1c — how long to wait for a cross-chunk route script to load
// before giving up and hard-navigating (§20.8.2 / §20.8.7).
var _SCRML_NAV_CHUNK_TIMEOUT_MS = 10000;

// The ORDERED set of client-chunk URLs the target document references but the
// live document has NOT loaded (need \ have). Resolved to ABSOLUTE URLs against
// the TARGET page's URL (not by convention) so a nested route's own upToRoot
// script-src prefixes resolve correctly, and preserved in the fetched doc's
// script order (deps-first — a dependency chunk precedes its importer).
function _scrml_nav_missing_chunks(doc, path) {
  var out = [];
  if (!doc || typeof doc.querySelectorAll !== "function") return out;
  var have = _scrml_nav_client_chunks(document); // basenames already loaded
  var pageUrl;
  try { pageUrl = new URL(path, window.location.href); }
  catch (e) { pageUrl = window.location.href; }
  var s = doc.querySelectorAll("script[src]");
  var seen = {};
  for (var i = 0; i < s.length; i++) {
    var src = s[i].getAttribute("src") || "";
    if (!_SCRML_CLIENT_CHUNK_RE.test(src)) continue;
    var base = src.split("/").pop();
    if (have[base] || seen[base]) continue;
    seen[base] = true;
    var abs;
    try { abs = new URL(src, pageUrl).href; }
    catch (e) { abs = src; }
    out.push(abs);
  }
  return out;
}

// A cross-chunk route script failed to load (error or timeout): fall back to a
// hard navigation, emitting the W-NAV-CHUNK-LOAD-FAILED info diagnostic (§20.8.7).
// A failure that arrives AFTER a newer nav superseded us bails silently — the
// newer nav owns the outcome (last-nav-wins).
function _scrml_nav_chunk_failed(path, token, url, reason) {
  if (typeof token === "number" && token !== _scrml_nav_token) return;
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info(
      "[scrml] W-NAV-CHUNK-LOAD-FAILED: cross-chunk soft navigation to \\"" + path +
      "\\" fell back to a hard navigation (route client chunk " + reason + ": " + url + ")."
    );
  }
  _scrml_navigate(path);
}

// Load the missing route client chunk(s) SEQUENTIALLY in deps-first order, then
// invoke onDone. Each chunk is a classic <script> whose module-init self-registers
// its soft-nav rehydrator (the readyState-gated boot runs immediately since the
// document is already loaded, navigate-wave1c), so once all have loaded the target
// route's wiring is present in _scrml_rehydrators. async=false preserves the
// deps-first execution order for a dynamically-inserted script.
function _scrml_nav_load_chunks(urls, token, onDone, path) {
  var i = 0;
  var loadNext = function () {
    // Last-nav-wins (§20.8.5(4)) — a newer nav superseded us: stop, do NOT swap.
    if (typeof token === "number" && token !== _scrml_nav_token) return;
    if (i >= urls.length) { onDone(); return; }
    var url = urls[i++];
    var s = document.createElement("script");
    s.src = url;
    s.async = false;
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      _scrml_nav_chunk_failed(path, token, url, "timeout");
    }, _SCRML_NAV_CHUNK_TIMEOUT_MS);
    s.onload = function () {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      loadNext();
    };
    s.onerror = function () {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      _scrml_nav_chunk_failed(path, token, url, "error");
    };
    // A synchronous append failure (CSP block / a host that rejects dynamic
    // script insertion) is a load failure too → hard-nav fallback.
    try {
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      _scrml_nav_chunk_failed(path, token, url, "error");
    }
  };
  loadNext();
}

// Parse the fetched HTML, extract the target outlet subtree + seed, load any
// missing route chunk(s) (Wave-1c), and swap the live outlet's children
// (View-Transition-wrapped where available).
function _scrml_nav_apply_html(html, path, restore, token) {
  var liveOutlet = _scrml_nav_outlet();
  if (!liveOutlet) return;
  var doc;
  try { doc = new DOMParser().parseFromString(html, "text/html"); }
  catch (e) { _scrml_navigate(path); return; }
  var fetchedOutlet = doc.querySelector("[data-scrml-outlet]");
  if (!fetchedOutlet) { _scrml_navigate(path); return; } // target isn't a shell page → hard nav

  // Install the target route's seed BEFORE loading its chunk(s) so an injected
  // chunk's module-init seed-apply hydrates the ROUTE's cells from the new-route
  // seed (which carries no shell keys) and never re-applies a stale seed over the
  // live shell cells (§52.8 + finding #5). Same-chunk navs are unaffected.
  _scrml_nav_extract_seed(doc);

  // Sync <title> + description + canonical (§20.8 head sync, finding #9).
  _scrml_nav_sync_head(doc);

  var newHtml = fetchedOutlet.innerHTML;
  // The swap — deferred behind a cross-chunk load when needed (Wave-1c).
  var swap = function () {
    // #6 — re-check the nav token INSIDE the swap. Under startViewTransition the
    // swap runs ASYNCHRONOUSLY (the browser defers it), so a fast second nav can
    // bump _scrml_nav_token between apply-html and this callback; without this
    // guard we would tear down + swap in STALE content over the newer nav. Also
    // guards the cross-chunk case: a chunk that finishes loading after a newer
    // nav must not swap.
    if (typeof token === "number" && token !== _scrml_nav_token) return;
    // Tear down the OUTGOING region's reactive effects/subscriptions/timers
    // before replacing it (finding #2 — no leak).
    _scrml_teardown_region(liveOutlet);
    liveOutlet.innerHTML = newHtml;
    // Re-hydrate the swapped-in region (seed + scoped re-wiring incl. reactive
    // display) without re-booting the shell (finding #1). For a cross-chunk nav
    // the newly loaded chunk has registered its rehydrator into _scrml_rehydrators,
    // so the target route's wiring is applied here.
    _scrml_rehydrate_region(liveOutlet);
    _scrml_nav_focus(liveOutlet);   // §20.8.5(3)
    _scrml_nav_scroll(restore);     // §20.8.5(2)
  };

  var runSwap = function () {
    // View Transitions where available; instant swap otherwise (§20.8.5(7)).
    if (typeof document.startViewTransition === "function") {
      try { document.startViewTransition(swap); } catch (e) { swap(); }
    } else {
      swap();
    }
  };

  // Wave-1c — the target references route client chunk(s) not yet loaded (a
  // separate pages/ route). Load them (deps-first, in the fetched doc's script
  // order) THEN swap+rehydrate; a load failure/timeout hard-navigates
  // (W-NAV-CHUNK-LOAD-FAILED, §20.8.2/§20.8.7). SSR-first is preserved — the
  // fallback is a full navigation to the same SSR document.
  var missing = _scrml_nav_missing_chunks(doc, path);
  if (missing.length > 0) {
    _scrml_nav_load_chunks(missing, token, runSwap, path);
    return;
  }
  runSwap();
}

// §20.8.5(3) — after a swap, move focus to the region (its first heading, else
// the outlet itself) for keyboard / assistive-tech users.
function _scrml_nav_focus(outlet) {
  if (!outlet) return;
  var target = outlet.querySelector("h1, h2, [autofocus]") || outlet;
  try {
    // #4 — a heading (h1/h2) or the outlet <div> is NOT focusable without a
    // tabindex, so a bare .focus() is a silent no-op (§20.8.5(3) unmet). Give the
    // target a programmatic tabindex="-1" (script-focusable, kept OUT of the tab
    // order) so focus actually lands. An [autofocus] control is already natively
    // focusable — leave its tab order intact.
    if (!target.hasAttribute("tabindex") && !target.hasAttribute("autofocus")) {
      target.setAttribute("tabindex", "-1");
    }
    target.focus();
  } catch (e) { /* focus can throw on a detached/hidden node — non-fatal */ }
}

// §20.8.5(2) — scroll: restore the saved position on back/forward, else scroll
// to the #hash target, else to top.
function _scrml_nav_scroll(restore) {
  if (typeof window === "undefined") return;
  if (restore && restore.length === 2) { window.scrollTo(restore[0], restore[1]); return; }
  var hash = window.location.hash;
  if (hash && hash.length > 1) {
    var el = document.getElementById(hash.slice(1));
    if (el) { try { el.scrollIntoView(); return; } catch (e) { /* fall through to top */ } }
  }
  window.scrollTo(0, 0);
}

// Re-hydrate a swapped-in region WITHOUT re-booting the shell (§20.8.2 step 3):
// apply the region's SSR seed, then run each registered element-scoped
// rehydrator against the swapped root. The rehydrators re-attach non-delegable
// handlers AND re-bind the reactive display (interpolations, inline match/if) to
// the swapped nodes — the display effects they create for elements in the outlet
// register their disposers into _scrml_region_cleanups (via _scrml_region_track)
// so the NEXT nav can tear them down (finding #1 + #2). Reuses the ordinary boot
// helpers (_scrml_ssr_seed_apply + the per-file wiring the rehydrators close over).
function _scrml_rehydrate_region(root) {
  // #5 — REHYDRATE seed-apply skips the persistent shell's cells (skipShell=true)
  // so a mutated shell cell survives the nav; route cells still re-seed.
  if (typeof _scrml_ssr_seed_apply === "function") _scrml_ssr_seed_apply(true);
  var scope = root || (typeof document !== "undefined" ? document : null);
  for (var i = 0; i < _scrml_rehydrators.length; i++) {
    try { _scrml_rehydrators[i](scope); }
    catch (e) { if (typeof console !== "undefined") console.error("scrml rehydrate error:", e); }
  }
  // M1 Phase 1 — re-render any <each> lists in the swapped region. The renderer
  // does its own [data-scrml-each-mount] querySelector + container-keyed reconcile
  // (adopting the server-rendered rows), so this is a clean scoped rebuild; the
  // old container's reconcile state dies with the detached node.
  if (typeof _scrml_remount_each === "function" && scope) _scrml_remount_each(scope);
}

// Tear down the OUTGOING region's reactive display effects / subscriptions /
// timers before its subtree is replaced (finding #2 — TRACK, not query). Every
// display effect created for an element INSIDE the outlet registered its
// disposer into _scrml_region_cleanups (at boot AND on each rehydrate, via
// _scrml_region_track.s closest("[data-scrml-outlet]") check); draining that
// list stops the old region's reactivity so it neither leaks subscriptions nor
// double-updates. Shell-level cells + delegated listeners live OUTSIDE the outlet
// and never registered, so they stay live.
function _scrml_teardown_region(root) {
  if (typeof _scrml_region_cleanups === "undefined") return;
  var list = _scrml_region_cleanups;
  _scrml_region_cleanups = [];
  for (var i = 0; i < list.length; i++) {
    try { if (typeof list[i] === "function") list[i](); }
    catch (e) { if (typeof console !== "undefined") console.error("scrml region teardown error:", e); }
  }
}

// ---------------------------------------------------------------------------
// §20.8.3 — Link-boost: <a href> default soft-nav + the \`hard\` opt-out (i27).
//
// One delegated document-level click listener (wired ONCE per app that has a
// <program>-shell <outlet>, via _scrml_link_ensure_click emitted at boot by
// emit-reactive-wiring's fileHasOutlet gate) intercepts internal same-origin
// cross-page <a> clicks and runs them through the §20.8.2 soft-nav engine
// instead of a full document reload. It calls _scrml_navigate_soft(href); the
// engine handles same-chunk-vs-cross-route + hard-falls-back on its own.
//
// Progressive enhancement (§20.8.5(6)): the <a href> stays a real link. EVERY
// guard below falls through to a NATIVE navigation (no preventDefault), so
// with JS off — and for external / new-tab / download / hash / modified-click
// / hard-opt-out links — the browser's own behavior is preserved. Link
// classification is RUNTIME same-origin (a.origin === location.origin), NOT the
// compile-time data-scrml-prefetch marker: that marker is a strict subset (only
// static hrefs resolving to a known RouteMap route carry it), so reusing it
// would miss legitimate internal links (reactive hrefs, unresolved routes).
// ---------------------------------------------------------------------------
var _scrml_link_click_wired = false;

// Wire the delegated click listener once (idempotent — the popstate-wiring
// pattern's twin). Browser-only; a no-op without a document.
function _scrml_link_ensure_click() {
  if (_scrml_link_click_wired || typeof document === "undefined") return;
  _scrml_link_click_wired = true;
  document.addEventListener("click", _scrml_link_click_handler);
}

function _scrml_link_click_handler(e) {
  // Already handled by another listener, or a modified / non-primary click →
  // leave it to the browser (cmd/ctrl = new tab, shift = new window, alt =
  // download, middle-click = new tab). A real 'click' fires with button 0;
  // middle-click fires 'auxclick', but guard e.button defensively anyway.
  if (e.defaultPrevented) return;
  if (typeof e.button === "number" && e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  // Nearest ancestor <a href> of the click target (handles a click on a child
  // element inside the link, e.g. an icon <span>).
  var t = e.target;
  var a = (t && typeof t.closest === "function") ? t.closest("a[href]") : null;
  if (!a) return;

  // \`hard\` opt-out (§20.8.3) — the markup sibling of navigate(…, .Hard). The
  // bare boolean attribute survives to the DOM, so read it directly. Opt-out is
  // PRESENCE-based (HTML boolean-attribute semantics): ANY value opts out —
  // \`hard\`, \`hard=""\`, and even \`hard="false"\` all hard-navigate. Use the
  // attribute's ABSENCE (omit it) to keep a link boosted.
  if (a.hasAttribute("hard")) return;

  // target=_blank / any non-_self named target → native (new browsing context).
  var target = a.getAttribute("target");
  if (target && target !== "_self") return;

  // download → native (the browser saves the resource; there is no navigation).
  if (a.hasAttribute("download")) return;

  // rel="external" / rel="noopener external" / … → author opt-out to native.
  var rel = a.getAttribute("rel");
  if (rel && (" " + rel.toLowerCase() + " ").indexOf(" external ") >= 0) return;

  // Non-http(s) scheme (mailto:/tel:/…) → native. a.protocol is the resolved
  // scheme of the fully-qualified href (via the URL-interface mixin on <a>);
  // an SVGAElement / anchor without these props reads undefined → native.
  var proto = a.protocol;
  if (proto !== "http:" && proto !== "https:") return;

  // Cross-origin → native full navigation. The router owns only same-app routes;
  // classify at runtime by resolved origin (see the header note on why not the
  // compile-time prefetch marker).
  if (typeof window === "undefined" || !window.location) return;
  if (a.origin !== window.location.origin) return;

  // Pure hash link (#…) → native hash scroll (never a route change).
  var rawHref = a.getAttribute("href");
  if (rawHref != null && rawHref.charAt(0) === "#") return;
  // Same-location target → native. Covers BOTH (a) a same-page #hash anchor
  // (native scroll) AND (b) an exact self-link with no hash (S239 LOW: soft-nav
  // would re-fetch + re-swap the outlet, wiping the current route's form / scroll
  // / if= state for no navigation). Any resolved pathname+search equal to the
  // current one is not a cross-page navigation, so let the browser handle it.
  if (a.pathname === window.location.pathname &&
      a.search === window.location.search) return;

  // All guards passed — an internal same-origin cross-page link. Intercept and
  // soft-navigate the resolved same-origin path (pathname+search+hash keeps the
  // engine's #hash short-circuit working; a full URL would defeat it).
  e.preventDefault();
  _scrml_navigate_soft(a.pathname + a.search + a.hash);
}

// ---------------------------------------------------------------------------
// §40.9.7 tier-1 idle prefetch runtime (chunk: 'prefetch')
// ---------------------------------------------------------------------------
//
// Per SPEC §40.9.7: "prefetch_tier_1(E) SHALL be idle-prefetched after
// initial render. The implementation SHOULD use \`requestIdleCallback\`
// (or the equivalent Bun-runtime primitive) to schedule the prefetch."
//
// OQ-A4-G ratification (S91): Option γ — \`requestIdleCallback\` browser-
// side with a \`setTimeout(fn, 1)\` Safari fallback (Safari still lacks
// \`requestIdleCallback\` support as of 2026). The Bun-runtime primitive
// named in the SPEC's SHOULD clause does NOT exist in Bun 1.2.x as of
// S91 — reserved as a v0.4 extension point.
//
// Called from the initial chunk's IIFE tail when the (EP, role)'s
// ChunkPlan.prefetchTier1 admits a non-empty set. The codegen
// route-splitter only emits the call when the tier-1 admission set is
// non-empty AND a real CompileContext is threaded through; the empty-
// admission case skips the call entirely (and this whole runtime
// section is tree-shaken from SCRML_RUNTIME via the \`prefetch\` chunk
// marker in \`runtime-chunks.ts\`).
//
// Implementation uses \`<link rel="prefetch">\` for browser-cache
// friendliness — once the chunk is in the HTTP cache, the actual
// \`<script>\` activation on traversal is a cache hit. Browsers that
// don't honor \`rel="prefetch"\` fall back to whatever they do for
// unknown link types (a no-op); no fetch error or runtime exception
// propagates.

function _scrml_prefetch_tier1(chunkUrl) {
  if (typeof document === "undefined") return;
  const schedule = typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : function (fn) { return setTimeout(fn, 1); };
  schedule(function () {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "script";
    link.href = chunkUrl;
    document.head.appendChild(link);
  });
}

// ---------------------------------------------------------------------------
// §40.9.7 prefetch runtime — chunk: 'prefetch'
// Hosts BOTH:
//   • _scrml_prefetch_tier2 (A-4.4) — cross-route hover-prefetch
//   • _scrml_fetch_chunk    (A-4.5) — tier-N (N>=3) on-demand dispatch
// ---------------------------------------------------------------------------
//
// Per SPEC §40.9.7:
//   • "prefetch_tier_2(E) SHALL be hover-prefetched (link-hover for
//      routes, focus-or-hover for interactive components)."
//   • "prefetch_tier_N(E) for N >= 3 SHALL be fetched on-demand when
//      the user actually traverses into the deep-interaction surface."
//
// Per SCOPING §3.4 (A-4 per-route artifact splitter) the §40.9.7 tier-2
// semantics has two distinct shapes:
//   1. Cross-route hover prefetch (DOMINANT) — \`<a href="/other-route">\`
//      hovered → fetch \`/other-route\`'s initial chunk for the viewer's
//      live role.
//   2. Intra-route deep-interaction prefetch — empty in v0.3 per RS
//      A-2.5 floor; structurally supported.
//
// \`_scrml_prefetch_tier2(routePath, role)\` implements case (1).
// \`_scrml_fetch_chunk(epId, role, tier)\` (A-4.5) is the tier-N dispatch
// surface; never fires in v0.3 per OQ-A2-B Option a + OQ-A4-D Option a,
// structural scaffolding for v0.4+.

// _SCRML_CHUNKS — per-app chunks.json manifest mirror.
//
// A-4.4 ships the placeholder scaffold (\`Object.create(null)\` to avoid
// prototype-pollution surprises). A-4.6 populates real chunk URLs at
// HTML emission time (a \`<script>\` tag in the initial HTML payload
// writes \`window._SCRML_CHUNKS = { ... }\` before any chunk script loads).
//
// Shape (after A-4.6 populates it):
//
//   _SCRML_CHUNKS["/loads"]["Driver"] = {
//     initial: "/loads/Driver.initial.abc12345.js",
//     tier1:   "/loads/Driver.tier1.def67890.js",
//   }
var _SCRML_CHUNKS = (typeof _SCRML_CHUNKS !== "undefined")
  ? _SCRML_CHUNKS
  : Object.create(null);

function _scrml_prefetch_tier2(routePath, role) {
  if (typeof document === "undefined") return;
  if (typeof routePath !== "string" || routePath === "") return;
  if (typeof role !== "string" || role === "") return;
  // Defensive: pre-A-4.6 \`_SCRML_CHUNKS\` is the empty scaffold.
  var byRoute = _SCRML_CHUNKS[routePath];
  if (!byRoute) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        "[scrml] _scrml_prefetch_tier2: no chunk manifest entry for route \\"" +
        routePath + "\\" (skipping prefetch — A-4.6 will populate _SCRML_CHUNKS)"
      );
    }
    return;
  }
  var byRole = byRoute[role];
  if (!byRole || typeof byRole.initial !== "string") {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        "[scrml] _scrml_prefetch_tier2: no chunk for route=\\"" + routePath +
        "\\" role=\\"" + role + "\\" (skipping prefetch)"
      );
    }
    return;
  }
  var link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "script";
  link.href = byRole.initial;
  document.head.appendChild(link);
}

// _scrml_fetch_chunk (A-4.5) — tier-N on-demand dispatch. Returns a
// \`Promise<string>\` resolving to the chunk's source bytes when the
// (epId, role, tier) tuple is registered in _SCRML_CHUNKS (A-4.6
// populates real entries). Returns JS \`null\` when the tuple is not
// registered. Per scrml's canonical absence (§42.5 / §42.8) emitted-
// runtime JS represents scrml \`not\` as JS \`null\`; adopters MUST null-
// check before chaining \`.then(...)\`. Structurally complete BUT never
// fires in v0.3 because RS emits empty tier-N admission sets. When RS
// extends to N>=3 in v0.4+, the codegen route-splitter will emit call
// sites referencing this function — no runtime-template.js change
// required at that point.

function _scrml_fetch_chunk(epId, role, tier) {
  var manifest = (typeof _SCRML_CHUNKS !== "undefined") ? _SCRML_CHUNKS : {};
  var entry = manifest[epId] && manifest[epId][role] && manifest[epId][role][tier];
  if (!entry) return null;
  return fetch(entry).then(function (r) { return r.text(); });
}

// ---------------------------------------------------------------------------
// §40.9.7 chunk mount registry (chunk: 'mount')
// ---------------------------------------------------------------------------
//
// Called from the per-(EP, role, tier) chunk file's IIFE for every admitted
// markup node (atom-emitter.ts:emitComponentAtom). Records the per-chunk
// admission set on the global \`_SCRML_MOUNTS\` registry for adopter-debug
// surfaces and downstream runtime instrumentation.
//
// In v0.3 the actual DOM-tree construction is performed by the per-file
// \`.html\` payload (\`emit-html.ts\` renders the static markup tree directly).
// This helper is the chunk-side record-keeping pair: it observes which
// markup nodes belong to the chunk so adopter tooling (debug overlays,
// reachability inspectors) can map chunk → admitted markup. The helper is
// intentionally a no-op-friendly shape (assignment only; no DOM mutation,
// no event dispatch) so adopters pay zero production overhead per §40.9.7
// SHOULD on chunk-side instrumentation cost.
//
// Tree-shake (chunk: 'mount'): when no chunks are emitted for the compile
// unit (the dominant pre-A-4 case), the atom-emitter produces no
// \`_scrml_chunk_mount(...)\` references and \`detectRuntimeChunks\` does NOT
// add 'mount' to \`ctx.usedRuntimeChunks\`. The helper is elided from
// per-file embed-mode runtimes; in full-runtime mode (\`scrml-runtime.js\`)
// it ships unconditionally.

var _SCRML_MOUNTS = (typeof _SCRML_MOUNTS !== "undefined")
  ? _SCRML_MOUNTS
  : Object.create(null);

function _scrml_chunk_mount(id, tag) {
  _SCRML_MOUNTS[id] = tag;
}

// ---------------------------------------------------------------------------
// §41 vendor-unit reference registry (chunk: 'vendor-ref')
// ---------------------------------------------------------------------------
//
// Called from the per-chunk IIFE for every \`use vendor:NAME\` reference in
// the chunk's admission set (atom-emitter.ts:emitVendorUnitRef + the chunk
// composition \`_scrml_vendor_require\` call site in route-splitter.ts).
// Records the chunk's vendor-unit dependencies on \`_SCRML_VENDOR_REFS\` so
// adopter bundler-side tooling can introspect cross-chunk vendor sharing.
//
// In v0.3 this is record-keeping only — the actual vendor-unit script
// inclusion happens via the per-route HTML's \`<script>\` ordering (the
// per-route HTML emitter resolves vendor units to script tags before the
// chunk \`<script>\`s load). When a future v0.4+ extension lands runtime-
// resolved vendor-unit loading, this helper can grow a real
// \`window["vendor:" + unit]\` lookup; until then it is the chunk-side
// record-keeping pair.
//
// Tree-shake (chunk: 'vendor-ref'): same gate as 'mount' — when no chunk
// emits any \`_scrml_vendor_require(...)\` call, this helper is elided from
// per-file embed-mode runtimes. \`detectRuntimeChunks\` activates the chunk
// when ANY entry-point chunk in the file's reachability record admits a
// non-empty \`vendorUnitNames\` set.

var _SCRML_VENDOR_REFS = (typeof _SCRML_VENDOR_REFS !== "undefined")
  ? _SCRML_VENDOR_REFS
  : Object.create(null);

function _scrml_vendor_require(unit) {
  _SCRML_VENDOR_REFS[unit] = true;
}

// ---------------------------------------------------------------------------
// §21.3 cross-file module registry (chunk: 'modules')
// ---------------------------------------------------------------------------
//
// Sibling to \`_scrml_stdlib\` (the \`scrml:NAME\` stdlib registry). scrml
// loads every \`.client.js\` as a CLASSIC (non-module) <script>, so a bare ES
// \`import { x } from "./dep.client.js"\` would SyntaxError at parse time and
// poison the whole script body. Instead, each dependency \`.client.js\` ends
// with a registration footer
//   \`_scrml_modules["<dist-relative-key>"] = { publicName: emittedName, ... };\`
// and each importing \`.client.js\` rewrites its \`import\` to a registry read
//   \`const { x } = _scrml_modules["<dist-relative-key>"];\`
// The dependency <script>s are emitted BEFORE the importing entry's <script>
// (topological order, deps first — see index.ts), so every dependency has
// registered before any importer reads. A missing/late registration fails
// LOUDLY: \`_scrml_modules["x"]\` is \`undefined\` and the destructuring read
// throws a clear TypeError (vs a silent shared-global last-wins collision).
//
// Forward note (A-4): when the per-route artifact splitter (\`emitPerRoute\`)
// turns on, A-4 chunk payloads register their exports into this SAME registry
// — one loader, not two parallel ones. The registry shape (keyed exports
// object) is A-4-compatible by construction.
//
// Tree-shake (chunk: 'modules'): \`detectRuntimeChunks\` activates this chunk
// only when the compile unit has a cross-file local \`.scrml\` import OR a file
// imported by another \`.scrml\`. Single-file apps never carry it. The
// idempotent \`(typeof ... !== "undefined")\` guard mirrors \`_SCRML_MOUNTS\` /
// \`_SCRML_VENDOR_REFS\` so any future shared-runtime double-load is safe.

var _scrml_modules = (typeof _scrml_modules !== "undefined")
  ? _scrml_modules
  : {};

// ---------------------------------------------------------------------------
// §22.5 meta.emit() runtime — insert HTML at a ^{} block's DOM position
// ---------------------------------------------------------------------------

/**
 * Insert HTML content at the position of a ^{} meta block in the DOM.
 *
 * The compiler emits a placeholder element for every ^{} block that appears in
 * markup context: <span data-scrml-meta="scopeId"></span>. When meta.emit()
 * is called at runtime, this function finds that placeholder and replaces its
 * inner content with the provided HTML string.
 *
 * Calling meta.emit() multiple times replaces the previous content each time.
 * This is intentional — the placeholder span is the container for the emitted
 * content, and each call is a full update of that container.
 *
 * @param {string} scopeId — the meta block scope ID (e.g. _scrml_meta_1)
 * @param {string} htmlString — the HTML string to insert
 */
function _scrml_meta_emit(scopeId, htmlString) {
  if (typeof document === "undefined") return;
  const placeholder = document.querySelector('[data-scrml-meta="' + scopeId + '"]');
  if (placeholder) {
    placeholder.innerHTML = htmlString;
  } else {
    // Fallback: if no placeholder found (e.g. meta block not in markup context),
    // append a new element to the document body with the scopeId marker.
    const el = document.createElement("span");
    el.setAttribute("data-scrml-meta", scopeId);
    el.innerHTML = htmlString;
    document.body.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// §22.6 meta reactive effects — auto-tracking reactive ^{} blocks (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Tracking context stack for _scrml_meta_effect.
 *
 * Each entry is a Set<string> of variable names read during the current effect run.
 * The stack supports nested effects: each effect pushes/pops its own tracking Set.
 * Inner effects do not pollute outer effect dependency sets.
 */
const _scrml_tracking_stack = [];

/**
 * Run fn as a reactive effect for the given scopeId.
 *
 * Auto-tracking strategy: temporarily replace globalThis._scrml_reactive_get with
 * a tracking version that records every variable name read during fn's execution.
 * After fn returns, subscribe to all tracked variables. On any change, re-run fn
 * (first unsubscribing from previous dependencies, running cleanup, then re-tracking).
 *
 * This approach is chosen over Proxy because _scrml_reactive_get is already a
 * function call in all compiled output — no need to intercept property access.
 *
 * Key design properties:
 *   - Scope isolation: fn receives a fresh meta object on each run
 *   - Cleanup: meta.cleanup(fn) callbacks fire before each re-run and on scope destroy
 *   - Infinite loop guard: MAX_RUNS = 100 (matches Vue 3 / React limit)
 *   - Run counter resets on external reactive trigger (not self-caused)
 *   - Final scope cleanup registered with _scrml_register_cleanup for _scrml_destroy_scope
 *
 * @param {string} scopeId — the meta block's stable scope ID (e.g. "_scrml_meta_1")
 * @param {function} fn — the effect body function, receives a meta API object
 * @param {object|null} capturedBindings — frozen object of lexical bindings at ^{} breakout point
 * @param {object|null} typeRegistry — plain object mapping type names to reflection data
 */
function _scrml_meta_effect(scopeId, fn, capturedBindings, typeRegistry) {
  let cleanupFns = [];
  let currentDeps = new Set();
  let unsubscribers = [];
  let isRunning = false;
  let runCount = 0;
  // S79 audit fix (hardcoded-thresholds A.1): infinite-loop guard cap is
  // overridable via globalThis.__scrml_max_meta_runs. Adopters with complex
  // derived graphs may set this higher (e.g. 1000) before the scrml runtime
  // loads. Tests use a small value (e.g. 5) to exercise the bail path
  // without authoring 101-cycle reactive fixtures. Default 100 (Stripe-
  // shape sensible bound -- big enough to avoid false positives on real
  // reactive cycles, small enough to detect a runaway loop within a few
  // seconds of wall-clock).
  var _scrml_runtime_max_runs = (typeof globalThis !== "undefined" &&
    typeof globalThis.__scrml_max_meta_runs === "number" &&
    globalThis.__scrml_max_meta_runs > 0)
    ? globalThis.__scrml_max_meta_runs
    : 100;
  const MAX_RUNS = _scrml_runtime_max_runs; // infinite loop guard (overridable; see globalThis.__scrml_max_meta_runs)

  function trackingGet(name) {
    // Record dependency if we are inside a tracking context
    if (_scrml_tracking_stack.length > 0) {
      _scrml_tracking_stack[_scrml_tracking_stack.length - 1].add(name);
    }
    return _scrml_state[name];
  }

  function runEffect() {
    if (isRunning) return; // prevent re-entrant execution
    isRunning = true;
    runCount++;
    if (runCount > MAX_RUNS) {
      console.error("[scrml] meta effect " + scopeId + " exceeded " + MAX_RUNS + " re-runs — possible infinite loop");
      isRunning = false;
      return;
    }

    // Run cleanup callbacks from the previous execution (LIFO order)
    for (let i = cleanupFns.length - 1; i >= 0; i--) {
      try { cleanupFns[i](); } catch(e) { console.error("[scrml] meta effect cleanup error:", e); }
    }
    cleanupFns = [];

    // Unsubscribe from all dependencies tracked during the previous run
    for (const unsub of unsubscribers) {
      try { unsub(); } catch(e) {}
    }
    unsubscribers = [];

    // Start dependency tracking for this run
    const newDeps = new Set();
    _scrml_tracking_stack.push(newDeps);

    // Temporarily replace globalThis._scrml_reactive_get with the tracking version.
    // This transparently intercepts ALL @variable reads inside fn, including those
    // inside helper functions called from fn, because compiled output always calls
    // _scrml_reactive_get by name (rewritten from @var at compile time).
    const savedGet = (typeof globalThis !== "undefined" && globalThis._scrml_reactive_get)
      ? globalThis._scrml_reactive_get
      : null;
    if (typeof globalThis !== "undefined") {
      globalThis._scrml_reactive_get = trackingGet;
    }

    // Build the meta API object for this run.
    // meta.cleanup() collects cleanup callbacks for the current run (not scope-level).
    // meta.get uses trackingGet so reads inside fn body are auto-tracked.
    const meta = {
      get: trackingGet,
      set: _scrml_reactive_set,
      subscribe: _scrml_reactive_subscribe,
      emit: function(htmlString) { _scrml_meta_emit(scopeId, htmlString); },
      cleanup: function(cleanupFn) { cleanupFns.push(cleanupFn); },
      scopeId: scopeId,
      bindings: capturedBindings != null ? capturedBindings : null,
      types: {
        reflect: function(name) {
          if (!name || typeof name !== "string") return null;
          if (typeRegistry == null) return null;
          const entry = typeRegistry[name];
          return entry != null ? entry : null;
        }
      },
    };

    try {
      fn(meta);
    } catch(e) {
      console.error("[scrml] meta effect error in " + scopeId + ":", e);
    } finally {
      // Restore the original get function
      if (typeof globalThis !== "undefined") {
        if (savedGet !== null) {
          globalThis._scrml_reactive_get = savedGet;
        } else {
          // savedGet was null, meaning _scrml_reactive_get wasn't on globalThis before.
          // Leave the tracking version since _scrml_reactive_get is defined at module level
          // (not on globalThis) in most environments. The tracking version still returns
          // correct values since it reads _scrml_state directly.
        }
      }
      _scrml_tracking_stack.pop();
      isRunning = false;
    }

    // Subscribe to all variables read during this run
    currentDeps = newDeps;
    for (const dep of currentDeps) {
      const unsub = _scrml_reactive_subscribe(dep, function() {
        // Reset run counter on external reactive trigger (new change, not self-caused)
        runCount = 0;
        runEffect();
      });
      if (typeof unsub === "function") unsubscribers.push(unsub);
    }
  }

  // Register scope-level cleanup: runs when _scrml_destroy_scope(scopeId) is called.
  // Fires all accumulated per-run cleanups and unsubscribes all reactive dependencies.
  _scrml_register_cleanup(function() {
    for (let i = cleanupFns.length - 1; i >= 0; i--) {
      try { cleanupFns[i](); } catch(e) { console.error("[scrml] meta effect final cleanup error:", e); }
    }
    cleanupFns = [];
    for (const unsub of unsubscribers) {
      try { unsub(); } catch(e) {}
    }
    unsubscribers = [];
  }, scopeId);

  // Initial run
  runEffect();
}


// --- Transition CSS injection (§38 transition directives) ---
// Inject transition keyframes and classes into the document head once.
(function() {
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = [
    "@keyframes scrml-fade-in { from { opacity: 0 } to { opacity: 1 } }",
    "@keyframes scrml-fade-out { from { opacity: 1 } to { opacity: 0 } }",
    ".scrml-enter-fade { animation: scrml-fade-in 300ms ease }",
    ".scrml-exit-fade { animation: scrml-fade-out 300ms ease }",
    "@keyframes scrml-slide-in { from { transform: translateY(-20px); opacity: 0 } to { transform: none; opacity: 1 } }",
    "@keyframes scrml-slide-out { from { transform: none; opacity: 1 } to { transform: translateY(-20px); opacity: 0 } }",
    ".scrml-enter-slide { animation: scrml-slide-in 300ms ease }",
    ".scrml-exit-slide { animation: scrml-slide-out 300ms ease }",
    "@keyframes scrml-fly-in { from { transform: translateX(-100%); opacity: 0 } to { transform: none; opacity: 1 } }",
    "@keyframes scrml-fly-out { from { transform: none; opacity: 1 } to { transform: translateX(100%); opacity: 0 } }",
    ".scrml-enter-fly { animation: scrml-fly-in 300ms ease }",
    ".scrml-exit-fly { animation: scrml-fly-out 300ms ease }",
  ].join("\\n");
  document.head.appendChild(style);
})();

// --- §19 Built-in error types ---
// Each error type is a class extending Error with .type and .cause fields.
// The .type field stores the type name as a string for serialization and
// arm pattern matching across the server/client boundary.

class _ScrmlError extends Error {
  constructor(message, opts) {
    super(message ?? "An error occurred");
    this.cause = opts?.cause ?? null;
    // .name and .type set by subclass
  }
}

class NetworkError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "NetworkError";
    this.type = "NetworkError";
  }
}

class ValidationError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ValidationError";
    this.type = "ValidationError";
  }
}

class SQLError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "SQLError";
    this.type = "SQLError";
  }
}

class AuthError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "AuthError";
    this.type = "AuthError";
  }
}

class TimeoutError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "TimeoutError";
    this.type = "TimeoutError";
  }
}

class ParseError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ParseError";
    this.type = "ParseError";
  }
}

class NotFoundError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "NotFoundError";
    this.type = "NotFoundError";
  }
}

class ConflictError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ConflictError";
    this.type = "ConflictError";
  }
}

// ---------------------------------------------------------------------------
// §19.6 / §19.6.8 — errorBoundary runtime support.
//
// The compiler emits the per-binding catch + variant-dispatch inline (see
// emit-event-wiring.ts); this helper provides the loud, non-swallowing logging
// the §19.6.8 B5 backstop requires. It NEVER throws and NEVER hides the error —
// it only reports. The decision to render fallback / re-propagate is made by
// the emitted dispatch, not here.
// ---------------------------------------------------------------------------

function _scrml_error_boundary_log(boundaryId, err) {
  if (typeof console === "undefined") return;
  // A typed scrml '!'-error envelope { __scrml_error, type, variant, data } vs.
  // a host throw — report both shapes loudly with the boundary id for context.
  if (err && typeof err === "object" && err.__scrml_error) {
    if (typeof console.error === "function") {
      console.error(
        "[scrml errorBoundary " + boundaryId + "] caught error variant " +
        (err.type || "Error") + "::" + (err.variant || "?"),
        err,
      );
    }
  } else {
    if (typeof console.error === "function") {
      console.error(
        "[scrml errorBoundary " + boundaryId + "] caught non-! runtime error (host backstop, §19.6.8)",
        err,
      );
    }
  }
}

// §19.6.8 B3 — wrap an uncaught typed error variant (no 'renders', no
// 'fallback') into a host Error so the throw propagates to the nearest
// enclosing boundary's host-JS backstop (inner-catches-first, §19.6.4). The
// wrapped Error carries the original envelope on '.scrmlError' so a debugger /
// log sees the variant. E-ERROR-005 (§19.6.6) makes this path statically
// unreachable for well-typed code; it exists only as the runtime tail of the
// C-hybrid model when an enclosing boundary CAN render the variant.
function _scrml_error_boundary_uncaught(envelope) {
  var msg = "scrml errorBoundary: error variant " +
    ((envelope && envelope.type) || "Error") + "::" +
    ((envelope && envelope.variant) || "?") +
    " has no 'renders' clause and the boundary has no 'fallback' (propagating, §19.6.8 B3)";
  var e = new Error(msg);
  e.scrmlError = envelope;
  return e;
}

// ---------------------------------------------------------------------------
// §35.1 Global input state registry — maps user-supplied id → state object
// ---------------------------------------------------------------------------

const _scrml_input_state_registry = new Map();

// ---------------------------------------------------------------------------
// §35.2 Keyboard input runtime
// ---------------------------------------------------------------------------

const _scrml_input_keyboard_registry = new Map();

function _scrml_input_keyboard_create(id, scopeId) {
  const pressedSet = new Set();
  const justPressedSet = new Set();
  const justReleasedSet = new Set();
  const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
  let lastKey = null;

  function keydownFn(e) {
    const key = e.key;
    if (!pressedSet.has(key)) {
      justPressedSet.add(key);
    }
    pressedSet.add(key);
    modifiers.shift = e.shiftKey;
    modifiers.ctrl = e.ctrlKey;
    modifiers.alt = e.altKey;
    modifiers.meta = e.metaKey;
    lastKey = key;
  }

  function keyupFn(e) {
    const key = e.key;
    pressedSet.delete(key);
    justReleasedSet.add(key);
    modifiers.shift = e.shiftKey;
    modifiers.ctrl = e.ctrlKey;
    modifiers.alt = e.altKey;
    modifiers.meta = e.metaKey;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", keydownFn);
    document.addEventListener("keyup", keyupFn);
  }

  const state = {
    pressed: (key) => pressedSet.has(key),
    justPressed: (key) => justPressedSet.has(key),
    justReleased: (key) => justReleasedSet.has(key),
    get modifiers() { return { ...modifiers }; },
    get lastKey() { return lastKey; },
    _clearFrameState() { justPressedSet.clear(); justReleasedSet.clear(); },
    _keydownFn: keydownFn,
    _keyupFn: keyupFn,
  };

  if (!_scrml_input_keyboard_registry.has(scopeId)) {
    _scrml_input_keyboard_registry.set(scopeId, new Map());
  }
  _scrml_input_keyboard_registry.get(scopeId).set(id, state);
  _scrml_input_state_registry.set(id, state);

  return state;
}

function _scrml_input_keyboard_destroy(id, scopeId) {
  const scopeMap = _scrml_input_keyboard_registry.get(scopeId);
  if (!scopeMap) return;
  const state = scopeMap.get(id);
  if (!state) return;
  if (typeof document !== "undefined") {
    document.removeEventListener("keydown", state._keydownFn);
    document.removeEventListener("keyup", state._keyupFn);
  }
  scopeMap.delete(id);
  if (scopeMap.size === 0) _scrml_input_keyboard_registry.delete(scopeId);
  _scrml_input_state_registry.delete(id);
}

// ---------------------------------------------------------------------------
// §35.3 Mouse input runtime
// ---------------------------------------------------------------------------

const _scrml_input_mouse_registry = new Map();

function _scrml_input_mouse_create(id, scopeId, targetFn) {
  let x = 0, y = 0, buttons = 0, wheel = 0;

  function mousemoveFn(e) { x = e.clientX; y = e.clientY; }
  function mousedownFn(e) { buttons = e.buttons; }
  function mouseupFn(e) { buttons = e.buttons; }
  function wheelfn(e) { wheel += e.deltaY; }

  const target = (targetFn ? targetFn() : null) || (typeof document !== "undefined" ? document : null);

  if (target) {
    target.addEventListener("mousemove", mousemoveFn);
    target.addEventListener("mousedown", mousedownFn);
    target.addEventListener("mouseup", mouseupFn);
    target.addEventListener("wheel", wheelfn);
  }

  const state = {
    get x() { return x; },
    get y() { return y; },
    get buttons() { return buttons; },
    pressed(button) { return !!(buttons & (1 << button)); },
    get wheel() { return wheel; },
    _clearFrameState() { wheel = 0; },
    _mousemoveFn: mousemoveFn,
    _mousedownFn: mousedownFn,
    _mouseupFn: mouseupFn,
    _wheelfn: wheelfn,
    _target: target,
  };

  if (!_scrml_input_mouse_registry.has(scopeId)) {
    _scrml_input_mouse_registry.set(scopeId, new Map());
  }
  _scrml_input_mouse_registry.get(scopeId).set(id, state);
  _scrml_input_state_registry.set(id, state);

  return state;
}

function _scrml_input_mouse_destroy(id, scopeId) {
  const scopeMap = _scrml_input_mouse_registry.get(scopeId);
  if (!scopeMap) return;
  const state = scopeMap.get(id);
  if (!state) return;
  const t = state._target;
  if (t) {
    t.removeEventListener("mousemove", state._mousemoveFn);
    t.removeEventListener("mousedown", state._mousedownFn);
    t.removeEventListener("mouseup", state._mouseupFn);
    t.removeEventListener("wheel", state._wheelfn);
  }
  scopeMap.delete(id);
  if (scopeMap.size === 0) _scrml_input_mouse_registry.delete(scopeId);
  _scrml_input_state_registry.delete(id);
}

// ---------------------------------------------------------------------------
// §35.4 Gamepad input runtime (polling via requestAnimationFrame)
// ---------------------------------------------------------------------------

const _scrml_input_gamepad_registry = new Map();

function _scrml_input_gamepad_create(id, scopeId, index) {
  let rafHandle = null;
  let connected = false;
  let axes = [];
  let gamepadButtons = [];

  function poll() {
    const gamepads = (typeof navigator !== "undefined" && navigator.getGamepads)
      ? navigator.getGamepads()
      : [];
    const gp = gamepads[index] || null;
    if (gp) {
      connected = true;
      axes = Array.from(gp.axes);
      gamepadButtons = gp.buttons.map(b => ({ pressed: b.pressed, value: b.value }));
    } else {
      connected = false;
    }
    if (typeof requestAnimationFrame !== "undefined") {
      rafHandle = requestAnimationFrame(poll);
    }
  }

  if (typeof requestAnimationFrame !== "undefined") {
    rafHandle = requestAnimationFrame(poll);
  }

  const state = {
    get connected() { return connected; },
    get axes() { return axes; },
    get buttons() { return gamepadButtons; },
    pressed(idx) { return gamepadButtons[idx] ? gamepadButtons[idx].pressed : false; },
    _stop() {
      if (rafHandle !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    },
  };

  if (!_scrml_input_gamepad_registry.has(scopeId)) {
    _scrml_input_gamepad_registry.set(scopeId, new Map());
  }
  _scrml_input_gamepad_registry.get(scopeId).set(id, state);
  _scrml_input_state_registry.set(id, state);

  return state;
}

function _scrml_input_gamepad_destroy(id, scopeId) {
  const scopeMap = _scrml_input_gamepad_registry.get(scopeId);
  if (!scopeMap) return;
  const state = scopeMap.get(id);
  if (!state) return;
  state._stop();
  scopeMap.delete(id);
  if (scopeMap.size === 0) _scrml_input_gamepad_registry.delete(scopeId);
  _scrml_input_state_registry.delete(id);
}

// ---------------------------------------------------------------------------
// §45 Structural equality — deep value comparison for structs and enums
// ---------------------------------------------------------------------------

function _scrml_structural_eq(a, b, seen) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  // Cycle guard: value-cycles are FORBIDDEN in scrml (§6.5.1 reassignment-
  // canonical), but a malformed JS-host value reaching == could still carry
  // one. Track visited (a, b) pairs so a revisit terminates instead of
  // stack-overflowing. seen maps each a-object to the WeakSet of b-objects
  // already compared against it. The standard structural-eq cycle convention
  // is assume-equal-on-revisit: the only way to reach a matching (a, b)
  // revisit is a structurally-matching cyclic shape.
  if (seen === undefined) seen = new WeakMap();
  let seenBs = seen.get(a);
  if (seenBs === undefined) {
    seenBs = new WeakSet();
    seen.set(a, seenBs);
  } else if (seenBs.has(b)) {
    return true;
  }
  seenBs.add(b);
  // Array comparison (for tuple-like fields)
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!_scrml_structural_eq(a[i], b[i], seen)) return false;
    }
    return true;
  }
  // §59 Value-native map: order-INDEPENDENT structural equality (§59.9). Two
  // maps are equal iff they have the same canonical-key set with structurally-
  // equal values, regardless of insertion / iteration order. This holds EVEN
  // for @ordered maps — == ignores order (the \`order\` sidecar is NOT compared);
  // @ordered governs iteration, not equality. Gate on the __scrml_map tag FIRST
  // so non-map values fall through to the array / enum / struct branches with
  // their existing behavior unchanged.
  if (a.__scrml_map === true || b.__scrml_map === true) {
    if (a.__scrml_map !== true || b.__scrml_map !== true) return false;
    var aEntries = a.entries;
    var bEntries = b.entries;
    var aMapKeys = Object.keys(aEntries);
    var bMapKeys = Object.keys(bEntries);
    if (aMapKeys.length !== bMapKeys.length) return false;
    for (var mk = 0; mk < aMapKeys.length; mk++) {
      var ckey = aMapKeys[mk];
      // Same canonical-key set (canonical strings are collision-free for
      // distinct values, §59.5 — so key-string presence IS key-identity).
      if (!Object.prototype.hasOwnProperty.call(bEntries, ckey)) return false;
      if (!_scrml_structural_eq(aEntries[ckey].v, bEntries[ckey].v, seen)) return false;
    }
    return true;
  }
  // Enum: compare tag + payload
  if (a._tag !== undefined && b._tag !== undefined) {
    if (a._tag !== b._tag) return false;
    // Unit variant (no payload beyond _tag)
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (key === "_tag") continue;
      if (!_scrml_structural_eq(a[key], b[key], seen)) return false;
    }
    return true;
  }
  // Struct: field-by-field comparison
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!_scrml_structural_eq(a[key], b[key], seen)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fine-grained reactivity primitives (Reactivity Phase 1)
// ---------------------------------------------------------------------------

/**
 * Effect tracking context stack.
 * Each entry is { deps: Map<target, Set<prop>> } where target is a reactive proxy's
 * backing object and prop is the property name read during the effect.
 */
const _scrml_effect_stack = [];

/**
 * WeakMap from backing object → Map<prop, Set<effectFn>>
 * Tracks which effects depend on which properties of which objects.
 */
const _scrml_prop_subscribers = new WeakMap();

/**
 * WeakMap from backing object → Proxy. Ensures we return the same Proxy for the
 * same object (identity stability).
 */
const _scrml_proxy_cache = new WeakMap();

/**
 * WeakMap from Proxy → backing object. Used by _scrml_deep_reactive to unwrap
 * if a Proxy is passed in.
 */
const _scrml_proxy_targets = new WeakMap();

/**
 * Track a property read for the current effect context.
 * @param {object} target — the backing object
 * @param {string|symbol} prop — the property key
 */
let _scrml_tracking_paused = false;

function _scrml_track(target, prop) {
  if (_scrml_tracking_paused) return;
  if (_scrml_effect_stack.length === 0) return;
  const current = _scrml_effect_stack[_scrml_effect_stack.length - 1];
  if (!current.deps.has(target)) current.deps.set(target, new Set());
  current.deps.get(target).add(prop);
}

/**
 * Run fn without tracking property reads.
 * Used by reconcile_list to avoid tracking every item.id access
 * in the key extraction loop — the list only needs to track the
 * array itself, not individual item properties.
 */
function _scrml_untracked(fn) {
  _scrml_tracking_paused = true;
  try { return fn(); } finally { _scrml_tracking_paused = false; }
}

/**
 * Trigger all effects that depend on target[prop].
 * @param {object} target — the backing object
 * @param {string|symbol} prop — the property key
 */
function _scrml_trigger(target, prop) {
  const propMap = _scrml_prop_subscribers.get(target);
  if (!propMap) return;
  const effects = propMap.get(prop);
  if (!effects) return;
  // Copy to avoid mutation during iteration.
  // Each effect is wrapped in try/catch so that a throwing effect (e.g. a
  // derived expression that evaluates null.property) does not halt the
  // trigger loop or propagate up to the reactive-set caller — Bug K.
  if (__SCRML_PERF) {
    const __t_eff = __SCRML_PERF_NOW();
    for (const effect of [...effects]) {
      try { effect(); } catch(e) { console.error("scrml effect error:", e); }
    }
    __SCRML_PERF.effect_scheduling.ms += __SCRML_PERF_NOW() - __t_eff;
    __SCRML_PERF.effect_scheduling.count++;
    return;
  }
  for (const effect of [...effects]) {
    try { effect(); } catch(e) { console.error("scrml effect error:", e); }
  }
}


/**
 * Array methods that mutate and should trigger reactivity.
 */
const _scrml_array_mutators = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"
]);

/**
 * Wrap an object or array in a deep reactive Proxy.
 *
 * - Property reads track dependencies for the current effect
 * - Property writes trigger only effects that read THAT property
 * - Nested objects are lazily wrapped on access
 * - Array mutating methods (push/pop/splice/etc.) trigger via Proxy set trap
 *
 * @param {*} value — the value to wrap
 * @returns {*} — Proxy-wrapped if object/array, otherwise the value unchanged
 */
function _scrml_deep_reactive(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  // Unwrap if already a proxy
  const unwrapped = _scrml_proxy_targets.get(value);
  if (unwrapped) return value; // already a proxy, return as-is

  // Return cached proxy if we already wrapped this object
  if (_scrml_proxy_cache.has(value)) return _scrml_proxy_cache.get(value);

  const proxy = new Proxy(value, {
    get(target, prop, receiver) {
      // Track the read
      if (typeof prop === "string" || typeof prop === "symbol") {
        _scrml_track(target, prop);
      }

      const val = Reflect.get(target, prop, receiver);

      // For array mutating methods, return a wrapped version that triggers "length"
      if (Array.isArray(target) && typeof prop === "string" && _scrml_array_mutators.has(prop) && typeof val === "function") {
        return function(...args) {
          const result = val.apply(target, args);
          // Trigger length and the array itself to notify effects
          _scrml_trigger(target, "length");
          _scrml_trigger(target, prop);
          return result;
        };
      }

      // Lazily wrap nested objects
      if (val !== null && typeof val === "object" && !_scrml_proxy_targets.has(val)) {
        return _scrml_deep_reactive(val);
      }

      return val;
    },

    set(target, prop, newValue, receiver) {
      const oldValue = target[prop];
      const result = Reflect.set(target, prop, newValue, receiver);
      if (oldValue !== newValue) {
        _scrml_trigger(target, prop);
        // For arrays, setting an index also changes length conceptually
        if (Array.isArray(target) && typeof prop === "string" && /^\\d+$/.test(prop)) {
          _scrml_trigger(target, "length");
        }
      }
      return result;
    },

    deleteProperty(target, prop) {
      const had = prop in target;
      const result = Reflect.deleteProperty(target, prop);
      if (had) {
        _scrml_trigger(target, prop);
      }
      return result;
    },
  });

  _scrml_proxy_cache.set(value, proxy);
  _scrml_proxy_targets.set(proxy, value);
  return proxy;
}

// §20.8.2 Client-Router region reactivity (navigate-wave1b, findings #1/#2).
//
// Disposers for reactive-display effects bound to elements INSIDE the persistent
// shell's outlet. The soft-nav rehydrator wires the outlet's display effects
// through _scrml_region_track(el, _scrml_effect(fn)) instead of the bare form, so each
// outlet-region effect's disposer lands here; _scrml_teardown_region drains + runs
// the list before the next swap (no leak, no double-update). Shell effects
// (outside the outlet) go through the bare _scrml_effect and persist. A page with
// no outlet never registers anything (the closest() check fails).
var _scrml_region_cleanups = [];

// Track a reactive-display effect's disposer for region teardown WHEN its target
// element is inside the shell outlet. Wraps the disposer returned by a bare
// _scrml_effect(fn) (the codegen emits _scrml_region_track(el, _scrml_effect(fn)),
// preserving the _scrml_effect(fn) shape) so the next soft-nav swap can dispose it
// (no leak / no double-update). Shell effects (element outside the outlet) fail
// the closest() check and are left untracked so they persist. Returns the
// disposer unchanged.
function _scrml_region_track(el, dispose) {
  if (el && typeof el.closest === "function" && el.closest("[data-scrml-outlet]")) {
    _scrml_region_cleanups.push(dispose);
  }
  return dispose;
}

/**
 * Create a reactive effect that auto-tracks property-level dependencies.
 *
 * Runs fn immediately, recording which reactive properties it reads.
 * When any tracked property changes, fn is re-run (after clearing old deps).
 *
 * Supports nested effects — inner effects don't leak deps to outer.
 *
 * @param {function} fn — the effect function
 * @returns {function} dispose — call to stop the effect and clean up subscriptions
 */
function _scrml_effect(fn) {
  let disposed = false;
  let cleanupEntries = []; // Array of { target, prop } for subscriber removal

  function effectFn() {
    if (disposed) return;

    // Remove old subscriptions
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(effectFn);
      }
    }
    cleanupEntries = [];

    // Push tracking context
    const ctx = { deps: new Map() };
    _scrml_effect_stack.push(ctx);

    // S139 Bug 11 (6nz-V class-binding on for-lift) fix — each _scrml_effect
    // owns its own tracking scope; un-pause around fn() so a paused outer
    // caller (e.g. _scrml_reconcile_list setting _scrml_tracking_paused=true
    // to suppress Proxy item.id reads from leaking onto the outer effect's
    // deps) does NOT silently swallow the nested effect's own dependency
    // tracking. Without this, per-item attribute-interpolation effects
    // registered during reconcile never subscribe and never re-fire.
    const wasPaused = _scrml_tracking_paused;
    _scrml_tracking_paused = false;
    try {
      fn();
    } finally {
      _scrml_tracking_paused = wasPaused;
      _scrml_effect_stack.pop();
    }

    // Subscribe to all tracked properties
    for (const [target, props] of ctx.deps) {
      if (!_scrml_prop_subscribers.has(target)) {
        _scrml_prop_subscribers.set(target, new Map());
      }
      const propMap = _scrml_prop_subscribers.get(target);
      for (const prop of props) {
        if (!propMap.has(prop)) propMap.set(prop, new Set());
        propMap.get(prop).add(effectFn);
        cleanupEntries.push({ target, prop });
      }
    }
  }

  // Initial run
  effectFn();

  // Return dispose function
  return function dispose() {
    disposed = true;
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(effectFn);
      }
    }
    cleanupEntries = [];
  };
}

/**
 * Static effect — like _scrml_effect but deps are tracked only on the first run.
 * Subsequent re-runs skip the cleanup/re-track/re-subscribe cycle entirely.
 * Use for effects that always read the same reactive properties (e.g. list reconcile).
 * DO NOT use for effects with conditional deps.
 */
function _scrml_effect_static(fn) {
  let disposed = false;
  let cleanupEntries = [];
  let hasRun = false;

  function effectFn() {
    if (disposed) return;

    if (hasRun) {
      fn();
      return;
    }

    const ctx = { deps: new Map() };
    _scrml_effect_stack.push(ctx);
    // S139 Bug 11 (6nz-V) fix — symmetric with _scrml_effect: each effect
    // owns its own tracking scope; un-pause around fn() so a paused outer
    // caller does NOT silently swallow this effect's first-run dep tracking.
    const wasPaused = _scrml_tracking_paused;
    _scrml_tracking_paused = false;
    try { fn(); } finally {
      _scrml_tracking_paused = wasPaused;
      _scrml_effect_stack.pop();
    }

    for (const [target, props] of ctx.deps) {
      if (!_scrml_prop_subscribers.has(target)) _scrml_prop_subscribers.set(target, new Map());
      const propMap = _scrml_prop_subscribers.get(target);
      for (const prop of props) {
        if (!propMap.has(prop)) propMap.set(prop, new Set());
        propMap.get(prop).add(effectFn);
        cleanupEntries.push({ target, prop });
      }
    }
    hasRun = true;
  }

  effectFn();

  return function dispose() {
    disposed = true;
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(effectFn);
      }
    }
    cleanupEntries = [];
  };
}

/**
 * Create a computed reactive value.
 *
 * Lazily evaluates fn when .value is accessed. Caches result until a tracked
 * dependency changes. Is itself reactive — effects that read .value track it.
 *
 * @param {function} fn — the computation function
 * @returns {{ readonly value: * }} — object with a reactive .value getter
 */
function _scrml_computed(fn) {
  let cachedValue;
  let dirty = true;
  let disposed = false;
  let cleanupEntries = [];

  function recompute() {
    // Remove old subscriptions
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(invalidate);
      }
    }
    cleanupEntries = [];

    // Push tracking context
    const ctx = { deps: new Map() };
    _scrml_effect_stack.push(ctx);

    try {
      cachedValue = fn();
    } finally {
      _scrml_effect_stack.pop();
    }

    dirty = false;

    // Subscribe to tracked properties with invalidate (not recompute)
    for (const [target, props] of ctx.deps) {
      if (!_scrml_prop_subscribers.has(target)) {
        _scrml_prop_subscribers.set(target, new Map());
      }
      const propMap = _scrml_prop_subscribers.get(target);
      for (const prop of props) {
        if (!propMap.has(prop)) propMap.set(prop, new Set());
        propMap.get(prop).add(invalidate);
        cleanupEntries.push({ target, prop });
      }
    }
  }

  function invalidate() {
    if (disposed) return;
    dirty = true;
    // Trigger effects that depend on this computed's backing object
    _scrml_trigger(_computed_backing, "value");
  }

  // Backing object for tracking by effects that read .value
  const _computed_backing = {};

  const computed = {
    get value() {
      // Track that this computed's value was read
      _scrml_track(_computed_backing, "value");
      if (dirty) recompute();
      return cachedValue;
    },
    dispose() {
      disposed = true;
      for (const entry of cleanupEntries) {
        const propMap = _scrml_prop_subscribers.get(entry.target);
        if (propMap) {
          const effects = propMap.get(entry.prop);
          if (effects) effects.delete(invalidate);
        }
      }
      cleanupEntries = [];
    },
  };

  return computed;
}

// ---------------------------------------------------------------------------
// §55.10 Error message resolution runtime (chunk: 'messages')
// ---------------------------------------------------------------------------
// 4-level chain (L12). Levels 1 → 2 → 3 (Level 4 is the consumer-side
// \`<match for=ValidationError>\` escape hatch — not in this catalog).
//
//   Level 1: per-(cell,validator) inline override on field declaration
//            (highest priority; static-string only per L12 Edge F).
//            Stored by C10's emitter via _scrml_messages_register_inline.
//   Level 2: project-registered messages — \`registerMessages({...})\`.
//            Stored as enum-tag → (fieldName, ...payload) → string.
//   Level 3: shipped English defaults — _SCRML_DEFAULT_MESSAGES below.
//            Always available zero-config floor.
//
// Chunk-detection trigger: any state-decl whose validators[] contains an
// entry with a non-null \`inlineOverride\`, OR (future, C11) any \`<errors of=>\`
// element. When neither is present this chunk is tree-shaken out entirely.
//
// Cross-references:
//   - SPEC §55.10 (lines 25243-25301) — 4-level chain
//   - SPEC §55.9  (lines 25212-25241) — ValidationError enum (14 + Custom)
//   - SPEC §41.12 (lines 17073-17115) — registerMessages API + messageFor
//   - PA-SCRML-PRIMER §8 — validators + auto-synth surface
//   - compiler/src/codegen/emit-messages.ts — Level-1 codegen emission

// Level-1 storage: keys are "<cellName>::<validatorName>"; values are
// override strings. \`::\` is collision-safe (cell names cannot contain it).
const _scrml_messages_inline = {};

// Level-2 storage: keys are ValidationError enum tags ("Required",
// "MinFailed", "Custom", etc.); values are (fieldName, ...payload) => string.
const _scrml_messages_registered = {};

// Tag → validator name mapping for Level-1 inline override lookup. Mirrors
// the validator-catalog at compile time but lives here so Level-1 lookup
// is self-contained at runtime. Custom maps to "custom" (developer-defined).
const _SCRML_TAG_TO_VALIDATOR = {
  Required:        "req",
  NotSome:         "is some",
  LengthFailed:    "length",
  PatternMismatch: "pattern",
  MinFailed:       "min",
  MaxFailed:       "max",
  GtFailed:        "gt",
  LtFailed:        "lt",
  GteFailed:       "gte",
  LteFailed:       "lte",
  EqFailed:        "eq",
  NeqFailed:       "neq",
  OneOfFailed:     "oneOf",
  NotInFailed:     "notIn",
  Custom:          "custom",
};

// Format a relational-predicate payload like { op: ">=", value: 2 } → ">= 2".
// Used by LengthFailed default. Payload may be null/undefined defensively.
function _scrml_format_predicate(p) {
  if (p && typeof p === "object" && typeof p.op === "string") {
    return p.op + " " + p.value;
  }
  return String(p);
}

// Format a set/array payload for OneOfFailed / NotInFailed defaults.
function _scrml_format_set(s) {
  if (Array.isArray(s)) return s.map(v => String(v)).join(", ");
  return String(s);
}

// Level-3 default catalog. Each entry takes (fieldName, payload) and returns
// a non-condescending professional string. Payload shape matches the
// ValidationError enum at SPEC §55.9 (e.g., MinFailed has \`threshold\`).
// Uses string concatenation rather than template literals so we don't have to
// escape every \\\${} inside this template-literal runtime source.
const _SCRML_DEFAULT_MESSAGES = {
  Required:        function (f) { return f + " is required."; },
  NotSome:         function (f) { return f + " is required."; },
  LengthFailed:    function (f, p) { return f + " length must satisfy " + _scrml_format_predicate(p) + "."; },
  PatternMismatch: function (f) { return f + " doesn't match the expected format."; },
  MinFailed:       function (f, p) { return f + " must be at least " + p + "."; },
  MaxFailed:       function (f, p) { return f + " must be at most " + p + "."; },
  GtFailed:        function (f, p) { return f + " must be greater than " + p + "."; },
  LtFailed:        function (f, p) { return f + " must be less than " + p + "."; },
  GteFailed:       function (f, p) { return f + " must be greater than or equal to " + p + "."; },
  LteFailed:       function (f, p) { return f + " must be less than or equal to " + p + "."; },
  EqFailed:        function (f, p) { return f + " must equal " + p + "."; },
  NeqFailed:       function (f, p) { return f + " cannot equal " + p + "."; },
  OneOfFailed:     function (f, p) { return f + " must be one of: " + _scrml_format_set(p) + "."; },
  NotInFailed:     function (f, p) { return f + " cannot be any of: " + _scrml_format_set(p) + "."; },
  Custom:          function (f, p) { return f + " failed validation (" + p + ")."; },
};

// Fallback for unknown/future tags. Keeps messageFor total — never throws,
// never returns undefined.
function _scrml_messages_fallback(fieldName) {
  return fieldName + " is invalid.";
}

// Extract payload values as a positional array for Level-2 function call. The
// payload-key per tag is documented at runtime-validators.js:36-49.
function _scrml_extract_payload(error) {
  switch (error.tag) {
    case "Required":
    case "NotSome":
      return [];
    case "LengthFailed":    return [error.predicate];
    case "PatternMismatch": return [error.re];
    case "MinFailed":       return [error.threshold];
    case "MaxFailed":       return [error.threshold];
    case "GtFailed":        return [error.expected];
    case "LtFailed":        return [error.expected];
    case "GteFailed":       return [error.expected];
    case "LteFailed":       return [error.expected];
    case "EqFailed":        return [error.expected];
    case "NeqFailed":       return [error.forbidden];
    case "OneOfFailed":     return [error.set];
    case "NotInFailed":     return [error.set];
    case "Custom":          return [error.tag_string != null ? error.tag_string : error.customTag];
    default:                return [];
  }
}

// First payload value (for default-catalog single-arg use). Keeps the default
// catalog signature simple: \`(field, payload) => string\`.
function _scrml_extract_payload_first(error) {
  const arr = _scrml_extract_payload(error);
  return arr.length > 0 ? arr[0] : undefined;
}

/**
 * Level-1 storage emission — called by C10-emitted code at module init.
 * Key shape: cellName + "::" + validatorName.
 */
function _scrml_messages_register_inline(cellName, validatorName, override) {
  _scrml_messages_inline[cellName + "::" + validatorName] = override;
}

/**
 * Level-2 registration — public facade for \`registerMessages\` (stdlib re-export).
 * Last-write-wins per variant key per SPEC §41.12 line 17096. Composes across
 * multiple calls (each call merges into the table).
 *
 * @param {Object} map — \`{ Required: (field) => "...", MinFailed: (field, n) => "...", ... }\`
 */
function _scrml_messages_register(map) {
  if (!map || typeof map !== "object") return;
  for (const tag of Object.keys(map)) {
    const fn = map[tag];
    if (typeof fn === "function") {
      _scrml_messages_registered[tag] = fn;
    }
  }
}

/**
 * messageFor — the 4-level resolution walker. Returns the user-facing string
 * for a ValidationError-shaped object. Always returns a string (never throws,
 * never returns undefined) so consumers can render unconditionally.
 *
 * @param {Object} error      — \`{ tag: "...", ...payload }\` per §55.9 + runtime-validators
 * @param {string} fieldName  — display name of the field (passed by C11)
 * @param {string} [cellName] — qualified cell name (\`signup.email\`); needed for Level-1 lookup
 * @returns {string}
 */
function _scrml_message_for(error, fieldName, cellName) {
  if (!error || typeof error !== "object" || typeof error.tag !== "string") {
    return _scrml_messages_fallback(fieldName);
  }
  const tag = error.tag;

  // Level 1: per-(cell, validator) inline override. Validator name maps from
  // ValidationError tag (e.g., "Required" → "req", "MinFailed" → "min"). Only
  // checks if cellName given (consumer must pass it for L1 to fire).
  if (typeof cellName === "string" && cellName.length > 0) {
    const validatorName = _SCRML_TAG_TO_VALIDATOR[tag];
    if (typeof validatorName === "string") {
      const inlineKey = cellName + "::" + validatorName;
      if (Object.prototype.hasOwnProperty.call(_scrml_messages_inline, inlineKey)) {
        return _scrml_messages_inline[inlineKey];
      }
    }
  }

  // Level 2: project-registered. Function takes (fieldName, ...payloadValues).
  const registeredFn = _scrml_messages_registered[tag];
  if (typeof registeredFn === "function") {
    const payloadArgs = _scrml_extract_payload(error);
    try {
      const result = registeredFn(fieldName, ...payloadArgs);
      if (typeof result === "string") return result;
    } catch (_e) {
      // Fall through to Level 3 if user-supplied function throws.
    }
  }

  // Level 3: shipped English default for the tag.
  const defaultFn = _SCRML_DEFAULT_MESSAGES[tag];
  if (typeof defaultFn === "function") {
    const payload = _scrml_extract_payload_first(error);
    return defaultFn(fieldName, payload);
  }

  // Unknown tag — fallback (never undefined).
  return _scrml_messages_fallback(fieldName);
}

// ---------------------------------------------------------------------------
// §41.14.7 Label resolution — project-wide Level-2 store (within 'messages' chunk).
// ---------------------------------------------------------------------------
// 4-level label resolution chain per SPEC §41.14.7 (highest precedence first):
//
//   Level 1: Slot override — <slot name="<fieldName>"> body owns the label.
//   Level 2: Project-registered — \`registerLabels({TypeName: {field: "..."}})\`
//            (THIS STORE).
//   Level 3: Type-field annotation — \`@label("...")\` (RESERVED for v1.next).
//   Level 4: Mechanical default — title-cased field name.
//
// v1.0 the formFor expander always resolves to Level 4. \`registerLabels\` seeds
// this store so v1.next Level-2 consultation lights up without API churn at
// the call site. Calls today work unchanged when Level-2 lookup lands.
//
// Stored shape: { TypeName: { fieldName: "Display label" } }. Composes across
// multiple calls — outer-key MERGE, inner-key OVERLAY (last-write-wins per
// (struct, field)). Mirrors registerMessages composition semantics (§41.12).
//
// Co-located with the messages chunk because (a) the helpers are tiny and
// don't justify a separate chunk; (b) both stores are project-wide app-text
// registries called from the same top-level boot positions; (c) future
// 4-level chain consultation will share the formFor / errors emission paths
// that already pull \`messages\`. Tree-shaken with \`messages\`.

const _scrml_labels_registered = {};

/**
 * Level-2 label registration — public facade for \`registerLabels\` (stdlib re-export).
 * Last-write-wins per (TypeName, fieldName) per SPEC §41.14.7. Composes across
 * multiple calls (each call merges into the table; inner objects overlay).
 *
 * @param {Object} map — \`{ TypeName: { fieldName: "Display label", ... }, ... }\`
 */
function _scrml_labels_register(map) {
  if (!map || typeof map !== "object") return;
  for (const typeName of Object.keys(map)) {
    const fields = map[typeName];
    if (!fields || typeof fields !== "object") continue;
    const existing = _scrml_labels_registered[typeName] || {};
    for (const fieldName of Object.keys(fields)) {
      const label = fields[fieldName];
      if (typeof label === "string") {
        existing[fieldName] = label;
      }
    }
    _scrml_labels_registered[typeName] = existing;
  }
}

/**
 * Resolve a struct-field label via the 4-level chain. v1.0 walks Level 2 →
 * Level 4 (Levels 1 and 3 are RESERVED — see header comment). Always returns
 * a string (never throws, never returns undefined) so consumers can render
 * unconditionally.
 *
 * @param {string} typeName    — struct type name (e.g., "Signup")
 * @param {string} fieldName   — struct field name (e.g., "email")
 * @returns {string}           — display label
 */
function _scrml_label_for(typeName, fieldName) {
  // Level 2: project-registered lookup.
  const fields = _scrml_labels_registered[typeName];
  if (fields && typeof fields[fieldName] === "string") {
    return fields[fieldName];
  }
  // Level 4: mechanical default — title-cased field name with intra-word
  // boundary detection. Matches mechanicalLabel() in emit-form-for.ts.
  if (!fieldName) return "";
  const spaced = String(fieldName).replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.replace(/(^|\\s)([a-z])/g, function(_m, p1, p2) {
    return p1 + p2.toUpperCase();
  });
}

// ---------------------------------------------------------------------------
// §51.0.F + §51.0.G Engine state-machine runtime hooks (chunk: 'engine')
// ---------------------------------------------------------------------------
// C13: rule= contract enforcement on the auto-declared engine variable.
//
// Substrate from C12 (per-engine, compile-time-baked):
//   - __scrml_engine_<varName>_transitions — Object.freeze({...}) keyed by
//     from-variant. Entries: ["X"] (single), ["A","B"] (multi), "*" (wildcard
//     escape hatch), [] (terminal — no transitions).
//   - The variant cell uses standard reactive substrate; current variant via
//     _scrml_reactive_get(varName) (returns bare-string variant tag), write
//     via _scrml_reactive_set(varName, value).
//
// This chunk adds three helpers:
//   - _scrml_engine_check_transition(currentVariant, target, table)
//       Pure boolean predicate. Looks up the from-variant entry; legal iff
//       the entry is "*" OR includes the target. No side effects.
//   - _scrml_engine_advance(varName, target, table, timersTable, idleEntry, internalTable, historyMap)
//       For \`@var.advance(.X)\`. Reads current variant, checks, throws with
//       "asserted advance failed" framing on failure, else sets the cell.
//       Per §51.0.G "loud failure" semantics. Returns true on EXTERNAL
//       transition, false on INTERNAL transition (§51.0.O). Codegen gates
//       the post-commit hook-firing call on the return value.
//   - _scrml_engine_direct_set(varName, target, table, timersTable, idleEntry, internalTable, historyMap)
//       For \`@var = .X\`. Reads current variant, checks, throws plain
//       E-ENGINE-INVALID-TRANSITION on failure, else sets the cell.
//       Per §51.0.F direct-write enforcement (Move 12). Returns the same
//       external/internal boolean as _scrml_engine_advance.
//
// A5-7 Wave 2.2 (§51.0.O): when internalTable is non-null AND the target is
// internal-legal from the current variant, the internal write-path runs:
// the cell value updates WITHOUT firing subscribers, no <onTransition>
// hooks fire, no timer clear/arm, no history-cell write. The helper returns
// false so the codegen-emitted post-commit hook-firing call is skipped.
// The idle watchdog DOES reset (§51.0.R — internal is engine activity).
//
// A5-7 Wave 2.3 (§51.0.N, Bug #3): when historyMap is non-null AND the
// EXTERNAL branch is taken AND currentVariant is a key in historyMap AND
// currentVariant !== target (real outer-exit, not self-loop), the helper
// captures the inner-engine variant from \`_scrml_state[historyMap[current]]\`
// into the synth history cell \`_scrml_state["_" + varName + "_" + current
// + "_history"]\` BEFORE the cell write. The internal branch explicitly
// skips this capture (per §51.0.O — internal does not exit the composite,
// so its history is never written). The history cell is read-only from
// user code (synth — §51.0.N "synth cell"); writes from anywhere outside
// these helpers are not addressable through any user-authored expression.
//
// Both throwing helpers funnel through _scrml_engine_check_transition so
// the lookup logic exists in exactly one place. Codegen emits ONE call per
// write site — no per-call message construction.

function _scrml_engine_check_transition(currentVariant, target, table) {
  if (table == null) return false;
  // S95 Bug 2 — normalize both sides to the bare tag string. Unit variants
  // are stored as bare strings; payload-bearing variants as \`{ variant, data }\`
  // tagged-objects (SPEC §51.3.2 Implementation notes, landed S22). The
  // transition table is keyed/valued by bare tags, so both sides need
  // extraction. Self-write idempotent check and the \`entry.indexOf(target)\`
  // lookup both depend on tag-shaped comparands.
  const fromTag = _scrml_engine_variant_tag(currentVariant);
  const toTag = _scrml_engine_variant_tag(target);
  const entry = table[fromTag];
  if (entry === "*") return true;
  if (Array.isArray(entry) && entry.indexOf(toTag) !== -1) return true;
  return false;
}

// S95 Bug 2 — Extract the bare tag string from an enum variant value.
// Unit variants are stored as bare strings (\`"Idle"\`); payload-bearing
// variants as \`{ variant: "X", data: {...} }\` tagged-objects per SPEC §51.3.2.
// Used by engine helpers + dispatchers that need to switch / compare against
// the variant tag without caring whether a payload is present. Returns the
// input untouched when neither shape applies (defensive; non-variant values
// are not legitimate engine cell values and would already be a contract
// violation at the codegen level).
function _scrml_engine_variant_tag(value) {
  if (value != null && typeof value === "object" && typeof value.variant === "string") {
    return value.variant;
  }
  return value;
}

// A5-7 Wave 2.4 (§51.0.Q.1 + §51.0.N, Bug #2) — pending-history-restore flag map.
// Keyed by outer engine var name; value is the target outer variant tag when the
// most recent write to that outer var was the .Tag.history structured target
// form. Read+cleared by the outer dispatcher's composite-arm postMountJs after
// the inner mount slot lands in DOM. When the flag is set AND the synth cell
// _scrml_state["_<outerVar>_<targetTag>_history"] is non-null, the inner cell
// restores from the synth cell. When unset OR cell null, the inner falls
// through to its initial= attribute (per §51.0.N empty-history fallback).
//
// The flag is SET by _scrml_engine_direct_set / _scrml_engine_advance when
// the codegen-emitted 8th arg (isHistoryRestore) is true. The flag is CLEARED
// by the dispatcher (postMountJs) immediately after consumption so subsequent
// non-history-form writes don't accidentally restore.
const _scrml_engine_pending_history_restore = {};

// A5-7 Wave 2.3 (§51.0.N, Bug #3) — Capture the inner-engine variant into
// the synth history cell on an external outer-exit. Called by both
// _scrml_engine_advance and _scrml_engine_direct_set in the EXTERNAL branch
// BEFORE the cell write, when historyMap is non-null AND historyMap[current]
// names an inner-engine var.
//
// The "real exit" guard (current !== target) ensures a self-loop transition
// (rule=.X from .X) doesn't capture stale state — a self-loop is conceptually
// equivalent to a re-entry, where the inner re-initializes per §51.0.N + Q.1.
// (Self-loop semantics may evolve; current conservative behavior is "do not
// capture on self-loop"; if user-feedback flags this as wrong, the guard can
// be widened.)
function _scrml_engine_history_capture_on_exit(varName, current, target, historyMap) {
  if (historyMap == null) return;
  if (current === target) return; // self-loop — not a real exit, do not capture
  var innerVarName = historyMap[current];
  if (typeof innerVarName !== "string" || innerVarName.length === 0) return;
  // Capture the inner-engine var's current value into the synth cell.
  // The synth cell key matches the codegen convention in
  // emit-engine.ts:engineHistoryCellKey: "_<outerVar>_<currentVariant>_history".
  var cellKey = "_" + varName + "_" + current + "_history";
  // Read inner directly from _scrml_state (synth cells / engine cells live
  // in the same flat reactive store).
  _scrml_state[cellKey] = _scrml_state[innerVarName];
}

function _scrml_engine_advance(varName, target, table, timersTable, idleEntry, internalTable, historyMap, isHistoryRestore) {
  // timersTable (optional, A5-4): per-state-tag timer-config map for engines
  // with at least one <onTimeout>. When provided, clear-on-exit fires before
  // the cell write and arm-on-entry fires after. When null/undefined (engines
  // with zero <onTimeout>), the timer paths short-circuit (no-op).
  // internalTable (optional, A5-7 Wave 2.2 §51.0.O): per-engine INTERNAL
  // transition table. When provided AND the target is internal-legal from
  // the current variant, the internal write-path runs (no subscriber fire,
  // no <onTransition>, no timer arm/clear, no history) and the helper returns
  // false. Otherwise (or when internalTable is null), the canonical external
  // path runs and returns true. Codegen gates the post-commit hook-firing
  // call on this boolean.
  // historyMap (optional, A5-7 Wave 2.3 §51.0.N): per-engine HISTORY MAP
  // {outerVariantTag → innerEngineVarName}. When provided AND the EXTERNAL
  // branch is taken AND current is a key in the map AND current !== target,
  // the helper captures _scrml_state[innerEngineVarName] into the synth
  // cell _scrml_state["_" + varName + "_" + current + "_history"] BEFORE
  // the cell write. The internal branch (above) skips this capture by
  // construction (no real exit).
  const current = _scrml_reactive_get(varName);
  // S95 Bug 2 — normalize both sides to bare tag for control-flow decisions.
  // The CELL writes still store the full \`target\` (which may be a payload-
  // bearing \`{ variant, data }\` tagged-object); only the tag is used for
  // rule= comparison, self-write detection, timer/history lookup keys, and
  // the pending-history-restore flag (which lives in tag space).
  const currentTag = _scrml_engine_variant_tag(current);
  const targetTag = _scrml_engine_variant_tag(target);
  // §51.0.F (v0.3 Option-d synthesis) — IDEMPOTENT SELF-WRITE NO-OP.
  // When target equals the current variant, this is a self-write — by spec
  // a true no-op (NOT a rule= violation, even when the from-state's rule=
  // does not list itself). No <onTransition> fires, no history capture,
  // no timer rearm, no idle-watchdog reset, no subscriber fire. Returns
  // false (matches the "no external transition occurred" signal so any
  // caller that gates post-commit hooks on the return value treats this
  // as a non-event).
  // Precedent: _scrml_engine_history_capture_on_exit:2390 already short-
  // circuits self-loops as "not a real exit"; this guard makes the front-
  // door helpers consistent with that intuition. W-ENGINE-SELF-WRITE-DETECTED
  // (info-level) surfaces the no-op at compile time when statically detectable.
  //
  // S95 Bug 2 — self-write detection runs on TAGS (a payload-bearing self-
  // write \`@phase = .Dragging(otherId)\` is a tag-identity self-write — same
  // state-child, just refreshing payload). Re-evaluating semantics here:
  // SPEC §51.0.F.1 frames idempotency as "self-write to the current variant"
  // which is variant-identity, not value-identity. A payload-refresh self-
  // write IS a tag self-write under this spec — runtime no-op. If adopters
  // need payload-refresh-fires-subscribers semantics in the future, that's
  // a SPEC amendment, not a runtime change here.
  if (currentTag === targetTag) return false;
  // A5-7 Wave 2.2 — internal-path check FIRST. Per §51.0.O an internal
  // transition is preferred when both an internal rule and an external rule
  // permit the same target (canonical example: composite self-loop
  // internal-rule=.Playing from .Playing; if the user also has
  // rule=.Playing for some reason, the internal semantics win — they're
  // the more-specific "stay in place" intent).
  if (internalTable != null && _scrml_engine_check_transition(currentTag, targetTag, internalTable)) {
    // §51.0.O internal write path:
    //   - Update the cell value WITHOUT firing subscribers (variant-guard
    //     dispatcher would tear down + re-create the arm body, including the
    //     inner engine — which is exactly what internal:rule= avoids).
    //   - SKIP <onTransition> hook fire (helper returns false; codegen gates).
    //   - SKIP timer clear/arm (timers are state-child-scoped; the composite
    //     did not exit — timers stay armed).
    //   - SKIP history-cell write (§51.0.N — internal does not write history).
    //   - DO reset the idle watchdog: §51.0.R counts ANY transition as
    //     engine activity, internal included.
    _scrml_state[varName] = target;
    if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
    return false;
  }
  if (!_scrml_engine_check_transition(currentTag, targetTag, table)) {
    throw new Error(
      "E-ENGINE-INVALID-TRANSITION: asserted advance failed. " +
      "Variable: " + varName + ". Move: ." + String(currentTag) + " => ." + String(targetTag) +
      ". The from-state's rule= contract does not permit this target."
    );
  }
  // A5-7 Wave 2.3 §51.0.N — history capture on EXTERNAL outer-exit. Fires
  // BEFORE the cell write so the captured inner variant reflects the state
  // at the moment of exit (not after any side effect of the write). Tree-
  // shaken via null historyMap.
  //
  // S95 Bug 2 — pass currentTag (not raw \`current\`) so history-cell key
  // construction operates on tag space. The captured inner-engine value
  // stored in the synth cell IS the inner cell value (also potentially a
  // tagged-object — handled by the inner engine's read sites).
  if (historyMap != null) _scrml_engine_history_capture_on_exit(varName, currentTag, targetTag, historyMap);
  // A5-7 Wave 2.4 §51.0.Q.1 — set the pending-history-restore flag BEFORE
  // the cell write (which fires the outer dispatcher's subscriber). The
  // dispatcher composite-arm postMountJs reads the flag, restores inner
  // from the synth cell when set, and clears the flag. Tree-shaken via
  // isHistoryRestore default-false.
  //
  // S95 Bug 2 — historyMap is keyed by tag (outerVariantTag → innerVarName),
  // pending-restore flag is keyed by tag too. Use targetTag.
  if (isHistoryRestore === true && historyMap != null && historyMap[targetTag] != null) {
    _scrml_engine_pending_history_restore[varName] = targetTag;
  }
  // Clear timers attached to the OUTGOING state-child first (timers belong
  // to the from-state — the spec semantics are "armed on entry, cleared on
  // exit"). Re-entering the same state-child clears + re-arms below.
  //
  // S95 Bug 2 — timersTable is keyed by tag (state-child names map directly).
  if (timersTable != null) _scrml_engine_clear_state_timers(varName, currentTag, timersTable);
  _scrml_reactive_set(varName, target);
  // Arm timers for the INCOMING state-child. Re-entering the same state-child
  // (current === target) re-arms a fresh timer per §51.12.4 reset semantics.
  if (timersTable != null) _scrml_engine_arm_state_timers(varName, targetTag, timersTable, table);
  // A5-6 §51.0.R — reset the engine's idle watchdog on every successful
  // transition (machine-wide event-timeout). idleEntry is null when the
  // engine declares no <onIdle> (tree-shake).
  if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
  return true;
}

function _scrml_engine_direct_set(varName, target, table, timersTable, idleEntry, internalTable, historyMap, isHistoryRestore) {
  // timersTable: see _scrml_engine_advance above.
  // idleEntry (A5-6 §51.0.R): per-engine event-timeout watchdog config or null.
  // internalTable (A5-7 Wave 2.2 §51.0.O): per-engine internal transition
  // table or null. Returns true on external transition, false on internal.
  // historyMap (A5-7 Wave 2.3 §51.0.N): per-engine history map or null. See
  // _scrml_engine_advance above for full semantics.
  const current = _scrml_reactive_get(varName);
  // S95 Bug 2 — tag-space normalization (see _scrml_engine_advance for the
  // full rationale). The cell stores the full target value (payload-bearing
  // variants are \`{ variant, data }\`); transition-table lookups, self-write
  // detection, history-map / pending-restore lookups, and timer-table
  // lookups all operate in tag space.
  const currentTag = _scrml_engine_variant_tag(current);
  const targetTag = _scrml_engine_variant_tag(target);
  // §51.0.F (v0.3 Option-d synthesis) — IDEMPOTENT SELF-WRITE NO-OP.
  // See _scrml_engine_advance above for the full rationale. A self-write
  // (target === current) is a true no-op, NOT a rule= violation. Returns
  // false (matches the non-external-transition signal). Surfaced at compile
  // time by W-ENGINE-SELF-WRITE-DETECTED (info-level lint).
  if (currentTag === targetTag) return false;
  // A5-7 Wave 2.2 — internal-path check FIRST (see _scrml_engine_advance).
  if (internalTable != null && _scrml_engine_check_transition(currentTag, targetTag, internalTable)) {
    // §51.0.O internal write path — see _scrml_engine_advance for full
    // rationale. Side-effect-free write: update cell value, do NOT fire
    // subscribers, do NOT touch timers, do NOT touch history. Idle watchdog
    // resets per §51.0.R (internal IS engine activity).
    _scrml_state[varName] = target;
    if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
    return false;
  }
  if (!_scrml_engine_check_transition(currentTag, targetTag, table)) {
    throw new Error(
      "E-ENGINE-INVALID-TRANSITION: illegal direct write to engine variable. " +
      "Variable: " + varName + ". Move: ." + String(currentTag) + " => ." + String(targetTag) +
      ". The from-state's rule= contract does not permit this target."
    );
  }
  // A5-7 Wave 2.3 §51.0.N — history capture on EXTERNAL outer-exit (see
  // _scrml_engine_advance for rationale). Tree-shaken via null historyMap.
  if (historyMap != null) _scrml_engine_history_capture_on_exit(varName, currentTag, targetTag, historyMap);
  // A5-7 Wave 2.4 §51.0.Q.1 — pending-history-restore flag (see
  // _scrml_engine_advance for rationale).
  if (isHistoryRestore === true && historyMap != null && historyMap[targetTag] != null) {
    _scrml_engine_pending_history_restore[varName] = targetTag;
  }
  if (timersTable != null) _scrml_engine_clear_state_timers(varName, currentTag, timersTable);
  _scrml_reactive_set(varName, target);
  if (timersTable != null) _scrml_engine_arm_state_timers(varName, targetTag, timersTable, table);
  if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
  return true;
}

// ---------------------------------------------------------------------------
// 51.0.E engine hydration — S198 (#Approach F A-leg, dynamic initial=@cell)
// ---------------------------------------------------------------------------
// Boot-only runtime-cell hydration. \`initial=@cell\` snapshots the named cell's
// value at engine-construction and seeds the engine variable to it. Hydration is
// CONSTRUCTION, not transition: it asserts the machine WAS at that state, so the
// from-state \`rule=\` guard does NOT apply. This is the GUARD-FREE counterpart of
// _scrml_engine_direct_set — it performs a bare reactive set, never routing
// through the transition guard (which would hard-throw E-ENGINE-INVALID-TRANSITION
// on a non-rule=-legal target).
//
// Decoder boundary: a guard-free construction must not silently corrupt the cell.
// The snapshot may be any persisted value (a DB-status string, a localStorage
// read). If it is absence (null/undefined) or not a legal variant of the engine's
// for=T type, this throws E-ENGINE-INITIAL-INVALID-VARIANT — the runtime
// counterpart of the compile-time static-literal check (symbol-table B15).
//   varName     — the engine's auto-declared variable (51.0.C).
//   snapshot    — the cell value read at construction (a variant string, or a
//                 \`{ variant, data }\` tagged-object for a payload variant).
//   validTags   — the engine's legal state tags (its for=T variant set).
//   forType     — the engine's for= type name (for the error message).
function _scrml_engine_hydrate_init(varName, snapshot, validTags, forType) {
  // Absence is never a valid hydration source (null + undefined do not exist in
  // scrml; an empty/absent persisted value is a decode failure, not a state).
  if (snapshot == null) {
    throw new Error(
      "E-ENGINE-INITIAL-INVALID-VARIANT: engine '" + varName + "' (for=" + forType +
      ") hydrates from a cell that resolved to absence at construction. " +
      "An initial=@cell source must hold a defined " + forType + " variant " +
      "(its value must be resolved at construction — e.g. an SSR/server-loaded " +
      "value, not an async-fetch-on-mount that is not ready yet)."
    );
  }
  // Normalize to the tag: a unit variant is a bare string; a payload variant is
  // a \`{ variant, data }\` tagged-object (the tag selects the legal-state check).
  var tag = _scrml_engine_variant_tag(snapshot);
  var ok = false;
  if (Array.isArray(validTags)) {
    for (var i = 0; i < validTags.length; i++) {
      if (validTags[i] === tag) { ok = true; break; }
    }
  }
  if (!ok) {
    var listed = Array.isArray(validTags) && validTags.length > 0
      ? validTags.map(function (v) { return "." + String(v); }).join(", ")
      : "(none)";
    throw new Error(
      "E-ENGINE-INITIAL-INVALID-VARIANT: engine '" + varName + "' (for=" + forType +
      ") hydrated from a cell whose value '" + String(tag) + "' is not a valid " +
      forType + " variant. Valid variants: " + listed + ". " +
      "The persisted value must decode to a legal " + forType + " state."
    );
  }
  // Guard-free construction set — bare reactive set, NOT _scrml_engine_direct_set
  // (hydration is construction, not a guarded transition).
  _scrml_reactive_set(varName, snapshot);
}

// ---------------------------------------------------------------------------
// 51.0.S engine message dispatch — S155 batch 3 (#14 event-payload-transition)
// ---------------------------------------------------------------------------
// Runtime backbone for \`@<engineVar>.advance(.MsgVariant)\` — the message-plane
// dispatch path (51.0.S.2.5). The codegen STAMPS the plane (state vs message)
// at compile time per 51.0.G.1, so a message-plane \`.advance\` lowers to a call
// to THIS helper instead of \`_scrml_engine_advance\`.
//
// armTable shape (compile-time-baked per engine — see emit-engine.ts
// \`emitEngineMessageArmTable\`). Keyed by from-state tag, then message tag, to
// an arm fn of (stateData, msgData) returning the resolved target state. The
// \`"_"\` key is the wildcard arm (51.0.S.2.4). A state with no message arms is
// absent from the table.
//
// Semantics (51.0.S.3):
//   - The matched arm body ALWAYS runs (effects are the message's purpose) --
//     even when the resolved target equals the current state.
//   - The state-change machinery (onTransition / history / onTimeout) fires
//     iff the resolved target differs from the current state -- achieved by
//     delegating the transition to \`_scrml_engine_advance\`, which no-ops the
//     self-target case per 51.0.F.1.
//   - THE ONE DIVERGENCE (51.0.R handled-message reset): the \`<onIdle>\`
//     watchdog resets EVEN on a same-state arm (a handled message is activity,
//     not silence). \`_scrml_engine_advance\` skips the idle reset on a
//     self-target no-op, so this helper force-resets it after a no-op commit.
//   - A message dispatched to a state with NO arm for it is a runtime no-op
//     (51.0.S.2.6) -- no effect, no transition, no idle reset.
//
// Returns the boolean \`_scrml_engine_advance\` returned (true = external
// transition fired, false = self-target no-op / no arm) so the codegen
// hook-firing wrap can gate the post-commit fire-hooks call on it.
function _scrml_engine_dispatch_message(
  varName, msg, armTable, table, timersTable, idleEntry, internalTable, historyMap
) {
  if (armTable == null) return false;
  // Resolve the dispatched message's tag + payload data. Messages are ordinary
  // enum values: unit variants are bare strings; payload variants are
  // \`{ variant, data }\` tagged-objects per 51.3.2 (same shape as state values).
  var msgTag = _scrml_engine_variant_tag(msg);
  var msgData = (msg != null && typeof msg === "object" && msg.data && typeof msg.data === "object") ? msg.data : null;
  // The CURRENT engine state -- its tag selects the per-state arm map; its data
  // provides the state-payload binding (\`id\` from \`.Dragging(id)\`, 51.0.B.1).
  var current = _scrml_reactive_get(varName);
  var currentTag = _scrml_engine_variant_tag(current);
  var stateData = (current != null && typeof current === "object" && current.data && typeof current.data === "object") ? current.data : null;
  // Find the arm for this (state, message). No arm for the current state, or no
  // arm for this message (and no wildcard) -> no-op (51.0.S.2.6). The
  // exhaustiveness check (51.0.S.2.4) guarantees a state WITH any arms covers
  // the full message set or carries a wildcard, so the only no-op-reachable
  // case is a state that declared NO arms at all.
  var stateArms = armTable[currentTag];
  if (stateArms == null || typeof stateArms !== "object") return false;
  var armFn = stateArms[msgTag];
  if (typeof armFn !== "function") armFn = stateArms["_"]; // 51.0.S.2.4 wildcard
  if (typeof armFn !== "function") return false; // no arm -> no-op
  // Run the arm body (effects ALWAYS run, 51.0.S.3) and resolve the target.
  // The arm fn receives (stateData, msgData) so both payload planes are in
  // scope; its return value is the resolved target state.
  var target = armFn(stateData, msgData);
  // Transition through the canonical advance helper -- it validates against the
  // from-state rule= (51.0.S.2.7 -> E-ENGINE-INVALID-TRANSITION), fires
  // onTransition / history / onTimeout iff target !== current, and resets onIdle
  // on a real transition. Self-target -> no-op (returns false), and we force the
  // idle reset below per 51.0.R handled-message reset.
  var external = _scrml_engine_advance(
    varName, target, table, timersTable, idleEntry, internalTable, historyMap
  );
  // 51.0.R handled-message reset (the 51.0.S.3 divergence): a handled message
  // resets the idle watchdog EVEN on a same-state arm. \`_scrml_engine_advance\`
  // skips the reset on a self-target no-op, so re-assert it here when the arm
  // resolved the current state (external === false) and the engine has an
  // \`<onIdle>\` watchdog.
  if (external === false && idleEntry != null) {
    _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
  }
  return external;
}

// ---------------------------------------------------------------------------
// §51.0.M onTimeout runtime — A5-4 engine state-child timer arm/clear
// ---------------------------------------------------------------------------
// Runtime support for the <onTimeout after=DURATION to=.Variant/> element.
// Backbone is shared with §51.12 (_scrml_machine_arm_timer /
// _scrml_machine_clear_timer); these two helpers provide the per-state-entry
// arm + per-state-exit clear bookkeeping for engine state-children.
//
// timersTable shape (compile-time-baked per engine, see emit-engine.ts):
//   const __scrml_engine_<varName>_timers = Object.freeze({
//     "Loading": [
//       { ms: 30000, target: "TimedOut" },
//       // OR for computed-delay (§51.12.3.1, A5-5):
//       { msExpr: function(){ return Math.min(1000 * 2 ** _scrml_reactive_get("attempt"), 30000) * 1; },
//         target: "Retry" },
//     ],
//     "Idle": [],
//     // ...
//   });
// (Tree-shake: emitted ONLY when the engine has at least one <onTimeout>; for
//  engines with zero timers, codegen passes null for the timersTable arg and
//  these helpers no-op.)
//
// Timer-key encoding (per SCOPE §3 decision #5): varName + "::" + stateName + "::" + index.
// The flat _scrml_machine_timers map is shared with legacy <machine> rules;
// composite keys avoid collision when an app mixes both surfaces or uses the
// same state name across multiple engines.

function _scrml_engine_arm_state_timers(varName, stateName, timersTable, table) {
  // Arm every <onTimeout> entry attached to stateName on engine varName.
  // table is the engine's transition table — needed so the timer's setterFn
  // can route through _scrml_engine_direct_set and enforce the rule= contract
  // at fire time (defensive — A5-3 typer already validated to= compile-time,
  // so a legitimate <onTimeout> never throws here).
  if (timersTable == null) return;
  var list = timersTable[stateName];
  if (!Array.isArray(list) || list.length === 0) return;
  for (var i = 0; i < list.length; i++) {
    var ent = list[i];
    var ms;
    if (typeof ent.ms === "number") {
      // Literal-form duration (constant-folded at compile time).
      ms = ent.ms;
    } else if (typeof ent.msExpr === "function") {
      // Computed-form duration (§51.12.3.1 — S67 amendment, A5-5).
      // The arrow-fn returns the runtime ms value; clamp negative/NaN to 0
      // per spec (equivalent to firing on the next tick per setTimeout).
      var v;
      try { v = ent.msExpr(); } catch (e) { v = 0; }
      ms = (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0;
    } else {
      continue; // malformed entry — defensive skip
    }
    // A5-6 Feature 1 (S79) -- named-timer key. When the entry has 'name',
    // the key uses 'n:NAME' instead of the index, so cancelTimer("NAME")
    // can reconstruct the same key from the same (varName, stateName).
    // Identifier-shape validation at compile time (E-TIMER-NAME-INVALID)
    // guarantees 'name' is never digits-only and so cannot collide with
    // an index-keyed sibling. Defensive runtime: still namespace named
    // entries with the 'n:' prefix to make collisions structurally
    // impossible.
    var keySuffix = (typeof ent.name === "string" && ent.name.length > 0)
      ? "n:" + ent.name
      : String(i);
    var timerKey = varName + "::" + stateName + "::" + keySuffix;
    var target = ent.target;
    // setterFn: route the timer-fire write through the engine's transition
    // table (A5-4 §51.0.M Semantics — a timer-induced transition is a legal
    // transition event that obeys the rule= contract).
    var setterFn = (function (vn, tbl) {
      return function (tg) { _scrml_engine_direct_set(vn, tg, tbl); };
    })(varName, table);
    _scrml_machine_arm_timer(timerKey, ms, target, {
      fromVariant: stateName,
      label: null,
      auditTarget: null,
      rulesJson: null,
      setterFn: setterFn,
    });
  }
}

function _scrml_engine_clear_state_timers(varName, stateName, timersTable) {
  // Clear every timer armed for stateName on engine varName. Called on
  // exit (any rule= transition or external write). No-ops when the state had
  // no <onTimeout> entries OR when the table is null (tree-shake path).
  if (timersTable == null) return;
  var list = timersTable[stateName];
  if (!Array.isArray(list) || list.length === 0) return;
  for (var i = 0; i < list.length; i++) {
    var ent = list[i];
    // A5-6 Feature 1 (S79) -- mirror the keying scheme used at arm time.
    var keySuffix = (ent && typeof ent.name === "string" && ent.name.length > 0)
      ? "n:" + ent.name
      : String(i);
    var timerKey = varName + "::" + stateName + "::" + keySuffix;
    _scrml_machine_clear_timer(timerKey);
  }
}

// A5-6 Feature 1 (SPEC sec 51.0.M name= extension, S79).
// cancelTimer("NAME") -- invoked from within an engine state-child arm body
// (event handler / interpolation expression) -- lowers to a call to this
// helper with the surrounding (varName, stateName) baked in by codegen.
// The helper reconstructs the same composite key the arm-on-entry path used
// and clears just that one timer via the shared _scrml_machine_clear_timer.
//
// Per SPEC sec 51.0.M S79 amendment + SCOPE sec 3.2 Option A:
//   - Names are scope-local to the state-child; cancelTimer can only address
//     timers declared in the SAME state-child. Codegen guarantees this by
//     using the static (varName, stateName) of the enclosing arm.
//   - Unknown names are a runtime no-op (matches clearTimeout(undefined)
//     browser semantics; SCOPE sec 3.3 explicit decision).
//   - Already-fired and not-yet-armed timers are no-ops.
function _scrml_engine_clear_named_timer(varName, stateName, name) {
  if (typeof name !== "string" || name.length === 0) return;
  var timerKey = varName + "::" + stateName + "::n:" + name;
  _scrml_machine_clear_timer(timerKey);
}

// ---------------------------------------------------------------------------
// §51.0.R onIdle runtime — A5-6 engine event-timeout watchdog
// ---------------------------------------------------------------------------
// Runtime support for the <onIdle after=DURATION to=.Variant/> element. One
// watchdog per engine. Armed at module-init alongside the variant cell;
// RESET on every successful transition (any _scrml_engine_direct_set or
// _scrml_engine_advance commit). Fires through the same write-path as a
// direct write — rule= validation applies at fire time.
//
// idleEntry shape (compile-time-baked per engine, see emit-engine.ts):
//   const __scrml_engine_<varName>_idle = {
//     ms: 300000, target: "Idle"
//   };
//   // OR for computed-delay (§51.12.3.1, A5-5):
//   const __scrml_engine_<varName>_idle = {
//     msExpr: function(){ return _scrml_reactive_get("backoffDelay") * 1; },
//     target: "Idle"
//   };
// (Tree-shake: emitted ONLY when the engine declares <onIdle>; codegen passes
//  null when absent and these helpers no-op.)
//
// Timer-key encoding: varName + "::__idle". The "::__idle" suffix cannot
// collide with state-child timer keys (state names start with PascalCase, not
// double-underscore).

function _scrml_engine_arm_idle_watchdog(varName, idleEntry, table) {
  // Arm the engine's machine-wide idle watchdog (A5-6 §51.0.R).
  // table is the engine's transition table — the setterFn routes the
  // watchdog-fire write through _scrml_engine_direct_set so rule= validation
  // applies (§51.0.R sub-A1: rule=-honoring fires).
  if (idleEntry == null) return;
  var ms;
  if (typeof idleEntry.ms === "number") {
    ms = idleEntry.ms;
  } else if (typeof idleEntry.msExpr === "function") {
    var v;
    try { v = idleEntry.msExpr(); } catch (e) { v = 0; }
    ms = (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0;
  } else {
    return; // malformed entry — defensive skip
  }
  var timerKey = varName + "::__idle";
  var target = idleEntry.target;
  var setterFn = (function (vn, tbl) {
    return function (tg) { _scrml_engine_direct_set(vn, tg, tbl); };
  })(varName, table);
  _scrml_machine_arm_timer(timerKey, ms, target, {
    fromVariant: null,
    label: null,
    auditTarget: null,
    rulesJson: null,
    setterFn: setterFn,
  });
}

function _scrml_engine_reset_idle_watchdog(varName, idleEntry, table) {
  // Reset the watchdog: clear any pending timer + re-arm. Called after
  // every successful _scrml_engine_direct_set / _scrml_engine_advance commit
  // (per A5-6 §51.0.R "reset on every transition" semantics). Module-init
  // arm uses _scrml_engine_arm_idle_watchdog directly (no clear needed).
  if (idleEntry == null) return;
  var timerKey = varName + "::__idle";
  _scrml_machine_clear_timer(timerKey);
  _scrml_engine_arm_idle_watchdog(varName, idleEntry, table);
}

// ---------------------------------------------------------------------------
// §59 Value-Native Maps runtime (chunk: 'map')
// ---------------------------------------------------------------------------
//
// A scrml map is a VALUE (§45.6), not an identity object: two maps with the
// same entries are == (§59.9), every "write" returns a NEW map (§59.7), and it
// round-trips losslessly across the §57 wire / SQL-JSON / == (§59.10).
//
// Runtime representation (a tagged plain object — NOT a class; no identity):
//
//   {
//     __scrml_map: true,
//     _root:  <HAMT node>,   // persistent hash-array-mapped trie (entries live here)
//     _count: <int>,         // entry count (O(1) .size)
//     _seq:   <int>,         // next insertion sequence number (drives iteration order)
//     ordered: <bool>,
//     entries: <lazy view>   // NON-stored: a memoized { ck: { k, v } } accessor
//   }                        //            derived from _root (see below)
//
// Internal storage is a HAMT (hash-array-mapped trie / persistent structural-
// sharing) keyed on _scrml_fnv1a(_scrml_value_canonical(k)). A "write" copies
// only the O(log n) path from root to the touched leaf and SHARES every
// untouched subtree — so insert/remove/update are O(log n), not the O(n)
// whole-object copy of the prior COW representation (the standing fix for the
// S94 super-linear insert blow-up). It is STILL pure/immutable: subtrees are
// shared, never mutated in place, so every method returns a NEW map value
// (reassignment-canonical, §59.7) with zero soundness risk — no uniqueness
// analysis needed (FBIP increment 1, "structural sharing not in-place").
//
// Why the canonical STRING (not just the hash) is the identity: the FNV-1a hash
// (_scrml_fnv1a, §47.1.3 / §59.5) only ROUTES the trie path; the full value-
// canonical string (_scrml_value_canonical) is the collision-free key identity
// (two §45-structurally-equal values produce byte-identical strings — the §59.5
// keystone). A leaf stores { ck, k, v, seq, h }: the canonical string ck IS the
// key-equality test (h is its routing hash); genuine hash collisions (distinct
// ck, identical h) collapse into a collision bucket, where ck still decides.
//
// The \`entries\` view (compatibility accessor): the §45 == (§59.9), the value-
// canonical walker (§59.5, nested-map branch), the §20.6 log renderer, and the
// REPLICATED data.js / log-loc.ts copies all read \`m.entries\` as a
// { ck: { k, v } } object. Rather than route every (cross-chunk, cross-realm,
// standalone-replica) reader through a shared accessor, the map object SELF-
// DESCRIBES its view: \`entries\` is a lazily-materialized, MEMOIZED accessor
// (_scrml_map_define_entries) that walks _root once on first read and redefines
// itself as a plain data property. The hot write path (insert/get/has/remove/
// size/keys/values/entries) reads _root DIRECTLY and NEVER touches \`entries\`, so
// it never materializes — the structural-sharing win is preserved. Only the
// inherently-O(n) value-walkers pay the one-time O(n) materialization, and the
// accessor keeps the map a plain JSON-serializable value (the §57 raw round-trip
// stays lossless, alongside the §59.10 codec).
//
// @ordered (§59.8) + iteration order: every leaf carries a monotonic insertion
// \`seq\` (new key -> next seq; overwrite/update REUSES the existing key's seq so
// position is preserved; a removed-then-reinserted key gets a fresh seq and so
// appends — exactly JS object-key semantics). keys()/values()/entries() and the
// \`entries\` view iterate leaves sorted by seq, reproducing the prior
// representation's insertion order BYTE-FOR-BYTE (all canonical-key strings are
// non-integer-index strings, so the prior \`Object.keys\` also yielded insertion
// order). The \`ordered\` FLAG is preserved for the §59.10 codec round-trip and as
// the §59.8 iteration PROMISE; == ignores it (§59.9). The unordered default stays
// "unordered + loud" with zero order sidecar — seq is one int per leaf, not an
// O(n) sidecar array.
//
// Acyclic precondition (the cycles-prereq, scrml 8d9db4e1): value-cycles are
// forbidden in scrml source by construction, so _scrml_value_canonical needs
// NO cycle-guard (unlike _scrml_structural_eq, which kept one defensively for
// malformed JS-host values).

// _scrml_fnv1a(str) — FNV-1a 32-bit hash, output as a zero-padded 8-char base36
// string. Transcribed VERBATIM from compiler/src/codegen/fnv1a-hash.ts (a
// compile-time TS util; the runtime needs its own copy). Constants are
// NORMATIVE (§47.1.3 / §59.5): prime 16777619, offset basis 2166136261.
function _scrml_fnv1a(str) {
  var hash = 2166136261;
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(36).padStart(8, "0");
}

// _scrml_value_canonical(v) — the value-canonical string walker (§59.5).
//
// Serializes a LIVE runtime value deterministically so that two §45-structurally
// -equal values produce BYTE-IDENTICAL strings (the §59.5 keystone, on which map
// key-identity rests). Mirrors the _scrml_structural_eq dispatch SHAPE (array /
// enum-_tag / struct) and the normalizeType alpha-sort discipline, but over LIVE
// values producing a STRING.
//
// Self-delimiting format (every variable-length piece is length-prefixed so
// concatenation is unambiguous — no escape character can collide with
// structural punctuation):
//
//   not / null / undefined  ->  "0:"                (the absence token)
//   boolean                 ->  "b1" | "b0"
//   number                  ->  "n" + canonical-number   (-0 normalized to 0)
//   string                  ->  "s" + length + ":" + raw  (length-prefixed:
//                                content can be ANYTHING incl. ':', '{', etc.)
//   array                   ->  "a" + count + "[" + canon(e0) + canon(e1) ... "]"
//   struct                  ->  "S{" + (for each field, ALPHA-SORTED by name)
//                                  fieldNameLen + ":" + fieldName + canon(value)
//                                "}"
//   enum                    ->  "E" + tagLen + ":" + tag + "("
//                                  (payload fields, ALPHA-SORTED, same encoding
//                                   as struct fields) ")"
//   map (nested value)      ->  "M{" + (entries ORDERED by canonical key string)
//                                  keyCanonLen + ":" + keyCanon + valCanon "}"
function _scrml_value_canonical(v) {
  // not / null / undefined — the absence token (§42; null + undefined both -> not)
  if (v === null || v === undefined) return "0:";
  var t = typeof v;
  if (t === "boolean") return v ? "b1" : "b0";
  if (t === "number") {
    // Normalize -0 -> 0 so the two §45-equal values share a canonical string.
    // String(n) already canonicalizes 1.0 / 1e0 -> "1", 0.5 -> "0.5".
    var n = v === 0 ? 0 : v; // collapses -0 (since -0 === 0) to +0
    return "n" + String(n);
  }
  if (t === "string") {
    return "s" + v.length + ":" + v;
  }
  if (Array.isArray(v)) {
    var out = "a" + v.length + "[";
    for (var i = 0; i < v.length; i++) out += _scrml_value_canonical(v[i]);
    return out + "]";
  }
  // Nested map value (§59.4 — a map may be a VALUE; only KEY types are
  // constrained). Canonicalize its entries ordered by canonical key string.
  if (v && v.__scrml_map === true) {
    var mkeys = Object.keys(v.entries).sort();
    var mout = "M{";
    for (var mi = 0; mi < mkeys.length; mi++) {
      var ck = mkeys[mi];
      mout += ck.length + ":" + ck + _scrml_value_canonical(v.entries[ck].v);
    }
    return mout + "}";
  }
  // Enum: _tag + alpha-sorted payload fields (§59.5 "tag(payload...)").
  if (v && typeof v._tag !== "undefined") {
    var tag = String(v._tag);
    var eout = "E" + tag.length + ":" + tag + "(";
    var eKeys = Object.keys(v).filter(function (k) { return k !== "_tag"; }).sort();
    for (var ei = 0; ei < eKeys.length; ei++) {
      var ek = eKeys[ei];
      eout += ek.length + ":" + ek + _scrml_value_canonical(v[ek]);
    }
    return eout + ")";
  }
  // Struct: fields ALPHA-SORTED by name (mirrors §47.1.4 / normalizeType).
  var sKeys = Object.keys(v).sort();
  var sout = "S{";
  for (var si = 0; si < sKeys.length; si++) {
    var sk = sKeys[si];
    sout += sk.length + ":" + sk + _scrml_value_canonical(v[sk]);
  }
  return sout + "}";
}

// ---------------------------------------------------------------------------
// HAMT primitives (persistent, structural-sharing) — keyed on canonical strings
// ---------------------------------------------------------------------------
//
// Node shapes (all plain JSON-safe objects — no class, no identity):
//   leaf      : { ck, k, v, seq, h }     (a single entry; ck is the identity)
//   bitmap    : { bitmap, nodes }        (sparse 32-way branch; nodes ordered by
//                                          popcount of bitmap, children are leaf
//                                          / bitmap / collision)
//   collision : { collision: true, leaves: [leaf, ...] }   (full-hash ties)
// The root is ALWAYS a bitmap node (empty root === { bitmap: 0, nodes: [] }).

// Route a canonical key string to its uint32 trie path. Reuses the §59.5 /
// §47.1.3 normative _scrml_fnv1a (base36 string) parsed back to its uint32 —
// so there is ONE hash codec, with the constants defined exactly once.
function _scrml_map_hash(ck) {
  return parseInt(_scrml_fnv1a(ck), 36) >>> 0;
}

// Population count (number of set bits) of a uint32 — the child index within a
// bitmap node is the popcount of the bits below the target fragment's bit.
function _scrml_popcount(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

// A leaf is the only node carrying a string \`ck\`; bitmap/collision nodes do not.
function _scrml_map_is_leaf(n) {
  return n && typeof n.ck === "string";
}

// Find the leaf for canonical key \`ck\` (routing by \`hash\`); returns the leaf or
// null. \`node\` is a bitmap node (root). 5-bit fragments => 32-way branching.
function _scrml_hamt_find(node, hash, ck, shift) {
  while (true) {
    var frag = (hash >>> shift) & 31;
    var bit = 1 << frag;
    if ((node.bitmap & bit) === 0) return null;
    var idx = _scrml_popcount(node.bitmap & (bit - 1));
    var child = node.nodes[idx];
    if (child.collision === true) {
      for (var i = 0; i < child.leaves.length; i++) {
        if (child.leaves[i].ck === ck) return child.leaves[i];
      }
      return null;
    }
    if (_scrml_map_is_leaf(child)) return child.ck === ck ? child : null;
    node = child; // descend into the bitmap sub-node
    shift += 5;
  }
}

// Merge two DISTINCT-ck leaves into a sub-node, descending until their hash
// fragments diverge; identical 32-bit hashes (distinct ck) become a collision
// bucket. Returns a bitmap or collision node.
function _scrml_hamt_merge_leaves(a, b, shift) {
  var fa = (a.h >>> shift) & 31;
  var fb = (b.h >>> shift) & 31;
  if (fa !== fb) {
    return { bitmap: (1 << fa) | (1 << fb), nodes: fa < fb ? [a, b] : [b, a] };
  }
  if (shift >= 30) {
    // All 32 hash bits consumed and still equal: a genuine hash collision.
    return { collision: true, leaves: [a, b] };
  }
  return { bitmap: 1 << fa, nodes: [_scrml_hamt_merge_leaves(a, b, shift + 5)] };
}

// Insert/replace \`leaf\` (by its ck) into a collision bucket — path-copies the
// leaves array (structural sharing of the bucket's siblings).
function _scrml_hamt_put_collision(node, leaf) {
  var leaves = node.leaves.slice();
  for (var i = 0; i < leaves.length; i++) {
    if (leaves[i].ck === leaf.ck) { leaves[i] = leaf; return { collision: true, leaves: leaves }; }
  }
  leaves.push(leaf);
  return { collision: true, leaves: leaves };
}

// Insert/replace \`leaf\` into a bitmap node, returning a NEW node that SHARES
// every untouched child (only the O(log n) root->leaf path is copied). The
// caller has already decided \`leaf.seq\` (reuse-on-overwrite, next-on-insert).
function _scrml_hamt_put(node, leaf, shift) {
  var frag = (leaf.h >>> shift) & 31;
  var bit = 1 << frag;
  var idx = _scrml_popcount(node.bitmap & (bit - 1));
  if ((node.bitmap & bit) === 0) {
    var nodes = node.nodes.slice();
    nodes.splice(idx, 0, leaf);
    return { bitmap: node.bitmap | bit, nodes: nodes };
  }
  var child = node.nodes[idx];
  var newChild;
  if (child.collision === true) {
    newChild = _scrml_hamt_put_collision(child, leaf);
  } else if (_scrml_map_is_leaf(child)) {
    newChild = child.ck === leaf.ck ? leaf : _scrml_hamt_merge_leaves(child, leaf, shift + 5);
  } else {
    newChild = _scrml_hamt_put(child, leaf, shift + 5);
  }
  var nodes2 = node.nodes.slice();
  nodes2[idx] = newChild;
  return { bitmap: node.bitmap, nodes: nodes2 };
}

// Remove the leaf for \`ck\` (routing by \`hash\`), returning a NEW node (path-
// copied) or the SAME node if absent (so callers can detect a no-op). Empty
// sub-nodes may linger (harmless: find/iterate skip them) — correctness does
// not depend on canonical-minimal trees, so collapse is intentionally omitted.
function _scrml_hamt_remove(node, hash, ck, shift) {
  var frag = (hash >>> shift) & 31;
  var bit = 1 << frag;
  if ((node.bitmap & bit) === 0) return node; // not present
  var idx = _scrml_popcount(node.bitmap & (bit - 1));
  var child = node.nodes[idx];
  var newChild;
  if (child.collision === true) {
    var leaves = [];
    for (var i = 0; i < child.leaves.length; i++) {
      if (child.leaves[i].ck !== ck) leaves.push(child.leaves[i]);
    }
    if (leaves.length === child.leaves.length) return node; // not found
    newChild = leaves.length === 1 ? leaves[0] : { collision: true, leaves: leaves };
  } else if (_scrml_map_is_leaf(child)) {
    if (child.ck !== ck) return node; // not found
    var droppedNodes = node.nodes.slice();
    droppedNodes.splice(idx, 1);
    return { bitmap: node.bitmap & ~bit, nodes: droppedNodes };
  } else {
    newChild = _scrml_hamt_remove(child, hash, ck, shift + 5);
    if (newChild === child) return node; // not found below
  }
  var nodes = node.nodes.slice();
  nodes[idx] = newChild;
  return { bitmap: node.bitmap, nodes: nodes };
}

// Collect every leaf reachable from \`node\` into \`out\` (traversal order). The
// single iteration primitive behind .size-independent walks, keys/values/
// entries, the == compare, the codec, and the \`entries\` view.
function _scrml_hamt_collect(node, out) {
  if (!node) return;
  if (_scrml_map_is_leaf(node)) { out.push(node); return; }
  if (node.collision === true) {
    for (var i = 0; i < node.leaves.length; i++) out.push(node.leaves[i]);
    return;
  }
  for (var j = 0; j < node.nodes.length; j++) _scrml_hamt_collect(node.nodes[j], out);
}

// All leaves of a map (unordered traversal).
function _scrml_map_leaves(m) {
  var out = [];
  _scrml_hamt_collect(m._root, out);
  return out;
}

// All leaves in ITERATION order (by insertion \`seq\`). This is the single source
// of POSITIONAL CORRESPONDENCE: keys() / values() / entries() and the \`entries\`
// view all derive from it, so observation index i agrees across them (§59.8).
// seq order reproduces the prior representation's Object.keys insertion order
// byte-for-byte (canonical-key strings are never integer-index-like, so the old
// plain-object also iterated in insertion order). For unordered maps this order
// is still "unspecified" per §59.8 — it just HAPPENS to be insertion order, as
// it always has been.
function _scrml_map_leaves_ordered(m) {
  var ls = _scrml_map_leaves(m);
  ls.sort(function (a, b) { return a.seq - b.seq; });
  return ls;
}

// Attach the lazily-materialized, MEMOIZED \`entries\` compatibility view. The
// §45 == (§59.9), _scrml_value_canonical's nested-map branch (§59.5), the §20.6
// log renderer, and the REPLICATED data.js / log-loc.ts copies all read
// \`m.entries\` as a { ck: { k, v } } object. The map object self-describes that
// view here so those (cross-chunk / cross-realm / standalone) readers need NO
// change and NO cross-chunk function reference. On first read the getter walks
// _root once and REDEFINES \`entries\` as a plain data property, so repeated reads
// (e.g. the canonical walker's per-key loop) are O(1) — no O(n^2). It is
// enumerable + plain-data after materialization, so JSON.stringify(map) keeps a
// lossless §57 raw round-trip; the hot write path never reads it, so it never
// materializes (the structural-sharing win stands).
function _scrml_map_define_entries(m) {
  Object.defineProperty(m, "entries", {
    configurable: true,
    enumerable: true,
    get: function () {
      var ls = _scrml_map_leaves_ordered(this);
      var view = {};
      for (var i = 0; i < ls.length; i++) view[ls[i].ck] = { k: ls[i].k, v: ls[i].v };
      Object.defineProperty(this, "entries", {
        value: view, enumerable: true, configurable: true, writable: false,
      });
      return view;
    },
  });
}

// Internal constructor: a fresh map value over the given root/count/seq.
function _scrml_map_new(root, count, seq, ordered) {
  var m = { __scrml_map: true, _root: root, _count: count, _seq: seq, ordered: ordered === true };
  _scrml_map_define_entries(m);
  return m;
}

// ---------------------------------------------------------------------------
// Map construction
// ---------------------------------------------------------------------------

// Build an empty map. The \`ordered\` flag governs §59.8 iteration PROMISE (==
// ignores it, §59.9) and round-trips through the §59.10 codec.
function _scrml_map_empty(ordered) {
  return _scrml_map_new({ bitmap: 0, nodes: [] }, 0, 0, ordered === true);
}

// _scrml_map_from_entries(pairs, ordered) — build a map from an array of
// [key, value] pairs (the literal-lowering entry point; D4 emits this for a
// map literal). Last-wins on duplicate keys (§59.3); the FIRST occurrence fixes
// the key's iteration position (seq), the LAST occurrence fixes its value —
// exactly the prior set-in-place semantics. pairs MAY be empty ([:]).
function _scrml_map_from_entries(pairs, ordered) {
  var m = _scrml_map_empty(ordered);
  if (pairs) {
    for (var i = 0; i < pairs.length; i++) m = _scrml_map_insert(m, pairs[i][0], pairs[i][1]);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Map method surface — all PURE (structural sharing; reassignment-canonical §59.7)
// ---------------------------------------------------------------------------

// _scrml_map_get(m, k) — bracket-read lowering target (§59.6). A key-MISS
// returns null (the \`not\` sentinel — §42 / S89 no-null; not -> JS null), NOT
// undefined, so it composes with given / is some (which test !== null &&
// !== undefined). A STORED \`not\` value is ALSO null; .has(k) disambiguates.
function _scrml_map_get(m, k) {
  if (!m || m.__scrml_map !== true) return null; // graceful on non-map receiver
  var ck = _scrml_value_canonical(k);
  var leaf = _scrml_hamt_find(m._root, _scrml_map_hash(ck), ck, 0);
  return leaf ? leaf.v : null;
}

// _scrml_map_has(m, k) -> bool (§59.6). The disambiguator: a stored \`not\`
// value reads as null via _scrml_map_get, same as an absent key; .has decides.
function _scrml_map_has(m, k) {
  if (!m || m.__scrml_map !== true) return false;
  var ck = _scrml_value_canonical(k);
  return _scrml_hamt_find(m._root, _scrml_map_hash(ck), ck, 0) !== null;
}

// _scrml_map_get_or(m, k, d) — fallback read in one expression (§59.6).
function _scrml_map_get_or(m, k, d) {
  if (!m || m.__scrml_map !== true) return d;
  var ck = _scrml_value_canonical(k);
  var leaf = _scrml_hamt_find(m._root, _scrml_map_hash(ck), ck, 0);
  return leaf ? leaf.v : d;
}

// _scrml_map_insert(m, k, v) — new map with k -> v, overwriting any prior k
// (§59.7). Pure: returns a NEW map that SHARES every untouched subtree of m.
// Overwrite REUSES the key's seq (iteration position preserved); a new key
// takes the next seq (appended).
function _scrml_map_insert(m, k, v) {
  var ck = _scrml_value_canonical(k);
  var h = _scrml_map_hash(ck);
  var existing = _scrml_hamt_find(m._root, h, ck, 0);
  var seq = existing ? existing.seq : m._seq;
  var leaf = { ck: ck, k: k, v: v, seq: seq, h: h };
  var root = _scrml_hamt_put(m._root, leaf, 0);
  return _scrml_map_new(root, existing ? m._count : m._count + 1, existing ? m._seq : m._seq + 1, m.ordered);
}

// _scrml_map_remove(m, k) — new map without k; no-op if absent (§59.7). This is
// the ONLY removal — \`=not\` is NOT a remove (M6); a stored \`not\` survives. The
// _seq counter is monotonic (never reused), so a remove-then-reinsert of the
// same key appends at a fresh position — matching JS delete-then-readd order.
function _scrml_map_remove(m, k) {
  var ck = _scrml_value_canonical(k);
  var h = _scrml_map_hash(ck);
  if (_scrml_hamt_find(m._root, h, ck, 0) === null) {
    return _scrml_map_new(m._root, m._count, m._seq, m.ordered); // no-op, fresh value
  }
  var root = _scrml_hamt_remove(m._root, h, ck, 0);
  return _scrml_map_new(root, m._count - 1, m._seq, m.ordered);
}

// _scrml_map_update(m, k, fn) — upsert: new map with k -> fn(currentOrNot)
// (§59.7). fn receives the current value or \`not\` (null) — no read-modify-write
// race, since this is a single pure expression. Overwrite preserves position.
function _scrml_map_update(m, k, fn) {
  var ck = _scrml_value_canonical(k);
  var h = _scrml_map_hash(ck);
  var existing = _scrml_hamt_find(m._root, h, ck, 0);
  var current = existing ? existing.v : null;
  var seq = existing ? existing.seq : m._seq;
  var leaf = { ck: ck, k: k, v: fn(current), seq: seq, h: h };
  var root = _scrml_hamt_put(m._root, leaf, 0);
  return _scrml_map_new(root, existing ? m._count : m._count + 1, existing ? m._seq : m._seq + 1, m.ordered);
}

// _scrml_map_insert_all(m, other) — bulk merge (§59.7). scrml has no tuple, so
// \`other\` is ANOTHER map of the same key/value types; all of its entries are
// inserted (last-wins on key collision). other's keys are visited in other's
// iteration order, so keys NEW to m append to m in that order. Each fold step is
// an O(log n) structural-sharing insert (no O(n^2) — the prior bulk-clone
// optimization is no longer needed once writes are sub-linear).
function _scrml_map_insert_all(m, other) {
  if (!other || other.__scrml_map !== true) {
    return _scrml_map_new(m._root, m._count, m._seq, m.ordered); // fresh value, no change
  }
  var ls = _scrml_map_leaves_ordered(other);
  var out = m;
  for (var i = 0; i < ls.length; i++) out = _scrml_map_insert(out, ls[i].k, ls[i].v);
  if (out === m) out = _scrml_map_new(m._root, m._count, m._seq, m.ordered); // other empty -> still fresh
  return out;
}

// _scrml_map_size(m) -> int (§59.6). O(1) via the maintained _count. Note: the
// map count member is \`.size\`, diverging from \`.length\` on arrays — intentional.
function _scrml_map_size(m) {
  if (!m || m.__scrml_map !== true) return 0;
  return m._count;
}

// _scrml_map_keys(m) -> [KeyT] (§59.8). Positionally corresponds to values() /
// entries() (all derive from _scrml_map_leaves_ordered).
function _scrml_map_keys(m) {
  var ls = _scrml_map_leaves_ordered(m);
  var out = [];
  for (var i = 0; i < ls.length; i++) out.push(ls[i].k);
  return out;
}

// _scrml_map_values(m) -> [ValT] (§59.8).
function _scrml_map_values(m) {
  var ls = _scrml_map_leaves_ordered(m);
  var out = [];
  for (var i = 0; i < ls.length; i++) out.push(ls[i].v);
  return out;
}

// _scrml_map_entries(m) -> [{ key, value }] (§59.8 / S169 ruling). The entry is
// a two-field STRUCT (scrml has no tuple), NOT a [k, v] tuple. Composes with
// <each in=@m.entries() as e> + e.key / e.value.
function _scrml_map_entries(m) {
  var ls = _scrml_map_leaves_ordered(m);
  var out = [];
  for (var i = 0; i < ls.length; i++) out.push({ key: ls[i].k, value: ls[i].v });
  return out;
}

// _scrml_map_sorted(m) -> [{ key, value }] — entries stabilized by canonical
// key string (the cheap, explicit determinism, §59.8). NOTE: returns an entries
// array (an observation), not a new map.
function _scrml_map_sorted(m) {
  var ls = _scrml_map_leaves(m);
  ls.sort(function (a, b) { return a.ck < b.ck ? -1 : a.ck > b.ck ? 1 : 0; });
  var out = [];
  for (var i = 0; i < ls.length; i++) out.push({ key: ls[i].k, value: ls[i].v });
  return out;
}

// _scrml_map_sorted_by(m, fn) -> [{ key, value }] — entries stabilized by a
// user comparator over the entry structs (§59.8). fn is a standard scrml
// compare-fn (negative / zero / positive).
function _scrml_map_sorted_by(m, fn) {
  var entries = _scrml_map_entries(m); // start from a stable observation
  entries.sort(fn);
  return entries;
}

// ---------------------------------------------------------------------------
// §59.10 Lossless codec — entries-array encoding, canonically ordered.
// ---------------------------------------------------------------------------
//
// Encoded shape:  { __scrml_map_enc: true, ordered: <bool>, entries: [[k, v], ...] }
//
// Entries are ordered by canonical KEY string for BIT-STABILITY across the §57
// wire / SQL-JSON. A stored \`not\`/null VALUE reuses the EXISTING §57
// absence-envelope { __scrml_absent: true } at the leaf (NOT re-invented) so a
// present-\`not\` survives distinctly from an absent key across the wire (§59.10).
// Keys are encoded as-is (a key value is never \`not\` — \`not\` is not a valid key
// since it is not §45-comparable in the key position).
//
// @ordered + codec (a load-bearing call): the \`ordered\` FLAG is preserved, but
// insertion order is NOT carried across the wire — entries always encode in
// canonical key order. Rationale: §59.10 mandates "canonically ordered for
// STABILITY" (two ==-equal maps MUST encode to identical bytes); §59.9 says
// @ordered governs ITERATION, not EQUALITY (== ignores order even for @ordered),
// so insertion order is NOT part of the map's VALUE. Carrying insertion order
// would break bit-stability. The decoded map stays @ordered (the flag round-
// trips) for FUTURE inserts; its post-decode iteration order is canonical. This
// is lossless at the VALUE level (== holds across the round-trip).
function _scrml_map_encode(m) {
  if (!m || m.__scrml_map !== true) return m; // not a map — pass through
  var ls = _scrml_map_leaves(m);
  ls.sort(function (a, b) { return a.ck < b.ck ? -1 : a.ck > b.ck ? 1 : 0; }); // canonical key-string order
  var entries = [];
  for (var i = 0; i < ls.length; i++) {
    // Reuse the §57 absence-envelope at the leaf for a stored \`not\` value.
    var encV = ls[i].v == null ? { __scrml_absent: true } : ls[i].v;
    entries.push([ls[i].k, encV]);
  }
  return { __scrml_map_enc: true, ordered: m.ordered === true, entries: entries };
}

// _scrml_map_decode(x) — reconstruct a tagged map from its encoded form.
// Accepts the canonical { __scrml_map_enc: true, ... } envelope; passes any
// other value through unchanged. Decodes the §57 absence-envelope back to
// \`not\` (null) at the value leaf. Entries arrive in canonical key order (encode
// sorts them), so the rebuilt map's iteration order is canonical — matching the
// §59.10 "post-decode order is canonical" contract.
function _scrml_map_decode(x) {
  if (!x || x.__scrml_map_enc !== true) return x; // not an encoded map
  var m = _scrml_map_empty(x.ordered === true);
  if (x.entries) {
    for (var i = 0; i < x.entries.length; i++) {
      var pair = x.entries[i];
      var v = pair[1];
      // §57 dual-decode the value leaf: envelope OR raw null -> \`not\` (null).
      if (v === null) {
        v = null;
      } else if (v !== null && typeof v === "object" && v.__scrml_absent === true) {
        v = null;
      }
      m = _scrml_map_insert(m, pair[0], v);
    }
  }
  return m;
}

// §52.8 SSR pre-render seed (chunk: 'ssr')
//
// B-substrate (ssr-b-substrate). The compiler-emitted SSR HTML-composition route
// (emit-server.ts) injects <script>window.__scrml_ssr_state={…}</script> before
// </head>, carrying the server-authoritative cell values redacted at the §14.8.9
// egress sink. _scrml_ssr_seed_apply() runs BEFORE the mount fetch decisions and
// the engine hydration (emit-reactive-wiring Step 4c) so each seeded cell is
// construction-resolved: the engine server=@cell ride reads a real value at
// construction (no async fetch-on-mount), and the /__serverLoad fetch IIFEs skip
// the RTT (see _scrml_ssr_seeded). When the page was served WITHOUT SSR (a static
// host, no server in the request path), window.__scrml_ssr_state is absent and
// both helpers are no-ops — the ordinary fetch path runs unchanged (graceful
// degradation, never a crash).
function _scrml_ssr_seeded(name) {
  return typeof window !== "undefined"
    && window.__scrml_ssr_state != null
    && Object.prototype.hasOwnProperty.call(window.__scrml_ssr_state, name);
}
// navigate-wave1b #5 — skipShell gates the SOFT-NAV REHYDRATE path. The fetched
// route's SSR seed carries the persistent shell's program-top-level cells at their
// SSR-INITIAL values; re-applying them on a soft nav would RESET a shell cell the
// user mutated (a nav counter, a sidebar toggle) — breaking the persistent shell
// that is the whole point of the router (§20.8.2 "The shell runtime SHALL NOT be
// re-booted."). Shell membership is a COMPILE-TIME set (_scrml_shell_cells, emitted
// by codegen for the cells declared OUTSIDE the <outlet>/page region). The INITIAL
// page-load call (no skipShell) still seeds EVERY cell — the shell needs its
// first-paint values too; only the rehydrate skips the shell cells.
function _scrml_ssr_seed_apply(skipShell) {
  if (typeof window === "undefined" || window.__scrml_ssr_state == null) return;
  var _seed = window.__scrml_ssr_state;
  var _shell = (skipShell && typeof _scrml_shell_cells !== "undefined") ? _scrml_shell_cells : null;
  for (var _k in _seed) {
    if (Object.prototype.hasOwnProperty.call(_seed, _k)) {
      if (_shell && Object.prototype.hasOwnProperty.call(_shell, _k)) continue; // shell cell — persist the live value
      _scrml_reactive_set(_k, _seed[_k]);
    }
  }
}

// §20.6 log() location-transparent logging runtime (chunk: 'log')
//
// The compiler lowers a log(...args) call to _scrml_log(side, loc, ...args)
// where side is the compiler-certain "server"/"client" classification of the
// call site and loc is the author "basename:line". This helper mirrors the
// _scrml_error_boundary_log discipline: it guards typeof console, NEVER
// throws, and only reports. In PRODUCTION the call is stripped at codegen
// (F4=A) so this helper is never emitted into a release bundle.
//
// Output line: "[side] <rendered args> (loc)".
//   - server log() prints to the dev terminal (this runs in the server bundle).
//   - client log() keeps the browser-console output AND forwards the tagged
//     payload to the dev server (POST /_scrml/log) for the terminal-as-single-
//     view (F2=B) — fire-and-forget, never blocking, never throwing.

// _scrml_log_render(v) — a READABLE, value-faithful render of a scrml value
// (§20.6.4). NOT _scrml_value_canonical (that is a hash-input machine string)
// and NOT JSON.stringify (renders structs/markup poorly, historically threw on
// cycles). Values are acyclic + immutable by construction (§59.5); a depth +
// seen guard is defensive only.
function _scrml_log_render(v, depth, seen) {
  if (typeof depth === "undefined") depth = 0;
  if (typeof seen === "undefined") seen = [];
  // not / null / undefined -> the absence token (§42; both map to not).
  if (v === null || typeof v === "undefined") return "not";
  var t = typeof v;
  if (t === "string") return v;                 // bare text (a log reads it)
  if (t === "number" || t === "boolean") return String(v);
  if (t === "function") return "<fn>";
  if (depth > 8) return "...";                  // defensive depth cap
  if (v && typeof v === "object") {
    if (seen.indexOf(v) !== -1) return "<cycle>"; // defensive (values acyclic)
    seen = seen.concat([v]);
  }
  // Markup-as-value (Pillar 1) — render a readable element summary, not [object].
  if (v && typeof v === "object" && (v.__scrml_markup === true || v.__scrml_el || (typeof v.tag === "string" && (typeof v.children !== "undefined" || typeof v.attrs !== "undefined" || typeof v.attributes !== "undefined")))) {
    var mtag = v.tag || v.__scrml_el || "markup";
    return "<" + String(mtag) + " …/>";
  }
  // Value-native map (§59) — readable { k: v, ... } over entries.
  if (v && v.__scrml_map === true) {
    var mkeys = Object.keys(v.entries);
    var mparts = [];
    for (var mi = 0; mi < mkeys.length; mi++) {
      var ent = v.entries[mkeys[mi]];
      mparts.push(_scrml_log_render(ent.k, depth + 1, seen) + ": " + _scrml_log_render(ent.v, depth + 1, seen));
    }
    return "{" + mparts.join(", ") + "}";
  }
  // Array -> [e0, e1, ...].
  if (Array.isArray(v)) {
    var aparts = [];
    for (var ai = 0; ai < v.length; ai++) aparts.push(_scrml_log_render(v[ai], depth + 1, seen));
    return "[" + aparts.join(", ") + "]";
  }
  // Enum -> Tag or Tag(field: value, ...) (alpha-sorted payload, §59.5 shape).
  if (v && typeof v._tag !== "undefined") {
    var tag = String(v._tag);
    var eKeys = Object.keys(v).filter(function (k) { return k !== "_tag"; }).sort();
    if (eKeys.length === 0) return tag;
    var eparts = [];
    for (var ei = 0; ei < eKeys.length; ei++) {
      eparts.push(eKeys[ei] + ": " + _scrml_log_render(v[eKeys[ei]], depth + 1, seen));
    }
    return tag + "(" + eparts.join(", ") + ")";
  }
  // Struct / plain object -> { field: value, ... } (alpha-sorted, §47.1.4 shape).
  var sKeys = Object.keys(v).sort();
  var sparts = [];
  for (var si = 0; si < sKeys.length; si++) {
    sparts.push(sKeys[si] + ": " + _scrml_log_render(v[sKeys[si]], depth + 1, seen));
  }
  return "{" + sparts.join(", ") + "}";
}

function _scrml_log(side, loc) {
  // Collect + render the variadic value args (args 2..n).
  var rendered = [];
  for (var i = 2; i < arguments.length; i++) {
    var piece;
    try { piece = _scrml_log_render(arguments[i]); }
    catch (e) { piece = "<unrenderable>"; }       // NEVER throw out of log()
    rendered.push(piece);
  }
  var body = rendered.join(" ");
  var locSuffix = (typeof loc === "string" && loc.length > 0) ? " (" + loc + ")" : "";
  var line = "[" + String(side) + "] " + body + locSuffix;

  // Always emit to the local console (server -> terminal; client -> devtools).
  if (typeof console !== "undefined" && typeof console.log === "function") {
    try { console.log(line); } catch (e) { /* never throw */ }
  }

  // Client side (dev only — log() is stripped in production): forward the tagged
  // payload to the dev server's terminal so the developer sees ONE unified view
  // (F2=B terminal-as-single-view). Fire-and-forget; failures are swallowed.
  if (side === "client" && typeof window !== "undefined" && typeof fetch === "function") {
    try {
      fetch("/_scrml/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side: "client", loc: (typeof loc === "string" ? loc : ""), msg: body }),
        keepalive: true,
      }).catch(function () { /* dev server absent / offline — ignore */ });
    } catch (e) { /* never throw */ }
  }
}

${_STDLIB_AUTH_CHUNK}${_STDLIB_CRYPTO_CHUNK}${_STDLIB_DATA_CHUNK}${_STDLIB_HOST_CHUNK}`;

/**
 * Runtime filename used in external mode.
 */
export const RUNTIME_FILENAME = "scrml-runtime.js";
