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
 * Round 2 (review of dde3d558d): the expression walk also reads the bodies impl#1 keeps as text — a
 * block-bodied arrow / `function` expression (escape hatch, read with escape-hatch-body.ts), a
 * `when … changes` body, a parameter default — and falls back to `lexicalRuledForms` when one cannot
 * be read; the type system's check-only copy walks (handler values, engine bodies, raw arms) keep
 * this code (`COPY_WALK_KEPT_CODES`), and `runTS` collapses repeats per form per line.
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

/**
 * Round 3 (F2): a primitive type name is a namespace for `parse` and nothing else (§14.13.4), and
 * impl#1 binds no such name, so ANY other read of it — `const p = int.parse`, `const { parse } =
 * int`, `int[\`parse\`]`, `int["pa" + "rse"]` — is the same unimplemented ruled form.
 */
export function namespaceValueFinding(name: string): RuledFormFinding {
  const prim = PARSE_PRIMITIVES.get(name) ?? name;
  return {
    form: `\`${name}\` used as a value`,
    section: "§14.13.4",
    detail: `a primitive type name is a namespace for \`parse\` only; call \`${prim}.parse(s)\` directly`,
  };
}

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
  const c = call as { kind?: string; callee?: { kind?: string; object?: unknown; property?: unknown; index?: unknown } };
  if (c.kind !== "call" || !c.callee) return null;
  // `recv.m(…)`, or the bracket spelling `recv["m"](…)` with a string-literal key (round 2, M2).
  let method: unknown;
  if (c.callee.kind === "member") method = c.callee.property;
  else if (c.callee.kind === "index") {
    const ix = c.callee.index as { kind?: string; litType?: string; value?: unknown } | undefined;
    if (ix && ix.kind === "lit" && ix.litType === "string") method = ix.value;
  }
  if (typeof method !== "string") return null;
  const obj = c.callee.object as { kind?: string; name?: string } | undefined;

  if (decodeIdentEscapes(method) === "parse" && obj && obj.kind === "ident" && typeof obj.name === "string") {
    const name = decodeIdentEscapes(obj.name);
    // A local / parameter / cell of that name shadows the type namespace; a type binding or an
    // imported name (an imported enum, resolved through the seeded registry) does not.
    const bound = ctx.lookupKind(name);
    if (bound !== null && bound !== "type" && bound !== "import") return null;
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

  const grant = TAPE_GRANT_METHODS.get(decodeIdentEscapes(method));
  if (grant && obj) {
    // Only a receiver PROVEN to be a tape: on a map (`insert` / `remove`, §59), a DOM element
    // (`el.remove()`, `el.append(…)`), FormData, classList … the name is a different method.
    if (ctx.receiverKind(obj) !== "array") return null;
    return {
      form: `the tape method \`.${decodeIdentEscapes(method)}(…)\``,
      section: "§66.12.6",
      detail: `\`.${method}\` is a ${grant} write, and impl#1 tapes are JavaScript arrays without it`,
    };
  }
  return null;
}

/**
 * Optional readers the walk uses to see bodies an ExprNode keeps only as TEXT (round 2, H2).
 */
export interface BodyReaders {
  /**
   * The statements of a block-bodied arrow / `function` expression the expression parser kept as
   * an escape hatch (`bodyRaw`), or null when the body cannot be read (the walk then falls back
   * to `lexicalRuledForms` over the text, so an unreadable body still fails closed).
   */
  hatchBody?(hatch: Record<string, unknown>): unknown[] | null;
  /** Enum type names in scope (for the lexical `E.parse(` fallback). */
  enumNames?(): Iterable<string>;
}

/**
 * Walk an ExprNode tree (including lambda bodies, template interpolations and the text bodies of
 * escape-hatch functions) and report every ruled form: the call forms, and the statement forms of
 * any block body reached on the way.
 */
export function forEachRuledCallForm(
  root: unknown,
  ctx: CallFormContext,
  templateNodes: (lit: unknown) => unknown[],
  cb: (f: RuledFormFinding) => void,
  readers: BodyReaders = {},
): void {
  const seen = new WeakSet<object>();
  const shadowStack: Set<string>[] = [];
  const tapeStack: Set<string>[] = [];
  const shadowed = (name: string) => shadowStack.some((s) => s.has(name));
  const scopedCtx: CallFormContext = {
    lookupKind: (n) => (shadowed(n) ? "variable" : ctx.lookupKind(n)),
    typeKind: ctx.typeKind,
    receiverKind: (node) => {
      const id = node as { kind?: string; name?: string };
      if (id && id.kind === "ident" && typeof id.name === "string") {
        // A tape bound inside the body being walked (its literal-tape evidence is local to it).
        if (!id.name.startsWith("@") && tapeStack.some((t) => t.has(id.name as string))) return "array";
        if (shadowed(id.name.replace(/^@/, ""))) return null;
      }
      return ctx.receiverKind(node);
    },
  };
  const paramNames = (params: unknown): Set<string> => {
    const names = new Set<string>();
    for (const p of (Array.isArray(params) ? params : []) as Array<{ name?: unknown } | string>) {
      if (typeof p === "string") names.add(p);
      else if (p && typeof p.name === "string") names.add(p.name);
    }
    return names;
  };
  // A block body: its statements are walked for call forms, scanned for statement forms, and its
  // own literal-tape locals are evidence inside it.
  const walkBody = (stmts: unknown[], params: Set<string>): void => {
    const tapes = new Set<string>();
    for (const nm of collectLiteralTapeNames(stmts)) if (!nm.startsWith("@") && !params.has(nm)) tapes.add(nm);
    // Round 3 (F4): a local declared in the body shadows like a parameter, as in a function body.
    const scope = new Set<string>([...params, ...declaredLocalNames(stmts)]);
    shadowStack.push(scope);
    tapeStack.push(tapes);
    for (const f of collectRuledStatementForms(stmts)) cb(f);
    walk(stmts);
    tapeStack.pop();
    shadowStack.pop();
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    const n = node as Record<string, unknown>;
    if (n.kind === "call") {
      const f = ruledFormOfCall(n, scopedCtx);
      if (f) {
        cb({ ...f, node: n });
        // The namespace this call reads is reported once, as the call form.
        const callee = n.callee as { object?: unknown } | undefined;
        if (callee && callee.object && typeof callee.object === "object") seen.add(callee.object as object);
      }
    }
    if (n.kind === "ident" && typeof n.name === "string") {
      const nm = decodeIdentEscapes(n.name);
      if (PARSE_PRIMITIVES.has(nm)) {
        const k = scopedCtx.lookupKind(nm);
        if (k === null || k === "type" || k === "import") cb({ ...namespaceValueFinding(nm), node: n });
      }
      return;
    }
    if (n.kind === "lit" && n.litType === "template") {
      for (const sub of templateNodes(n)) walk(sub);
      return;
    }
    if (n.kind === "escape-hatch") {
      const text = typeof n.bodyRaw === "string" ? n.bodyRaw : typeof n.raw === "string" ? n.raw : "";
      const isFn = n.nativeKind === "ArrowFunctionExpression" || n.nativeKind === "FunctionExpression";
      const shadow = paramNames(n.params);
      if (isFn) {
        const stmts = readers.hatchBody ? readers.hatchBody(n) : null;
        if (Array.isArray(stmts)) {
          walkBody(stmts, shadow);
          for (const nm of declaredLocalNames(stmts)) shadow.add(nm);
        }
      }
      // The text is ALSO matched, readable or not (round 3, F3): a re-read can lose an escape
      // (`\u0069nt` read back as `u0069nt`), and the text keeps it. An unreadable body is matched
      // only here, so it fails closed. Repeats of a structured finding collapse in runTS.
      for (const f of lexicalRuledForms(text, scopedCtx, readers.enumNames ? readers.enumNames() : [], shadow)) cb({ ...f, node: n });
      return;
    }
    if (n.kind === "lambda") {
      const body = n.body as { kind?: string; stmts?: unknown[] } | undefined;
      if (body && body.kind === "block" && Array.isArray(body.stmts)) {
        walkBody(body.stmts, paramNames(n.params));
        for (const p of (n.params as Array<{ defaultValue?: unknown }> | undefined) ?? []) walk(p && p.defaultValue);
        return;
      }
      shadowStack.push(paramNames(n.params));
      for (const key in n) { if (key !== "span") walk(n[key]); }
      shadowStack.pop();
      return;
    }
    for (const key in n) { if (key !== "span") walk(n[key]); }
  };
  walk(root);
}

/**
 * The fail-closed fallback for a body impl#1 keeps only as text it cannot read: a lexical match on
 * the ruled call spellings (`int.parse(`, `E.parse(` on a known enum, a grant method on a name the
 * context proves is a tape), a range `a..b`, and the two loop heads. Strings are blanked first.
 */
export function lexicalRuledForms(
  text: string,
  ctx: CallFormContext,
  enumNames: Iterable<string>,
  shadow: ReadonlySet<string> = new Set(),
): RuledFormFinding[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const src = decodeIdentEscapes(codeOnly(text));
  const out: RuledFormFinding[] = [];
  const seenForms = new Set<string>();
  const add = (f: RuledFormFinding | null) => {
    if (!f || seenForms.has(f.form)) return;
    seenForms.add(f.form);
    out.push(f);
  };
  const fake = (objName: string, method: string) => ({
    kind: "call",
    callee: { kind: "member", object: { kind: "ident", name: objName }, property: method },
    args: [],
  });
  const lexCtx: CallFormContext = {
    lookupKind: (nm) => (shadow.has(nm) ? "variable" : ctx.lookupKind(nm)),
    typeKind: ctx.typeKind,
    receiverKind: (node) => {
      const id = node as { name?: string };
      if (id && typeof id.name === "string" && shadow.has(id.name.replace(/^@/, ""))) return null;
      return ctx.receiverKind(node);
    },
  };
  const names = new Set<string>(["int", "number", "bool", "integer", "boolean", ...enumNames]);
  const parseRe = /(^|[^\w$.@])([A-Za-z_$][\w$]*)\s*\.\s*parse\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = parseRe.exec(src))) {
    if (!names.has(m[2])) continue;
    add(ruledFormOfCall(fake(m[2], "parse"), lexCtx));
  }
  // A primitive namespace read as a value (`int.parse` not called, `int[…]`): F2 below, lexically.
  const nsRe = /(^|[^\w$.@])(int|number|bool|integer|boolean)\s*(\.|\[)/g;
  while ((m = nsRe.exec(src))) {
    if (/^\s*\.\s*parse\s*\(/.test(src.slice(m.index + m[0].length - 1))) continue; // the call form, above
    const k = lexCtx.lookupKind(m[2]);
    if (k !== null && k !== "type" && k !== "import") continue;
    add(namespaceValueFinding(m[2]));
  }
  const tapeRe = /(^|[^\w$.])(@?[A-Za-z_$][\w$]*)\s*\.\s*(append|prepend|insert|remove)\s*\(/g;
  while ((m = tapeRe.exec(src))) add(ruledFormOfCall(fake(m[2], m[3]), lexCtx));
  if (/(^|[^\w$])for\s*\{/.test(src)) add({ form: "the infinite loop `for { … }`", section: "§49.3.6" });
  // A `for ( … )` head with no `;` and no `of` / `in` binder is the condition head.
  const forRe = /(^|[^\w$])for\s*\(/g;
  while ((m = forRe.exec(src))) {
    let depth = 1;
    let k = forRe.lastIndex;
    while (k < src.length && depth > 0) {
      const ch = src[k];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      k++;
    }
    const head = src.slice(forRe.lastIndex, k - 1);
    if (depth === 0 && !head.includes(";") && !/(^|[^\w$])(of|in)([^\w$]|$)/.test(head)) {
      add({ form: "the condition loop `for (cond) { … }`", section: "§49.3.1" });
    }
  }
  if (isRangeIterable(src)) add({ form: "the range `a..b` / `a..=b`", section: "§49.2.5" });
  return out;
}

// ---------------------------------------------------------------------------
// Statement forms (structural)
// ---------------------------------------------------------------------------

/**
 * The CODE of a JavaScript-like text, with everything that is not code blanked (round 3, F1):
 * comments go; a quoted string becomes `""`; a regular-expression literal becomes `/ /`; a template
 * literal keeps its `${ … }` contents (they are code — a tagged template's interpolations run) and
 * loses only its text. Lengths are not preserved; only the code tokens matter to the matchers.
 */
export function codeOnly(raw: string): string {
  let out = "";
  let i = 0;
  const n = raw.length;
  // A `/` starts a regex when the previous significant character cannot end an operand.
  const regexCanStart = (): boolean => {
    let k = out.length - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (k < 0) return true;
    const ch = out[k];
    if (/[(,=:[!&|?{};+\-*%<>~^]/.test(ch)) return true;
    const word = /([A-Za-z_$][\w$]*)$/.exec(out.slice(0, k + 1));
    return !!word && /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await|lift)$/.test(word[1]);
  };
  const template = (): void => {
    // at raw[i] === "`"
    i++;
    out += "``";
    while (i < n && raw[i] !== "`") {
      if (raw[i] === "\\") { i += 2; continue; }
      if (raw[i] === "$" && raw[i + 1] === "{") {
        i += 2;
        out += " (";
        code("}");
        out += ") ";
        i++; // the closing }
        continue;
      }
      i++;
    }
    i++; // closing backtick
  };
  // Scan code until the unmatched `stop` (or the end).
  const code = (stop: string | null): void => {
    let depth = 0;
    while (i < n) {
      const ch = raw[i];
      if (stop && ch === stop && depth === 0) return;
      if (ch === "/" && raw[i + 1] === "/") { while (i < n && raw[i] !== "\n") i++; out += " "; continue; }
      if (ch === "/" && raw[i + 1] === "*") { const e = raw.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; out += " "; continue; }
      if (ch === '"' || ch === "'") {
        i++;
        while (i < n && raw[i] !== ch && raw[i] !== "\n") { if (raw[i] === "\\") i++; i++; }
        i++;
        out += '""';
        continue;
      }
      if (ch === "`") { template(); continue; }
      if (ch === "/" && regexCanStart()) {
        let inClass = false;
        i++;
        while (i < n && raw[i] !== "\n") {
          if (raw[i] === "\\") { i += 2; continue; }
          if (raw[i] === "[") inClass = true;
          else if (raw[i] === "]") inClass = false;
          else if (raw[i] === "/" && !inClass) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(raw[i])) i++;
        out += "/ /";
        continue;
      }
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
      out += ch;
      i++;
    }
  };
  code(null);
  return out;
}

/** `\u0069nt` → `int`: identifier escapes decoded, so an escaped spelling is matched (round 3, F3). */
export function decodeIdentEscapes(text: string): string {
  return text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_m, a, b) => {
    const cp = parseInt(a ?? b, 16);
    return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : _m;
  });
}

/** Back-compat name: the code of a text (strings, comments, regexes and template text blanked). */
function stripStrings(raw: string): string {
  return codeOnly(raw);
}

/** True when a for-head iterable is a §49.2.5 range (`a..b` / `a..=b`), not a spread. */
export function isRangeIterable(iterable: unknown): boolean {
  if (typeof iterable !== "string" || !iterable.includes("..")) return false;
  return /(^|[^.])\.\s*\.(?!\s*\.)/.test(stripStrings(iterable).replace(/\.\.\./g, "\u0000"));
}

const FN_BOUNDARY_KINDS = new Set(["function-decl", "fn-decl", "function", "fn", "lambda"]);

/**
 * A value-form block whose `lift` is emitted after a bare expression statement (impl#1 mis-targets
 * it: the statement mints a new `~` accumulator and the later `lift` writes there). The walk is in
 * source order and DEPTH-FIRST through nested statement bodies (round 2, H6): a bare statement in
 * an earlier `if` / `for` body, or before the `lift` inside the same branch, counts. It does not
 * cross a function boundary or a nested value form (which owns its own lifts).
 */
function liftAfterBareExpr(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  let sawBare = false;
  let hit = false;
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (hit || !node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const x of node) visit(x); return; }
    const n = node as Record<string, unknown>;
    if (n.kind === "lift-expr") { if (sawBare) hit = true; return; }
    if (n.kind === "bare-expr") { sawBare = true; return; }
    if (FN_BOUNDARY_KINDS.has(n.kind as string)) return;
    if (n.kind === "match-expr" || n.kind === "for-expr" || n.kind === "if-expr") return;
    for (const key in n) {
      if (key === "span" || key === "parent") continue;
      visit(n[key]);
    }
  };
  visit(body);
  return hit;
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

/** The names a statement list declares (not crossing a function body), destructured ones included. */
export function declaredLocalNames(stmts: unknown): Set<string> {
  const out = new Set<string>();
  const addPat = (pat: unknown): void => {
    if (typeof pat === "string") { out.add(pat); return; }
    if (!pat || typeof pat !== "object") return;
    if (Array.isArray(pat)) { for (const p of pat) addPat(p); return; }
    const p = pat as Record<string, unknown>;
    for (const k of ["bindName", "local"]) if (typeof p[k] === "string") out.add(p[k] as string);
    if (typeof p.name === "string" && p.kind !== "ident") out.add(p.name as string);
    for (const k of ["properties", "elements", "rest"]) if (p[k]) addPat(p[k]);
  };
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    const n = node as Record<string, unknown>;
    const k = n.kind as string;
    if (k === "const-decl" || k === "let-decl" || k === "tilde-decl" || k === "lin-decl") addPat(n.name);
    if (k === "function-decl" || k === "fn-decl") { if (typeof n.name === "string") out.add(n.name); return; }
    if (k === "lambda" || k === "escape-hatch") return;
    for (const key in n) if (key !== "span" && key !== "parent") walk(n[key]);
  };
  walk(stmts);
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
