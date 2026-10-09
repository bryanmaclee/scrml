/**
 * emit-predicates.ts — §53 Inline Type Predicate Codegen Utilities
 *
 * This module provides shared utilities for emitting §53 predicate enforcement:
 *
 *   1. emitRuntimeCheck(predicate, varName, label) — emit a runtime boundary check
 *      (E-CONTRACT-001-RT). Called from emit-logic.ts for let-decl / state-decl nodes
 *      that the TS stage classified as boundary zone.
 *
 *   2. emitServerParamCheck(paramName, predicate, label) — emit a server-side boundary
 *      check for a function parameter (§53.9.4). Called from emit-server.ts.
 *
 *   3. deriveHtmlAttrs(predicate, baseType) — derive HTML validation attributes from a
 *      predicate expression (§53.7). Used by emit-html.ts when rendering bind:value.
 *
 *   4. predicateToJsExpr(predicate, valueExpr) — serialize a PredicateExpr AST node into
 *      a boolean JS expression. Used by emitRuntimeCheck and emitServerParamCheck.
 *
 * The PredicateExpr type mirrors the one in type-system.ts. We operate on the opaque
 * `node.predicateCheck.predicate` objects already present in the TypedFileAST.
 */

import { URL_GUARD_RUNTIME_SOURCE } from "../runtime-template.js";
import { describeJudge, structJudgeDef, enumJudgeDef, type JudgeType } from "../refinement-obligations.ts";
import { aliasHostGlobalsInRuntimeText } from "./host-global-alias.ts";

// ---------------------------------------------------------------------------
// PredicateExpr mirror (matches type-system.ts — no import to avoid coupling)
// ---------------------------------------------------------------------------

interface PredicateExpr {
  kind: "comparison" | "property" | "named-shape" | "and" | "or" | "not" | "error" | "variant-set"
    | "on-length" | "pattern" | "value-set" | "req";
  // S458 — §55.1 shared-core kinds: `pattern` (value = regex source, flags),
  // `value-set` (variantMode oneOf/notIn over literal `values`), `on-length`
  // (`operand` judged on `.length`), `req` (non-empty).
  flags?: string;
  values?: Array<number | string>;
  op?: string;
  value?: number | string;
  prop?: string;
  name?: string;
  left?: PredicateExpr;
  right?: PredicateExpr;
  operand?: PredicateExpr;
  message?: string;
  hasExternalRef?: boolean;
  // §53.15 enum-subset refinement — variant-set membership over an enum base.
  // `variants` is the RESOLVED IN-SET variant names (notIn already complemented
  // at type-resolution time). Enum variants lower to plain strings at runtime,
  // so the boundary membership check is a string `.includes`.
  variantMode?: "oneOf" | "notIn";
  variants?: string[];
}

// ---------------------------------------------------------------------------
// Named shape → JS runtime validation predicate (§53.6)
//
// Named shapes cannot be statically proven for non-literal string values.
// The compiler emits a runtime expression that validates the string.
// ---------------------------------------------------------------------------

/** The runtime judge of the `url` named shape (runtime-url-guard.js). Emitted text gates its inlining. */
export const URL_SHAPE_FN = "_scrml_url_shape_ok";

/**
 * The server copy of the `url` shape judge: the whole of runtime-url-guard.js (the reader, the
 * safe-scheme set and `_scrml_url_shape_ok`), for a server bundle / library module / tool / worker whose body
 * calls `_scrml_url_shape_ok(` (a `string(url)` server-function parameter or a boundary-zone decl).
 * The same source the client 'urlguard' chunk inlines. A bundle that already carries it (the SSR
 * first-paint URL guard copy) must not inline it twice — see `needsUrlShapeHelper`.
 *
 * The copy shares its module scope with user bindings (a server function called by another is
 * a module-scope `async function <name>`), so its host-global references are spelled through
 * the `_scrml_g` alias (codegen/host-global-alias.ts) — a `server function URL` must not
 * become the judge's `new URL(…)`.
 */
export const SERVER_URL_SHAPE_HELPER: string = [
  "",
  "// --- §53.6.1 `url` named shape + §5.2 URL scheme reader (inlined copy; source: runtime-url-guard.js) ---",
  aliasHostGlobalsInRuntimeText(URL_GUARD_RUNTIME_SOURCE),
].join("\n");

/** Does `emitted` call the `url` shape judge without already defining it? */
export function needsUrlShapeHelper(emitted: string): boolean {
  return emitted.includes(`${URL_SHAPE_FN}(`) && !emitted.includes(`function ${URL_SHAPE_FN}(`);
}

const NAMED_SHAPE_RUNTIME: Record<string, string> = {
  email: `(typeof __V__ === "string" && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(__V__))`,
  // §53.6.1 / S457 "6a" — `_scrml_url_shape_ok` is defined ONCE, in compiler/src/runtime-url-guard.js
  // (the §5.2 scheme reader's file): an absolute URL whose scheme is in the §5.2 safe set. The client
  // runtime carries it in the 'urlguard' chunk (emit-client.ts post-emit gate on this call); a server
  // bundle that calls it inlines the same source (emit-server.ts). The type checker's static zone
  // calls the same function, so the two zones cannot disagree.
  url: `${URL_SHAPE_FN}(__V__)`,
  uuid: `(typeof __V__ === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(__V__))`,
  phone: `(typeof __V__ === "string" && /^[+]?[0-9\\s\\-().]{7,15}$/.test(__V__))`,
  date: `(typeof __V__ === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(__V__))`,
  time: `(typeof __V__ === "string" && /^\\d{2}:\\d{2}(:\\d{2})?$/.test(__V__))`,
  color: `(typeof __V__ === "string" && /^#[0-9A-Fa-f]{6}$|^[a-z]+$/.test(__V__))`,
};

// ---------------------------------------------------------------------------
// Named shape → HTML attributes (§53.7.1, §53.6.1 table)
// ---------------------------------------------------------------------------

const NAMED_SHAPE_HTML: Record<string, Record<string, string>> = {
  email: { type: "email" },
  url:   { type: "url" },
  uuid:  { pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" },
  phone: { type: "tel" },
  date:  { type: "date" },
  time:  { type: "time" },
  color: { type: "color" },
};

// ---------------------------------------------------------------------------
// predicateToJsExpr
//
// Serialize a PredicateExpr to a JS boolean expression.
// `valueExpr` is the JS expression for the incoming value (e.g. "amount", "_scrml_v").
//
// Returns a JS expression string that evaluates to `true` when the predicate
// is satisfied, `false` when violated.
// ---------------------------------------------------------------------------

// S458 F1 — the judge FAILS CLOSED. A predicate it cannot judge (an `error`
// node, an unregistered shape, an unknown kind) yields `false` — the value is
// refused — never `true`. The type-system stage refuses every such annotation at
// its declaration (E-CONTRACT-002 / -003, `checkRefinementJudgeable`), so a
// clean compile never reaches these arms; they exist so that a path which
// somehow does cannot ship a check that admits everything.
const FAIL_CLOSED = "false /* §53 S458: unjudgeable predicate — refused */";

/** A predicate operand as a JS literal: numbers as-is, strings quoted. */
function jsLiteral(v: number | string): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

// ---------------------------------------------------------------------------
// The ONE judge (S458) — base type first, then containers, then the predicate.
//
// `predicateToJsExpr` alone judges a value already known to be of the base type;
// over HTTP / postMessage / argv / a decoded payload it is not. `number(>0)`
// used to admit "5" and [5] (`"5" > 0`, `[5] > 0`), `integer(>0)` admitted 0.5,
// `string(.length >= 1)` admitted ["a","b"] and {length: 5}, and a property
// predicate on null / a missing field THREW (a server 500). The judge tests the
// base type first, which also guards the property access.
// ---------------------------------------------------------------------------

/** What the judge needs: the refinement, plus any containers around it. */
export interface JudgeShape {
  baseType?: string;
  wrap?: Array<"array" | "nullable">;
  /** S458 slice 2 — the whole declared type's judge; when present it is used. */
  judge?: JudgeType;
  /** §53 R2 — a server-side failure report omits the value. */
  noValue?: boolean;
}

/** JS boolean: is `v` a value of `baseType`? `null` = no base guard (enum subset). */
function baseTypeGuard(baseType: string | undefined, v: string): string | null {
  switch (baseType) {
    case "number": return `typeof ${v} === "number" && !_scrml_g.Number.isNaN(${v})`;
    case "integer": return `_scrml_g.Number.isInteger(${v})`;
    case "string": return `typeof ${v} === "string"`;
    // registered string-shaped primitives (ISO-8601 text)
    case "date": case "timestamp": return `typeof ${v} === "string"`;
    case "boolean": return `typeof ${v} === "boolean"`;
    default: return null;
  }
}

/**
 * The full judge for `valueExpr` against `predicate` under `shape`: containers
 * (an array is judged element-wise, `not` inhabits a nullable), then the base
 * type, then the predicate. `valueExpr` must be a side-effect-free reference
 * (a parameter or temp name) — it is read more than once.
 */
export function judgeExpr(predicate: PredicateExpr, valueExpr: string, shape: JudgeShape = {}): string {
  if (shape.judge) return judgeTypeExpr(shape.judge, valueExpr);
  const wrap = shape.wrap ?? [];
  const inner = (v: string, at: number): string => {
    if (at < wrap.length) {
      if (wrap[at] === "nullable") return `(${v} === null || ${v} === undefined || ${inner(v, at + 1)})`;
      const el = `_scrml_el${at}`;
      return `(_scrml_g.Array.isArray(${v}) && ${JUDGE_EACH}(${v}, (${el}) => ${inner(el, at + 1)}))`;
    }
    const guard = baseTypeGuard(shape.baseType, v);
    const pred = predicateToJsExpr(predicate, v);
    return guard ? `(${guard} && ${pred})` : pred;
  };
  return inner(valueExpr, 0);
}

/**
 * S458 slice 2 — the judge for a whole declared type (refinement-obligations.ts
 * `JudgeType`): containers, structs, unions and refinements, in one expression.
 * `valueExpr` is read more than once, so it must be a side-effect-free name.
 */
export function judgeTypeExpr(j: JudgeType, valueExpr: string, depth = 0): string {
  const v = valueExpr;
  switch (j.k) {
    case "pred": {
      const guard = baseTypeGuard(j.baseType, v);
      const pred = predicateToJsExpr(j.predicate as PredicateExpr, v);
      return guard ? `(${guard} && ${pred})` : pred;
    }
    case "array": {
      // S459 — every slot, holes included (a hole reads as `not`, §42; `.every` skips holes)
      const el = `_scrml_el${depth}`;
      return `(_scrml_g.Array.isArray(${v}) && ${JUDGE_EACH}(${v}, (${el}) => ${judgeTypeExpr(j.of, el, depth + 1)}))`;
    }
    case "nullable":
      return `(${v} === null || ${v} === undefined || ${judgeTypeExpr(j.of, v, depth)})`;
    case "struct":
      // S458 2a-fix F3 — a struct is judged by ONE named function per type
      // per bundle (hoisted; see judgeDefinitionsFor), never inlined: a struct
      // reused k times per level used to grow the output k^depth.
      return `${structJudgeName(j)}(${v})`;
    case "enum":
      return `${enumJudgeName(j)}(${v})`;
    case "anyOf":
      return `(${j.of.map((m) => judgeTypeExpr(m, v, depth)).join(" || ")})`;
    case "prim":
      return baseTypeGuard(j.baseType, v) ?? FAIL_CLOSED;
    case "shape":
      return j.shape === "map"
        ? `(${v} !== null && typeof ${v} === "object" && ${v}.__scrml_map === true)`
        : `typeof ${v} === "function"`;
    case "any":
      return "true /* asIs: a developer-signed untyped value — every value inhabits it (§7.5.2) */";
    case "unjudgeable": // refused at the declaration (E-CONTRACT-002); never admits
      return FAIL_CLOSED;
    default:
      return FAIL_CLOSED;
  }
}

/** The human description of a judge (failure reports). A nested struct is named, not expanded. */
export function describeJudgeType(j: JudgeType): string {
  return describeJudge(j, (p) => predicateToDisplayString(p as PredicateExpr));
}

// ---------------------------------------------------------------------------
// S458 2a-fix F3 — hoisted struct judges.
//
// Each struct judge is ONE function per bundle, named by its type and a hash of
// its content (`_scrml_judge_Link_1k2j3h`), so two sites judging the same type
// call the same function, and a struct nested in another is a call, not a
// copy. The definitions are registered here while the code is emitted, and
// every emitter appends the ones its artifact calls (`judgeDefinitionsFor`)
// before it scans its text for runtime helpers — a judge may call
// `_scrml_url_shape_ok`, and that scan must see it.
// ---------------------------------------------------------------------------

const _judgeDefs = new Map<string, string>();

// S459 — an array judge visits EVERY slot: `Array.prototype.every` skips holes, but
// a hole reads as `not` (§42), so `number(>0)[]` must not admit `[1, , 3]`.
// Hoisted like the struct judges (appended to each artifact that calls it).
const JUDGE_EACH = "_scrml_judge_each";
_judgeDefs.set(JUDGE_EACH, [
  "// §53 every slot of an array satisfies its element judge (a hole reads as `not`, §42)",
  "function _scrml_judge_each(a, ok) {",
  "  for (let i = 0; i < a.length; i++) if (!ok(a[i])) return false;",
  "  return true;",
  "}",
].join("\n"));

/** A field read `obj.field` (or `obj["field"]`) as JS text. */
function fieldAccess(obj: string, field: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field) ? `${obj}.${field}` : `${obj}[${JSON.stringify(field)}]`;
}

function judgeComment(j: JudgeType): string {
  return `// §53 judge — ${describeJudge(j, (p) => predicateToDisplayString(p as PredicateExpr), false, true).replace(/[\n\r]/g, " ")}`;
}

/** The hoisted judge function of struct judge `j` (registered on first use). */
function structJudgeName(j: Extract<JudgeType, { k: "struct" }>): string {
  const slug = String(j.name).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40) || "struct";
  const name = `_scrml_judge_${slug}_${j.id}`;
  if (_judgeDefs.has(name)) return name;
  _judgeDefs.set(name, ""); // a recursive reference resolves to the name
  // a field read is a property access on an already-checked object: no side effects
  const parts = structJudgeDef(j.id).fields.map(([field, f]) => judgeTypeExpr(f, fieldAccess("v", field), 1));
  _judgeDefs.set(name, [
    judgeComment(j),
    `function ${name}(v) {`,
    `  return v !== null && typeof v === "object" && !_scrml_g.Array.isArray(v)` + (parts.length ? " &&" : ";"),
    ...parts.map((p, i) => `    ${p}${i < parts.length - 1 ? " &&" : ";"}`),
    `}`,
  ].join("\n"));
  return name;
}

/**
 * The hoisted judge function of enum judge `j`: a unit variant is its tag
 * string; a payload variant is `{ variant, data }` whose refined payload
 * fields are judged. Anything else — including an object spelling a UNIT
 * variant — is not a value of the enum.
 */
function enumJudgeName(j: Extract<JudgeType, { k: "enum" }>): string {
  const slug = String(j.name).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40) || "enum";
  const name = `_scrml_judge_${slug}_${j.id}`;
  if (_judgeDefs.has(name)) return name;
  _judgeDefs.set(name, "");
  const def = enumJudgeDef(j.id);
  const units = def.variants.filter(([, f]) => f === null).map(([v]) => v);
  const payloads = def.variants.filter(([, f]) => f !== null) as Array<[string, Array<[string, JudgeType]>]>;
  const lines = [judgeComment(j), `function ${name}(v) {`];
  lines.push(`  if (typeof v === "string") return ${JSON.stringify(units)}.includes(v);`);
  if (payloads.length) {
    lines.push(`  if (v === null || typeof v !== "object" || _scrml_g.Array.isArray(v)) return false;`);
    lines.push(`  const d = v.data;`);
    lines.push(`  switch (v.variant) {`);
    for (const [variant, fields] of payloads) {
      const parts = fields.map(([field, f]) => judgeTypeExpr(f, fieldAccess("d", field), 1));
      lines.push(`    case ${JSON.stringify(variant)}: return d !== null && typeof d === "object"${parts.map((p) => ` && ${p}`).join("")};`);
    }
    lines.push(`    default: return false;`);
    lines.push(`  }`);
  } else {
    lines.push(`  return false;`);
  }
  lines.push(`}`);
  _judgeDefs.set(name, lines.join("\n"));
  return name;
}

// ---------------------------------------------------------------------------
// S459 MED-1 — the runtime DESCRIPTOR of a refined cell's declared type.
//
// A refined cell registers `{ ok, el?, fields? }` with the runtime:
//   ok     — the whole judge of a value at this position (judgeTypeExpr);
//   el     — (an array) the descriptor of one element;
//   fields — (a struct) a hoisted function returning `{ field: descriptor }`
//            for the struct's refined fields (unlisted fields carry no
//            refinement). A function, so a struct reached along many paths
//            is described once, lazily.
// The runtime judges an in-place change by what it changes — a pushed
// element, a written element, a written field — against the descriptor of
// the object it changes, instead of re-judging the whole collection (§53.1:
// "an O(1) boolean expression"). A position with no `el` / `fields` (a union,
// an enum, …) is not described below its own `ok`: a change inside it
// re-judges the whole cell. Built from the same JudgeType as the judge — one
// reader.
// ---------------------------------------------------------------------------

/** The descriptor object literal of judge `j` (see above), as JS text. */
export function judgeDescriptorExpr(j: JudgeType): string {
  // a struct / enum is judged by its hoisted function: name it, no wrapper
  const parts = [j.k === "struct" ? `ok: ${structJudgeName(j)}` : j.k === "enum" ? `ok: ${enumJudgeName(j)}` : `ok: (v) => ${judgeTypeExpr(j, "v")}`];
  // `T | not`: when the value is an object it is a `T`, so it is described as one.
  let inner: JudgeType = j;
  while (inner.k === "nullable") inner = inner.of;
  if (inner.k === "array") parts.push(`el: ${judgeDescriptorExpr(inner.of)}`);
  else if (inner.k === "struct") parts.push(`fields: ${structPartsName(inner)}`);
  return `{ ${parts.join(", ")} }`;
}

/** The hoisted `{ field: descriptor }` function of struct judge `j` (registered on first use). */
function structPartsName(j: Extract<JudgeType, { k: "struct" }>): string {
  const judge = structJudgeName(j);
  const name = judge.replace(/^_scrml_judge_/, "_scrml_judge_parts_");
  if (_judgeDefs.has(name)) return name;
  _judgeDefs.set(name, ""); // a recursive reference resolves to the name
  const fields = structJudgeDef(j.id).fields.map(([field, f]) =>
    `    ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field) ? field : JSON.stringify(field)}: ${judgeDescriptorExpr(f)},`);
  _judgeDefs.set(name, [
    `// §53 the refined fields of ${String(j.name).replace(/[\n\r]/g, " ")}, each with its descriptor (judging one field write)`,
    `function ${name}() {`,
    `  return {`,
    ...fields,
    `  };`,
    `}`,
  ].join("\n"));
  return name;
}

// A judge is referenced by a call, a parts function by its bare name (`fields: _scrml_judge_parts_…`),
// so a reference is any occurrence of the name; one that is not a registered judge is ignored.
const JUDGE_REF = /\b(_scrml_judge_[A-Za-z0-9_]+)/g;
const JUDGE_DEF = /\bfunction (_scrml_judge_[A-Za-z0-9_]+)\(/g;

/**
 * The definitions of every hoisted judge `js` calls (and the judges those call)
 * that `js` does not already define — "" when there are none. Emitters append
 * it to their artifact.
 */
export function judgeDefinitionsFor(js: string): string {
  if (!js.includes("_scrml_judge_")) return "";
  const defined = new Set<string>();
  for (const m of js.matchAll(JUDGE_DEF)) defined.add(m[1]);
  const queue = [...js.matchAll(JUDGE_REF)].map((m) => m[1]);
  const out: string[] = [];
  while (queue.length) {
    const name = queue.shift()!;
    if (defined.has(name)) continue;
    const def = _judgeDefs.get(name);
    if (!def) continue; // not a judge this compiler registered — left for the emit gates to report
    defined.add(name);
    out.push(def);
    for (const m of def.matchAll(JUDGE_REF)) queue.push(m[1]);
  }
  return out.join("\n");
}

/** Is `name` a hoisted judge this compiler registered (its definition is appended on use)? */
export function isHoistedJudgeName(name: string): boolean {
  return name.startsWith("_scrml_judge_") && !!_judgeDefs.get(name);
}

/** `js` with the definitions of the hoisted judges it calls appended. */
export function appendJudgeDefinitions(js: string): string {
  const defs = judgeDefinitionsFor(js);
  return defs ? `${js}${js.endsWith("\n") ? "" : "\n"}\n${defs}\n` : js;
}

/**
 * S458 slice 2 — the lowering of a refine placeholder call
 * (`__scrml_refine_<token>__(value)`, refinement-obligations.ts): an inline
 * arrow that judges the value, refuses it, and otherwise yields it unchanged.
 * `server` — a server-side failure (§53 R2): the report carries no value (an
 * uncaught throw reaches the host's 500 response, which may echo the message).
 */
export function emitRefineExpr(valueJs: string, judge: JudgeType, where: { kind: string; name: string; fn?: string }, server: boolean): string {
  const v = "_scrml_rv";
  const check = judgeTypeExpr(judge, v);
  const loc = where.fn ? `${where.kind} '${where.name}' in ${where.fn}` : `${where.kind} '${where.name}'`;
  const msg =
    `"E-CONTRACT-001-RT: Value constraint violated at runtime.\\n" + ` +
    `"  Location: " + ${JSON.stringify(loc)} + "\\n" + ` +
    `"  Constraint: (" + ${JSON.stringify(describeJudgeType(judge))} + ")"` +
    (server ? "" : ` + "\\n  Value: " + ${safeValueText(v)}`);
  return `((${v}) => { if (!${check}) throw new _scrml_g.Error(${msg}); return ${v}; })(${valueJs})`;
}

/** The E-CONTRACT-001-RT message expression for a refine lowering over value name `v`. */
function refineMessage(v: string, judge: JudgeType, where: { kind: string; name: string; fn?: string }, server: boolean): string {
  const loc = where.fn ? `${where.kind} '${where.name}' in ${where.fn}` : `${where.kind} '${where.name}'`;
  return `"E-CONTRACT-001-RT: Value constraint violated at runtime.\\n" + ` +
    `"  Location: " + ${JSON.stringify(loc)} + "\\n" + ` +
    `"  Constraint: (" + ${JSON.stringify(describeJudgeType(judge))} + ")"` +
    (server ? "" : ` + "\\n  Value: " + ${safeValueText(v)}`);
}

/**
 * S458 2a-fix F2 — the lowering of a refine-UPDATE placeholder (`x++` / `--x`
 * on a refined local): compute the new value, judge it, assign it, and yield
 * the prefix (new) or postfix (old) value. `targetJs` is a side-effect-free
 * reference, written twice (read, then assigned).
 */
export function emitRefineUpdate(targetJs: string, judge: JudgeType, where: { kind: string; name: string; fn?: string }, update: { op: "+" | "-"; prefix: boolean }, server: boolean): string {
  const v = "_scrml_rv";
  return `((_scrml_ro) => { const ${v} = _scrml_ro ${update.op} 1; ` +
    `if (!${judgeTypeExpr(judge, v)}) throw new _scrml_g.Error(${refineMessage(v, judge, where, server)}); ` +
    `${targetJs} = ${v}; return ${update.prefix ? v : "_scrml_ro"}; })(${targetJs})`;
}

/**
 * S458 2a-fix F2 — the lowering of a refine-MERGE placeholder (the sources of
 * `Object.assign(x, …src)` into a refined local struct): merge the sources,
 * judge `{ ...x, ...merged }` BEFORE anything is copied into `x`, and yield the
 * merged object for the assign to copy. `argsJs[0]` is the target, the rest the
 * sources (each evaluated once, in order).
 */
export function emitRefineMerge(argsJs: string[], judge: JudgeType, where: { kind: string; name: string; fn?: string }, server: boolean): string {
  const v = "_scrml_rv";
  return `((_scrml_rb, ..._scrml_rs) => { const _scrml_rm = _scrml_g.Object.assign({}, ..._scrml_rs); ` +
    `const ${v} = _scrml_g.Object.assign({}, _scrml_rb, _scrml_rm); ` +
    `if (!${judgeTypeExpr(judge, v)}) throw new _scrml_g.Error(${refineMessage(v, judge, where, server)}); ` +
    `return _scrml_rm; })(${argsJs.join(", ")})`;
}

/**
 * S458 slice 2 — a parameter guard STATEMENT (the body-prepended obligation for
 * a refined parameter). `response400` — inside a server route handler body: the
 * §53.9.4 400 response, exactly the shape `emitServerParamCheck` writes.
 */
export function emitParamGuardStatement(param: string, judge: JudgeType, fnName: string, mode: "throw" | "throw-server" | "response400"): string[] {
  if (mode === "response400") {
    return emitServerParamCheck(param, { kind: "error" } as PredicateExpr, null, fnName, "", { judge });
  }
  const check = judgeTypeExpr(judge, param);
  const lines: string[] = [];
  lines.push(`// §53.9.1 E-CONTRACT-001-RT boundary check: parameter '${param}' of ${fnName}`);
  lines.push(`if (!${check}) {`);
  lines.push(`  throw new _scrml_g.Error(`);
  lines.push(`    "E-CONTRACT-001-RT: Value constraint violated at runtime.\\n" +`);
  lines.push(`    "  Location: " + ${JSON.stringify(`fn ${fnName}, parameter '${param}'`)} + "\\n" +`);
  lines.push(`    "  Constraint: (" + ${JSON.stringify(describeJudgeType(judge))} + ")"` + (mode === "throw" ? ` + "\\n" +` : ``));
  if (mode === "throw") lines.push(`    "  Value: " + ${safeValueText(param)}`);
  lines.push(`  );`);
  lines.push(`}`);
  return lines;
}

/**
 * A failure report's rendering of the offending value that cannot throw
 * (`String(v)` throws for `{ toString: 1 }`, which turned a refused server
 * parameter into a 500) and does not echo a structured attacker value.
 */
function safeValueText(v: string): string {
  return `(typeof ${v} === "string" || typeof ${v} === "number" || typeof ${v} === "boolean" ? _scrml_g.String(${v}) : typeof ${v})`;
}

export function predicateToJsExpr(pred: PredicateExpr, valueExpr: string): string {
  if (!pred || !pred.kind) return FAIL_CLOSED;

  switch (pred.kind) {
    case "comparison": {
      const op = pred.op ?? ">";
      // comparison predicate: just `value op N`. S458 — a string operand
      // (`eq("x")`) is emitted as a quoted JS string literal, never as bare text.
      return `(${valueExpr} ${op} ${jsLiteral(pred.value ?? 0)})`;
    }

    case "property": {
      // property predicate: `.length > N`, `.kind == "a"` etc. S458 — a string
      // value is quoted (it used to be emitted bare: `.kind == "foo"` became
      // `(v.kind == foo)`, a ReferenceError on every call).
      const prop = pred.prop ?? "length";
      const op = pred.op ?? ">";
      return `(${valueExpr}.${prop} ${op} ${jsLiteral(pred.value ?? 0)})`;
    }

    case "on-length":
      // §55.1 `length(pred)` — the inner predicate judged on `.length`.
      return pred.operand ? predicateToJsExpr(pred.operand, `${valueExpr}.length`) : FAIL_CLOSED;

    case "pattern": {
      // §55.1 `pattern(/re/flags)` — a regex literal; its source was read and
      // validated by the type stage (it is a well-formed RegExp body).
      const src = String(pred.value ?? "");
      if (/[\n\r]/.test(src)) return FAIL_CLOSED;
      return `(/${src}/${pred.flags ?? ""}.test(${valueExpr}))`;
    }

    case "value-set": {
      // §55.1 `oneOf([…])` / `notIn([…])` over literal values.
      const inSet = `${JSON.stringify(pred.values ?? [])}.includes(${valueExpr})`;
      return pred.variantMode === "notIn" ? `(!${inSet})` : `(${inSet})`;
    }

    case "req":
      // §55.1 `req` — non-empty (`""` fails; absence is refused by the base guard).
      return `(${valueExpr} !== "")`;

    case "named-shape": {
      const shapeName = pred.name ?? "";
      const template = NAMED_SHAPE_RUNTIME[shapeName];
      if (template) {
        return template.replaceAll("__V__", valueExpr);
      }
      // Unknown shape — TS refuses it as E-CONTRACT-002 at the declaration.
      return FAIL_CLOSED;
    }

    case "and": {
      const l = predicateToJsExpr(pred.left!, valueExpr);
      const r = predicateToJsExpr(pred.right!, valueExpr);
      return `(${l} && ${r})`;
    }

    case "or": {
      const l = predicateToJsExpr(pred.left!, valueExpr);
      const r = predicateToJsExpr(pred.right!, valueExpr);
      return `(${l} || ${r})`;
    }

    case "not": {
      const inner = predicateToJsExpr(pred.operand!, valueExpr);
      return `(!(${inner}))`;
    }

    case "variant-set": {
      // §53.15.2 boundary check — enum-subset membership. Enum variants lower
      // to plain strings at runtime (see the `Role_toEnum` table emitted in
      // emit-enums), so the check is a string-array `.includes`. `variants` is
      // the resolved IN-SET (notIn was complemented at type-resolution time),
      // so the test is uniformly positive regardless of surface form.
      // S458 — a PAYLOAD variant lowers to `{ variant, data }` (emit-enums), not
      // a bare string, and §53.15.5 admits payload variants in a subset: the
      // membership is read off the TAG. (`.includes(obj)` refused every payload
      // variant, in-subset or not.)
      const set = Array.isArray(pred.variants) ? pred.variants : [];
      const literal = JSON.stringify(set);
      return `(${literal}.includes(typeof ${valueExpr} === "object" && ${valueExpr} !== null ? ${valueExpr}.variant : ${valueExpr}))`;
    }

    case "error":
    default:
      // Malformed predicate — TS refuses it as E-CONTRACT-002 at the declaration.
      return FAIL_CLOSED;
  }
}

// ---------------------------------------------------------------------------
// predicateToDisplayString
//
// Produce a human-readable description of the predicate for error messages.
// ---------------------------------------------------------------------------

function predicateToDisplayString(pred: PredicateExpr): string {
  if (!pred || !pred.kind) return "(unknown)";

  switch (pred.kind) {
    case "comparison":
      return `${pred.op}${jsLiteral(pred.value ?? 0)}`;
    case "property":
      return `.${pred.prop} ${pred.op} ${jsLiteral(pred.value ?? 0)}`;
    case "on-length":
      return `length(${pred.operand ? predicateToDisplayString(pred.operand) : "?"})`;
    case "pattern":
      return `pattern(/${pred.value ?? ""}/${pred.flags ?? ""})`;
    case "value-set":
      return `${pred.variantMode ?? "oneOf"}(${JSON.stringify(pred.values ?? [])})`;
    case "req":
      return "req";
    case "named-shape":
      return pred.name ?? "(unknown-shape)";
    case "and": {
      const l = predicateToDisplayString(pred.left!);
      const r = predicateToDisplayString(pred.right!);
      return `${l} && ${r}`;
    }
    case "or": {
      const l = predicateToDisplayString(pred.left!);
      const r = predicateToDisplayString(pred.right!);
      return `${l} || ${r}`;
    }
    case "not":
      return `!(${predicateToDisplayString(pred.operand!)})`;
    case "variant-set": {
      const set = Array.isArray(pred.variants) ? pred.variants : [];
      // §53.15 — display as the canonical positive subset form.
      return `oneOf([${set.map(v => "." + v).join(", ")}])`;
    }
    default:
      return "(error)";
  }
}

// ---------------------------------------------------------------------------
// emitRuntimeCheck
//
// Emit a §53.4.5 runtime boundary check for a variable assignment.
//
// Produces a JS `if (!(predicate)) throw ...` guard that should be emitted
// BEFORE the assignment statement so that the variable retains its prior value
// on violation (§53.3.3).
//
// @param predicate  — the PredicateExpr from node.predicateCheck.predicate
// @param valueExpr  — the JS expression for the incoming value (e.g. "rawAmount")
// @param varName    — the scrml variable name (for error message)
// @param label      — optional named constraint label (e.g. "invoice_amount")
// @param location   — optional source location string for the error message
// @returns          — an array of JS lines to emit before the assignment
// ---------------------------------------------------------------------------

export function emitRuntimeCheck(
  predicate: PredicateExpr,
  valueExpr: string,
  varName: string,
  label: string | null = null,
  location = "",
  shape: JudgeShape = {},
): string[] {
  // S458 — the one judge: base type, containers, predicate.
  const checkExpr = judgeExpr(predicate, valueExpr, shape);
  const displayPred = shape.judge ? describeJudgeType(shape.judge) : predicateToDisplayString(predicate);
  const labelPart = label ? ` [${label}]` : "";
  const locationPart = location ? ` (${location})` : "";

  const lines: string[] = [];
  lines.push(`// §53.4.5 E-CONTRACT-001-RT boundary check for '${varName}'${labelPart}`);
  lines.push(`if (!(${checkExpr})) {`);
  lines.push(`  throw new _scrml_g.Error(`);
  lines.push(`    "E-CONTRACT-001-RT: Value constraint violated at runtime.\\n" +`);
  lines.push(`    "  Variable: " + ${JSON.stringify(varName + labelPart)} + "\\n" +`);
  lines.push(`    "  Constraint: (" + ${JSON.stringify(displayPred)} + ")\\n" +`);
  // §53 R2 (S458) — a SERVER-side failure carries no value: the uncaught throw
  // reaches the host's 500 response, which may echo the message.
  if (!shape.noValue) lines.push(`    "  Value: " + ${safeValueText(valueExpr)} + "\\n" +`);
  lines.push(`    "  Location: " + ${JSON.stringify(locationPart || varName)}`);
  lines.push(`  );`);
  lines.push(`}`);

  return lines;
}

// ---------------------------------------------------------------------------
// emitServerParamCheck
//
// Emit §53.9.4 server-side boundary checks for a server function parameter.
//
// Called from emit-server.ts after params are extracted from _scrml_body.
// Produces `if (!(predicate(param))) throw ...` guards at function entry.
//
// @param paramName  — the JS parameter name (already extracted from body)
// @param predicate  — the PredicateExpr from the param annotation
// @param label      — optional named constraint label
// @param fnName     — the scrml function name (for error message)
// @param indent     — leading whitespace (e.g. "  " or "    ")
// @returns          — an array of JS lines
// ---------------------------------------------------------------------------

export function emitServerParamCheck(
  paramName: string,
  predicate: PredicateExpr,
  label: string | null,
  fnName: string,
  indent = "  ",
  shape: JudgeShape = {},
): string[] {
  // S458 — the one judge: base type, containers, predicate. A value of the
  // wrong base type (or a missing field) is a clean 400, not a thrown 500.
  const checkExpr = judgeExpr(predicate, paramName, shape);
  const displayPred = shape.judge ? describeJudgeType(shape.judge) : predicateToDisplayString(predicate);
  const labelPart = label ? ` [${label}]` : "";

  const lines: string[] = [];
  lines.push(`${indent}// §53.9.4 E-CONTRACT-001-RT server-side boundary check: '${paramName}'${labelPart}`);
  lines.push(`${indent}if (!(${checkExpr})) {`);
  lines.push(`${indent}  return new _scrml_g.Response(_scrml_g.JSON.stringify({`);
  lines.push(`${indent}    error: "E-CONTRACT-001-RT: Value constraint violated at runtime.",`);
  lines.push(`${indent}    constraint: ${JSON.stringify(`(${displayPred})`)},`);
  lines.push(`${indent}    parameter: ${JSON.stringify(paramName + labelPart)},`);
  lines.push(`${indent}    function: ${JSON.stringify(fnName)},`);
  lines.push(`${indent}    value: ${safeValueText(paramName)},`);
  lines.push(`${indent}  }), { status: 400, headers: { "Content-Type": "application/json" } });`);
  lines.push(`${indent}}`);

  return lines;
}

// ---------------------------------------------------------------------------
// deriveHtmlAttrs
//
// Derive HTML input validation attributes from a predicate and base type.
// Used by emit-html.ts (or emit-bindings.ts) when emitting bind:value on inputs.
//
// §53.7.1 mapping:
//   Numeric >N  → min="N+1" (integer step) or min="N+ε"
//   Numeric >=N → min="N"
//   Numeric <N  → max="N-1" (integer step)
//   Numeric <=N → max="N"
//   String .length >N  → minlength="N+1"
//   String .length >=N → minlength="N"
//   String .length <N  → maxlength="N-1"
//   String .length <=N → maxlength="N"
//   named-shape email  → type="email" (etc. from NAMED_SHAPE_HTML)
//
// @param predicate  — the PredicateExpr
// @param baseType   — "number" | "string" | "integer" | "boolean"
// @returns          — a Record<string, string> of HTML attributes to inject
// ---------------------------------------------------------------------------

export function deriveHtmlAttrs(
  predicate: PredicateExpr,
  baseType: string,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (baseType === "number" || baseType === "integer") {
    // For number inputs, always set type="number" (baseline).
    attrs["type"] = "number";
  }
  collectHtmlAttrs(predicate, baseType, attrs);
  return attrs;
}

function collectHtmlAttrs(
  pred: PredicateExpr,
  baseType: string,
  attrs: Record<string, string>,
): void {
  if (!pred || !pred.kind) return;

  switch (pred.kind) {
    case "comparison": {
      if (baseType === "number" || baseType === "integer") {
        const n = Number(pred.value ?? 0);
        const isInt = baseType === "integer";
        switch (pred.op) {
          case ">":
            // >N → min = N+1 for integers, N+ε (smallest step = 1 for html) for floats
            attrs["min"] = String(isInt ? n + 1 : n + 1);
            break;
          case ">=":
            attrs["min"] = String(n);
            break;
          case "<":
            attrs["max"] = String(isInt ? n - 1 : n - 1);
            break;
          case "<=":
            attrs["max"] = String(n);
            break;
          default:
            break;
        }
      }
      break;
    }

    case "property": {
      const prop = pred.prop ?? "";
      if (prop === "length" && baseType === "string") {
        const n = Number(pred.value ?? 0);
        switch (pred.op) {
          case ">":
            attrs["minlength"] = String(n + 1);
            break;
          case ">=":
            attrs["minlength"] = String(n);
            break;
          case "<":
            attrs["maxlength"] = String(n - 1);
            break;
          case "<=":
            attrs["maxlength"] = String(n);
            break;
          default:
            break;
        }
        // Presence requirement: if minlength >= 1, also emit required
        if (pred.op === ">" && Number(pred.value ?? 0) >= 0) {
          attrs["required"] = "";
        } else if (pred.op === ">=" && Number(pred.value ?? 0) >= 1) {
          attrs["required"] = "";
        }
      }
      break;
    }

    case "named-shape": {
      const shapeName = pred.name ?? "";
      const shapeAttrs = NAMED_SHAPE_HTML[shapeName];
      if (shapeAttrs) {
        for (const [k, v] of Object.entries(shapeAttrs)) {
          attrs[k] = v;
        }
      }
      break;
    }

    case "and": {
      collectHtmlAttrs(pred.left!, baseType, attrs);
      collectHtmlAttrs(pred.right!, baseType, attrs);
      break;
    }

    case "or": {
      // For OR: we can only emit attributes that apply to both branches.
      // The conservative approach: emit nothing for OR (don't over-constrain the browser).
      // Both branches are still runtime-validated.
      break;
    }

    case "not":
      // Negated predicates cannot map to simple HTML min/max. Skip.
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Refinement — the ONE reader's output, as codegen sees it (S458)
//
// The type-system stage resolves every refinement annotation (one reader:
// type-system.ts `resolveTypeExpr`) and stamps the result as plain data:
//   - a function parameter:   `param.refinement`
//   - a function:             `fnNode.returnRefinement`
//   - a let/const/state decl: `node.predicateCheck` ({ predicate, baseType, label, zone })
// Codegen never re-parses an annotation string. (Before S458 a regex "mirror"
// parser here re-read parameter / return / bind:value annotations and dropped
// every form it did not know — enum-subset parameters were never checked, and
// an unreadable predicate silently produced no check.)
// ---------------------------------------------------------------------------

/**
 * A refinement as codegen sees it: the WHOLE declared type's judge, plus an
 * optional label. There is deliberately no `predicate` here (S458 2a-fix F1).
 * A stamp whose type needs the whole-type judge (a struct with a refined field,
 * a union) has no single top-level predicate, and a consumer that read one off
 * it judged the wrong thing: the bind:value gate of `bind:value=@p.name`
 * (`name` unrefined) became `if (false)` and never wrote the cell. Every
 * consumer judges `judge`. The only way to a raw predicate is
 * `htmlPredicateOf` (§53.7.1 attributes), which answers only for a plain
 * refinement.
 */
export interface Refinement {
  readonly judge: JudgeType;
  readonly label: string | null;
}

/** The refinement carried by a TS stamp (param / fn return / decl), or null. */
export function refinementOf(stamp: unknown): Refinement | null {
  if (!stamp || typeof stamp !== "object") return null;
  const r = stamp as { predicate?: unknown; baseType?: unknown; label?: unknown; wrap?: unknown; judge?: unknown };
  const label = typeof r.label === "string" ? r.label : null;
  // S458 slice 2 — a stamp carrying the whole declared type's judge.
  if (r.judge && typeof r.judge === "object") return { judge: r.judge as JudgeType, label };
  if (!r.predicate || typeof r.predicate !== "object") return null;
  // A plain refinement (`T(pred)`), possibly inside containers (outermost first).
  let judge: JudgeType = { k: "pred", baseType: typeof r.baseType === "string" ? r.baseType : "", predicate: r.predicate, label };
  const wrap = Array.isArray(r.wrap) ? (r.wrap as unknown[]) : [];
  for (let i = wrap.length - 1; i >= 0; i--) {
    if (wrap[i] === "array") judge = { k: "array", of: judge };
    else if (wrap[i] === "nullable") judge = { k: "nullable", of: judge };
  }
  return { judge, label };
}

/**
 * The refinement of the value at `path` inside a refined value (`bind:value=@p.name`
 * → the judge of field `name`), or null when that position carries no refinement
 * (an unrefined struct field). The absence arm of `T | not` is looked through.
 */
export function refinementAtPath(r: Refinement | null, path: readonly string[]): Refinement | null {
  if (!r) return null;
  let j: JudgeType | null = r.judge;
  for (const seg of path) {
    while (j && j.k === "nullable") j = j.of;
    if (!j) return null;
    if (j.k === "struct") {
      const f: [string, JudgeType] | undefined = structJudgeDef(j.id).fields.find(([n]) => n === seg);
      j = f ? f[1] : null;
    } else if (j.k === "array" && /^\d+$/.test(seg)) {
      j = j.of;
    } else {
      return null;
    }
  }
  return j ? { judge: j, label: path.length ? null : r.label } : null;
}

/** The primitive base a judged value must have ("" when it is not exactly one primitive). */
export function judgeBaseType(j: JudgeType | null | undefined): string {
  if (!j) return "";
  if (j.k === "nullable") return judgeBaseType(j.of);
  if (j.k === "pred" || j.k === "prim") return j.baseType;
  return "";
}

/**
 * §53.7.1 — the plain refinement behind HTML attribute derivation, or null. The
 * ONE accessor that hands out a raw predicate, and only for a judge that is
 * exactly one refinement (or `T(pred) | not`). A struct / union / array has none.
 */
export function htmlPredicateOf(r: Refinement | null): { predicate: PredicateExpr; baseType: string } | null {
  let j: JudgeType | null = r ? r.judge : null;
  while (j && j.k === "nullable") j = j.of;
  return j && j.k === "pred" ? { predicate: j.predicate as PredicateExpr, baseType: j.baseType } : null;
}

/**
 * A boundary check of `valueExpr` against refinement `r` (§53.4.5): the lines
 * `if (!judge) throw E-CONTRACT-001-RT`. `noValue` — a server-side report
 * omits the value (§53 R2).
 */
export function emitRefinementCheck(r: Refinement, valueExpr: string, varName: string, opts: { noValue?: boolean; location?: string } = {}): string[] {
  return emitRuntimeCheck({ kind: "error" }, valueExpr, varName, r.label, opts.location ?? "", { judge: r.judge, noValue: opts.noValue });
}

/** The §53.9.4 server parameter check (400) of `paramName` against refinement `r`. */
export function emitServerRefinementCheck(r: Refinement, paramName: string, fnName: string, indent = "  "): string[] {
  return emitServerParamCheck(paramName, { kind: "error" }, r.label, fnName, indent, { judge: r.judge });
}
