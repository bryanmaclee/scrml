/**
 * E-IMPL1-RULED-FORM-UNSUPPORTED — impl#1 fails closed on ruled forms it does not implement.
 *
 * Provenance: ruling:user-voice-scrml.md S469 "⭐ RULED — impl#1 refuses ruled forms it doesn't
 * implement" — *"Refuse them in impl#1 (Recommended)"* (*"impl#1 refuses ruled forms it can't compile
 * correctly (`int.parse`, `Enum.parse`, `.append`, and similar) with a diagnostic that points to the
 * bootstrap, instead of emitting them verbatim and crashing at runtime. It fails closed."*). A narrow
 * exception to the S435 impl#1 freeze. Gap: g-impl1-ruled-forms-emitted-verbatim-fail-open-s469.
 *
 * This is an impl#1 LIMIT, not a language rule: every form refused here is valid scrml (SPEC section
 * named in each message), and the bootstrap (`bun run boot:compile`) compiles it.
 *
 * ONE module owns the code, the message and the list of refused forms. The type system calls its two
 * entry points (no codegen site refuses anything):
 *   - `ruledFormOfCall` — from the scope-aware expression walk (`checkLogicExprIdents`), for the
 *     call forms that need scope / receiver types: `T.parse(s)`, `E.parse(s)`, and the tape grow /
 *     shrink methods `append` / `prepend` / `insert` / `remove` on a receiver PROVEN to be a tape.
 *   - `collectRuledStatementForms` — a structural walk over the file's nodes, for the loop heads the
 *     parser records (`for { … }`, `for (cond)`), the range head `a..b` / `a..=b`, and a value-form
 *     block (`match` arm / `for` value body) whose `lift` follows a bare expression statement.
 *
 * Deliberately NOT refused — forms whose impl#1 meaning DIVERGES from the ruling but that legacy code
 * already relies on (string `.length` / positions in UTF-16, `indexOf` → -1, negative `slice` / `at`,
 * mutating `sort` / `reverse` / `fill`, JS `sort()` order, out-of-range `xs[i]` → absent). Changing or
 * refusing those is an owner decision, not a fail-closed fix.
 */

export const RULED_FORM_CODE = "E-IMPL1-RULED-FORM-UNSUPPORTED";

/** The single message builder. `form` is the source spelling; `section` the SPEC section. */
export function ruledFormMessage(form: string, section: string, detail?: string): string {
  return (
    `${RULED_FORM_CODE}: ${form} is ruled scrml (${section}) but impl#1 does not implement it` +
    (detail ? ` — ${detail}` : "") +
    `. Compile with the bootstrap (\`bun run boot:compile\`). ` +
    `This is an impl#1 limit, not a language rule.`
  );
}

export interface RuledFormFinding {
  form: string;
  section: string;
  detail?: string;
  /** The AST node to anchor a span on (statement nodes carry `span`). */
  node?: unknown;
}

// ---------------------------------------------------------------------------
// Call forms (scope-aware)
// ---------------------------------------------------------------------------

/** Primitive type names that are a namespace for `parse` (§14.13.4), plus the legacy synonyms. */
const PARSE_PRIMITIVES: ReadonlyMap<string, string> = new Map([
  ["int", "int"],
  ["number", "number"],
  ["bool", "bool"],
  // §14.13.6: `integer` / `boolean` are type-position synonyms only, never a namespace. impl#1
  // would emit them verbatim (ReferenceError) all the same, so fail closed and name the spelling.
  ["integer", "int"],
  ["boolean", "bool"],
]);

/** The §66.12.6 rule-3 tape methods named after their grants that impl#1 does not implement. */
const TAPE_GRANT_METHODS: ReadonlyMap<string, string> = new Map([
  ["append", "grow at the end"],
  ["prepend", "grow at the front"],
  ["insert", "grow anywhere"],
  ["remove", "shrink anywhere"],
]);

export interface CallFormContext {
  /** Scope lookup for a bare name (no `@`). Returns the binding kind, or null when unbound. */
  lookupKind(name: string): string | null;
  /** The resolved type kind of a type name in the file's registry ("enum", "primitive", …), or null. */
  typeKind(name: string): string | null;
  /** The resolved type kind of a receiver expression ("array", "map", …), or null when unproven. */
  receiverKind(node: unknown): string | null;
}

/**
 * If `call` (an ExprNode of kind "call") is a ruled form impl#1 does not implement, describe it.
 */
export function ruledFormOfCall(call: unknown, ctx: CallFormContext): RuledFormFinding | null {
  if (!call || typeof call !== "object") return null;
  const c = call as { kind?: string; callee?: { kind?: string; object?: unknown; property?: unknown } };
  if (c.kind !== "call" || !c.callee || c.callee.kind !== "member") return null;
  const method = c.callee.property;
  if (typeof method !== "string") return null;
  const obj = c.callee.object as { kind?: string; name?: string } | undefined;

  if (method === "parse" && obj && obj.kind === "ident" && typeof obj.name === "string") {
    const name = obj.name;
    // A local / parameter / cell of that name shadows the type namespace.
    const bound = ctx.lookupKind(name);
    if (bound !== null && bound !== "type") return null;
    const prim = PARSE_PRIMITIVES.get(name);
    if (prim) {
      return {
        form: `\`${name}.parse(s)\``,
        section: "§14.13.4",
        detail: prim === name
          ? `it returns \`${prim} | not\` (strict, whole-string)`
          : `the ruled spelling is \`${prim}.parse(s)\` (§14.13.6), returning \`${prim} | not\``,
      };
    }
    if (ctx.typeKind(name) === "enum") {
      return {
        form: `\`${name}.parse(s)\``,
        section: "§14.13.4",
        detail: `it returns \`${name} | not\`; impl#1 still spells it \`${name}.toEnum(s)\` (§14.4.1)`,
      };
    }
    return null;
  }

  const grant = TAPE_GRANT_METHODS.get(method);
  if (grant && obj) {
    // Only a receiver PROVEN to be a tape: on a map (`insert` / `remove`, §59), a DOM element
    // (`el.remove()`, `el.append(…)`), FormData, classList … the name is a different method.
    if (ctx.receiverKind(obj) !== "array") return null;
    return {
      form: `the tape method \`.${method}(…)\``,
      section: "§66.12.6",
      detail: `\`.${method}\` is a ${grant} write, and impl#1 tapes are JavaScript arrays without it`,
    };
  }
  return null;
}

/**
 * Walk an ExprNode tree (including lambda bodies and template interpolations) and report every
 * ruled call form. `templateNodes` expands a template literal into its interpolation ExprNodes.
 */
export function forEachRuledCallForm(
  root: unknown,
  ctx: CallFormContext,
  templateNodes: (lit: unknown) => unknown[],
  cb: (f: RuledFormFinding) => void,
): void {
  const seen = new WeakSet<object>();
  const shadowStack: Set<string>[] = [];
  const shadowed = (name: string) => shadowStack.some((s) => s.has(name));
  const scopedCtx: CallFormContext = {
    lookupKind: (n) => (shadowed(n) ? "variable" : ctx.lookupKind(n)),
    typeKind: ctx.typeKind,
    receiverKind: (node) => {
      const id = node as { kind?: string; name?: string };
      if (id && id.kind === "ident" && typeof id.name === "string" && shadowed(id.name.replace(/^@/, ""))) return null;
      return ctx.receiverKind(node);
    },
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    const n = node as Record<string, unknown>;
    if (n.kind === "call") {
      const f = ruledFormOfCall(n, scopedCtx);
      if (f) cb({ ...f, node: n });
    }
    if (n.kind === "lit" && n.litType === "template") {
      for (const sub of templateNodes(n)) walk(sub);
      return;
    }
    if (n.kind === "lambda") {
      const names = new Set<string>();
      for (const p of (n.params as Array<{ name?: string }> | undefined) ?? []) {
        if (p && typeof p.name === "string") names.add(p.name);
      }
      shadowStack.push(names);
      for (const key in n) { if (key !== "span") walk(n[key]); }
      shadowStack.pop();
      return;
    }
    for (const key in n) { if (key !== "span") walk(n[key]); }
  };
  walk(root);
}

// ---------------------------------------------------------------------------
// Statement forms (structural)
// ---------------------------------------------------------------------------

/** Strip quoted strings / templates so a `..` inside text is not read as a range. */
function stripStrings(raw: string): string {
  return raw.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
}

/** True when a for-head iterable is a §49.2.5 range (`a..b` / `a..=b`), not a spread. */
export function isRangeIterable(iterable: unknown): boolean {
  if (typeof iterable !== "string" || !iterable.includes("..")) return false;
  return /(^|[^.])\.\s*\.(?!\s*\.)/.test(stripStrings(iterable).replace(/\.\.\./g, "\u0000"));
}

const FN_BOUNDARY_KINDS = new Set(["function-decl", "fn-decl", "function", "fn", "lambda"]);

function containsLift(node: unknown, seen = new WeakSet<object>()): boolean {
  if (!node || typeof node !== "object") return false;
  if (seen.has(node as object)) return false;
  seen.add(node as object);
  if (Array.isArray(node)) return node.some((x) => containsLift(x, seen));
  const n = node as Record<string, unknown>;
  if (n.kind === "lift-expr") return true;
  if (FN_BOUNDARY_KINDS.has(n.kind as string)) return false;
  // A nested value form owns its own lifts.
  if (n.kind === "match-expr" || n.kind === "for-expr" || n.kind === "if-expr") return false;
  for (const key in n) {
    if (key === "span" || key === "parent") continue;
    if (containsLift(n[key], seen)) return true;
  }
  return false;
}

/** A value-form block whose `lift` follows a bare expression statement (impl#1 mis-targets it). */
function liftAfterBareExpr(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  let sawBare = false;
  for (const st of body) {
    if (!st || typeof st !== "object") continue;
    const s = st as Record<string, unknown>;
    if (sawBare && containsLift(s)) return true;
    if (s.kind === "bare-expr") sawBare = true;
  }
  return false;
}

/**
 * Structural walk: every ruled statement form impl#1 does not implement, in source order.
 */
export function collectRuledStatementForms(topNodes: unknown[]): RuledFormFinding[] {
  const out: RuledFormFinding[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown, anchor: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const x of node) walk(x, anchor); return; }
    const n = node as Record<string, unknown>;
    const here = n.span ? n : anchor;
    if (n.kind === "for-stmt" || n.kind === "for-expr") {
      if (n.ruledHead === "infinite") {
        out.push({ form: "the infinite loop `for { … }`", section: "§49.3.6", detail: "impl#1 mis-parses the head (use `for (;;) { … }`)", node: here });
      } else if (n.ruledHead === "condition") {
        out.push({ form: "the condition loop `for (cond) { … }`", section: "§49.3.1", detail: "impl#1 reads the head as `for (x of …)`", node: here });
      } else if (isRangeIterable(n.iterable)) {
        out.push({ form: "the range head `a..b` / `a..=b`", section: "§49.2.5", node: here });
      }
    }
    if (n.kind === "match-expr") {
      for (const arm of (n.body as unknown[] | undefined) ?? []) {
        const a = arm as Record<string, unknown> | null;
        if (a && a.kind === "match-arm-block" && liftAfterBareExpr(a.body)) {
          out.push({ form: "a `match` block arm that yields with `lift` after an expression statement", section: "§18.5", detail: "impl#1 sends the `lift` to the expression's accumulator, so the arm's value is lost", node: here });
        }
      }
    }
    if (n.kind === "for-expr" && liftAfterBareExpr(n.body)) {
      out.push({ form: "a value-form `for` body that yields with `lift` after an expression statement", section: "§49.6", detail: "impl#1 sends the `lift` to the expression's accumulator", node: here });
    }
    for (const key in n) {
      if (key === "span" || key === "parent") continue;
      walk(n[key], here);
    }
  };
  walk(topNodes, null);
  return out;
}

// ---------------------------------------------------------------------------
// Literal-tape names (receiver evidence the type system does not record)
// ---------------------------------------------------------------------------

/**
 * impl#1 infers no type for an array literal (it is an inference gap, `asIs`), so a cell declared
 * `<xs> = [1, 2]` or a local `const ys = []` is not a PROVEN tape to the type system. This pass
 * supplies that evidence, conservatively, by name over the whole file:
 *   - a cell `@name` is a tape when its declaration's initializer is an array literal;
 *   - a local `name` is a tape when EVERY declaration / rebinding of that name in the file has an
 *     array-literal initializer, and the name is never a parameter, a loop binder, a lambda
 *     parameter or a destructured name anywhere in the file.
 * Anything else stays unproven, so a `.remove()` on a DOM element or a map is never refused.
 */
export function collectLiteralTapeNames(topNodes: unknown): Set<string> {
  const cellTape = new Map<string, boolean>();
  const localTape = new Map<string, boolean>();
  const isArrayLit = (e: unknown) => !!e && typeof e === "object" && (e as { kind?: string }).kind === "array";
  const mark = (m: Map<string, boolean>, name: string, tape: boolean) => {
    m.set(name, (m.get(name) ?? true) && tape);
  };
  const markBinderNames = (pat: unknown): void => {
    if (typeof pat === "string") { mark(localTape, pat, false); return; }
    if (!pat || typeof pat !== "object") return;
    if (Array.isArray(pat)) { for (const p of pat) markBinderNames(p); return; }
    const p = pat as Record<string, unknown>;
    for (const k of ["name", "bindName", "local"]) if (typeof p[k] === "string") mark(localTape, p[k] as string, false);
    for (const k of ["properties", "elements", "params", "rest"]) if (p[k]) markBinderNames(p[k]);
  };
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    const n = node as Record<string, unknown>;
    const k = n.kind;
    if (k === "state-decl" && typeof n.name === "string") {
      if (n._isReactiveAssign !== true) mark(cellTape, n.name, isArrayLit(n.initExpr));
    } else if ((k === "const-decl" || k === "let-decl" || k === "tilde-decl" || k === "lin-decl")) {
      if (typeof n.name === "string") mark(localTape, n.name, isArrayLit(n.initExpr));
      else markBinderNames(n.name);
    }
    if (Array.isArray(n.params)) markBinderNames(n.params);
    if ((k === "for-stmt" || k === "for-expr") && n.variable) markBinderNames(n.variable);
    // `<each … as=x>` / handle names and other binders spelled as a string field.
    for (const bk of ["as", "asName", "alias", "binding", "bindName", "variables"]) {
      if (typeof n[bk] === "string") mark(localTape, n[bk] as string, false);
      else if (Array.isArray(n[bk])) markBinderNames(n[bk]);
    }
    for (const key in n) {
      if (key === "span" || key === "parent") continue;
      walk(n[key]);
    }
  };
  walk(topNodes);
  const out = new Set<string>();
  for (const [name, tape] of cellTape) if (tape) out.add("@" + name);
  for (const [name, tape] of localTape) if (tape) out.add(name);
  return out;
}
