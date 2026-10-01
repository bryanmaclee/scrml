/**
 * §14.8.9 — protected-column PROVENANCE FLOW over the emitted server modules.
 *
 * WHY THIS EXISTS (S441, `g-protected-column-escapes-redaction-as-scalar`).
 *
 * The §14.8.9 floor (`protect-egress.ts`) tags the ROW — the object a `?{}`
 * SELECT returns — with a Symbol-keyed origin descriptor, and the egress sink
 * `_scrml_protect_redact` strips every protected column the descriptor names.
 * That is sound for every value that still IS a row (or holds one): `return u`,
 * `{...u}`, `{ user: u }`, `rows.map(r => ({...r}))`, a helper returning the row.
 *
 * It is NOT sound for a value pulled OUT of a row. `return u.passwordHash` hands
 * the sink a plain string, and a primitive cannot carry a descriptor, so the
 * redactor has nothing to read: MEASURED, HTTP 200 body `"SECRET-HASH-123"`,
 * while `I-PROTECT-STRIP-001` claimed the column had been stripped. The same is
 * true of every shape that re-houses or re-encodes the extracted value.
 *
 * No runtime mechanism can repair that at the sink: the descriptor lives on the
 * container, and by the time the sink runs the container is gone. The only
 * place the provenance of an extracted value is still known is the code that
 * extracted it. So this module reads that code — ALL of it: every server module
 * of the compile, with the imports between them resolved (S441 fix round F1: a
 * helper in another file was the first thing the review used to walk around a
 * single-module analysis).
 *
 * THE RULE (stated once; the comments below refer back to it):
 *
 *   A value whose provenance includes a `protect=` column, and which is NOT
 *   still carried inside a descriptor-bearing row, SHALL NOT reach a client-
 *   egress sink. The compiler proves this over the EMITTED server modules and
 *   rejects the build (`E-PROTECT-006`) — it does not strip at runtime, because
 *   a stripped scalar would silently change what the program returns, and it
 *   does not pass, because that is the leak.
 *
 *   Provenance is PRESERVED BY DEFAULT. A value computed from a protected value
 *   by any step the analysis does not positively know to be a DERIVER of
 *   independent identity stays protected — including every call into code the
 *   compile does not contain (a host / stdlib / npm import, a platform API).
 *   S441 fix round F2 inverted this default: the first cut treated "a scalar
 *   passed to a function the module does not define" as derived, and
 *   `Buffer.from(h).toString("base64")`, `new URL("…?h=" + h).search`,
 *   `new Error(h).message` and a charCode round-trip all SHIPPED the hash. A
 *   reversible encoding is not a derived value; only an explicit allowlist is.
 *
 *   THE DERIVER ALLOWLIST (the only exemptions — everything else fails closed):
 *     - comparison / equality / relational / arithmetic operators, `!`, `typeof`;
 *     - `.length` of a value whose length is a known count (the column's own
 *       string, a string / array literal built from it, a mapped array, a row
 *       array — `Taint.len`; NOT `({length: h})` or `new Array(u.pin)`), and
 *       the predicate / position methods in `DERIVED_METHODS`
 *       (`includes`, `startsWith`, `indexOf`, …) — NOT `charCodeAt` /
 *       `codePointAt`, which are lossless;
 *     - one-way / boolean functions (`DERIVER_CALLS`, `STDLIB_DERIVERS`):
 *       `scrml:auth` `verifyPassword` / `hashPassword` / `verifyTotp`,
 *       `scrml:crypto` `verifyHash`, `hash("argon2", …)` and `hmac(key, …)`
 *       with an unprotected key — and NOT a bare digest (`hash("sha256", …)`,
 *       `crypto.subtle.digest`: RULING S443 #7) — plus `Boolean`,
 *       `Array.isArray`, `Number.isNaN` / `isNaN`, `console.*` (returns nothing).
 *     (`Number(x)` is deliberately NOT allowlisted: on a numeric protected column
 *     it is the identity.)
 *
 *   Calls to functions the compile DOES contain are analysed interprocedurally
 *   and CALL-SITE SENSITIVELY (each distinct argument signature gets its own
 *   instance of the callee — F6: a helper used both on the hash and on a name no
 *   longer poisons the clean call).
 *
 *   `reveal("col")` is honoured exactly as at the sink: reading a column off a
 *   value that `reveal`ed it is a declassified read.
 *
 * WHERE THE SINKS ARE. Every compiler-emitted client-egress path — server-fn
 * response, `<endpoint>` arm, SSR `/__serverLoad`, `/__mountHydrate`, channel
 * `broadcast()`, the `watches=` feed — wraps its payload in
 * `_scrml_protect_redact(...)` when protect is active, so the argument of that
 * call IS a sink. The §37 SSE frame (`for await (const _scrml_val …)`) is a sink
 * as a whole (`event` / `id` are serialized outside the redact). And the raw
 * serializers are sinks whether or not a redact is in front of them — every
 * argument of `new Response(body, init)` (F3: the `init` HEADERS — a `Location`
 * or `Set-Cookie` built from the hash — are egress too), `Response.redirect`,
 * `Response.json`, `….publish`, `….enqueue`, `….send`.
 *
 * WHAT THIS DOES NOT COVER (disclosed; also in SPEC §14.8.9 / §34):
 *   - derived flows through the allowlist above (§14.8.9's own bound);
 *   - a DB round trip — writing the value into a non-protected column and
 *     reading it back is a new row with a non-protected origin (F5);
 *   - flow-insensitivity: a binding's taint is the union of everything ever
 *     assigned to it, so a variable reassigned from a protected value to a
 *     clean one is still treated as protected (fails CLOSED, never open).
 *
 * WHY THE EMITTED MODULES AND NOT THE SCRML AST. They are where the provenance
 * SOURCES (`_scrml_protect_tag(<rows>, <cols>)`) and the SINKS are both explicit,
 * and they are exactly the code that runs. They parse by construction
 * (`validate-emit.ts` gates that), and acorn reads them exactly.
 */

// @ts-ignore — acorn ships its own types but the compiler imports it untyped elsewhere.
import * as acorn from "acorn";
import { CGError } from "./errors.ts";

/** Label used for a row whose SQL origins could not be resolved (strip-all). */
export const ALL_COLUMNS_LABEL = "*";

/**
 * S443 round 6b (L4) — a PSEUDO-label, carried through the same maps as the
 * protected labels so every propagation and alias rule applies to it
 * unchanged, but never reported as a column: "a property of this object may
 * have been REMOVED by a key the compiler cannot read". The runtime floor is one
 * marker per protected column, keyed by a registry Symbol and read by PRESENCE,
 * so writing or overwriting a key can never under-strip — only REMOVING a marker
 * can. Every removal whose key is not a string / number literal therefore
 * carries this label into the object: `delete o[k]`, `Reflect.deleteProperty(o,
 * k)`, `Object.defineProperty(o, k, …)` (a hidden marker is dropped by the next
 * spread), `Object.defineProperties(o, …)`, and an object-rest pattern that
 * excludes a computed key (`const { [k]: _, ...rest } = o`). A value that
 * carries a descriptor-bearing ROW together with this label ships every
 * protected column of that row at a sink.
 *
 * Round 6 keyed this on the KEY's provenance instead (a list of Symbol
 * sources: `Symbol.for`, `Object.getOwnPropertySymbols`, `Reflect.ownKeys`).
 * That was a recognizer list and aliases walked past it — `const S = Symbol;
 * S.for(…)`, `globalThis.Symbol.for`, `const O = Object`, `Symbol.for.bind`,
 * `const { for: sf } = Symbol` all served the full row (review, measured). JS
 * has no sound way to know which values can be Symbols (`({}).constructor` is
 * `Object`), so the rule now looks only at the removal, whatever the key.
 */
const MARKER_REMOVED_LABEL = "\u0000marker-removed";
function isPseudoLabel(l: string): boolean {
  return l.startsWith("\u0000");
}

/** The compile-wide binding cell every free (global) name reads and writes (L3). */
const GLOBAL_CELL = "\u0000global";

type SinkKind = "redact" | "frame" | "serializer" | "serializer-json" | "global";

interface RowPart {
  /** `_scrml_protect_tag` call sites (module-qualified) this row came from. */
  tags: Set<string>;
  /** Protected OUTPUT column names the descriptor names. */
  cols: Set<string>;
  /** The descriptor is the strip-all sentinel (unresolvable SQL). */
  all: boolean;
  /** Columns `reveal`ed on EVERY path that reaches here (intersection) — FOLDED names. */
  revealed: Set<string>;
}

/**
 * SQL identifiers are case-insensitive (SQLite; Postgres folds unquoted names),
 * so every column comparison the flow makes is on the folded name — the same
 * fold the runtime floor applies (`_scrml_protect_fold`). S441 round 5: the
 * descriptor recorded the SELECT's surface spelling (`PASSWORDHASH`), the driver
 * returned the declared key (`passwordHash`), and an exact-case compare shipped
 * the hash.
 */
function foldCol(c: string): string {
  return c.toLowerCase();
}

/** The descriptor column `key` names (case-insensitively), or null. */
function rowColFor(row: RowPart, key: string): string | null {
  const f = foldCol(key);
  for (const c of row.cols) if (foldCol(c) === f) return c;
  return null;
}

/**
 * The abstract value. `scalar` = the value itself is (or embeds) a protected
 * column; `deep` = the value is a container holding one outside any descriptor.
 * Both map label -> the first extraction site seen (for the diagnostic). `row` =
 * the value is, or contains, a descriptor-bearing row — which the redact sink
 * strips, so it is SAFE there on its own. `fns` = function values (closures).
 */
interface Taint {
  row: RowPart | null;
  scalar: Map<string, string>;
  deep: Map<string, string>;
  fns: Set<Closure>;
  /**
   * Binding CELLS this value may be the same object as (round 4, F2). A value
   * read from a binding carries that binding's cell; binding it elsewhere, or
   * passing it to a parameter, UNIFIES the two cells — so a write through any
   * alias (`const o2 = o; o2.x = h`, `setv(o, h)`, `box.m.set(h, 1)`) lands in
   * the one shared cell every alias reads.
   */
  refs?: Set<string>;
  /**
   * S441 round 5 (F1) — the protected labels the value's `.length` reveals.
   * UNDEFINED means the fail-closed default: everything the value carries
   * outside a row (`naked`). Only constructions whose length is known to be a
   * DERIVED count set it explicitly: a column read off a row (the §14.8.9
   * allowlisted `row.passwordHash.length`), string concatenation / templates of
   * such values, array literals, `.map` / `.filter` / `.sort` of an array, a row
   * array itself. Anything else — `({ length: h })`, `new Array(u.pin)`,
   * `"x".repeat(u.pin)`, a method result the analysis has no model for — keeps
   * the default, so its `.length` stays protected. (Round 4 treated `.length`
   * as derived on ANY receiver; measured, `({length: h}).length` and
   * `new Array(u.pin).length` shipped the value.)
   */
  len?: Map<string, string>;
  /**
   * RULING S445 #4 — where the value's bits come from, for the `hmac` KEY rule:
   * bit 1 = a compile-time constant (a literal) is part of it; bit 2 = POSITIVE
   * evidence of a runtime secret source is part of it — a read under
   * `process.env` / `Bun.env` / `import.meta.env`, a database value, or the
   * result of a host (stdlib / npm) call such as a config or secret-store read.
   * Every combination UNIONS the bits — a choice (`a ?? b`), a join of call
   * sites, and a concatenation alike. `hmac` declassifies only for a key that
   * is EXACTLY runtime (2): a key with no evidence (0 — `String(Math.PI)`, a
   * parameter no caller shows, a platform call) or with any constant part
   * (`"k" + process.env.K` is `"kundefined"` when the variable is unset) stays
   * protected. S443 round 6c: 6b treated every unmodelled call and every global
   * read as runtime, so `String.fromCharCode(107,101,121)`, `JSON.parse('"key"')`
   * and `String(Math.PI)` keys declassified (review, measured).
   */
  k?: number;
}

/** Constness bits of a combined value: the union of its parts' (S445 #4). */
function opK(...ts: Taint[]): number | undefined {
  let bits = 0;
  for (const t of ts) bits |= t?.k ?? 0;
  return bits === 0 ? undefined : bits;
}

/** A global path that reads the process environment (positive runtime evidence). */
function isEnvPath(path: string | null): boolean {
  return path !== null && /^(?:(?:globalThis|self|global)\.)?(?:process\.env|Bun\.env)(?:\.|$)/.test(path);
}

/** What `.length` of the value reveals (see `Taint.len`). */
function lenOf(t: Taint): Map<string, string> {
  return t.len ?? naked(t);
}

/** A copy of `t` whose `.length` is the fail-closed default. */
function lenDefault(t: Taint): Taint {
  const r = { ...t };
  delete r.len;
  return r;
}

/** A copy of `t` whose `.length` reveals exactly `len`. */
function withLen(t: Taint, len: Map<string, string>): Taint {
  return { ...t, len: new Map(len) };
}

function clean(): Taint {
  return { row: null, scalar: new Map(), deep: new Map(), fns: new Set() };
}

/** The value's data only — no function values, no alias cells. */
function dataOnly(t: Taint): Taint {
  const r: Taint = { row: t.row ? copyRow(t.row) : null, scalar: new Map(t.scalar), deep: new Map(t.deep), fns: new Set() };
  if (t.len !== undefined) r.len = new Map(t.len);
  if (t.k !== undefined) r.k = t.k;
  return r;
}

function refsOf(t: Taint): Set<string> {
  return t.refs ?? new Set();
}

function copyRow(r: RowPart): RowPart {
  return { tags: new Set(r.tags), cols: new Set(r.cols), all: r.all, revealed: new Set(r.revealed) };
}

function joinRow(a: RowPart | null, b: RowPart | null): RowPart | null {
  if (!a) return b ? copyRow(b) : null;
  if (!b) return copyRow(a);
  const revealed = new Set<string>();
  for (const c of a.revealed) if (b.revealed.has(c)) revealed.add(c);
  return { tags: new Set([...a.tags, ...b.tags]), cols: new Set([...a.cols, ...b.cols]), all: a.all || b.all, revealed };
}

function mergeMap(into: Map<string, string>, from: Map<string, string>): void {
  for (const [k, v] of from) if (!into.has(k)) into.set(k, v);
}

function join(...ts: Taint[]): Taint {
  const out = clean();
  for (const t of ts) {
    if (!t) continue;
    out.row = t.row ? joinRow(out.row, t.row) : out.row;
    mergeMap(out.scalar, t.scalar);
    mergeMap(out.deep, t.deep);
    for (const f of t.fns) out.fns.add(f);
    if (t.refs && t.refs.size > 0) {
      if (!out.refs) out.refs = new Set();
      for (const r of t.refs) out.refs.add(r);
    }
    if (t.k) out.k = (out.k ?? 0) | t.k;
  }
  // `.length` of a join is whatever `.length` of ANY part reveals.
  if (ts.some((t) => t && t.len !== undefined)) {
    const len = new Map<string, string>();
    for (const t of ts) if (t) mergeMap(len, lenOf(t));
    out.len = len;
  }
  return out;
}

/** Every protected label the value carries OUTSIDE a descriptor. */
function naked(t: Taint): Map<string, string> {
  const m = new Map<string, string>();
  mergeMap(m, t.scalar);
  mergeMap(m, t.deep);
  return m;
}

/** The value, placed inside a fresh container (object / array literal slot). */
function containerOf(t: Taint): Taint {
  // The container HOLDS the value — if it is an object, the container reaches it.
  return { row: t.row ? copyRow(t.row) : null, scalar: new Map(), deep: naked(t), fns: new Set(t.fns), refs: new Set(refsOf(t)), ...(t.k ? { k: t.k } : {}) };
}

/** An element / field of the value, when WHICH one is not statically known. */
function elemOf(t: Taint): Taint {
  return { row: t.row ? copyRow(t.row) : null, scalar: naked(t), deep: new Map(t.deep), fns: new Set(t.fns), refs: new Set(refsOf(t)), ...(t.k ? { k: t.k } : {}) };
}

/** The protected labels a row still carries (not `reveal`ed). */
function unrevealed(row: RowPart): string[] {
  if (row.all) return [ALL_COLUMNS_LABEL];
  return [...row.cols].filter((c) => !row.revealed.has(foldCol(c)));
}

/** Everything protected the value carries or could expose, row columns included. */
function everything(t: Taint, site: string): Map<string, string> {
  const m = naked(t);
  if (t.row) for (const c of unrevealed(t.row)) if (!m.has(c)) m.set(c, site);
  return m;
}

function taintKey(t: Taint): string {
  const r = t.row
    ? `${[...t.row.tags].sort().join(",")}|${[...t.row.cols].sort().join(",")}|${t.row.all}|${[...t.row.revealed].sort().join(",")}`
    : "-";
  const f = [...t.fns].map((c) => c.cid).sort((a, b) => a - b).join(",");
  const a = [...refsOf(t)].sort().join(",");
  const l = t.len ? [...t.len.keys()].sort().join(",") : "~";
  return `${r}#${[...t.scalar.keys()].sort().join(",")}#${[...t.deep.keys()].sort().join(",")}#${f}#${a}#${l}#${t.k ?? 0}`;
}

/** The protected part of a taint's key (no function values). */
function protKey(t: Taint): string {
  const r = t.row
    ? `${[...t.row.tags].sort().join(",")}|${[...t.row.cols].sort().join(",")}|${t.row.all}|${[...t.row.revealed].sort().join(",")}`
    : "-";
  return `${r}#${[...t.scalar.keys()].sort().join(",")}#${[...t.deep.keys()].sort().join(",")}`;
}

const CLEAN_KEY = protKey(clean());

/** A value used as a KEY: only what it carries as data (its naked labels) matters. */
function keyOnly(t: Taint): Taint {
  const r = clean();
  mergeMap(r.scalar, naked(t));
  return r;
}

/** Fail-closed result: everything any argument carried comes out naked. */
function tainted(args: Taint[], site: string): Taint {
  const r = clean();
  for (const a of args) mergeMap(r.scalar, everything(a, site));
  r.deep = new Map(r.scalar);
  r.k = opK(...args); // an opaque call carries its arguments' constness (no evidence of its own)
  // NOT aliased to the arguments: the result is already fail-closed (every
  // protected label comes out naked), and aliasing it back into an argument's
  // cell would poison that argument with the result's naked labels (measured:
  // `const s = truncate(u, 3); return { id: u.id }` was rejected).
  return r;
}

/**
 * ECMAScript built-ins whose result COPIES the argument's data such that the
 * Symbol-keyed descriptor does not survive — a row passed in comes out naked.
 */
const SERIALIZING_BUILTINS = new Set([
  "JSON.stringify", "JSON.parse", "Object.values", "Object.entries", "Object.fromEntries", "structuredClone",
  "Object.getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptors", "Reflect.get", "Reflect.ownKeys",
]);
/** Of those, the ones whose result holds the argument's MEMBER objects themselves (aliases). */
const ELEMENT_ALIASING_BUILTINS = new Set([
  "Object.values", "Object.entries", "Object.fromEntries", "Reflect.get",
  "Object.getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptors",
]);
/** Built-ins that return their argument (or a container of it) with the descriptor intact. */
const IDENTITY_BUILTINS = new Set([
  "Object.assign", "Object.freeze", "Object.seal", "Array.from", "Array.of",
  "Promise.resolve", "Promise.all", "Promise.allSettled", "Promise.any", "Promise.race",
  "Map", "Set", "Array", "Object", "WeakMap",
]);
/**
 * THE DERIVER ALLOWLIST for calls — results of independent identity (one-way
 * digests, booleans, nothing). Global dotted paths; `scrml:` stdlib exports are
 * matched by `isStdlibDeriver`. Anything NOT here that receives a protected value
 * returns a protected value (fail closed).
 */
const DERIVER_CALLS = new Set([
  "Boolean", "isNaN", "isFinite", "Number.isNaN", "Number.isFinite", "Number.isInteger", "Array.isArray",
  // NOT `crypto.subtle.digest`: a bare digest (RULING S443 #7, below).
  "crypto.timingSafeEqual",
  "console.log", "console.error", "console.warn", "console.info", "console.debug", "console.trace",
]);
/**
 * RULING S443 #7 (user-voice-scrml.md §S443): only KEYED or PASSWORD-class
 * derivations produce a value of independent identity — `verifyPassword`,
 * `hashPassword` (argon2id), `verifyTotp` (a boolean), `verifyHash` (a boolean),
 * `hash("argon2", …)`, and `hmac(key, …)` when the key is not itself protected.
 * A BARE DIGEST (`hash("md5" | "sha256" | …, x)`, `crypto.subtle.digest`) stays
 * PROTECTED: it is reversible by enumeration on a low-entropy column —
 * `hash("md5", u.pin)` of a 4-digit pin falls in 10⁴ tries, the same reason
 * `Bun.hash` was never on the list. (It was on the list at S441; measured, the
 * digest shipped.)
 */
const STDLIB_DERIVERS: Record<string, Set<string>> = {
  auth: new Set(["verifyPassword", "hashPassword", "verifyTotp"]),
  crypto: new Set(["verifyHash"]),
};
/**
 * RULING S445 #4 — the stdlib calls whose RESULT is a runtime source (I/O, a
 * secret / configuration read, the environment, entropy): an `hmac` key built
 * only from these declassifies. `scrml:process` `env("HMAC_KEY")` is THE
 * configuration read; there is no separate config module. Everything else in
 * the stdlib is a pure function of its arguments.
 */
const RUNTIME_SOURCE_CALLS: Record<string, Set<string>> = {
  process: new Set(["env", "argv"]),
  fs: new Set(["readFileSync", "readdirSync"]),
  http: new Set(["get", "post", "put", "del", "patch"]),
  redis: new Set(["get", "getBuffer", "smembers"]),
  random: new Set(["random", "randomInt"]),
  crypto: new Set(["generateToken", "generateUUID"]),
};
function stdlibModuleOf(source: string): string | null {
  const m = /(?:^scrml:|(?:^|\/)_scrml\/)([a-z]+)(?:\.js)?$/.exec(source);
  return m ? m[1] : null;
}
function isStdlibDeriver(source: string, imported: string, node?: any, args?: Taint[]): boolean {
  const mod = stdlibModuleOf(source);
  if (!mod) return false;
  if (STDLIB_DERIVERS[mod]?.has(imported)) return true;
  if (mod === "crypto" && imported === "hash") {
    // Only the password-hashing algorithm, named literally.
    return staticKey(node?.arguments?.[0]) === "argon2";
  }
  if (mod === "crypto" && imported === "hmac") {
    // Keyed: the KEY must not itself be the protected value (a MAC keyed by the
    // secret over a known message is a digest of the secret), and — RULING S445
    // #4 — must not be a compile-time constant: `hmac("public-key", pin)` is
    // reversible by enumeration exactly like a bare digest. Only a key that is
    // exactly a RUNTIME value (env, config, a secret store, a DB read) counts.
    const key = args?.[0] ?? clean();
    return everything(key, "").size === 0 && key.k === 2;
  }
  return false;
}

/**
 * Binary operators whose result is a boolean of independent identity (DERIVED).
 * Every OTHER binary operator — `+ - * / % **`, bitwise and shifts — preserves
 * provenance (ruling, S441: arithmetic stays protected).
 */
const DERIVED_OPERATORS = new Set(["==", "!=", "===", "!==", "<", "<=", ">", ">=", "in", "instanceof"]);

/** Array callbacks: element-param methods (and what their result is). */
const CALLBACK_METHODS = new Set([
  "map", "flatMap", "filter", "find", "findLast", "forEach", "some", "every",
  "findIndex", "findLastIndex", "sort", "toSorted", "reduce", "reduceRight", "then", "catch", "finally",
]);
/** Methods that write their arguments INTO the receiver. */
const MUTATING_METHODS = new Set(["push", "unshift", "splice", "set", "add", "fill", "append", "update", "write"]);
/** Methods that return a single element of the receiver. */
const ELEMENT_METHODS = new Set(["at", "pop", "shift", "get", "charAt"]);
/**
 * Methods whose result is a predicate / position / comparison / digest over the
 * receiver — a DERIVED value of independent identity (§14.8.9 bound). NOT
 * `charCodeAt` / `codePointAt`: a character code is lossless.
 */
const DERIVED_METHODS = new Set([
  "includes", "indexOf", "lastIndexOf", "startsWith", "endsWith", "localeCompare",
  "search", "test", "has", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "delete", "forEach", "every", "some", "findIndex", "findLastIndex",
]);
/**
 * Methods that execute SQL. The result is a new row read from the database — a
 * DB round trip, outside the egress guarantee (F5). Its arguments are bound
 * parameters (server-side use).
 */
const SQL_METHODS = new Set(["unsafe"]);

/** Compiler-runtime helpers the analysis models itself (never walked). */
function isModelledHelperName(name: string): boolean {
  return name.startsWith("_scrml_protect_") || name.startsWith("_scrml_tenant_") || name === "_scrml_active_tenant"
    || name === "_scrml_structural_eq";
}

interface Mod {
  idx: number;
  filePath: string;
  src: string;
  root: any;
  scope: Scope;
  /** local name -> where it comes from. */
  imports: Map<string, { target: Mod | null; source: string; imported: string }>;
  /** exported name -> local binding name. */
  exports: Map<string, string>;
}

interface Scope {
  id: number;
  parent: Scope | null;
  names: Set<string>;
  mod: Mod;
}

/** Static facts about one function node. */
interface FnStatic {
  node: any;
  mod: Mod;
  name: string;
  names: Set<string>;
  /** FunctionDeclarations hoisted into this function's scope. */
  decls: any[];
  isGen: boolean;
  skip: boolean;
}

/** A function VALUE: a node + the scope instance it closes over (or a pseudo-function). */
interface Closure {
  cid: number;
  node?: any;
  env?: Scope;
  resolver?: string;
  rejecter?: true;
  host?: { source: string; imported: string };
}

/** One analysed instance of a function: a closure called with one argument signature. */
interface Instance {
  closure: Closure;
  stat: FnStatic;
  scope: Scope;
  ret: Taint;
  yields: Taint;
}

/** One leak: a protected value reaching a client-egress sink. */
export interface ProtectFlowLeak {
  /** Source file of the module whose egress ships it. */
  filePath: string;
  /** Display name of the function whose egress ships it (demangled). */
  sinkFn: string;
  /** Protected label (output column name, or `*`). */
  column: string;
  /** Where the value was extracted, e.g. "`u.passwordHash` in `getIt`". */
  site: string;
  /** The function the extraction happened in (demangled), or null. */
  siteFn: string | null;
  /** Source file the extraction happened in. */
  siteFile: string | null;
  /** The egress is a write into a global store (S443 round 6, L3), not a response. */
  global?: boolean;
}

/** One `_scrml_protect_tag` site: the SQL it wraps + whether a redact sink stripped it. */
export interface ProtectTagSite {
  filePath: string;
  /** Static SQL skeleton — quasis with `${}` holes, whitespace-collapsed. */
  skeleton: string | null;
  cols: string[] | "*";
  /** True iff a descriptor-bearing row from this site reached a REDACT sink with ≥1 unrevealed protected column. */
  stripped: boolean;
}

export interface ProtectFlowResult {
  /** filePath -> acorn parse error, for modules that did not parse. */
  parseErrors: Map<string, string>;
  /** The analysis budget ran out — nothing it says is a proof (fail closed). */
  saturated: boolean;
  leaks: ProtectFlowLeak[];
  tagSites: ProtectTagSite[];
}

const PARSE_OPTIONS = { ecmaVersion: "latest" as const, sourceType: "module" as const, allowAwaitOutsideFunction: true };

/**
 * Normalize SQL into its static skeleton: interpolation bodies replaced by a
 * hole marker, whitespace collapsed. Used to match an emitted tag site back to
 * the rewriter's per-query record. Balanced-brace aware for `${ f({a:1}) }`.
 */
export function sqlSkeleton(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "$" && sql[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "{") depth++;
        else if (sql[j] === "}") depth--;
        j++;
      }
      out += "\u0000";
      i = j;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The rewriter's per-query record (see `rewrite.ts` `protectTagSqlResult`). */
export interface ProtectStripInfo {
  cols: string[] | "*";
  sql: string;
  skeleton: string;
}

type SpanOf = (fnName: string) => { start: number; end: number; line?: number; col?: number } | null;

// ---------------------------------------------------------------------------
// The compile-wide registry. generateServerJs (per file) registers each
// protect-active file's strip records + span lookup; api.js runs the flow ONCE
// over every emitted server module of the compile, so an import between two
// files is resolved rather than guessed.
// ---------------------------------------------------------------------------
const registry = new Map<string, { infos: ProtectStripInfo[]; spanOf: SpanOf }>();

export function registerProtectModule(filePath: string, infos: ProtectStripInfo[], spanOf: SpanOf): void {
  registry.set(filePath, { infos, spanOf });
}

/** Return and CLEAR the registry (one compile's worth). */
export function takeProtectRegistry(): Map<string, { infos: ProtectStripInfo[]; spanOf: SpanOf }> {
  const out = new Map(registry);
  registry.clear();
  return out;
}

export interface CompileModule {
  filePath: string;
  js: string;
  /** Present for a protect-active file (it declares `protect=` columns). */
  infos?: ProtectStripInfo[];
  spanOf?: SpanOf;
}

/**
 * Run the provenance flow over a whole compile and return its diagnostics per
 * source file:
 *
 *   - `E-PROTECT-006` (Error) for every protected value that reaches a client
 *     egress sink outside a descriptor-bearing row (THE RULE, file header);
 *   - `I-PROTECT-STRIP-001` (Info) ONLY for a query whose row a redact sink
 *     really stripped. A query whose row never reaches one — a login that only
 *     verifies the hash, a helper whose caller extracts the column — reports
 *     nothing: the info never claims a strip that did not happen.
 *
 * A protect-active module that does not parse is UNVERIFIED and fails CLOSED
 * with `E-PROTECT-006`.
 *
 * @param resolveImport  maps (importer filePath, specifier) to the filePath of
 *        another module of THIS compile, or null (a host / stdlib / npm import).
 */
export function analyzeCompileProtectFlow(
  modules: CompileModule[],
  resolveImport: (fromFilePath: string, specifier: string) => string | null,
): Map<string, CGError[]> {
  const out = new Map<string, CGError[]>();
  const push = (fp: string, e: CGError) => {
    if (!out.has(fp)) out.set(fp, []);
    out.get(fp)!.push(e);
  };
  const byPath = new Map(modules.map((m) => [m.filePath, m]));
  const flow = runFlow(modules.map((m) => ({ filePath: m.filePath, js: m.js })), resolveImport);

  if (flow.saturated) {
    for (const m of modules) {
      if (!m.infos) continue;
      push(m.filePath, new CGError(
        "E-PROTECT-006",
        `E-PROTECT-006: the compiler could not finish proving that no \`protect=\` column leaves this compile's ` +
        `server modules outside its row — the provenance analysis exhausted its budget. §14.8.9 fails closed on an ` +
        `egress it cannot analyse. Please report this file: it is a compiler limitation, not a finding.`,
        { file: m.filePath, start: 0, end: 0 } as any,
        "error",
      ));
    }
  }
  for (const [fp, err] of flow.parseErrors) {
    if (!byPath.get(fp)?.infos) continue; // not protect-active: validate-emit reports it
    push(fp, new CGError(
      "E-PROTECT-006",
      `E-PROTECT-006: the compiler could not verify that no \`protect=\` column leaves this file's server module ` +
      `outside its row: the emitted server module did not parse (${err}). §14.8.9 fails closed on an ` +
      `egress it cannot analyse. This is a compiler defect — please report it with this file.`,
      { file: fp, start: 0, end: 0 } as any,
      "error",
    ));
  }

  // ONE error per extraction (column + site), naming the most useful sink.
  const isCompilerName = (n: string) => n.startsWith("_scrml_") || n === "<module>";
  const byExtraction = new Map<string, ProtectFlowLeak>();
  for (const leak of flow.leaks) {
    const key = `${leak.column}\u0000${leak.site}\u0000${leak.siteFile}\u0000${leak.global ? "g" : ""}`;
    const prev = byExtraction.get(key);
    if (!prev || (isCompilerName(prev.sinkFn) && !isCompilerName(leak.sinkFn))) byExtraction.set(key, leak);
  }
  for (const leak of byExtraction.values()) {
    const spanOf = byPath.get(leak.filePath)?.spanOf;
    const siteSpanOf = leak.siteFile ? byPath.get(leak.siteFile)?.spanOf : undefined;
    let span = spanOf ? spanOf(leak.sinkFn) : null;
    let file = leak.filePath;
    if (!span && leak.siteFn && siteSpanOf) {
      span = siteSpanOf(leak.siteFn);
      if (span) file = leak.siteFile!;
    }
    const egress = leak.global
      ? `a write into a global store (\`globalThis\`, \`process.env\`, \`import.meta\` or another object reached ` +
        `from a global name) in \`${leak.sinkFn}\` — any other request, and code the compiler cannot see, can read ` +
        `it back and send it`
      : isCompilerName(leak.sinkFn)
      ? `the compiler-emitted client egress \`${leak.sinkFn}\``
      : `the client egress of \`${leak.sinkFn}\``;
    const what = leak.column === ALL_COLUMNS_LABEL
      ? "a column of a row whose SQL column origins cannot be resolved statically (the floor treats every column " +
        "of such a row as protected and strips the row wholesale)"
      : `the protected (\`protect=\`) column \`${leak.column}\``;
    const resolution = leak.site.includes("§14.8.9 column marker")
      ? "remove the property with a LITERAL key — `delete o.name`, `delete o[\"name\"]`, or a `const` bound to a " +
        "string / number literal — or rebuild the collection without the entry (`rows.filter((r) => r.id != id)`, a " +
        "`Map` and `.delete(id)`); a computed key the compiler cannot read might be one of the row's §14.8.9 column " +
        "markers, and removing one would ship every protected column of the row"
      : leak.global
      ? "keep the value in a local binding, or store the ROW itself (it keeps its descriptor and is stripped " +
        "wherever it later leaves the server) — never a value taken out of it"
      : leak.column === ALL_COLUMNS_LABEL
      ? "rewrite the query so its column origins resolve (a plain SELECT with an explicit column list), then " +
        "return the row itself or only its non-protected fields"
      : `return the row itself (the floor strips \`${leak.column}\` and keeps the rest), or only a value DERIVED ` +
        `from the column (a comparison, \`verifyPassword(pw, row.${leak.column})\`); to send it deliberately, ` +
        `declassify it at the value — \`row.reveal("${leak.column}").${leak.column}\` (the name is the query's ` +
        `OUTPUT column name after aliasing)`;
    push(file, new CGError(
      "E-PROTECT-006",
      `E-PROTECT-006: ${what} leaves the server outside its row — ${leak.site} reaches ${egress}. ` +
      `The §14.8.9 egress floor strips a protected column using the origin descriptor its ROW carries; a value ` +
      `taken out of the row — a field read, a destructure, a concatenation, template or encoding, a new object or ` +
      `array holding it, \`JSON.stringify\` of the row, or anything passed through a function the compiler cannot ` +
      `see into — carries no descriptor, so the floor cannot strip it and the compiler will not ship it. ` +
      `Resolution: ${resolution}.`,
      span ? ({ file, ...span } as any) : ({ file, start: 0, end: 0 } as any),
      "error",
    ));
  }

  // I-PROTECT-STRIP-001 — only for a query a redact sink ACTUALLY stripped.
  for (const m of modules) {
    if (!m.infos) continue;
    const stripped = new Set<string>();
    for (const t of flow.tagSites) if (t.filePath === m.filePath && t.stripped && t.skeleton !== null) stripped.add(t.skeleton);
    for (const info of m.infos) {
      if (!stripped.has(info.skeleton)) continue;
      const what = info.cols === "*"
        ? "ALL columns (the query's column origins are not statically resolvable — fail-closed wholesale strip)"
        : `protected column(s) ${info.cols.map((c) => `\`${c}\``).join(", ")}`;
      push(m.filePath, new CGError(
        "I-PROTECT-STRIP-001",
        `I-PROTECT-STRIP-001: the egress floor strips ${what} from the client response of \`${info.sql}\` ` +
        `(§14.8.9 — a \`protect=\` column never crosses the wire unredacted). To send a protected column ` +
        `deliberately, declassify it at the value with \`reveal("col")\`; to silence this, project the column out of the SELECT.`,
        { file: m.filePath, start: 0, end: 0 } as any,
        "info",
      ));
    }
  }
  return out;
}

/**
 * Single-module convenience (unit tests): the diagnostics for one module with
 * no cross-module imports.
 */
export function buildProtectFlowDiagnostics(
  moduleJs: string,
  infos: ProtectStripInfo[],
  filePath: string,
  spanOf: SpanOf,
): CGError[] {
  return analyzeCompileProtectFlow([{ filePath, js: moduleJs, infos, spanOf }], () => null).get(filePath) ?? [];
}

/** Single-module analysis (unit tests). */
export function analyzeProtectFlow(moduleJs: string): ProtectFlowResult & { parseError: string | null } {
  const r = runFlow([{ filePath: "<module>", js: moduleJs }], () => null);
  return { ...r, parseError: r.parseErrors.get("<module>") ?? null };
}

function runFlow(
  modules: Array<{ filePath: string; js: string }>,
  resolveImport: (fromFilePath: string, specifier: string) => string | null,
): ProtectFlowResult {
  const parseErrors = new Map<string, string>();
  const parsed: Array<{ filePath: string; js: string; root: any }> = [];
  for (const m of modules) {
    try {
      parsed.push({ ...m, root: acorn.parse(m.js, PARSE_OPTIONS) });
    } catch (e) {
      parseErrors.set(m.filePath, (e as Error)?.message ?? String(e));
    }
  }
  const r = new FlowAnalysis(parsed, resolveImport).run();
  return { ...r, parseErrors };
}

function staticKey(node: any): string | null {
  if (!node) return null;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) return String(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

function isFnNode(n: any): boolean {
  return !!n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");
}

/** Per-closure instance cap: beyond it, calls share one widened instance (still sound — a union). */
const MAX_INSTANCES_PER_CLOSURE = 24;
/**
 * Whole-compile budget. Pathological code (a recursive function that wraps a
 * fresh closure into its own argument) can keep minting instances; past this
 * budget the analysis stops and the result is UNVERIFIED — the caller fails
 * CLOSED rather than report a partial proof as a clean one.
 */
const MAX_INSTANCES = 20000;
const MAX_PASSES = 80;

class FlowAnalysis {
  private mods: Mod[] = [];
  private scopeSeq = 0;
  private cidSeq = 0;
  private statics = new Map<any, FnStatic>();
  private fnParent = new Map<any, any>();
  private bindings = new Map<string, Taint>();
  private closures = new Map<string, Closure>();
  private instances = new Map<string, Instance>();
  private instanceList: Instance[] = [];
  private instanceCount = new Map<number, number>();
  private changed = false;
  /** The budget ran out (instances or passes): the result is not a proof. */
  saturated = false;
  private curMod: Mod | null = null;
  private inferredNames = new Map<any, string>();
  private siteFnOf = new Map<string, { fn: string; file: string }>();
  /**
   * Every client-egress point:
   *   redact           — the argument of `_scrml_protect_redact(…)`;
   *   frame            — the §37 SSE frame (`for await (const _scrml_val …)`);
   *   serializer       — every argument of `new Response(body, init)`,
   *                      `Response.redirect(url, status)`, `….publish`,
   *                      `….enqueue`, `….send` (the init HEADERS included);
   *   serializer-json  — `Response.json(value)`, which JSON-encodes a row itself.
   */
  private sinks: Array<{ t: Taint; fnName: string; kind: SinkKind; mod: Mod }> = [];
  /** The function instance being walked (null = a module body) — names a global-store sink. */
  private curInst: Instance | null = null;
  private tagMeta = new Map<string, { mod: Mod; skeleton: string | null; cols: string[] | "*" }>();
  private resolved = new Map<string, Taint>();
  private rejecter: Closure;
  /** Everything ever thrown / rejected — what any `catch` may receive. */
  private thrown: Taint = clean();

  constructor(parsed: Array<{ filePath: string; js: string; root: any }>, private resolveImport: (from: string, spec: string) => string | null) {
    this.rejecter = { cid: this.cidSeq++, rejecter: true };
    for (const p of parsed) {
      const mod = { idx: this.mods.length, filePath: p.filePath, src: p.js, root: p.root, imports: new Map(), exports: new Map() } as unknown as Mod;
      mod.scope = { id: this.scopeSeq++, parent: null, names: new Set(), mod };
      this.mods.push(mod);
    }
  }

  private t0 = performance.now();
  run(): { leaks: ProtectFlowLeak[]; tagSites: ProtectTagSite[]; saturated: boolean } {
    const byPath = new Map(this.mods.map((m) => [m.filePath, m]));
    for (const mod of this.mods) {
      this.curMod = mod;
      const decls: any[] = [];
      this.declare(mod.root.body, mod.scope.names, decls, null, mod);
      this.collectImportsExports(mod, byPath);
      this.bindDecls(decls, mod.scope);
      this.collectInferredNames(mod.root);
    }
    // Monotone fixpoint over a finite lattice — it terminates; the cap is a guard.
    let converged = false;
    let passes = 0;
    for (let pass = 0; pass < MAX_PASSES && !this.saturated; pass++) {
      passes = pass + 1;
      this.changed = false;
      this.sinks = [];
      this.globalRetCache.clear();
      for (const mod of this.mods) {
        this.curMod = mod;
        this.curInst = null;
        this.walkBody(mod.root.body, mod.scope, null);
      }
      for (let i = 0; i < this.instanceList.length && !this.saturated; i++) this.walkInstance(this.instanceList[i]);
      if (!this.changed) { converged = true; break; }
    }
    if (!converged) this.saturated = true;
    if (process.env.SCRML_PROTECT_FLOW_DEBUG) {
      console.error(`[protect-flow] modules=${this.mods.length} instances=${this.instanceList.length} closures=${this.closures.size} converged=${converged} passes=${passes} ms=${Math.round(performance.now() - this.t0)}`);
    }
    const leaks: ProtectFlowLeak[] = [];
    const seen = new Set<string>();
    const stripped = new Set<string>();
    for (const s of this.sinks) {
      const nk = naked(s.t);
      // A ROW written into a global store keeps its descriptor (a later read of
      // it is still redacted at a sink); only a value OUTSIDE a row is refused.
      const shipped = s.kind === "serializer-json"
        ? everything(s.t, "a protected row serialized by `Response.json` without the §14.8.9 redact")
        : new Map(nk);
      // A row that may have lost a column marker (L4): every column may ship.
      const symSite = nk.get(MARKER_REMOVED_LABEL);
      if (symSite !== undefined && s.t.row) {
        for (const c of unrevealed(s.t.row)) if (!shipped.has(c)) shipped.set(c, symSite);
      }
      for (const [col, site] of shipped) {
        if (isPseudoLabel(col)) continue;
        const key = `${s.mod.filePath}\u0000${s.fnName}\u0000${col}\u0000${site}\u0000${s.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sf = this.siteFnOf.get(site);
        leaks.push({
          filePath: s.mod.filePath, sinkFn: s.fnName, column: col, site, siteFn: sf?.fn ?? null,
          siteFile: sf?.file ?? s.mod.filePath, ...(s.kind === "global" ? { global: true } : {}),
        });
      }
      if (s.kind === "redact" && s.t.row && unrevealed(s.t.row).length > 0) for (const id of s.t.row.tags) stripped.add(id);
    }
    const tagSites: ProtectTagSite[] = [];
    for (const [id, meta] of this.tagMeta) {
      tagSites.push({ filePath: meta.mod.filePath, skeleton: meta.skeleton, cols: meta.cols, stripped: stripped.has(id) });
    }
    return { leaks, tagSites, saturated: this.saturated };
  }

  // ---------------------------------------------------------------- setup

  /**
   * Hoist declared names of one function body (or module body) into `names`,
   * collecting its FunctionDeclarations into `decls`, and record static facts
   * for every nested function (recursively, each with its own names/decls).
   */
  private declare(node: any, names: Set<string>, decls: any[], curFn: any, mod: Mod): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const c of node) this.declare(c, names, decls, curFn, mod);
      return;
    }
    if (isFnNode(node)) {
      if (node.type === "FunctionDeclaration" && node.id) {
        names.add(node.id.name);
        decls.push(node);
      }
      const fnNames = new Set<string>();
      if (node.type === "FunctionExpression" && node.id) fnNames.add(node.id.name);
      // A non-arrow function has its own `arguments` (an arrow reads its
      // enclosing function's, by ordinary scope resolution) — L2.
      if (node.type !== "ArrowFunctionExpression") fnNames.add("arguments");
      for (const p of node.params) this.patternNames(p, fnNames);
      const fnDecls: any[] = [];
      const name = node.id?.name ?? "";
      this.statics.set(node, {
        node, mod, name, names: fnNames, decls: fnDecls, isGen: !!node.generator,
        skip: node.type === "FunctionDeclaration" && !!name && isModelledHelperName(name),
      });
      this.fnParent.set(node, curFn);
      for (const p of node.params) this.declareInPattern(p, fnNames, fnDecls, node, mod);
      this.declare(node.body, fnNames, fnDecls, node, mod);
      return;
    }
    switch (node.type) {
      case "VariableDeclaration":
        for (const d of node.declarations) {
          // A `const` bound to a string / number literal IS that literal (it can
          // never be rebound) — a removal keyed by it names a column, not a marker.
          // Only when that name is declared ONCE in this function scope (block
          // scopes share the set here, so any second declaration disqualifies it).
          const declared = new Set<string>();
          this.patternNames(d.id, declared);
          let m = this.constLiterals.get(names);
          if (!m) { m = new Map(); this.constLiterals.set(names, m); }
          for (const n of declared) {
            if (names.has(n) || m.has(n)) m.set(n, "\u0000ambiguous");
            else if (node.kind === "const" && d.id?.type === "Identifier" && staticKey(d.init) !== null) m.set(n, staticKey(d.init)!);
            else m.set(n, "\u0000ambiguous");
          }
          this.patternNames(d.id, names);
        }
        break;
      case "ClassDeclaration":
        if (node.id) names.add(node.id.name);
        break;
      case "ImportDeclaration":
        for (const s of node.specifiers) if (s.local) names.add(s.local.name);
        return;
      case "CatchClause":
        if (node.param) {
          const declared = new Set<string>();
          this.patternNames(node.param, declared);
          const m = this.constLiterals.get(names);
          if (m) for (const n of declared) m.set(n, "\u0000ambiguous");
          else if (declared.size) this.constLiterals.set(names, new Map([...declared].map((n) => [n, "\u0000ambiguous"])));
          this.patternNames(node.param, names);
        }
        break;
    }
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (v && typeof v === "object") this.declare(v, names, decls, curFn, mod);
    }
  }

  /** Default-value expressions in parameters may contain functions. */
  private declareInPattern(p: any, names: Set<string>, decls: any[], curFn: any, mod: Mod): void {
    if (!p || typeof p !== "object") return;
    if (p.type === "AssignmentPattern") this.declare(p.right, names, decls, curFn, mod);
  }

  private patternNames(p: any, into: Set<string>): void {
    if (!p) return;
    switch (p.type) {
      case "Identifier": into.add(p.name); break;
      case "ObjectPattern": for (const pr of p.properties) this.patternNames(pr.type === "RestElement" ? pr.argument : pr.value, into); break;
      case "ArrayPattern": for (const el of p.elements) this.patternNames(el, into); break;
      case "RestElement": this.patternNames(p.argument, into); break;
      case "AssignmentPattern": this.patternNames(p.left, into); break;
    }
  }

  private collectImportsExports(mod: Mod, byPath: Map<string, Mod>): void {
    for (const st of mod.root.body) {
      if (st.type === "ImportDeclaration") {
        const source = String(st.source.value);
        const targetPath = this.resolveImport(mod.filePath, source);
        const target = targetPath ? byPath.get(targetPath) ?? null : null;
        for (const s of st.specifiers) {
          const imported = s.type === "ImportDefaultSpecifier" ? "default"
            : s.type === "ImportNamespaceSpecifier" ? "*"
            : (s.imported?.name ?? s.imported?.value ?? "");
          mod.imports.set(s.local.name, { target, source, imported });
        }
      } else if (st.type === "ExportNamedDeclaration") {
        if (st.declaration) {
          const d = st.declaration;
          if (d.id?.name) mod.exports.set(d.id.name, d.id.name);
          if (d.type === "VariableDeclaration") {
            const ns = new Set<string>();
            for (const dd of d.declarations) this.patternNames(dd.id, ns);
            for (const n of ns) mod.exports.set(n, n);
          }
        }
        for (const s of st.specifiers ?? []) {
          const local = s.local?.name ?? s.local?.value;
          const exported = s.exported?.name ?? s.exported?.value;
          if (!local || !exported) continue;
          if (!st.source) {
            mod.exports.set(exported, local);
          } else {
            // `export { nm } from "./b.server.js"` — a re-export: bind a hidden
            // module-scope name to the source module's export and export that.
            const source = String(st.source.value);
            const targetPath = this.resolveImport(mod.filePath, source);
            const alias = `\u0000reexport:${exported}`;
            mod.scope.names.add(alias);
            mod.imports.set(alias, { target: targetPath ? byPath.get(targetPath) ?? null : null, source, imported: local });
            mod.exports.set(exported, alias);
          }
        }
      } else if (st.type === "ExportDefaultDeclaration" && st.declaration?.id?.name) {
        mod.exports.set("default", st.declaration.id.name);
      }
    }
  }

  /** Bind hoisted FunctionDeclarations in a scope instance to their closures. */
  private bindDecls(decls: any[], scope: Scope): void {
    for (const d of decls) {
      const c = this.closureFor(d, scope);
      const key = `${scope.id}:${d.id.name}`;
      const prev = this.bindings.get(key) ?? clean();
      if (!prev.fns.has(c)) this.bindings.set(key, join(prev, { ...clean(), fns: new Set([c]) }));
    }
  }

  /**
   * The closure for a function node evaluated in `env`. Creating one also
   * creates its DEFAULT instance (every parameter clean) so that a function
   * nobody in the compile calls — a route handler, a callback handed to a
   * platform API — is still walked for the sinks inside it.
   */
  private closureFor(node: any, env: Scope): Closure {
    const key = `${this.statics.get(node)?.mod.idx ?? -1}:${node.start}@${env.id}`;
    let c = this.closures.get(key);
    if (!c) {
      c = { cid: this.cidSeq++, node, env };
      this.closures.set(key, c);
      this.instanceFor(c, [], undefined);
    }
    return c;
  }

  private instanceFor(c: Closure, args: Taint[], everyParam: Taint | undefined): Instance | null {
    const stat = this.statics.get(c.node);
    if (!stat || stat.skip) return null;
    if (this.instanceList.length >= MAX_INSTANCES) { this.saturated = true; return null; }
    // The context key is the PROTECTED signature of the arguments only — not the
    // function values they carry. Calls that differ only in which callbacks they
    // pass share an instance (the callbacks union into the parameter — still
    // sound); calls that differ in what PROTECTED data they pass do not. Keying on
    // the callbacks too minted a fresh instance per closure environment and
    // exploded (measured: 4016 instances for 245 closures in one module).
    const keys = args.map(protKey);
    while (keys.length > 0 && keys[keys.length - 1] === CLEAN_KEY) keys.pop(); // trailing clean args == absent
    let argKey = everyParam ? (protKey(everyParam) === CLEAN_KEY ? "" : `*${protKey(everyParam)}`) : keys.join(";");
    const count = this.instanceCount.get(c.cid) ?? 0;
    if (!this.instances.has(`${c.cid}|${argKey}`) && count >= MAX_INSTANCES_PER_CLOSURE) argKey = "~wide";
    const key = `${c.cid}|${argKey}`;
    let inst = this.instances.get(key);
    if (!inst) {
      const scope: Scope = { id: this.scopeSeq++, parent: c.env!, names: stat.names, mod: stat.mod };
      inst = { closure: c, stat, scope, ret: clean(), yields: clean() };
      this.instances.set(key, inst);
      this.instanceList.push(inst);
      this.instanceCount.set(c.cid, count + 1);
      this.changed = true;
      if (stat.node.type === "FunctionExpression" && stat.node.id) {
        this.bindings.set(`${scope.id}:${stat.node.id.name}`, { ...clean(), fns: new Set([c]) });
      }
      this.bindDecls(stat.decls, scope);
    }
    // Bind (merge) this call's arguments into the instance's parameters.
    const saved = this.curMod;
    this.curMod = stat.mod;
    stat.node.params.forEach((p: any, i: number) => {
      if (everyParam) this.bindPattern(p.type === "RestElement" ? p.argument : p, everyParam, inst!.scope, inst!);
      else if (p.type === "RestElement") this.bindPattern(p.argument, containerOf(join(...args.slice(i))), inst!.scope, inst!);
      else this.bindPattern(p, args[i] ?? clean(), inst!.scope, inst!);
    });
    // S443 round 6 (L2) — `arguments` holds EVERY argument, including those no
    // parameter names. It read as a free (clean) name, so `function f() {
    // return arguments[0] } f(u.passwordHash)` and `return arguments` shipped the
    // hash (measured). It is the container of the join of all arguments; its
    // `.length` is the argument COUNT, a value of independent identity.
    if (stat.node.type !== "ArrowFunctionExpression") {
      const argsObj = containerOf(everyParam ?? join(...args));
      argsObj.len = new Map();
      this.mergeBinding("arguments", inst!.scope, argsObj);
    }
    this.curMod = saved;
    return inst;
  }

  private walkInstance(inst: Instance): void {
    this.curMod = inst.stat.mod;
    this.curInst = inst;
    const body = inst.stat.node.body;
    if (body && body.type === "BlockStatement") this.walkBody(body.body, inst.scope, inst);
    else if (body) this.addRet(inst, this.evalExpr(body, inst.scope, inst));
  }

  // ---------------------------------------------------------------- bindings

  private resolve(name: string, scope: Scope): Scope | null {
    for (let s: Scope | null = scope; s; s = s.parent) if (s.names.has(name)) return s;
    return null;
  }

  // ---- ALIAS CLASSES (round 4, F2) ----------------------------------------
  // Bindings that may hold the SAME object form one alias class (union-find
  // over binding keys). What is shared by a class is only what is WRITTEN INTO
  // the object — a container write through any alias (`o2.x = h`, `setv(o, h)`
  // in a helper, `box.m.set(h, 1)`) lands in `classWrites` for the whole class
  // and every alias reads it. Each binding's OWN assigned value stays its own:
  // merging whole values would make two primitives compared by a helper
  // (`_scrml_structural_eq(h[i], c)`) contaminate each other.
  private classWrites = new Map<string, Taint>();
  private cellParent = new Map<string, string>();
  private find(k: string): string {
    let r = k;
    while (this.cellParent.has(r)) r = this.cellParent.get(r)!;
    let c = k;
    while (this.cellParent.has(c)) { const n = this.cellParent.get(c)!; this.cellParent.set(c, r); c = n; }
    return r;
  }
  /** Two bindings may hold the same object: from now on they are ONE alias class. */
  private unite(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    const merged = join(this.classWrites.get(ra) ?? clean(), this.classWrites.get(rb) ?? clean());
    delete merged.refs;
    this.cellParent.set(rb, ra);
    this.classWrites.delete(rb);
    this.classWrites.set(ra, merged);
    this.changed = true;
  }

  /**
   * S443 round 6 (L3) — EVERY free name (`globalThis`, `process`, `Bun`, `Date`,
   * …) reads and writes ONE compile-wide cell. It used to read as clean and a
   * write into it landed in a per-module slot nobody read, so
   * `globalThis.x = u.passwordHash; return globalThis.x`, `process.env.X = h`,
   * and the same store split across two server functions all served the hash
   * (measured). Now what is written into the global heap is what any global
   * read returns (provenance on read), and a write of a value outside a row is
   * itself an egress (`E-PROTECT-006`, sink kind "global"): code the compiler
   * cannot see — a library, a child process given `process.env` — may read it.
   */
  private readGlobal(): Taint {
    const own = this.bindings.get(GLOBAL_CELL) ?? clean();
    const writes = this.classWrites.get(this.find(GLOBAL_CELL));
    const t = writes ? join(own, writes) : own;
    return { ...t, refs: new Set([GLOBAL_CELL]) };
  }

  /**
   * FUNCTIONS stored in the global heap, by the property NAME they were stored
   * under (`globalThis.clamp = …` → "clamp"; `clamp = …` → "clamp"), plus the
   * ones stored where no name is readable (an alias of a global object, a
   * computed key, `Object.assign(globalThis, …)`). A global-path call applies —
   * and joins the returns of — only the functions whose name appears in its
   * path, plus the unnamed ones. S443 round 6b (review SHOULD 5/6): applying
   * EVERY global-stored function at EVERY global call (`Math.abs(u.pin)` ran a
   * `globalThis.clamp` closure) blamed compiler-emitted code the author cannot
   * change (`_scrml_session_middleware`) for a leak, and went roughly cubic
   * (89 s on a generated 32-function file).
   */
  private globalFnsByName = new Map<string, Set<Closure>>();
  private globalFnsUnnamed = new Set<Closure>();
  /** Set while a NAMED global write is being recorded, so it is not also unnamed. */
  private namedGlobalWrite = false;
  private recordGlobalFns(name: string | null, fns: Set<Closure>): void {
    if (fns.size === 0) return;
    let set: Set<Closure>;
    if (name === null) set = this.globalFnsUnnamed;
    else {
      set = this.globalFnsByName.get(name) ?? new Set();
      this.globalFnsByName.set(name, set);
    }
    for (const f of fns) if (!set.has(f)) { set.add(f); this.changed = true; }
  }
  /** The global-stored functions a call through global `path` may reach. */
  private globalFnsFor(parts: string[]): Set<Closure> {
    const out = new Set<Closure>(this.globalFnsUnnamed);
    for (const p of parts) for (const f of this.globalFnsByName.get(p) ?? []) out.add(f);
    return out;
  }
  /** What those functions have returned so far (data only), cached per pass. */
  private globalRetCache = new Map<string, Taint>();
  private globalFnRetFor(parts: string[]): Taint {
    const fns = this.globalFnsFor(parts);
    if (fns.size === 0) return clean();
    const key = [...fns].map((c) => c.cid).sort((a, b) => a - b).join(",");
    const hit = this.globalRetCache.get(key);
    if (hit) return hit;
    let r = clean();
    for (const inst of this.instanceList) if (fns.has(inst.closure)) r = join(r, dataOnly(inst.ret));
    r = dataOnly(r);
    this.globalRetCache.set(key, r);
    return r;
  }

  /** Does any argument carry protected data (a row, or a value outside one)? */
  private carriesProtected(args: Taint[]): boolean {
    return args.some((a) => [...everything(a, "").keys()].some((l) => !isPseudoLabel(l)));
  }

  /**
   * A reflection-capable callee — a global-rooted path (`Reflect.deleteProperty`,
   * an unmodelled `Object.*`) or a function reached from the global heap
   * (`const O = Object; O.defineProperty(…)`) — handed a ROW may remove or hide
   * one of its column markers; that argument ships every column from now on (L4).
   * Host imports and compile functions are not covered by this rule: the
   * markers on the row a query returned are non-configurable, so no callee can
   * remove THOSE; only an author-made copy is exposed, and an author who hands a
   * copy to reflection is what this rule sees.
   */
  private reflectionMayRemoveMarkers(args: Taint[], node: any, fn: Instance | null, scope: Scope): void {
    const argNodes = node?.arguments ?? [];
    args.forEach((a, i) => {
      const an = argNodes[i];
      if (a?.row && an && an.type !== "SpreadElement") this.markerRemoved(an, a, node, fn, scope);
    });
  }

  /** Does this value belong to the global heap's alias class? */
  private isGlobalValue(t: Taint): boolean {
    const g = this.find(GLOBAL_CELL);
    for (const r of refsOf(t)) if (this.find(r) === g) return true;
    return false;
  }

  /** A write landed in the global heap's alias class: a value outside a row is an egress. */
  private globalStore(slot: string, t: Taint): void {
    if (this.find(slot) !== this.find(GLOBAL_CELL)) return;
    if ([...naked(t).keys()].some((l) => !isPseudoLabel(l))) this.sink(t, this.curInst, "global");
    if (!this.namedGlobalWrite) this.recordGlobalFns(null, t.fns);
  }

  private getBinding(name: string, scope: Scope, depth = 0): Taint {
    const s = this.resolve(name, scope);
    if (!s) return this.readGlobal();
    if (s.parent === null) {
      const imp = s.mod.imports.get(name);
      if (imp) return this.importValue(imp, depth);
    }
    const key = `${s.id}:${name}`;
    const own = this.bindings.get(key) ?? clean();
    const writes = this.classWrites.get(this.find(key));
    const t = writes ? join(own, writes) : own;
    return { ...t, refs: new Set([key]) };
  }

  /** The value of an imported binding: the exporting module's binding, or a host function. */
  private importValue(imp: { target: Mod | null; source: string; imported: string }, depth: number): Taint {
    if (imp.target && imp.imported !== "*" && depth < 16) {
      const local = imp.target.exports.get(imp.imported);
      if (local) return this.getBinding(local, imp.target.scope, depth + 1);
    }
    if (imp.target && imp.imported === "*") {
      // A namespace import of a compile module: any of its exports.
      let t = clean();
      for (const local of imp.target.exports.values()) t = join(t, this.getBinding(local, imp.target.scope, depth + 1));
      return containerOf(t);
    }
    // Code outside the compile (stdlib / npm / platform): an opaque host function.
    const key = `host:${imp.source}:${imp.imported}`;
    let c = this.closures.get(key);
    if (!c) {
      c = { cid: this.cidSeq++, host: { source: imp.source, imported: imp.imported } };
      this.closures.set(key, c);
    }
    return { ...clean(), fns: new Set([c]) };
  }

  private mergeBinding(name: string, scope: Scope, t: Taint, isWrite = false): void {
    const resolved = this.resolve(name, scope);
    let s = resolved ?? scope.mod.scope;
    // An assignment to an imported binding writes the exporting module's binding.
    if (resolved && s.parent === null) {
      const imp = s.mod.imports.get(name);
      if (imp?.target) {
        const local = imp.target.exports.get(imp.imported);
        if (local) { name = local; s = imp.target.scope; }
      }
    }
    // A free name is the global heap (L3).
    const key = resolved ? `${s.id}:${name}` : GLOBAL_CELL;
    // The value may BE another binding's object — join its alias class.
    for (const r of refsOf(t)) this.unite(key, r);
    const plain = { ...t };
    delete plain.refs;
    // A write INTO the object goes to the whole alias class; an assignment of
    // the binding itself stays the binding's own.
    const store = isWrite ? this.classWrites : this.bindings;
    const slot = isWrite ? this.find(key) : key;
    if (!resolved && !isWrite) {
      // `clamp = () => …` to a free name: a global stored under that name.
      this.recordGlobalFns(name, plain.fns);
      const prevNamed = this.namedGlobalWrite;
      this.namedGlobalWrite = true;
      try { this.globalStore(slot, plain); } finally { this.namedGlobalWrite = prevNamed; }
    } else if (isWrite || key === GLOBAL_CELL) {
      this.globalStore(slot, plain);
    }
    const prev = store.get(slot) ?? clean();
    const next = join(prev, plain);
    if (taintKey(prev) !== taintKey(next)) {
      store.set(slot, next);
      this.changed = true;
    } else if (!store.has(slot)) {
      store.set(slot, next);
    }
  }

  private addRet(inst: Instance, t: Taint): void {
    const next = join(inst.ret, t);
    if (taintKey(next) !== taintKey(inst.ret)) { inst.ret = next; this.changed = true; }
  }

  private addYield(inst: Instance | null, t: Taint): void {
    if (!inst) return;
    const next = join(inst.yields, t);
    if (taintKey(next) !== taintKey(inst.yields)) { inst.yields = next; this.changed = true; }
  }

  private addThrown(t: Taint): void {
    const next = join(this.thrown, t);
    if (taintKey(next) !== taintKey(this.thrown)) { this.thrown = next; this.changed = true; }
  }

  // ------------------------------------------------------------ naming

  /** Demangled display name of the function enclosing `fnNode` (for diagnostics). */
  private displayName(fnNode: any): string {
    let fallback = "";
    for (let f = fnNode; f; f = this.fnParent.get(f)) {
      let name = this.statics.get(f)?.name ?? "";
      if (!name) name = this.inferredNames.get(f) ?? "";
      if (!name) continue;
      const h = /^_scrml_handler_(.+?)(?:_\d+)?$/.exec(name);
      if (h) return h[1];
      if (name.startsWith("_scrml_")) { if (!fallback) fallback = name; continue; }
      return name;
    }
    return fallback || "<module>";
  }

  private collectInferredNames(node: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) this.collectInferredNames(c); return; }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && isFnNode(node.init)) {
      this.inferredNames.set(node.init, node.id.name);
    }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init?.type === "ObjectExpression") {
      for (const pr of node.init.properties) if (pr.type === "Property" && isFnNode(pr.value)) this.inferredNames.set(pr.value, node.id.name);
    }
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const v = node[k];
      if (v && typeof v === "object") this.collectInferredNames(v);
    }
  }

  private site(node: any, inst: Instance | null): string {
    const mod = this.curMod!;
    let text = mod.src.slice(node.start, node.end).replace(/\s+/g, " ");
    if (text.length > 70) text = text.slice(0, 67) + "...";
    const where = this.displayName(inst?.stat.node ?? null);
    const s = `\`${text}\` in \`${where}\``;
    if (!this.siteFnOf.has(s)) this.siteFnOf.set(s, { fn: where, file: mod.filePath });
    return s;
  }

  private sink(t: Taint, inst: Instance | null, kind: SinkKind): void {
    this.sinks.push({ t, fnName: this.displayName(inst?.stat.node ?? null), kind, mod: this.curMod! });
  }

  // -------------------------------------------------------- statements

  private walkBody(stmts: any[], scope: Scope, fn: Instance | null): void {
    for (const s of stmts) this.walkStmt(s, scope, fn);
  }

  private walkStmt(node: any, scope: Scope, fn: Instance | null): void {
    if (!node) return;
    switch (node.type) {
      case "VariableDeclaration":
        for (const d of node.declarations) {
          const v = d.init ? this.evalExpr(d.init, scope, fn) : clean();
          this.bindPattern(d.id, v, scope, fn);
        }
        return;
      case "FunctionDeclaration":
      case "EmptyStatement":
      case "DebuggerStatement":
      case "BreakStatement":
      case "ContinueStatement":
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        return;
      case "ClassDeclaration":
        this.evalGeneric(node, scope, fn);
        return;
      case "ReturnStatement":
        if (node.argument) {
          const v = this.evalExpr(node.argument, scope, fn);
          if (fn) this.addRet(fn, v);
        }
        return;
      case "ExpressionStatement":
        this.evalExpr(node.expression, scope, fn);
        return;
      case "BlockStatement":
      case "StaticBlock":
        this.walkBody(node.body, scope, fn);
        return;
      case "IfStatement":
        this.evalExpr(node.test, scope, fn);
        this.walkStmt(node.consequent, scope, fn);
        this.walkStmt(node.alternate, scope, fn);
        return;
      case "ForStatement":
        if (node.init) {
          if (node.init.type === "VariableDeclaration") this.walkStmt(node.init, scope, fn);
          else this.evalExpr(node.init, scope, fn);
        }
        if (node.test) this.evalExpr(node.test, scope, fn);
        if (node.update) this.evalExpr(node.update, scope, fn);
        this.walkStmt(node.body, scope, fn);
        return;
      case "WhileStatement":
      case "DoWhileStatement":
        this.evalExpr(node.test, scope, fn);
        this.walkStmt(node.body, scope, fn);
        return;
      case "ForOfStatement":
      case "ForInStatement": {
        const right = this.evalExpr(node.right, scope, fn);
        const el = node.type === "ForOfStatement" ? elemOf(right) : clean();
        if (node.left.type === "VariableDeclaration") {
          const id = node.left.declarations[0].id;
          this.bindPattern(id, el, scope, fn);
          // §37 SSE: the compiler's own frame loop serializes `event` / `id` off
          // each yielded frame OUTSIDE the redact — the whole frame is a sink.
          if (node.type === "ForOfStatement" && node.await && id.type === "Identifier" && id.name === "_scrml_val") {
            this.sink(el, fn, "frame");
          }
        } else {
          this.bindPattern(node.left, el, scope, fn);
        }
        this.walkStmt(node.body, scope, fn);
        return;
      }
      case "TryStatement":
        this.walkStmt(node.block, scope, fn);
        if (node.handler) {
          // A `catch` may receive anything the compile ever throws or rejects.
          if (node.handler.param) this.bindPattern(node.handler.param, this.thrown, scope, fn);
          this.walkStmt(node.handler.body, scope, fn);
        }
        this.walkStmt(node.finalizer, scope, fn);
        return;
      case "SwitchStatement":
        this.evalExpr(node.discriminant, scope, fn);
        for (const c of node.cases) {
          if (c.test) this.evalExpr(c.test, scope, fn);
          this.walkBody(c.consequent, scope, fn);
        }
        return;
      case "LabeledStatement":
        this.walkStmt(node.body, scope, fn);
        return;
      case "ThrowStatement":
        this.addThrown(this.evalExpr(node.argument, scope, fn));
        return;
      case "ExportNamedDeclaration":
        if (node.declaration) this.walkStmt(node.declaration, scope, fn);
        return;
      case "ExportDefaultDeclaration":
        if (node.declaration) {
          if (node.declaration.type.endsWith("Declaration")) this.walkStmt(node.declaration, scope, fn);
          else this.evalExpr(node.declaration, scope, fn);
        }
        return;
      default:
        this.evalGeneric(node, scope, fn);
    }
  }

  /** Visit every expression under `node` for side effects; the node's own value is clean. */
  private evalGeneric(node: any, scope: Scope, fn: Instance | null): Taint {
    for (const k in node) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (!v || typeof v !== "object") continue;
      const items = Array.isArray(v) ? v : [v];
      for (const it of items) {
        if (!it || typeof it.type !== "string") continue;
        if (isFnNode(it)) { this.closureFor(it, scope); continue; } // class methods etc. — walked via their default instance
        if (/Statement$|Declaration$/.test(it.type)) this.walkStmt(it, scope, fn);
        else if (it.type === "ClassBody" || it.type === "MethodDefinition" || it.type === "PropertyDefinition") this.evalGeneric(it, scope, fn);
        else this.evalExpr(it, scope, fn);
      }
    }
    return clean();
  }

  // -------------------------------------------------------- patterns

  private bindPattern(p: any, t: Taint, scope: Scope, fn: Instance | null): void {
    if (!p) return;
    switch (p.type) {
      case "Identifier":
        this.mergeBinding(p.name, scope, t);
        return;
      case "ObjectPattern":
        for (const pr of p.properties) {
          if (pr.type === "RestElement") {
            // Object rest copies enumerable Symbol-keyed props too — the
            // column markers survive, exactly as for `{...row}` — EXCEPT a key
            // the pattern names: excluding a computed key the compiler cannot
            // read (`const { [k]: _, ...rest } = row`) may drop a marker (L4).
            const dynExcluded = p.properties.some((q: any) => q.type !== "RestElement" && q.computed && this.literalKey(q.key, scope) === null);
            if (dynExcluded) {
              const lost = { ...t, scalar: new Map(t.scalar), deep: new Map(t.deep) };
              lost.deep.set(MARKER_REMOVED_LABEL, `${this.site(p, fn)} — excludes a key the compiler cannot read from an object rest (it may be a §14.8.9 column marker)`);
              this.bindPattern(pr.argument, lost, scope, fn);
            } else {
              this.bindPattern(pr.argument, t, scope, fn);
            }
            continue;
          }
          let v: Taint;
          if (pr.computed) {
            const k = staticKey(pr.key);
            this.evalExpr(pr.key, scope, fn);
            v = this.memberRead(t, k, k === null, pr, fn);
          } else {
            const k = pr.key.type === "Identifier" ? pr.key.name : staticKey(pr.key);
            v = this.memberRead(t, k, false, pr, fn);
          }
          this.bindPattern(pr.value, v, scope, fn);
        }
        return;
      case "ArrayPattern":
        for (const el of p.elements) {
          if (!el) continue;
          if (el.type === "RestElement") this.bindPattern(el.argument, t, scope, fn);
          else this.bindPattern(el, this.memberRead(t, "0", false, el, fn), scope, fn);
        }
        return;
      case "RestElement":
        this.bindPattern(p.argument, t, scope, fn);
        return;
      case "AssignmentPattern":
        this.bindPattern(p.left, join(t, this.evalExpr(p.right, scope, fn)), scope, fn);
        return;
      case "MemberExpression": {
        const objT = this.evalExpr(p.object, scope, fn);
        // `o[h] = v` writes the KEY `h` into `o` as well as the value (N1).
        const k = p.computed ? keyOnly(this.evalExpr(p.property, scope, fn)) : clean();
        // A function stored straight into a global object is recorded under the
        // property name it is stored as (see `globalFnsByName`).
        // (Walks through `(g.x ??= {})[k]` / parentheses to the root, and names a
        // computed-key store after the nearest STATIC name on its path —
        // `(globalThis.__scrml_session_stores ??= {})[path] = store` is
        // "__scrml_session_stores" — so the compiler's own session store's methods
        // are applied only at calls that name that path, not at every global call.)
        const rootOf = (e: any): any => {
          while (e) {
            if (e.type === "MemberExpression") e = e.object;
            else if (e.type === "ChainExpression" || e.type === "ParenthesizedExpression") e = e.expression;
            else if (e.type === "AssignmentExpression") e = e.left;
            else return e;
          }
          return e;
        };
        const staticNameOf = (e: any): string | null => {
          while (e) {
            if (e.type === "MemberExpression") {
              const n = e.computed ? staticKey(e.property) : (e.property?.name ?? null);
              if (n !== null) return n;
              e = e.object;
            } else if (e.type === "ChainExpression" || e.type === "ParenthesizedExpression") e = e.expression;
            else if (e.type === "AssignmentExpression") e = e.left;
            else return null;
          }
          return null;
        };
        const root = rootOf(p.object);
        const freeRoot = !!root && ((root.type === "Identifier" && !this.resolve(root.name, scope)) || root.type === "MetaProperty");
        const propName = p.computed ? staticKey(p.property) : (p.property?.name ?? null);
        const globalName = propName ?? staticNameOf(p.object);
        if (t.fns.size > 0) {
          // `o.f = function …` runs with `this` = o (round 6e) — and a `toJSON`
          // (or a key the compiler cannot read, which may be `toJSON`) is INVOKED
          // by the serializer: what it returns is part of o.
          this.recordThis(t.fns, objT);
          if (propName === "toJSON" || propName === null) t = join(t, containerOf(this.applyFns(t.fns, [], undefined, p, fn)));
        }
        if (freeRoot && globalName !== null && t.fns.size > 0) {
          this.recordGlobalFns(globalName, t.fns);
          this.namedGlobalWrite = true;
          try { this.writeThrough(p.object, objT, containerOf(join(t, k)), scope); } finally { this.namedGlobalWrite = false; }
          return;
        }
        this.writeThrough(p.object, objT, containerOf(join(t, k)), scope);
        return;
      }
    }
  }

  /** `a.b.c = v` / `a.push(v)` — the value now lives inside the root binding `a`. */
  private mutateRoot(expr: any, t: Taint, scope: Scope): void {
    let e = expr;
    while (e && (e.type === "MemberExpression" || e.type === "ChainExpression")) e = e.type === "ChainExpression" ? e.expression : e.object;
    if (e && e.type === "Identifier") this.mergeBinding(e.name, scope, t, true);
    else if (e && e.type === "MetaProperty") this.writeCell(GLOBAL_CELL, t);
  }

  /**
   * A write INTO the object `expr` evaluates to (whose abstract value is
   * `exprT`). Lands in the syntactic root binding (`a.b.c = v` → `a`) AND in
   * every alias class the object may belong to — `exprT.refs`. S441 round 5
   * (F4): the root-binding walk alone stopped at a call, so a write into an
   * ELEMENT a collection method handed back — `arr.find(…).x = h`,
   * `arr.at(0).x = h`, `m.get(k).x = h`, `Object.values(o)[0].x = h`,
   * `it.next().value.x = h` — reached no binding and the container shipped.
   */
  /** A property of `expr`'s object may have been removed by an unreadable key (L4). */
  private markerRemoved(expr: any, exprT: Taint, node: any, fn: Instance | null, scope: Scope): void {
    const t = clean();
    t.deep.set(MARKER_REMOVED_LABEL, `${this.site(node, fn)} — removes a property by a key the compiler cannot read (it may be a §14.8.9 column marker)`);
    this.writeThrough(expr, exprT, t, scope);
  }

  private writeThrough(expr: any, exprT: Taint, t: Taint, scope: Scope): void {
    this.mutateRoot(expr, t, scope);
    for (const r of refsOf(exprT)) this.writeCell(r, t);
  }

  /** Merge a container write into the alias class of binding cell `key`. */
  private writeCell(key: string, t: Taint): void {
    for (const r of refsOf(t)) this.unite(key, r);
    const plain = { ...t };
    delete plain.refs;
    const slot = this.find(key);
    this.globalStore(slot, plain);
    const prev = this.classWrites.get(slot) ?? clean();
    const next = join(prev, plain);
    if (taintKey(prev) !== taintKey(next)) {
      this.classWrites.set(slot, next);
      this.changed = true;
    }
  }

  // -------------------------------------------------------- expressions

  /**
   * A field / index read off a value. This is where extraction happens: a
   * protected column read off a descriptor-bearing row becomes a NAKED scalar.
   */
  private memberRead(o: Taint, key: string | null, dynamic: boolean, node: any, fn: Instance | null): Taint {
    const r = clean();
    // `.length` is DERIVED only where the value's length is known to be a
    // count of independent identity (S441 round 5, F1 — see `Taint.len`); on
    // any other receiver it is read like any other field, fail-closed.
    if (!dynamic && key === "length") {
      mergeMap(r.scalar, lenOf(o));
      return r;
    }
    const numeric = key !== null && /^\d+$/.test(key);
    let columnRead = false;
    if (o.row) {
      if (dynamic) {
        // `rows[i]` (an element — still a row) OR `u[k]` (any column): both.
        r.row = copyRow(o.row);
        for (const c of unrevealed(o.row)) r.scalar.set(c, this.site(node, fn));
      } else if (numeric) {
        r.row = copyRow(o.row);
      } else if (key !== null) {
        // A named protected column keeps its (declared) name; any other column
        // read off a strip-all row (unresolvable SQL) is protected-by-default,
        // labelled `*`. Column names compare case-insensitively (round 5, F2).
        columnRead = true;
        if (!o.row.revealed.has(foldCol(key))) {
          const col = rowColFor(o.row, key);
          if (col !== null) r.scalar.set(col, this.site(node, fn));
          else if (o.row.all) r.scalar.set(ALL_COLUMNS_LABEL, this.site(node, fn));
        }
      }
    }
    if (o.deep.size > 0) {
      mergeMap(r.scalar, o.deep);
      mergeMap(r.deep, o.deep);
    }
    // A property of a primitive is derived; a CHARACTER of it is not.
    if (o.scalar.size > 0 && (dynamic || numeric)) mergeMap(r.scalar, o.scalar);
    for (const f of o.fns) r.fns.add(f);
    // The read may yield an object REACHABLE from `o` (`arr[0]`, `box.m`) — it
    // aliases into `o`'s cell. A named column read off a row is a primitive and
    // does not (a row column cannot alias its row).
    const namedColumnOffRow = o.row !== null && !dynamic && !numeric && o.deep.size === 0;
    if (!namedColumnOffRow && refsOf(o).size > 0) r.refs = new Set(refsOf(o));
    // A column read straight off a row is a primitive: its `.length` is the
    // §14.8.9 allowlisted derived count. Anything that merged container
    // contents (`o.deep`) may be an object with its own `length` — default.
    if (columnRead && namedColumnOffRow && o.fns.size === 0) r.len = new Map();
    if (o.k) r.k = o.k; // a part of a constant is constant; of a runtime value, runtime
    return r;
  }

  private evalExpr(node: any, scope: Scope, fn: Instance | null): Taint {
    if (!node) return clean();
    switch (node.type) {
      case "Identifier":
        if (node.name === "undefined") return clean();
        return this.getBinding(node.name, scope);
      case "Literal":
        return { ...clean(), k: 1 };
      case "ThisExpression":
        return this.thisTaint(fn);
      case "Super":
      case "PrivateIdentifier":
        return clean();
      case "MetaProperty":
        // `import.meta` is a host-owned object like any global (L3).
        return this.readGlobal();
      case "TemplateLiteral": {
        const r = clean();
        // The string's length is the sum of its parts' lengths (F1).
        r.len = new Map();
        const parts: Taint[] = [{ ...clean(), k: 1 }];
        for (const e of node.expressions) {
          const v = this.evalExpr(e, scope, fn);
          mergeMap(r.scalar, naked(v));
          mergeMap(r.len, lenOf(v));
          parts.push(v);
        }
        r.k = opK(...parts);
        return r;
      }
      case "TaggedTemplateExpression": {
        const tagT = this.evalExpr(node.tag, scope, fn);
        const args = node.quasi.expressions.map((e: any) => this.evalExpr(e, scope, fn));
        if (this.hasCallable(tagT)) return this.applyFns(tagT.fns, args, undefined, node, fn);
        const path = this.globalPath(node.tag, scope);
        if (path === "String.raw") return tainted(args, this.site(node, fn));
        // `_scrml_sql`…`` / `tx`…`` — a query. Its interpolations are bound
        // parameters (server-side use), and its result is a row read from the
        // database: a DB round trip is outside the egress guarantee (F5).
        return { ...clean(), k: 2 };
      }
      case "ArrayExpression": {
        let r = clean();
        // An array literal's length is its element count — static, except that
        // a spread contributes the spread value's own length (F1).
        const len = new Map<string, string>();
        for (const el of node.elements) {
          if (!el) continue;
          const v = el.type === "SpreadElement" ? this.evalExpr(el.argument, scope, fn) : this.evalExpr(el, scope, fn);
          r = join(r, el.type === "SpreadElement" ? containerOf(elemOf(v)) : containerOf(v));
          if (el.type === "SpreadElement") mergeMap(len, lenOf(v));
        }
        return withLen(r, len);
      }
      case "ObjectExpression": {
        let r = clean();
        const methods: Array<{ fns: Set<Closure>; invoked: boolean }> = [];
        for (const pr of node.properties) {
          if (pr.type === "SpreadElement") {
            // `{...row}` copies the enumerable Symbol descriptor: still a row.
            r = join(r, containerOf(this.evalExpr(pr.argument, scope, fn)));
            continue;
          }
          // A protected value used as a KEY is part of the container too —
          // `{ [h]: 1 }` serializes as `{"SECRET":1}` (S441 round 3, N1).
          if (pr.computed) r = join(r, containerOf(keyOnly(this.evalExpr(pr.key, scope, fn))));
          const v = this.evalExpr(pr.value, scope, fn);
          r = join(r, containerOf(v));
          const keyName = pr.key?.type === "Identifier" ? pr.key.name : staticKey(pr.key);
          if (v.fns.size > 0) methods.push({ fns: v.fns, invoked: pr.kind === "get" || pr.kind === "set" || keyName === "toJSON" });
        }
        // S443 round 6e — a function stored on this object runs with `this` =
        // the object: `{ ...u, toJSON() { return { pw: this.passwordHash } } }`.
        for (const m of methods) this.recordThis(m.fns, r);
        // A getter, or a `toJSON` method, is INVOKED by `JSON.stringify` at the
        // sink — what it returns is what ships.
        let invokedRet = clean();
        for (const m of methods) if (m.invoked) invokedRet = join(invokedRet, this.applyFns(m.fns, [], undefined, node, fn));
        return methods.some((m) => m.invoked) ? join(r, containerOf(invokedRet)) : r;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return { ...clean(), fns: new Set([this.closureFor(node, scope)]) };
      case "ClassExpression":
        return this.evalGeneric(node, scope, fn);
      case "UnaryExpression":
      case "UpdateExpression": {
        if (node.type === "UnaryExpression" && node.operator === "delete") {
          // `delete o[k]` with a key that is not a string / number literal may
          // remove a §14.8.9 column marker from a copy of a row (L4).
          const target = node.argument?.type === "ChainExpression" ? node.argument.expression : node.argument;
          if (target?.type === "MemberExpression" && target.computed) {
            const objT = this.evalExpr(target.object, scope, fn);
            this.evalExpr(target.property, scope, fn);
            if (this.literalKey(target.property, scope) === null) this.markerRemoved(target.object, objT, node, fn, scope);
            return clean();
          }
        }
        const v = this.evalExpr(node.argument, scope, fn);
        // RULING (bryan, S441): arithmetic stays protected. Unary `+` / `-` /
        // `~` and `++` / `--` yield a number computed from the operand — `+u.pin`
        // IS the pin. Only `!`, `typeof`, `void` and `delete` are derived.
        if (node.type === "UnaryExpression" && (node.operator === "!" || node.operator === "typeof" || node.operator === "void" || node.operator === "delete")) {
          return clean();
        }
        const r = clean();
        mergeMap(r.scalar, naked(v));
        r.k = opK(v);
        return r;
      }
      case "BinaryExpression": {
        const l = this.evalExpr(node.left, scope, fn);
        const rr = this.evalExpr(node.right, scope, fn);
        // Comparisons / relational / membership operators yield a boolean of
        // independent identity — DERIVED.
        if (DERIVED_OPERATORS.has(node.operator)) return clean();
        // String concatenation embeds a protected scalar VERBATIM; and — RULING
        // (bryan, S441): "arithmetic stays protected" — every arithmetic or
        // bitwise result computed from a protected value is protected
        // (`u.pin * 1`, `u.pin - 0`, `cost_price * qty`). To compute with a
        // protected column and ship the result, declassify it with `reveal`.
        // A row in the expression is "[object Object]" / NaN and carries nothing.
        const r = clean();
        mergeMap(r.scalar, naked(l));
        mergeMap(r.scalar, naked(rr));
        // A concatenation's length is the sum of the operands' string lengths;
        // an operand whose own length is not known-derived (`new Array(u.pin)`
        // stringifies to `pin - 1` commas) keeps the result's length protected.
        r.len = new Map();
        mergeMap(r.len, lenOf(l));
        mergeMap(r.len, lenOf(rr));
        r.k = opK(l, rr);
        return r;
      }
      case "LogicalExpression":
        return join(this.evalExpr(node.left, scope, fn), this.evalExpr(node.right, scope, fn));
      case "ConditionalExpression":
        this.evalExpr(node.test, scope, fn);
        return join(this.evalExpr(node.consequent, scope, fn), this.evalExpr(node.alternate, scope, fn));
      case "AssignmentExpression": {
        const rv = this.evalExpr(node.right, scope, fn);
        let v = rv;
        if (node.operator !== "=" && node.operator !== "||=" && node.operator !== "&&=" && node.operator !== "??=") {
          const lv = this.evalExpr(node.left, scope, fn);
          v = clean();
          mergeMap(v.scalar, naked(lv));
          mergeMap(v.scalar, naked(rv));
          v.k = opK(lv, rv);
        }
        this.bindPattern(node.left, v, scope, fn);
        return v;
      }
      case "SequenceExpression": {
        let last = clean();
        for (const e of node.expressions) last = this.evalExpr(e, scope, fn);
        return last;
      }
      case "AwaitExpression":
        return this.evalExpr(node.argument, scope, fn);
      case "YieldExpression": {
        const v = node.argument ? this.evalExpr(node.argument, scope, fn) : clean();
        this.addYield(fn, node.delegate ? elemOf(v) : v);
        return clean();
      }
      case "ChainExpression":
      case "ParenthesizedExpression":
        return this.evalExpr(node.expression, scope, fn);
      case "MemberExpression": {
        const o = this.evalExpr(node.object, scope, fn);
        let key: string | null;
        let dynamic = false;
        let keyTaint = clean();
        if (node.computed) {
          keyTaint = this.evalExpr(node.property, scope, fn);
          key = staticKey(node.property);
          dynamic = key === null;
        } else {
          key = node.property.type === "Identifier" || node.property.type === "PrivateIdentifier" ? node.property.name : null;
        }
        const read = this.memberRead(o, key, dynamic, node, fn);
        // A lookup KEYED by a protected value (`labels[u.passwordHash]`,
        // `table[h[i]]`) selects by the secret — the result is protected (N2),
        // ALL THE WAY DOWN (round 4, F1): the selected value may be an object,
        // and `L[c].v`, `L[c].test()` and `Object.keys(L[c])` read through it.
        // So the key's labels go into BOTH parts — as the value itself and as
        // what it contains — never the scalar part alone (a static field read
        // off a scalar is treated as a primitive property and drops it).
        const sel = naked(keyTaint);
        mergeMap(read.scalar, sel);
        mergeMap(read.deep, sel);
        // S445 #4: a read of the process environment is positive evidence of a
        // runtime (secret) source — `process.env.X`, `Bun.env.X`, `import.meta.env.X`.
        if (isEnvPath(this.globalPath(node, scope)) || this.isImportMetaEnv(node)) read.k = 2;
        return read;
      }
      case "CallExpression":
      case "NewExpression":
        return this.evalCall(node, scope, fn);
      case "ImportExpression":
        this.evalExpr(node.source, scope, fn);
        return clean();
      default:
        return this.evalGeneric(node, scope, fn);
    }
  }

  /**
   * The dotted path of a callee rooted at an UNRESOLVED (global) identifier —
   * `JSON.stringify`, `Bun.password.verify`, `String.prototype.concat.call` —
   * or null when the root is a local / imported binding or the chain is computed.
   */
  private globalPath(callee: any, scope: Scope): string | null {
    const parts: string[] = [];
    let e = callee;
    while (e && e.type === "MemberExpression") {
      if (e.computed) {
        const k = staticKey(e.property);
        if (k === null) return null;
        parts.unshift(k);
      } else {
        parts.unshift(e.property.name);
      }
      e = e.object;
    }
    if (!e || e.type !== "Identifier" || this.resolve(e.name, scope)) return null;
    parts.unshift(e.name);
    return parts.join(".");
  }

  private hasCallable(t: Taint): boolean {
    return t.fns.size > 0;
  }

  /** Call every function value in `fns`; the result is the union of their returns. */
  private applyFns(fns: Set<Closure>, args: Taint[], everyParam: Taint | undefined, node: any, fn: Instance | null): Taint {
    let r = clean();
    for (const c of fns) {
      if (c.resolver !== undefined) {
        const prev = this.resolved.get(c.resolver) ?? clean();
        const next = join(prev, everyParam ?? args[0] ?? clean());
        if (taintKey(next) !== taintKey(prev)) { this.resolved.set(c.resolver, next); this.changed = true; }
        continue;
      }
      if (c.rejecter) { this.addThrown(everyParam ?? args[0] ?? clean()); continue; }
      if (c.host) { r = join(r, this.hostCall(c.host, everyParam ? [everyParam] : args, node, fn)); continue; }
      const inst = this.instanceFor(c, args, everyParam);
      if (!inst) continue;
      r = join(r, inst.stat.isGen ? containerOf(join(inst.yields, inst.ret)) : inst.ret);
    }
    return r;
  }

  /**
   * A call into code the compile does not contain (a stdlib / npm import).
   * FAIL CLOSED: everything protected the arguments carry comes out protected,
   * unless the callee is an allowlisted DERIVER (a one-way digest / boolean).
   */
  private hostCall(host: { source: string; imported: string }, args: Taint[], node: any, fn: Instance | null): Taint {
    const cb = this.opaqueCallbacks(null, args, node, fn);
    if (isStdlibDeriver(host.source, host.imported, node, args)) return clean();
    const pm = this.pickOmit(host, args, node, fn);
    if (pm) return join(pm, cb);
    // S445 #4 (round 6d): a host call is positive runtime evidence ONLY when it
    // is a recognized I/O / secret / entropy source (`RUNTIME_SOURCE_CALLS`) —
    // its argument is a selector (a variable name, a path, a URL), not key
    // material, so the result is runtime whatever the argument. Any other host
    // function — a pure stdlib helper (`scrml:path` `normalize`, `scrml:format`
    // `capitalize`, `scrml:crypto` `hash`) or an npm import the compiler has no
    // model for — carries its arguments' constness: a function of constants is
    // a constant (fail closed). Round 6c counted every host call as runtime and
    // `normalize("public-key")` laundered a constant key (review, measured).
    const src = stdlibModuleOf(host.source);
    const k = src !== null && RUNTIME_SOURCE_CALLS[src]?.has(host.imported) ? 2 : opK(...args);
    if (args.every((a) => everything(a, "").size === 0)) return { ...cb, k };
    return { ...join(cb, tainted(args, `${this.site(node, fn)} — \`${host.imported}\` from \`${host.source}\`, code the compiler cannot see into`)), k };
  }

  /**
   * `scrml:data` `pick(obj, keys)` / `omit(obj, keys)` with a LITERAL key list:
   * they copy fields into a fresh object (no descriptor), so exactly the
   * protected columns that survive the selection come out naked — and none
   * does for `pick(u, ["id", "name"])`. A non-literal key list fails closed.
   */
  private pickOmit(host: { source: string; imported: string }, args: Taint[], node: any, fn: Instance | null): Taint | null {
    if (!/(?:^scrml:|(?:^|\/)_scrml\/)data(?:\.js)?$/.test(host.source)) return null;
    if (host.imported !== "pick" && host.imported !== "omit") return null;
    const keysNode = node?.arguments?.[1];
    if (!keysNode || keysNode.type !== "ArrayExpression") return null;
    const keys: string[] = [];
    for (const e of keysNode.elements) {
      const k = staticKey(e);
      if (k === null) return null;
      keys.push(k);
    }
    const obj = args[0] ?? clean();
    const r = clean();
    const site = this.site(node, fn);
    if (obj.row) {
      for (const c of unrevealed(obj.row)) {
        // JS keys are exact-case: `pick` keeps a column any case-variant key MAY
        // name (over-approximation), `omit` removes it only on an exact match.
        const survives = c === ALL_COLUMNS_LABEL ? true : host.imported === "pick" ? keys.some((k) => foldCol(k) === foldCol(c)) : !keys.includes(c);
        if (survives) r.scalar.set(c, site);
      }
    }
    mergeMap(r.scalar, obj.deep);
    for (const a of args.slice(2)) mergeMap(r.scalar, everything(a, site));
    r.deep = new Map(r.scalar);
    return r;
  }

  /** A call to a global the analysis has no model for: same fail-closed rule. */
  private unknownCall(path: string | null, args: Taint[], node: any, fn: Instance | null): Taint {
    let cb = this.opaqueCallbacks(null, args, node, fn);
    if (path !== null && DERIVER_CALLS.has(path)) return clean();
    if (path !== null) cb = join(cb, this.globalFnRetFor(path.split(".")));
    if (args.every((a) => everything(a, "").size === 0)) return cb;
    const what = path ?? "an unmodelled callee";
    return join(cb, tainted(args, `${this.site(node, fn)} — \`${what}\`, which the compiler does not know to be a one-way deriver`));
  }

  private evalCall(node: any, scope: Scope, fn: Instance | null): Taint {
    const callee = node.callee;
    const args: Taint[] = node.arguments.map((a: any) =>
      a.type === "SpreadElement" ? elemOf(this.evalExpr(a.argument, scope, fn)) : this.evalExpr(a, scope, fn));

    // --- the compiler's own protect runtime, modelled exactly -----------------
    if (callee.type === "Identifier" && !this.resolveLocalShadow(callee.name, scope)) {
      const name = callee.name;
      if (name === "_scrml_protect_tag") {
        const colsArg = node.arguments[1];
        let cols: string[] | "*" = [];
        if (colsArg?.type === "Literal" && colsArg.value === "*") cols = "*";
        else if (colsArg?.type === "ArrayExpression") {
          cols = colsArg.elements.filter((e: any) => e?.type === "Literal" && typeof e.value === "string").map((e: any) => e.value);
        }
        const id = `${this.curMod!.idx}:${node.start}`;
        if (!this.tagMeta.has(id)) this.tagMeta.set(id, { mod: this.curMod!, skeleton: this.tagSkeleton(node.arguments[0]), cols });
        return {
          ...clean(),
          row: { tags: new Set([id]), cols: new Set(cols === "*" ? [] : cols), all: cols === "*", revealed: new Set() },
          k: 2,
        };
      }
      if (name === "_scrml_protect_reveal") {
        const v = args[0] ?? clean();
        const col = staticKey(node.arguments[1]);
        if (v.row && col !== null) {
          const row = copyRow(v.row);
          row.revealed.add(foldCol(col));
          return { ...v, row, refs: undefined }; // reveal returns a NEW object (no alias)
        }
        return v;
      }
      if (name === "_scrml_protect_redact") {
        this.sink(args[0] ?? clean(), fn, "redact");
        return clean();
      }
      if (name === "_scrml_structural_eq") {
        // scrml's `==` / `!=` on non-primitive operands lowers to this runtime
        // helper. It is a COMPARISON — a derived boolean, exactly like `==` —
        // and it is modelled as one rather than walked: its internals put both
        // operands into shared memo structures, which the alias analysis would
        // (soundly but uselessly) read as the two operands aliasing each other.
        return clean();
      }
      if (isModelledHelperName(name)) {
        // `_scrml_tenant_redact(v, t)` / `_scrml_tenant_tag(v, …)` preserve the
        // protect descriptor on survivors (§14.8.10 composes inside §14.8.9).
        return args[0] ?? clean();
      }
    }

    // --- method calls ----------------------------------------------------------
    if (callee.type === "MemberExpression" || (callee.type === "ChainExpression" && callee.expression.type === "MemberExpression")) {
      const m = callee.type === "ChainExpression" ? callee.expression : callee;
      const path = this.globalPath(m, scope);
      if (path === "Response.json") {
        this.sink(args[0] ?? clean(), fn, "serializer-json");
        for (const a of args.slice(1)) this.sink(a, fn, "serializer");
        return clean();
      }
      if (path === "Response.redirect") {
        for (const a of args) this.sink(a, fn, "serializer");
        return clean();
      }
      if (path === "Array.from" && args[1] && this.hasCallable(args[1])) {
        // `Array.from(rows, r => r.passwordHash)` — the mapper is a `.map`.
        return this.callbackMethod("map", args[0] ?? clean(), [args[1]], node, fn);
      }
      if (path === "Promise.reject") {
        this.addThrown(args[0] ?? clean());
        return clean();
      }
      if (path === "Object.defineProperty" || path === "Reflect.defineProperty") {
        // The descriptor's `value` / getter become a field of the target, and a
        // redefinition by an unreadable key may HIDE a column marker (a
        // non-enumerable marker is dropped by the next spread) — L4.
        const desc = args[2] ?? clean();
        this.recordThis(desc.fns, args[0] ?? clean()); // a getter / value function runs with `this` = the target (6e)
        const got = this.hasCallable(desc) ? this.applyFns(desc.fns, [], undefined, node, fn) : clean();
        const written = containerOf(join(desc, got, keyOnly(args[1] ?? clean())));
        this.writeThrough(node.arguments[0], args[0] ?? clean(), written, scope);
        if (this.literalKey(node.arguments[1], scope) === null) this.markerRemoved(node.arguments[0], args[0] ?? clean(), node, fn, scope);
        return join(args[0] ?? clean(), written);
      }
      if (path === "Object.defineProperties" || path === "Reflect.set" || path === "Reflect.deleteProperty") {
        // Keys and values of the second argument (or the key + value) are written
        // into the target; a redefinition / removal by an unreadable key may
        // drop a column marker (L4). A function among them runs with `this` = the target (6e).
        this.recordThis(path === "Reflect.set" ? (args[2] ?? clean()).fns : (args[1] ?? clean()).fns, args[0] ?? clean());
        const written = path === "Object.defineProperties"
          ? containerOf(join(args[1] ?? clean(), ...(this.hasCallable(args[1] ?? clean()) ? [this.applyFns(args[1].fns, [], undefined, node, fn)] : [])))
          : containerOf(join(keyOnly(args[1] ?? clean()), args[2] ?? clean()));
        this.writeThrough(node.arguments[0], args[0] ?? clean(), written, scope);
        if (path === "Object.defineProperties" || (path === "Reflect.deleteProperty" && this.literalKey(node.arguments[1], scope) === null)) {
          this.markerRemoved(node.arguments[0], args[0] ?? clean(), node, fn, scope);
        }
        return path === "Object.defineProperties" ? join(args[0] ?? clean(), written) : clean();
      }
      if (path !== null) {
        const b = this.builtin(path, args, node, fn);
        if (b) return join(b, this.opaqueCallbacks(null, args, node, fn));
        if (DERIVER_CALLS.has(path)) {
          this.opaqueCallbacks(null, args, node, fn); // side effects only: the result is derived
          return clean();
        }
      }
      const recv = this.evalExpr(m.object, scope, fn);
      let method: string | null = null;
      if (m.computed) { this.evalExpr(m.property, scope, fn); method = staticKey(m.property); }
      else if (m.property.type === "Identifier") method = m.property.name;

      // Bytes leaving the server: a channel publish, an SSE chunk, a WS send.
      const sinkArg = method === "publish" ? 1 : (method === "enqueue" || method === "send") ? 0 : -1;
      if (sinkArg >= 0) this.sink(args[sinkArg] ?? clean(), fn, "serializer");

      if ((method === "call" || method === "apply") && this.hasCallable(recv)) {
        if (method === "call") return this.applyFns(recv.fns, args.slice(1), undefined, node, fn);
        // `f.apply(this, list)`: every parameter may receive any list element.
        return this.applyFns(recv.fns, [], elemOf(args[1] ?? clean()), node, fn);
      }
      if (method === "bind" && this.hasCallable(recv)) return { ...clean(), fns: new Set(recv.fns) };

      // `row.reveal("col")` left UNLOWERED — the scrml declassification written
      // inside a `_{}` foreign block. Honour it as a reveal (at runtime a plain
      // row has no `.reveal`, so the call throws before anything ships).
      if (method === "reveal" && recv.row) {
        const col = staticKey(node.arguments[0]);
        if (col !== null) {
          const row = copyRow(recv.row);
          row.revealed.add(foldCol(col));
          return { ...recv, row, refs: undefined }; // a new object (no alias)
        }
      }

      if (method !== null && SQL_METHODS.has(method)) return clean();
      if (method !== null && CALLBACK_METHODS.has(method)) return this.callbackMethod(method, recv, args, node, fn);

      if (method !== null && MUTATING_METHODS.has(method)) {
        // `m.set(k, v)` stores the KEY too (N1).
        const written = method === "set" ? join(keyOnly(args[0] ?? clean()), args[1] ?? clean()) : method === "splice" ? join(...args.slice(2)) : join(...args);
        this.writeThrough(m.object, recv, containerOf(written), scope);
        const cbm = this.opaqueCallbacks(path === null ? recv : dataOnly(recv), args, node, fn); // `store.update(fn)` calls it
        return method === "push" || method === "unshift" ? cbm : join(recv, containerOf(written), cbm);
      }
      // A method stored in an object the compile built (`api.f(x)`), or a
      // function value reached through a host namespace.
      const viaField = this.memberRead(recv, method, method === null, node, fn);
      let r = clean();
      // A method reached from the GLOBAL heap (`Math.abs(…)`, `process.env.x.trim()`,
      // `const O = Object; O.keys(…)`) is a platform API — unless a function was
      // stored in a global under a name on its path (`globalThis.clamp(…)`), which
      // is applied (only when protected data is passed) and whose returns join
      // the result. See `globalFnsByName`.
      const recvGlobal = path !== null || this.isGlobalValue(recv);
      const gParts = path !== null ? path.split(".") : (method !== null ? [method] : []);
      if (recvGlobal) {
        const gf = this.globalFnsFor(gParts);
        if (gf.size > 0 && this.carriesProtected(args)) r = join(r, this.applyFns(gf, args, undefined, node, fn));
      } else if (this.hasCallable(viaField)) {
        r = join(r, this.applyFns(viaField.fns, args, undefined, node, fn));
      }
      // L1 — a method the analysis has no model for may call any function it is
      // handed (a compile-defined method is walked exactly instead, above).
      if (recvGlobal || !this.hasCallable(viaField)) r = join(r, this.opaqueCallbacks(recvGlobal ? dataOnly(recv) : recv, args, node, fn));
      // L4 — reflection reached from the global heap may remove a row's marker.
      if (recvGlobal) this.reflectionMayRemoveMarkers(args, node, fn, scope);

      // A predicate / position method is DERIVED only on a string-like receiver.
      // An OBJECT receiver carrying protected data (`new Box(h).test()`, a
      // user class whose `digest()` returns its field) is a method the compiler
      // has no model for — fail closed (round-2 review A4/A5).
      if (method !== null && DERIVED_METHODS.has(method) && recv.deep.size === 0 && recv.row === null) return r;
      if (method !== null && ELEMENT_METHODS.has(method)) {
        // `m.get(h[i])` — an element selected BY a protected key is protected (N2).
        const el = elemOf(recv);
        // …and protected all the way down (round 4, F1): `M.get(c).v`.
        for (const a of args) { mergeMap(el.scalar, naked(a)); mergeMap(el.deep, naked(a)); }
        return join(r, el);
      }
      if (method === "join" || method === "toString" || method === "toLocaleString") {
        // Serializes the receiver's elements (and a `join` separator).
        const s = clean();
        mergeMap(s.scalar, naked(recv));
        for (const a of args) mergeMap(s.scalar, naked(a));
        return join(r, s);
      }
      // Any other method — a slice, transform, encoding, or something the
      // analysis has no model for. FAIL CLOSED: the result carries the receiver
      // AND every argument (`String.prototype.concat.call("", h)`,
      // `Buffer.from(h).toString("base64")`, `h.charCodeAt(0)`).
      // (Not for a GLOBAL-rooted callee: the global heap's function values are
      // whatever anything ever stored there, not a model of `Math.max`.)
      if (!recvGlobal && this.hasCallable(viaField) && recv.row === null && recv.scalar.size === 0 && recv.deep.size === 0) return r;
      const out: Taint = { row: recv.row ? copyRow(recv.row) : null, scalar: new Map(recv.scalar), deep: new Map(recv.deep), fns: new Set() };
      // …and it may BE (or hand back) an object reachable from the receiver or
      // an argument — `arr.values().next().value`, `it.next().value`, a
      // library `wrap(o)` — so it joins their alias classes (round 5, F4).
      const aliases = new Set<string>(refsOf(recv));
      // A GLOBAL-rooted method (`Date.now()`, `Math.max(…)`, `crypto.randomUUID()`)
      // is a platform API, not a handle into the global heap: aliasing its
      // result to the global cell unified every value near a timestamp with
      // every global store (measured: examples/23 did not finish in 400 s with
      // it, 0.95 s without). A global OBJECT reached by name or member
      // (`const e = process.env; e.X = h`) still aliases it. Disclosed in
      // g-protect-egress-round-7-residuals: `process.env.valueOf().X = h`.
      if (path !== null) aliases.delete(GLOBAL_CELL);
      for (const a of args) for (const x of refsOf(a)) aliases.add(x);
      if (aliases.size > 0) out.refs = aliases;
      for (const a of args) mergeMap(out.scalar, everything(a, this.site(node, fn)));
      if (out.scalar.size > 0) mergeMap(out.deep, out.scalar);
      out.k = opK(recv, ...args);
      return recvGlobal ? join(r, out, this.globalFnRetFor(gParts)) : join(r, out);
    }

    // --- plain calls -------------------------------------------------------------
    const ct = this.evalExpr(callee, scope, fn);
    const path = this.globalPath(callee, scope);
    // A GLOBAL callee may be a function something stored in the global heap
    // (L3) — applied — but it is also the platform built-in of that name, which
    // keeps its own (fail-closed) model below.
    const gfPlain = path !== null ? this.globalFnsFor(path.split(".")) : null;
    const viaGlobal = gfPlain !== null && gfPlain.size > 0 && this.carriesProtected(args)
      ? this.applyFns(gfPlain, args, undefined, node, fn)
      : null;
    if (path === null && this.hasCallable(ct)) return this.applyFns(ct.fns, args, undefined, node, fn);
    if (viaGlobal) return join(viaGlobal, this.evalGlobalCall(path!, node, args, fn));
    return this.evalGlobalCall(path, node, args, fn);
  }

  /** A plain call whose callee is not a function value the analysis holds. */
  private evalGlobalCall(path: string | null, node: any, args: Taint[], fn: Instance | null): Taint {
    if (path === "Promise" && node.type === "NewExpression" && args[0] && this.hasCallable(args[0])) {
      // `new Promise((resolve, reject) => resolve(u.passwordHash))` — the promise
      // settles to whatever the executor passes to `resolve`.
      const key = `${this.curMod!.idx}:${node.start}`;
      const ckey = `resolver:${key}`;
      let resolver = this.closures.get(ckey);
      if (!resolver) { resolver = { cid: this.cidSeq++, resolver: key }; this.closures.set(ckey, resolver); }
      this.applyFns(args[0].fns, [{ ...clean(), fns: new Set([resolver]) }, { ...clean(), fns: new Set([this.rejecter]) }], undefined, node, fn);
      return this.resolved.get(key) ?? clean();
    }
    if (path === "Response" && node.type === "NewExpression") {
      // A response the server sends: the BODY and the INIT (status + headers —
      // a `Location` / `Set-Cookie` built from the hash is egress too, F3). An
      // AUTHOR-built one with a body is also E-PROTECT-005 and refused at
      // runtime; a null-body one is not, so its headers must be checked here.
      for (const a of args) this.sink(a, fn, "serializer");
      return clean();
    }
    if (path !== null) {
      const b = this.builtin(path, args, node, fn);
      if (b) return join(b, this.opaqueCallbacks(null, args, node, fn));
      // L4 — an unmodelled global (reflection) handed a row may remove a marker.
      if (!DERIVER_CALLS.has(path)) this.reflectionMayRemoveMarkers(args, node, fn, fn?.scope ?? this.curMod!.scope);
    }
    return this.unknownCall(path, args, node, fn);
  }

  /**
   * S443 round 6 (L1) — a function value handed to code the analysis has no
   * model for (a host / stdlib / npm call, a platform built-in, an unmodelled
   * method) may be CALLED by it, with anything that code can reach. It used to
   * be walked only by its default instance, every parameter clean — so
   * `h.replace(/.+/, m => { s = m })`, a `JSON.stringify(u, replacer)` replacer
   * and `"x".replace("x", () => h)` shipped the hash (measured). Every such
   * function (directly an argument, or held inside one) is applied with EVERY
   * parameter — and its `arguments` — bound to the join of the receiver and
   * all arguments, row columns included as values (a replacer is handed each
   * column's value), and what it returns joins the call's result. This is the
   * fail-closed model; it deliberately does not try to know which built-ins
   * call back and with what.
   */
  private opaqueCallbacks(recv: Taint | null, args: Taint[], node: any, fn: Instance | null): Taint {
    const fns = new Set<Closure>();
    for (const a of args) for (const f of a.fns) fns.add(f);
    if (fns.size === 0) return clean();
    const all = join(...(recv ? [recv] : []), ...args);
    const every = everything(all, `${this.site(node, fn)} — handed to a callback of code the compiler has no model for`);
    const param: Taint = {
      row: all.row ? copyRow(all.row) : null,
      scalar: new Map(every),
      deep: new Map(every),
      fns: new Set(all.fns),
      refs: new Set(refsOf(all)),
    };
    return this.applyFns(fns, [], param, node, fn);
  }

  /**
   * S443 round 6e — `this`. A function stored ON an object (`o.f = function …`,
   * a method / getter / setter in an object literal, a `defineProperty` getter or
   * value, `Object.assign(o, { f() … })`) runs with `this` = that object, so a
   * `this.passwordHash` inside it IS the column. `this` used to read as clean:
   * `u.toJSON = function () { return { pw: this.passwordHash } }` and a
   * `defineProperty(u, "pw3", { get: function () { return this.passwordHash } })`
   * served the hash through the response, `/__mountHydrate` and the SSR state
   * script (review, measured; no `_{}` needed). Keyed by the function NODE: every
   * object a function was ever stored on joins into its `this` (fail closed).
   */
  private thisOf = new Map<any, Taint>();
  private recordThis(fns: Set<Closure>, obj: Taint): void {
    const data = dataOnly(obj);
    // Data only — no alias cells: a READ through `this` sees what the object
    // carries; a WRITE through `this` is not modelled (it lands nowhere, as it did
    // before round 6e). Aliasing `this` to its object made the compiler's own
    // session object (whose methods run on every opaque-call over-approximation)
    // collect every protected value in the compile — a false E-PROTECT-006 on
    // examples/23's login. Disclosed in g-protect-egress-round-7-residuals.
    for (const c of fns) {
      if (!c.node) continue;
      const prev = this.thisOf.get(c.node) ?? clean();
      const next = join(prev, data);
      if (taintKey(next) !== taintKey(prev)) { this.thisOf.set(c.node, next); this.changed = true; }
    }
  }
  /** `this` inside the walked function (an arrow's is its enclosing function's). */
  private thisTaint(fn: Instance | null): Taint {
    let node = fn?.stat.node ?? null;
    while (node && node.type === "ArrowFunctionExpression") node = this.fnParent.get(node) ?? null;
    const t = node ? this.thisOf.get(node) : undefined;
    return t ? { ...t, refs: t.refs ? new Set(t.refs) : undefined } : clean();
  }

  /** `const` names bound to a string / number literal, per declaring scope's name set. */
  private constLiterals = new WeakMap<Set<string>, Map<string, string>>();

  /**
   * The literal string a property key denotes, or null: a string / number
   * literal, or an identifier bound by `const` to one (S443 round 6c — `const
   * gone = 1; delete byId[gone]` is a literal key, not a possible marker).
   */
  private literalKey(node: any, scope: Scope): string | null {
    const k = staticKey(node);
    if (k !== null) return k;
    if (node?.type === "Identifier") {
      const s = this.resolve(node.name, scope);
      const v = s ? this.constLiterals.get(s.names)?.get(node.name) : undefined;
      if (v !== undefined && v !== "\u0000ambiguous") return v;
    }
    return null;
  }

  /** `import.meta.env.X` (or `import.meta.env[…]`). */
  private isImportMetaEnv(node: any): boolean {
    const o = node?.object;
    return o?.type === "MemberExpression" && !o.computed && o.property?.name === "env" && o.object?.type === "MetaProperty";
  }

  /** A callee identifier that a local binding shadows is not the runtime helper. */
  private resolveLocalShadow(name: string, scope: Scope): boolean {
    const s = this.resolve(name, scope);
    return !!s && s.parent !== null;
  }

  private builtin(path: string, args: Taint[], node: any, fn: Instance | null): Taint | null {
    // (No special case for `Symbol.for` / `Object.getOwnPropertySymbols` /
    // `Reflect.ownKeys`: they are unmodelled calls and fail closed on their
    // arguments like any other. Round 6 returned a fresh marker value for them
    // WITHOUT the arguments' provenance, and `Symbol.for(u.passwordHash)
    // .description` served the hash — review, measured.)
    if (SERIALIZING_BUILTINS.has(path)) {
      // The descriptor is a Symbol key: these drop it and keep the column.
      const r = tainted(args, `\`${path}(…)\` of a protected value in \`${this.displayName(fn?.stat.node ?? null)}\``);
      // `Object.values(o)` / `entries` / `fromEntries` / `Reflect.get` hand back
      // the SAME member objects — a write into one lands in `o` (round 5, F4).
      if (ELEMENT_ALIASING_BUILTINS.has(path)) {
        const aliases = new Set<string>();
        for (const a of args) for (const x of refsOf(a)) aliases.add(x);
        if (aliases.size > 0) r.refs = aliases;
      }
      return r;
    }
    if (path === "Object.setPrototypeOf" || path === "Reflect.setPrototypeOf") {
      // `o` now INHERITS everything `p` holds, and every later write into `p`
      // is readable through `o` (`o.h` after `p.h = h`) — one alias class, and
      // `p`'s current contents are written into it (round 5, F4).
      const o = args[0] ?? clean();
      const p = args[1] ?? clean();
      for (const a of refsOf(o)) for (const b of refsOf(p)) this.unite(a, b);
      if (node?.arguments?.[0]) this.writeThrough(node.arguments[0], o, containerOf(p), fn?.scope ?? this.curMod!.scope);
      return path === "Reflect.setPrototypeOf" ? clean() : o;
    }
    if (path === "Object.create") {
      // A fresh object whose prototype IS `p`: it reads through to `p`'s class.
      return lenDefault(join(...args.map(containerOf)));
    }
    if (path === "Object.getPrototypeOf" || path === "Reflect.getPrototypeOf") {
      return lenDefault(elemOf(args[0] ?? clean()));
    }
    if (path === "String") {
      // `String(x)` embeds a scalar verbatim; a row stringifies as
      // "[object Object]" and carries nothing.
      const r = clean();
      r.len = new Map();
      for (const a of args) { mergeMap(r.scalar, naked(a)); mergeMap(r.len, lenOf(a)); }
      r.k = opK(...args);
      return r;
    }
    if (path === "Object.assign" && node?.arguments?.[0]) {
      // Writes every source into the TARGET object (round 4, F2) — methods
      // included, which then run with `this` = the target (round 6e).
      this.recordThis(join(...args.slice(1)).fns, args[0] ?? clean());
      this.writeThrough(node.arguments[0], args[0] ?? clean(), containerOf(join(...args.slice(1))), fn?.scope ?? this.curMod!.scope);
    }
    if (path === "Object.keys") {
      // A row's keys are its column NAMES, not its values. Only a container that
      // carries protected data OUTSIDE a row (possibly as a key) keeps it.
      const r = clean();
      for (const a of args) mergeMap(r.scalar, a.deep);
      r.deep = new Map(r.scalar);
      return r;
    }
    if (IDENTITY_BUILTINS.has(path)) {
      // The result's `.length` is NOT the argument's (F1): `new Array(u.pin)`
      // has length `pin`, `Array.from({ length: h })` has length `h`.
      if (path === "Array.of") return lenDefault(join(...args.map(containerOf)));
      return lenDefault(join(...args));
    }
    return null;
  }

  private callbackMethod(method: string, recv: Taint, args: Taint[], node: any, fn: Instance | null): Taint {
    const cb = args[0] ?? clean();
    const el = elemOf(recv);
    let cbRet = clean();
    if (this.hasCallable(cb)) {
      let params: Taint[];
      if (method === "reduce" || method === "reduceRight") params = [join(args[1] ?? clean()), el, clean(), recv];
      else if (method === "then") params = [recv];
      else if (method === "catch") params = [this.thrown];
      else if (method === "finally") params = [clean()];
      else params = [el, clean(), recv];
      cbRet = this.applyFns(cb.fns, params, undefined, node, fn);
      if (method === "reduce" || method === "reduceRight") {
        // The accumulator also receives every callback return.
        cbRet = join(cbRet, this.applyFns(cb.fns, [join(args[1] ?? clean(), cbRet), el, clean(), recv], undefined, node, fn));
      }
    } else if (method === "map" || method === "flatMap") {
      // An opaque callback (`rows.map(format)`): the element may come back as-is.
      cbRet = el;
    }
    switch (method) {
      case "map":
        // Same element count as the receiver (F1).
        return withLen(containerOf(cbRet), lenOf(recv));
      case "flatMap":
        return containerOf(cbRet);
      case "filter":
      case "sort":
      case "toSorted":
        return recv;
      case "find":
      case "findLast":
        return el;
      case "reduce":
      case "reduceRight":
        return join(args[1] ?? clean(), cbRet);
      case "then":
        return this.hasCallable(cb) ? cbRet : recv;
      case "catch":
        return join(recv, cbRet);
      case "finally":
        return recv;
      default:
        return clean();
    }
  }

  /** The static SQL skeleton wrapped by a `_scrml_protect_tag` first argument. */
  private tagSkeleton(arg: any): string | null {
    let found: string | null = null;
    const stack = [arg];
    while (stack.length > 0 && found === null) {
      const n = stack.pop();
      if (!n || typeof n !== "object") continue;
      if (Array.isArray(n)) { for (const c of n) stack.push(c); continue; }
      if (n.type === "TaggedTemplateExpression") {
        found = sqlSkeleton(n.quasi.quasis.map((q: any) => q.value.cooked ?? q.value.raw).join("${}"));
        break;
      }
      if (n.type === "CallExpression" && n.callee?.type === "MemberExpression" && n.callee.property?.name === "unsafe"
          && n.arguments[0]?.type === "Literal" && typeof n.arguments[0].value === "string") {
        found = sqlSkeleton(n.arguments[0].value);
        break;
      }
      for (const k in n) {
        if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
        const v = n[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return found;
  }
}
