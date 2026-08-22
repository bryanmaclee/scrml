/**
 * @module nested-program-kind
 *
 * SPEC §4.12.3 — the FOUR nested-`<program>` execution-context types, and the
 * single source of truth for which of them the compiler extracts as a separate
 * compilation unit.
 *
 * §4.12.3 determines the execution context from the ATTRIBUTE COMBINATION:
 *
 * | Type                     | Attributes                            | Runtime model              |
 * |--------------------------|---------------------------------------|----------------------------|
 * | Inline web worker        | `name=`, no `lang=`                   | `new Worker()`, postMessage|
 * | Foreign language sidecar | `name=`, `lang=` (non-WASM language)  | Subprocess with HTTP/socket|
 * | WASM compute module      | `name=`, `lang=`, `mode="wasm"`       | `WebAssembly.instantiate()`|
 * | Scoped DB context        | `name=` (optional), `db=`             | New `?{}` driver scope     |
 *
 * §4.12.2 additionally admits `route=` in nested position ("Declares the nested
 * program as a server endpoint at the given route") — a fifth shape the §4.12.3
 * table does not enumerate.
 *
 * ## Why this module exists (S356 — the operator ruling)
 *
 * `codegen/index.ts`'s `extractWorkerPrograms` used to claim ANY `name=`d nested
 * `<program>` as a §4.12.4 inline web worker. Measured consequence on the shapes
 * that are NOT inline workers:
 *
 * ```
 * <program name="calc" lang="rust" mode="wasm">  ->  app.calc.worker.js (25 bytes)
 *    client: new Worker("app.calc.worker.js")    ->  200 OK, loads,
 *                                                    self.onmessage never assigned
 *    -> `<#calc>.send()` returns a Promise that NEVER RESOLVES (a silent hang)
 * ```
 *
 * The ruling: worker registration is gated to the TRUE §4.12.4 shape — `name=`,
 * no `lang=`, no `mode=`, no `route=`, no `db=`. The other execution-context
 * types emit NEITHER a `new Worker(...)` reference NOR a bundle.
 *
 * The precedent was already in the same file: the §23.4 SIDECAR carve-out
 * splices a `port=` nested program WITHOUT registering a worker, because
 * "a reference to a never-emitted bundle is the misleading client stub the
 * fail-closed build must NOT produce". The other shapes were simply missed by
 * that carve-out; this module generalizes it from `port=` to the whole §4.12.3
 * table.
 *
 * ## Two consumers, one predicate
 *
 * - `compiler/src/codegen/index.ts` — decides splice / register-worker / fire
 *   `E-NESTED-PROGRAM-CONTEXT-NOMINAL`.
 * - `compiler/src/symbol-table.ts` — decides `E-CHANNEL-INSIDE-NESTED-PROGRAM`.
 *   That diagnostic exists because an EXTRACTED subtree loses its channel before
 *   server emission, so its discriminator must be "is the subtree extracted",
 *   not "does it carry `name=`". Keeping the two in one place is what stops them
 *   drifting apart (the `name=`-keyed version produced a FALSE POSITIVE on the
 *   legal §4.12.6 shape `<program name="analytics" db="…">`).
 */

/** A loosely-typed AST node — `attrs` on some builders, `attributes` on others. */
type ASTNodeLike = Record<string, unknown>;

/**
 * The §4.12.3 execution-context type of a nested `<program>`, plus the two
 * shapes the table does not name (`route=` server endpoint, and a nested
 * `<program>` carrying no distinguishing attribute at all).
 */
export type NestedProgramKind =
  /** §4.12.4 — `name=` and nothing else context-bearing. `new Worker()` + postMessage IPC. IMPLEMENTED. */
  | "inline-worker"
  /** §4.12.5 — `name=` + `lang=` (non-WASM) and/or `port=`. Subprocess + HTTP/socket. NOT IMPLEMENTED (§23.4 Nominal). */
  | "foreign-sidecar"
  /** §4.12.3 — `name=` + `mode="wasm"`. `WebAssembly.instantiate()`. NOT IMPLEMENTED. */
  | "wasm-module"
  /** §4.12.2 — `name=` + `route=`. A server endpoint at the given route. NOT IMPLEMENTED. */
  | "server-endpoint"
  /** §4.12.6 — `db=` (`name=` optional). A new `?{}` driver scope. IMPLEMENTED, in-tree. */
  | "scoped-db"
  /** No distinguishing attribute (W-PROGRAM-001 territory). Left in the tree. */
  | "plain";

export interface NestedProgramClassification {
  /** The §4.12.3 execution-context type. */
  kind: NestedProgramKind;
  /** The `name=` value, or `null` when the element carries no `name=`. */
  name: string | null;
}

/**
 * Read an attribute's value as a string, tolerating the three shapes the
 * builders produce: a bare string, a `string-literal` node, and a
 * `variable-ref` node (`@x` — the leading sigil is stripped).
 *
 * Returns `null` when the attribute is absent OR carries a value shape this
 * helper cannot read. Callers that only care about PRESENCE must use
 * `hasNestedProgramAttr`, never `!== null` on this.
 */
export function nestedProgramAttrValue(programNode: unknown, attrName: string): string | null {
  const attrs = readAttrs(programNode);
  const attr = attrs.find((a) => a && (a as ASTNodeLike).name === attrName);
  if (!attr) return null;
  const v = (attr as ASTNodeLike).value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const vn = v as ASTNodeLike;
    if (vn.kind === "string-literal" && typeof vn.value === "string") return vn.value;
    if (vn.kind === "variable-ref" && typeof vn.name === "string") return vn.name.replace(/^@/, "");
  }
  return null;
}

/** TRUE when the `<program>` element carries `attrName` at all, whatever its value shape. */
export function hasNestedProgramAttr(programNode: unknown, attrName: string): boolean {
  return readAttrs(programNode).some((a) => a && (a as ASTNodeLike).name === attrName);
}

function readAttrs(programNode: unknown): unknown[] {
  if (!programNode || typeof programNode !== "object") return [];
  const n = programNode as ASTNodeLike;
  const attrs = (n.attrs ?? n.attributes) as unknown;
  return Array.isArray(attrs) ? attrs : [];
}

/**
 * Classify a nested `<program>` element by its §4.12.3 attribute combination.
 *
 * **Precedence, most-specific-first.** Several context-bearing attributes can
 * co-occur (`lang=` + `mode="wasm"` is the SPEC's own WASM row), so the order is
 * normative here, not incidental:
 *
 * 1. `mode=` → WASM compute module. §4.12.2 defines `mode=` as `"wasm"` for
 *    client-side WASM modules, "omitted for sidecar processes" — so ANY `mode=`
 *    is a WASM-shaped declaration, and a non-`"wasm"` value is a malformed one,
 *    never an inline worker.
 * 2. `lang=` or `port=` → foreign sidecar (§4.12.5). `port=` is kept as a
 *    discriminator for continuity with the ratified §23.4 carve-out, which keyed
 *    on it alone.
 * 3. `route=` → server endpoint (§4.12.2).
 * 4. `db=` → scoped DB context (§4.12.6). This is the ONLY row where `name=` is
 *    optional, so it is also the only row reachable without a `name=`.
 * 5. `name=` and none of the above → §4.12.4 inline web worker.
 * 6. otherwise → `plain`.
 *
 * Rows 1-3 and 5 all require `name=`: they are all referenced from the parent BY
 * NAME (`<#name>.send()`, `use foreign:name`, `callchar{}`), so a nameless one is
 * unreachable by construction and is left in the tree exactly as it was before
 * this module existed (W-PROGRAM-001 governs it).
 *
 * `story=`, `protect=`, `callchar=`, `capabilities=`, `build=` and `health=` are
 * deliberately NOT discriminators: they are compile-axis / annotation attributes
 * that ride ON an execution context rather than selecting one.
 */
export function classifyNestedProgram(programNode: unknown): NestedProgramClassification {
  const name = nestedProgramAttrValue(programNode, "name");
  const hasName = hasNestedProgramAttr(programNode, "name");
  const hasDb = hasNestedProgramAttr(programNode, "db");

  if (hasName) {
    if (hasNestedProgramAttr(programNode, "mode")) return { kind: "wasm-module", name };
    if (hasNestedProgramAttr(programNode, "lang") || hasNestedProgramAttr(programNode, "port")) {
      return { kind: "foreign-sidecar", name };
    }
    if (hasNestedProgramAttr(programNode, "route")) return { kind: "server-endpoint", name };
    if (hasDb) return { kind: "scoped-db", name };
    return { kind: "inline-worker", name };
  }

  if (hasDb) return { kind: "scoped-db", name };
  return { kind: "plain", name };
}

/**
 * TRUE for the ONE shape that gets a `new Worker(…)` reference in the parent and
 * a `<base>.<name>.worker.js` bundle on disk: the §4.12.4 inline web worker.
 *
 * This is the ruling, verbatim: `name=`, no `lang=`, no `mode=`, no `route=`,
 * no `db=` (and, retaining §23.4, no `port=`).
 */
export function isInlineWorkerProgram(programNode: unknown): boolean {
  return classifyNestedProgram(programNode).kind === "inline-worker";
}

/**
 * TRUE when the compiler removes this nested `<program>`'s subtree from the tree
 * before analysis and emission — i.e. when it is a separate compilation unit in
 * practice, not merely in principle.
 *
 * §4.12.8 normative: "The compiler SHALL extract each nested `<program>` as an
 * independent compilation unit before running any analysis pass on its
 * contents." The §4.12.6 SCOPED-DB context is the standing exception: it is not
 * a separate RUNTIME context at all (it re-scopes `?{}` for a subtree that still
 * compiles into the parent), so its subtree stays, and `annotateDbScopes` tags
 * it in place.
 *
 * This is the predicate `E-CHANNEL-INSIDE-NESTED-PROGRAM` keys on: a `<channel>`
 * only loses its server route when the subtree holding it is REMOVED.
 */
export function nestedProgramSubtreeIsExtracted(programNode: unknown): boolean {
  const kind = classifyNestedProgram(programNode).kind;
  return kind === "inline-worker" || kind === "foreign-sidecar" ||
    kind === "wasm-module" || kind === "server-endpoint";
}

/**
 * The §4.12.3 execution-context types whose CODEGEN is Nominal/spec-ahead — the
 * shapes `E-NESTED-PROGRAM-CONTEXT-NOMINAL` refuses.
 *
 * ALL FOUR UNBUILT CONTEXTS, `foreign-sidecar` INCLUDED (S356 r4 ruling). The
 * three revisions before this one carved the sidecar out and tried to say WHEN
 * the carve-out applied; each attempt produced a defect, and every one of them
 * lived in the carve-out:
 *
 * 1. an unconditional exemption gave an UNCLAIMED sidecar no diagnostic at all —
 *    the covering code fires at a `use foreign:` site, and there was none;
 * 2. `<program name="api" route="/api/v1" lang="go">` LAUNDERED past the refusal,
 *    because `lang=` outranks `route=` in the §4.12.3 classifier and so routed a
 *    server endpoint down the exempt path;
 * 3. the conditional carve-out that fixed (1) DOUBLE-FIRED on the two ratified
 *    capability cases, with a message asserting the file contains no
 *    `use foreign:` when line 3 of it does.
 *
 * The common cause is not any of the three conditions: it is that TWO codes said
 * the same thing — *this context is specified but unbuilt; refuse rather than
 * emit a stub* — and were told apart by WHICH SITE NOTICED. `E-FOREIGN-SIDECAR-NOMINAL`
 * is retired; the declaration is the single fire site for all four, so there is
 * no longer a condition to get wrong.
 *
 * The `use foreign:name` REFERENCE keeps its own diagnostic, but for its own
 * condition rather than for Nominal-ness: `E-FOREIGN-010` (§23.4), an unresolved
 * name. That code outlives the Nominal period — `use foreign:ghost` with nothing
 * declaring `ghost` is an error after the sidecar layer lands too.
 */
export function nestedProgramContextIsNominal(kind: NestedProgramKind): boolean {
  return kind === "foreign-sidecar" || kind === "wasm-module" || kind === "server-endpoint";
}

/** Human-readable §4.12.3 context label + runtime model, for diagnostics. */
export function describeNestedProgramKind(kind: NestedProgramKind): { label: string; runtime: string; spec: string } {
  switch (kind) {
    case "inline-worker":
      return { label: "inline web worker", runtime: "`new Worker()` + postMessage IPC", spec: "§4.12.4" };
    case "foreign-sidecar":
      return { label: "foreign language sidecar", runtime: "a subprocess reached over HTTP/socket", spec: "§4.12.5" };
    case "wasm-module":
      return { label: "WASM compute module", runtime: "`WebAssembly.instantiate()`", spec: "§4.12.3" };
    case "server-endpoint":
      return { label: "server endpoint", runtime: "a server route mounted at the declared `route=`", spec: "§4.12.2" };
    case "scoped-db":
      return { label: "scoped DB context", runtime: "a new `?{}` driver scope", spec: "§4.12.6" };
    case "plain":
      return { label: "nested program", runtime: "compiled inline with its parent", spec: "§4.12" };
  }
}
