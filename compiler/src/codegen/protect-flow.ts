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
import { SESSION_STORE_SQLITE_TEXT, SESSION_STORE_MEMORY_TEXT } from "./session-store-emit.ts";

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

/**
 * S447 round 7 — the property keys under which the LANGUAGE itself may call a
 * stored function without the program naming the call (ECMAScript's own
 * protocol, not a list of author shapes): a thenable's `then` (`await`, promise
 * resolution, a server function's return), the coercion hooks `toString` /
 * `valueOf` (templates, `+`, `String()`, property keys), `toJSON` (the
 * serializer), `toLocaleString`, an iterator's `next` / `return` / `throw`, and
 * `__proto__` (a literal that sets the prototype hands the new object every
 * function of it). A STRING key cannot be aliased — the language looks up
 * exactly these names. Every Symbol-keyed hook (`[Symbol.iterator]`,
 * `[Symbol.toPrimitive]`, `[Symbol.asyncIterator]`, `[Symbol.hasInstance]`, …)
 * is stored under a COMPUTED key, and any key the compiler cannot read counts
 * as possibly one of these — fail closed (`null` below). Accessors (`get` /
 * `set`) are invoked whatever their key.
 */
const LANGUAGE_INVOKED_KEYS = new Set(["then", "toString", "valueOf", "toJSON", "toLocaleString", "next", "return", "throw", "__proto__"]);
function mayBeInvokedByLanguage(key: string | null): boolean {
  return key === null || LANGUAGE_INVOKED_KEYS.has(key);
}

/** The compile-wide binding cell every free (global) name reads and writes (L3). */
const GLOBAL_CELL = "\u0000global";
/** The compiler-owned session store — one object of the global heap shared by every module (r9 fix round). */
const SESSION_STORE_CELL = "\u0000session-store";

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
  /**
   * S447 round 8 — WHERE in the value the row sits: the set of property paths
   * from the value to a descriptor-bearing row (see `ROW_SELF` / `ANY_KEY` /
   * `ROW_ANYWHERE`). `""` = the value IS the row (or an array of rows — what a
   * query returns); `"h"` = the row is the value's `h` field; `"a\u0001b"` =
   * `value.a.b`. Round 7 had no such part: "is, OR contains, a row" was one bit,
   * and a named read applied column semantics to both — so `const t = { h: u };
   * return t.h.passwordHash` read "column `h` of the row" (not a protected
   * column), then "column `passwordHash` of nothing", and served the hash
   * (measured over HTTP on base and round 7, with `JSON.stringify(t.h)`,
   * `Object.values(t.h)`, `t.rs.map(…)`, `t.a.b.pin` and `this.h.passwordHash`).
   * Now a named read off a value yields the row wherever a path continues
   * through that key, and reads a COLUMN only where the value may itself be the
   * row. A path is precise only where the analysis built the container itself
   * (an object / array literal, a spread copy); every construction it does not
   * model exactly — a write into an alias class, the global heap, a host call's
   * result, a hook's return — yields `ROW_ANYWHERE` (fail closed: the row may
   * be the value or anything under it, at any depth).
   */
  paths: Set<string>;
}

/** The value IS the row (or an array of rows). */
const ROW_SELF = "";
/** Path separator between property names. */
const PATH_SEP = "\u0001";
/** A path segment matching ANY property name (an array element, a key the compiler cannot read). */
const ANY_KEY = "\u0002";
/** The row may be the value itself or anything reachable from it, at any depth (fail closed). */
const ROW_ANYWHERE = "\u0003";
/** Paths longer than this collapse to `ROW_ANYWHERE` (keeps the lattice finite). */
const MAX_ROW_PATH = 4;

/** `ROW_ANYWHERE` subsumes every other path. */
function normPaths(paths: Set<string>): Set<string> {
  return paths.has(ROW_ANYWHERE) && paths.size > 1 ? new Set([ROW_ANYWHERE]) : paths;
}

/** `paths` one level down: the container now holds them under `seg` (null = same depth — a copy). */
function prefixPaths(paths: Set<string>, seg: string | null): Set<string> {
  if (seg === null) return new Set(paths);
  const out = new Set<string>();
  for (const p of paths) {
    if (p === ROW_ANYWHERE) { out.add(ROW_ANYWHERE); continue; }
    const np = p === ROW_SELF ? seg : seg + PATH_SEP + p;
    out.add(np.split(PATH_SEP).length > MAX_ROW_PATH ? ROW_ANYWHERE : np);
  }
  return normPaths(out);
}

/**
 * Reading property `key` (null = a key the compiler cannot read) off a value
 * whose row sits at `paths`: `column` = the value may itself be the row, so the
 * read may be a COLUMN of it; `next` = where the row sits in what the read
 * yields. A numeric / dynamic read of the row itself is an ELEMENT of a row
 * array (still a row).
 */
function readPaths(paths: Set<string>, key: string | null, numeric: boolean): { column: boolean; next: Set<string> } {
  let column = false;
  const next = new Set<string>();
  for (const p of paths) {
    if (p === ROW_ANYWHERE) { column = true; next.add(ROW_ANYWHERE); continue; }
    if (p === ROW_SELF) {
      column = true;
      if (key === null || numeric) next.add(ROW_SELF);
      continue;
    }
    const i = p.indexOf(PATH_SEP);
    const seg = i < 0 ? p : p.slice(0, i);
    if (key === null || seg === ANY_KEY || seg === key) next.add(i < 0 ? ROW_SELF : p.slice(i + 1));
  }
  return { column, next: normPaths(next) };
}

/** The row, placed somewhere the analysis cannot follow: at any depth (fail closed). */
function rowAnywhere(r: RowPart | null): RowPart | null {
  return r ? { ...copyRow(r), paths: new Set([ROW_ANYWHERE]) } : null;
}

/** A copy of `t` whose row (if any) may sit anywhere in it (see `ROW_ANYWHERE`). */
function anyDepth(t: Taint): Taint {
  return t.row ? { ...t, row: rowAnywhere(t.row) } : t;
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
  /**
   * S447 round 7 — the function values the value may BE (as opposed to merely
   * CONTAIN: `fns` includes every function reachable from it). UNDEFINED means
   * "any of `fns`" (the fail-closed default — a field read may be any of its
   * object's functions); a container built by the program (`containerOf`) is
   * not a function, so its `own` is empty. Used to decide which functions a
   * STORE puts under a key (`o[k] = store` stores an object, not its methods).
   */
  own?: Set<Closure>;
  /**
   * S447 round 8 — the GLOBAL NAMES the value was read through: every property
   * name on the path(s) by which it was reached from the global heap
   * (`globalThis.box` → {globalThis, box}; `const g = globalThis.box; g` → the
   * same; `const { C } = globalThis` → {globalThis, C}; `const P = process;
   * P.C` → {process, C}). The global heap is ONE abstract object, so every
   * function ever stored in it is a field of every value read from it; a call
   * through such a value applies only the functions stored under a name on its
   * path (`globalFnsByName`). Round 7 knew the path only when the call SPELLED
   * it (`globalThis.box.set(u)`), so an alias dropped the hook: `const g =
   * globalThis.box; g.set(u)` modelled `set` as a Map write and served the hash,
   * and `u instanceof C` with `C` aliased called no `hasInstance` (measured on
   * base and round 7). Names travel with the value — through bindings,
   * parameters, containers and returns — so an alias resolves to the same
   * abstract object as its named path.
   */
  gn?: Set<string>;
  /**
   * The value may have been read from the global heap through a path the
   * compiler cannot name (a computed key, an unmodelled method's result): a
   * call through it may reach ANY global-stored function (fail closed).
   */
  gnAny?: true;
  /**
   * S449 round 9 — the value may BE a built-in prototype or constructor: it was
   * read through an intrinsic link (`.prototype`, `.__proto__`, `.constructor`,
   * `Object.getPrototypeOf`) — or holds / is a part of such a value (carried
   * through containers, fail closed). A write INTO it is refused (see
   * `PLATFORM_GLOBALS`): every object may inherit what it holds.
   */
  plat?: true;
  /** The value may CONTAIN such a value (a field or element of it may be one). */
  platIn?: true;
  /**
   * r9 fix round (R3) — EVERY object the value may be has a prototype the PROGRAM
   * set: `new F(…)` of a compile function, `Object.create(p)` / a literal's
   * `__proto__: p` with `p` program-made. Its `.__proto__`, `.constructor` and
   * `Object.getPrototypeOf` are then the program's, not a built-in's. Unlike every
   * other mark this one is an AND over a join (see `join`): any part that may be
   * an ordinary object (prototype `Object.prototype`) clears it — fail closed.
   */
  pproto?: true;
}

/** Does `t` carry any information (a part that may be some value), so it counts in an AND-join? */
function informative(t: Taint): boolean {
  return !!(t.pproto || t.row || t.fns.size > 0 || (t.refs && t.refs.size > 0) || t.scalar.size > 0 || t.deep.size > 0 || t.k);
}

/** Copy `from`'s global names (and the intrinsic-link marks) onto `to` — the same value (in place). */
function carryGlobalNames(from: Taint, to: Taint): void {
  if (from.gnAny) to.gnAny = true;
  if (from.gn && from.gn.size > 0) to.gn = new Set(from.gn);
  if (from.plat) to.plat = true;
  if (from.platIn) to.platIn = true;
}

/** The functions the value may itself be (see `Taint.own`). */
function ownOf(t: Taint): Set<Closure> {
  return t.own ?? t.fns;
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
  carryGlobalNames(t, r);
  if (t.pproto) r.pproto = true;
  return r;
}

function refsOf(t: Taint): Set<string> {
  return t.refs ?? new Set();
}

function copyRow(r: RowPart): RowPart {
  return { tags: new Set(r.tags), cols: new Set(r.cols), all: r.all, revealed: new Set(r.revealed), paths: new Set(r.paths) };
}

function joinRow(a: RowPart | null, b: RowPart | null): RowPart | null {
  if (!a) return b ? copyRow(b) : null;
  if (!b) return copyRow(a);
  const revealed = new Set<string>();
  for (const c of a.revealed) if (b.revealed.has(c)) revealed.add(c);
  const paths = normPaths(new Set([...a.paths, ...b.paths]));
  return { tags: new Set([...a.tags, ...b.tags]), cols: new Set([...a.cols, ...b.cols]), all: a.all || b.all, revealed, paths };
}

function mergeMap(into: Map<string, string>, from: Map<string, string>): void {
  for (const [k, v] of from) if (!into.has(k)) into.set(k, v);
}

function join(...ts: Taint[]): Taint {
  const out = clean();
  let named = false;
  let anonymous = false;
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
    if (t.plat) out.plat = true;
    if (t.platIn) out.platIn = true;
    if (t.gnAny) out.gnAny = true;
    if (t.gn && t.gn.size > 0) {
      named = true;
      if (!out.gn) out.gn = new Set();
      for (const n of t.gn) out.gn.add(n);
    } else if (!t.gnAny && t.refs && t.refs.size > 0) {
      anonymous = true;
    }
  }
  // r9 fix round: `pproto` holds only if every informative part has it.
  {
    let any = false, all = true;
    for (const t of ts) if (t && informative(t)) { if (t.pproto) any = true; else all = false; }
    if (any && all) out.pproto = true;
  }
  // Round 8: names are a precision filter for values read from the global heap
  // (`Taint.gn`). A part with alias cells and NO names may be a global object
  // reached without a nameable path (a local object stored into a global, say):
  // joined with a named part, the names no longer cover it — fail closed.
  if (named && anonymous) out.gnAny = true;
  if (out.fns.size > 0 && ts.some((t) => t && t.own !== undefined)) {
    const own = new Set<Closure>();
    for (const t of ts) if (t) for (const f of ownOf(t)) own.add(f);
    out.own = own;
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

/**
 * The value, placed inside a fresh container — under property `seg` (an object
 * literal's key; `ANY_KEY` by default: an array slot, an unknown key), or at the
 * SAME depth (`null`: a spread copy, which copies the value's own properties).
 */
function containerOf(t: Taint, seg: string | null = ANY_KEY): Taint {
  // The container HOLDS the value — if it is an object, the container reaches it.
  const row = t.row ? { ...copyRow(t.row), paths: prefixPaths(t.row.paths, seg) } : null;
  const c: Taint = { row, scalar: new Map(), deep: naked(t), fns: new Set(t.fns), refs: new Set(refsOf(t)), ...(t.k ? { k: t.k } : {}) };
  if (t.fns.size > 0) c.own = new Set(); // a container is not itself any of the functions it holds
  carryGlobalNames(t, c);
  // A container is not a prototype — it HOLDS what may be one (round 9).
  if (c.plat) { delete c.plat; c.platIn = true; }
  return c;
}

/** An element / field of the value, when WHICH one is not statically known. */
function elemOf(t: Taint): Taint {
  const row = t.row ? { ...copyRow(t.row), paths: readPaths(t.row.paths, null, false).next } : null;
  const e: Taint = { row: row && row.paths.size > 0 ? row : null, scalar: naked(t), deep: new Map(t.deep), fns: new Set(t.fns), refs: new Set(refsOf(t)), ...(t.k ? { k: t.k } : {}) };
  // An element is reached by no NAME: its global names are unknown (round 8).
  if (t.gnAny || (t.gn && t.gn.size > 0)) e.gnAny = true;
  if (t.plat || t.platIn) e.plat = true;
  return e;
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
    ? `${[...t.row.tags].sort().join(",")}|${[...t.row.cols].sort().join(",")}|${t.row.all}|${[...t.row.revealed].sort().join(",")}|${[...t.row.paths].sort().join(",")}`
    : "-";
  const f = [...t.fns].map((c) => c.cid).sort((a, b) => a - b).join(",");
  const a = [...refsOf(t)].sort().join(",");
  const l = t.len ? [...t.len.keys()].sort().join(",") : "~";
  const o = t.own ? [...t.own].map((c) => c.cid).sort((x, y) => x - y).join(",") : "~";
  const g = t.gnAny ? "?" : t.gn ? [...t.gn].sort().join(",") : "";
  return `${r}#${[...t.scalar.keys()].sort().join(",")}#${[...t.deep.keys()].sort().join(",")}#${f}#${a}#${l}#${t.k ?? 0}#${o}#${g}${t.plat ? "#P" : ""}${t.platIn ? "#Q" : ""}${t.pproto ? "#O" : ""}`;
}

function subsetOf<T>(a: Iterable<T>, b: Set<T>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
function keysSubsetOf(a: Map<string, string>, b: Map<string, string>): boolean {
  for (const k of a.keys()) if (!b.has(k)) return false;
  return true;
}

/**
 * Round 8 (perf) — does joining `t` into `prev` leave `taintKey(prev)`
 * unchanged? Exactly the test `taintKey(join(prev, t)) === taintKey(prev)`,
 * decided by set membership instead of by building and sorting both keys (the
 * dominant cost on long object chains). `refs` are compared as the key does.
 */
function subsumes(prev: Taint, t: Taint): boolean {
  if (t.row) {
    const a = prev.row;
    if (!a) return false;
    if (t.row.all && !a.all) return false;
    if (!subsetOf(t.row.tags, a.tags) || !subsetOf(t.row.cols, a.cols)) return false;
    // revealed of a join is the INTERSECTION: unchanged iff prev's ⊆ t's.
    if (!subsetOf(a.revealed, t.row.revealed)) return false;
    if (!a.paths.has(ROW_ANYWHERE) && !subsetOf(t.row.paths, a.paths)) return false;
  }
  if (!keysSubsetOf(t.scalar, prev.scalar) || !keysSubsetOf(t.deep, prev.deep)) return false;
  if (!subsetOf(t.fns, prev.fns)) return false;
  if (t.refs && t.refs.size > 0 && (!prev.refs || !subsetOf(t.refs, prev.refs))) return false;
  if (t.k && ((prev.k ?? 0) | t.k) !== (prev.k ?? 0)) return false;
  if (t.gnAny && !prev.gnAny) return false;
  if (t.plat && !prev.plat) return false;
  if (t.platIn && !prev.platIn) return false;
  if (prev.pproto && !t.pproto && informative(t)) return false; // the AND-join would clear it
  if (t.pproto && !prev.pproto && !informative(prev)) return false;
  if (t.gn && t.gn.size > 0 && (!prev.gn || !subsetOf(t.gn, prev.gn))) return false;
  // `.length`: undefined is the fail-closed default (`naked`).
  if (t.len !== undefined || prev.len !== undefined) {
    if (prev.len === undefined) return false; // the joined key would list labels where prev's is "~"
    if (!keysSubsetOf(lenOf(t), prev.len)) return false;
  }
  // `own`: defined on the join iff fns are present and any part defines it.
  if (prev.fns.size > 0 && (t.own !== undefined || prev.own !== undefined)) {
    if (prev.own === undefined) return false;
    if (!subsetOf(ownOf(t), prev.own)) return false;
  }
  return true;
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
  if (args.some((a) => a?.plat || a?.platIn)) r.plat = true; // it may hand an argument (or a part) back (round 9)
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
/**
 * The stdlib module a specifier names — ONLY the compiler's own `scrml:NAME`
 * specifier. The flow runs on the emitted server modules BEFORE the write phase
 * rewrites `scrml:NAME` to the bundled `./_scrml/NAME.js` (api.js
 * `rewriteStdlibImports`), so the compiler's stdlib always arrives here as
 * `scrml:NAME`. S447 round 7: this also matched any `…/_scrml/NAME.js` path, so
 * an author file at `./_scrml/auth.js` whose `verifyPassword` returned its
 * argument was treated as the allowlisted deriver and served the hash (measured;
 * the same held for a spoofed `crypto.js` `hmac` key source or `data.js` `pick`).
 */
function stdlibModuleOf(source: string): string | null {
  const m = /^scrml:([a-z]+)$/.exec(source);
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
 * S447 round 8 — the platform COERCIONS. `String(x)`, `Number(x)`,
 * `Boolean(x)`, `BigInt(x)` and `Symbol(x)` run no author code except the
 * coercion hooks of their argument (`toString` / `valueOf` /
 * `[Symbol.toPrimitive]`; `Boolean` none at all) — never a function value they
 * are handed. Those hooks are analysed where they are stored (`storeFns`: called
 * with `this` = the object, their returns part of it), exactly as for a template
 * or `+`, so these calls are not handed to the opaque-callback rule (L1), which
 * applied EVERY function reachable from the argument: on a chain of objects each
 * holding the previous one, `String(this.f)` in each `toString` applied all N
 * hooks from every hook — the round-7 performance cliff (240 objects: 13.7 s vs
 * 0.47 s on base, review-measured).
 */
const LANGUAGE_COERCIONS = new Set(["String", "Number", "Boolean", "BigInt", "Symbol"]);

/**
 * S449 round 9 — THE PLATFORM IS NOT THE PROGRAM'S TO REPLACE. The global names
 * the platform defines (ECMA-262's global object, plus the host APIs a server
 * module and the compiler's own runtime use), and the objects reached from them.
 * Code the compiler does not walk calls into these at request time with values
 * the analysis cannot follow: the LANGUAGE (a coercion calls the inherited
 * `toString` / `valueOf`; `String([…])` calls `Array.prototype.join`;
 * `JSON.stringify` an inherited `toJSON`; spread an inherited iterator) and the
 * COMPILER'S OWN RUNTIME (the §14.8.9 redactor reads rows through `Object.keys`,
 * `Object.getOwnPropertySymbols`, `Array.isArray`, `Set`, … — with every
 * protected column still on them). Round 8 modelled none of it: `Object.prototype
 * .toString = function () { s = this.h }; String({ h: u.passwordHash })`,
 * `Array.prototype.join = …; String([h])`, `globalThis.String = function (f) {
 * Reflect.apply(f, null, [h]) }` each served the hash (measured on base). A
 * program that writes into a built-in prototype, stores a function into a
 * platform object, or rebinds one of these global names, is therefore not
 * analysed: it is `E-PROTECT-006` (fail closed — modelling "every object
 * inherits it" and "the runtime calls it with anything" is no cheaper than
 * refusing, and no real program needs it).
 */
const GLOBAL_OBJECT_NAMES = new Set(["globalThis", "self", "global", "window"]);
const PLATFORM_GLOBALS = new Set([
  // ECMA-262 §19 — the global object's value / function / constructor / namespace properties
  "eval", "isFinite", "isNaN", "parseFloat", "parseInt", "decodeURI", "decodeURIComponent", "encodeURI",
  "encodeURIComponent", "escape", "unescape",
  "Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Reflect",
  "Proxy", "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "RegExp", "Date",
  "Error", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError",
  "SuppressedError", "Iterator", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "Int8Array",
  "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float16Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Intl", "DisposableStack",
  "AsyncDisposableStack",
  // host APIs on the serialization / request path
  "console", "crypto", "fetch", "Response", "Request", "Headers", "URL", "URLSearchParams", "TextEncoder",
  "TextDecoder", "Blob", "File", "FormData", "structuredClone", "queueMicrotask", "setTimeout", "setInterval",
  "clearTimeout", "clearInterval", "setImmediate", "atob", "btoa", "Buffer", "performance", "ReadableStream",
  "WritableStream", "TransformStream", "EventTarget", "Event", "AbortController", "AbortSignal", "WebSocket",
  "navigator",
]);
/** The global names of the platform's code evaluators (round 9 — see `FlowAnalysis.evaluator`). */
const CODE_EVALUATORS = new Set(["Function", "eval"]);
/** Property keys that lead from a value to a PROTOTYPE or CONSTRUCTOR (an intrinsic link). */
const INTRINSIC_LINK_KEYS = new Set(["prototype", "__proto__", "constructor"]);

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
const ELEMENT_METHODS = new Set(["at", "pop", "shift", "get", "charAt", "deref"]);
/**
 * S449 round 9 — ECMAScript built-in methods whose result HOLDS the receiver's
 * ELEMENTS (and, for the combining ones, their arguments' elements): the
 * iterators (`values`, `keys`, `entries`, an iterator's `next` → `{ value }`,
 * the iterator helpers `toArray` / `drop` / `take`), the copies (`slice`,
 * `concat`, `flat`, `toReversed`, `toSorted`, `toSpliced`, `with`) and the `Set`
 * algebra (`union`, `intersection`, `difference`, `symmetricDifference`). Round 7
 * modelled every method it had no entry for as returning the receiver's DATA
 * only — its function values dropped — so a function kept in a collection walked
 * out through any of these and was called unseen: `globalThis.arr.slice()[0](u)`,
 * `[...globalThis.m.values()][0](u)`, `m.values().next().value(u)` (global AND
 * local receivers — measured on base, served the hash). A method reached by a
 * COMPUTED key (`x[Symbol.iterator]()`) may be any of these (fail closed).
 */
const ELEMENT_RESULT_METHODS = new Set([
  "values", "keys", "entries", "next", "toArray", "drop", "take",
  "slice", "concat", "flat", "toReversed", "toSorted", "toSpliced", "with",
  "union", "intersection", "difference", "symmetricDifference",
]);
/**
 * S449 round 9 — the Array methods that build their result through the
 * receiver's SPECIES constructor (`receiver.constructor[Symbol.species]`) and
 * write the result's elements INTO whatever it returns. `a.constructor = {
 * [Symbol.species]: function () { return cap } }; a.map((x) => x); return cap`
 * served `{"0":"SECRET-HASH-123"}` on base. See `speciesResult`.
 */
const SPECIES_METHODS = new Set(["map", "filter", "flatMap", "slice", "splice", "concat", "flat"]);
/** Built-in methods that RETURN THE RECEIVER itself (`Object.prototype.valueOf`, the in-place array reorders). */
const RECEIVER_RESULT_METHODS = new Set(["valueOf", "reverse", "copyWithin"]);
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

/**
 * §19.10.6 (S449) — the transaction-mutex runtime (codegen/sql-tx-guard.ts). Never
 * walked: `_scrml_db_guard` / `_scrml_db_request_scope` are modelled at their call
 * sites as the identity on data (see `evalCall`); the other two are only called
 * from inside them. Walking the Proxy + closure + queue bodies took a 25-module
 * protect build (examples/23) from ~1.4 s to more than 400 s (measured).
 */
const TX_GUARD_RUNTIME_NAMES = new Set([
  "_scrml_db_guard", "_scrml_db_request_scope", "_scrml_db_scope_end", "_scrml_db_stream_end",
  "_scrml_db_tx_kind", "_scrml_db_sql_head", "_scrml_db_savepoint_name",
]);

/** Compiler-runtime helpers the analysis models itself (never walked). */
function isModelledHelperName(name: string): boolean {
  return name.startsWith("_scrml_protect_") || name.startsWith("_scrml_tenant_") || name === "_scrml_active_tenant"
    || name === "_scrml_structural_eq" || TX_GUARD_RUNTIME_NAMES.has(name);
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
  /** A function `bind` made with leading arguments (round 9 — see `bindFns`). */
  bound?: true;
  /** The platform's code evaluators — `Function` / `eval` (round 9 — see `evaluator`). */
  evaluator?: true;
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
  /**
   * S449 round 9 — writes that replace part of the PLATFORM (a built-in
   * prototype, a function stored onto a built-in, a rebound built-in name): the
   * language and the compiler's own runtime call those with values the analysis
   * cannot follow, so each is `E-PROTECT-006` (see `PLATFORM_GLOBALS`).
   */
  poisoned: ProtectFlowPoison[];
}

export interface ProtectFlowPoison {
  filePath: string;
  /** The write, e.g. "`Object.prototype.toString = …` in `getIt`". */
  site: string;
  siteFn: string | null;
  /** What it replaces, in words. */
  what: string;
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
  // S449 round 9 — a write that replaces part of the platform (see PLATFORM_GLOBALS).
  for (const p of flow.poisoned) {
    const spanOf = byPath.get(p.filePath)?.spanOf;
    const span = spanOf && p.siteFn ? spanOf(p.siteFn) : null;
    push(p.filePath, new CGError(
      "E-PROTECT-006",
      `E-PROTECT-006: ${p.site} ${p.what}. In a compile that declares \`protect=\` columns the §14.8.9 provenance ` +
      `analysis cannot follow such a write: the language and the compiler's own runtime (the egress redactor ` +
      `included) call platform built-ins with values the analysis never sees — a row with every protected column ` +
      `still on it — so a replaced built-in can take the column outside its row. §14.8.9 fails closed on what it ` +
      `cannot analyse. Resolution: keep the helper in a binding or on your own object (\`const fmt = …\`, ` +
      `\`globalThis.myApp = { … }\`) instead of patching a built-in or its prototype.`,
      span ? ({ file: p.filePath, ...span } as any) : ({ file: p.filePath, start: 0, end: 0 } as any),
      "error",
    ));
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

/** The static string every value of a computed key starts with (`"cache_" + id`, `` `cache_${id}` ``), or "". */
function keyPrefix(node: any): string {
  if (!node) return "";
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis[0]?.value?.cooked ?? "";
  // `a + b`: a's prefix — and, when `a` is wholly a string literal, b's after it.
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const l = keyPrefix(node.left);
    const leftIsWholeString = node.left.type === "Literal" && typeof node.left.value === "string";
    return leftIsWholeString ? l + keyPrefix(node.right) : l;
  }
  return "";
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
  run(): { leaks: ProtectFlowLeak[]; tagSites: ProtectTagSite[]; saturated: boolean; poisoned: ProtectFlowPoison[] } {
    const byPath = new Map(this.mods.map((m) => [m.filePath, m]));
    for (const mod of this.mods) {
      this.curMod = mod;
      const decls: any[] = [];
      this.declare(mod.root.body, mod.scope.names, decls, null, mod);
      this.collectImportsExports(mod, byPath);
      this.bindDecls(decls, mod.scope);
      this.collectInferredNames(mod.root);
    }
    this.sessionSummaryOk = this.sessionSummaryPrecondition();
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
      console.error(`[protect-flow] modules=${this.mods.length} instances=${this.instanceList.length} closures=${this.closures.size} converged=${converged} passes=${passes} globalFns=${[...this.globalFnsByName.values()].reduce((n, s) => n + s.size, 0)}named/${this.globalFnsUnnamed.size}unnamed/${this.globalFnsSlot.size}slot ms=${Math.round(performance.now() - this.t0)}`);
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
    const poisoned: ProtectFlowPoison[] = [...this.poisoned.values()].map((p) => ({
      filePath: p.mod.filePath, site: p.site, siteFn: this.siteFnOf.get(p.site)?.fn ?? null, what: p.what,
    }));
    return { leaks, tagSites, saturated: this.saturated, poisoned };
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
      this.fnOfNames.set(fnNames, node);
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

  private instanceFor(c: Closure, args: Taint[], everyParam: Taint | undefined, argsObjIn?: Taint): Instance | null {
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
      this.mergeBinding("arguments", inst!.scope, argsObjIn ?? this.argumentsObject(args, everyParam));
    }
    this.curMod = saved;
    return inst;
  }

  /** The `arguments` object of a call (see `instanceFor`). */
  private argumentsObject(args: Taint[], everyParam: Taint | undefined): Taint {
    const argsObj = containerOf(everyParam ?? join(...args));
    argsObj.len = new Map();
    return argsObj;
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
  /**
   * `unite`, remembering the pair: classes only ever merge, so a pair united
   * once is united for good (round 8, perf — a binding re-bound every pass to a
   * value with N cells walked the union-find N times per pass).
   */
  private unitedPairs = new Set<string>();
  private uniteOnce(a: string, b: string): void {
    const k = a + "\u0000" + b;
    if (this.unitedPairs.has(k)) return;
    this.unitedPairs.add(k);
    this.unite(a, b);
  }
  /**
   * Unite `key` with every cell of `refs`. Afterwards every cell of that SET is in
   * one class, for good — so the next binding handed the same set (one
   * `arguments` object bound into every callee of a call) unites with one
   * representative instead of walking the set again (round 8, perf).
   */
  private unitedSets = new WeakMap<Set<string>, { rep: string; size: number }>();
  private uniteAll(key: string, refs: Set<string> | undefined): void {
    if (!refs || refs.size === 0) return;
    const seen = this.unitedSets.get(refs);
    if (seen !== undefined && seen.size === refs.size) { this.uniteOnce(key, seen.rep); return; }
    for (const r of refs) this.uniteOnce(key, r);
    this.unitedSets.set(refs, { rep: key, size: refs.size });
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
  private readGlobal(name: string): Taint {
    const own = this.bindings.get(GLOBAL_CELL) ?? clean();
    const writes = this.classWrites.get(this.find(GLOBAL_CELL));
    const t = anyDepth(writes ? join(own, writes) : own);
    // Round 8: the value carries the global name it was read through (`Taint.gn`).
    const r: Taint = { ...t, refs: new Set([GLOBAL_CELL]), gn: new Set([name]) };
    delete r.gnAny;
    if (CODE_EVALUATORS.has(name)) {
      r.fns = new Set([...r.fns, this.evaluator]);
      if (r.own) r.own = new Set([...r.own, this.evaluator]); // it IS the evaluator
    }
    return r;
  }

  /**
   * S449 round 9 — `Function` and `eval` run code built from a STRING: code the
   * compile does not contain, with every global in reach (`Function("return
   * this")()` IS `globalThis`, and its body may be anything). They are a function
   * value of their own (one pseudo-closure), held by every read that may be one —
   * the global names `Function` / `eval`, and any `.constructor` (a function's
   * constructor is `Function`; an async / generator function's, its kin) — and
   * CALLING it, by any route, is `E-PROTECT-006` in a `protect=` compile.
   * (Round 8: `const g = Function("return this")(); g.k.set(u)` read `g` as
   * clean — carried LOW since round 6.)
   */
  private evaluator: Closure = { cid: -2, evaluator: true };
  private evaluated(fns: Set<Closure>, node: any, fn: Instance | null): void {
    if (fns.has(this.evaluator)) this.poison(node, fn, "evaluates code built at runtime (`Function`, `eval`, or a `.constructor` that may be `Function`): the compiler cannot see what that code does with the values in reach");
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
    for (const f of fns) {
      if (!set.has(f)) { set.add(f); this.changed = true; }
      if (name !== null) {
        let ns = this.globalNamesByFn.get(f);
        if (!ns) { ns = new Set(); this.globalNamesByFn.set(f, ns); }
        ns.add(name);
      }
    }
  }
  /** The names each NAMED-global-stored function was stored under (inverse of `globalFnsByName`). */
  private globalNamesByFn = new Map<Closure, Set<string>>();

  /**
   * S447 round 8 — the names a call through `t` (a value read from the global
   * heap) may reach functions under: the names it was read through (`Taint.gn`)
   * plus `extra` (the called method's name). NULL when the path cannot be named
   * — a computed key, an unmodelled method's result, or a value that joined the
   * global heap's alias class without being read from it — and then every
   * function the value holds is a candidate (fail closed).
   */
  private globalNames(t: Taint, extra: Array<string | null>): Set<string> | null {
    if (t.gnAny || !t.gn) return null;
    const out = new Set(t.gn);
    for (const e of extra) if (e !== null) out.add(e);
    return out;
  }

  /**
   * The names a SPELLED global path reaches functions under — null when any
   * segment is an element position (a literal index: `globalThis.arr[0].m`).
   * r8b: `globalPath` names a literal index, and the spelled-path branches used
   * those segments as names, so a function stored in an element (`globalFnsSlot`,
   * reached by no name) was skipped at `globalThis.arr[0].m(u)`, at
   * `` globalThis.arr[0]`${u}` `` and through `[Symbol.iterator]()` — all three
   * served the hash (S239 review of round 8, measured). One rule, as in
   * `memberRead`: an element is not a name.
   */
  private pathNames(path: string): Set<string> | null {
    const parts = path.split(".");
    for (const p of parts) if (/^\d+$/.test(p)) return null;
    return new Set(parts);
  }

  /**
   * Of the functions `fns` a value read from the global heap holds, the ones a
   * call through names `names` may reach: every function stored under one of
   * those names, every function stored where no name was readable, and every
   * function never recorded as a NAMED global store (it reached the value some
   * other way — fail closed). `names === null`: all of them.
   */
  private globalCandidates(fns: Set<Closure>, names: Set<string> | null): Set<Closure> {
    // r8b: plus every function the global heap holds under those names (all of
    // them when the path cannot be named) — a global value whose own function
    // set lost them (an unmodelled method's result: `it.next().value(u)` after
    // `globalThis.arr[Symbol.iterator]()`) still reaches them.
    const reach = this.globalFnsFor(names);
    if (names === null) return new Set([...fns, ...reach]);
    const out = new Set<Closure>(reach);
    for (const f of fns) {
      const ns = this.globalNamesByFn.get(f);
      if (this.globalFnsUnnamed.has(f)) { out.add(f); continue; }
      // Stored only in element positions (no name reaches them) — round 8.
      if (!ns && this.globalFnsSlot.has(f)) continue;
      if (!ns) { out.add(f); continue; }
      for (const n of ns) if (names.has(n)) { out.add(f); break; }
    }
    return out;
  }
  /**
   * The global-stored functions a call through global `path` may reach — every
   * one when the path cannot be named (`null`, round 8: fail closed).
   */
  private globalFnsFor(parts: Iterable<string> | null): Set<Closure> {
    const out = new Set<Closure>(this.globalFnsUnnamed);
    if (parts === null) {
      for (const set of this.globalFnsByName.values()) for (const f of set) out.add(f);
      for (const f of this.globalFnsSlot) out.add(f);
      return out;
    }
    for (const p of parts) for (const f of this.globalFnsByName.get(p) ?? []) out.add(f);
    return out;
  }
  /** What the functions `fns` have returned so far, over every instance (data only), cached per pass (r9 re-review). */
  private retsOf(fns: Set<Closure>): Taint {
    const key = "R" + [...fns].map((c) => c.cid).sort((a, b) => a - b).join(",");
    const hit = this.globalRetCache.get(key);
    if (hit) return hit;
    let r = clean();
    for (const inst of this.instanceList) if (fns.has(inst.closure)) r = join(r, dataOnly(inst.ret));
    r = dataOnly(r);
    this.globalRetCache.set(key, r);
    return r;
  }
  /** What those functions have returned so far (data only), cached per pass. */
  private globalRetCache = new Map<string, Taint>();
  private globalFnRetFor(parts: Iterable<string> | null): Taint {
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
  /**
   * r8b — should a call through the global heap apply the global functions it
   * may reach? When an argument carries protected data, OR when an argument is
   * (or holds) a compile function: the callee may invoke it with protected data
   * of its own in scope (`globalThis.run = function (f) { f(u.passwordHash) };
   * globalThis.run(function (x) { s = x })` served the hash on base and round 8 —
   * the callback carried nothing, so `run` was never applied with it).
   */
  private globalCallMatters(args: Taint[]): boolean {
    if (this.carriesProtected(args)) return true;
    for (const a of args) for (const f of a.fns) if (!f.host) return true;
    return false;
  }

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

  /**
   * May this callee value be a PLATFORM function (code the compile does not
   * contain): no function value known, one read from the global heap, or a
   * host import.
   */
  private mayBePlatformFunction(t: Taint): boolean {
    if (t.fns.size === 0 || this.isGlobalValue(t)) return true;
    for (const f of t.fns) if (f.host) return true;
    return false;
  }

  /** Does this value belong to the global heap's alias class? */
  private isGlobalValue(t: Taint): boolean {
    const g = this.find(GLOBAL_CELL);
    const st = this.find(SESSION_STORE_CELL);
    for (const r of refsOf(t)) { const c = this.find(r); if (c === g || c === st) return true; }
    return false;
  }

  /** A write landed in the global heap's alias class: a value outside a row is an egress. */
  private globalStore(slot: string, t: Taint): void {
    const c = this.find(slot);
    const g = this.find(GLOBAL_CELL);
    if (c !== g && c !== this.find(SESSION_STORE_CELL)) return;
    if ([...naked(t).keys()].some((l) => !isPseudoLabel(l))) this.sink(t, this.curInst, "global");
    // A function written into the session store (not the global heap proper) is
    // reached only by reading the store — `elemOf` of its contents carries it — so
    // it is not registered as a global function callable by NAME (r9 fix round:
    // registering it made every session-touching function "unnamed", applied at
    // every global call — g2-deep 0.3 s → 20 s and a false E-PROTECT-006).
    if (c !== g) return;
    if (this.namedGlobalWrite) return;
    if (this.slotWrite) this.addAll(this.globalFnsSlot, t.fns);
    else this.recordGlobalFns(null, t.fns);
  }
  /**
   * S447 round 8 — functions stored into an ELEMENT position of a global
   * container (`m.set(k, f)`, `arr.push(f)`, `s.add(f)` …). An element is never
   * reached by a property NAME — only by an element read (`get` / `at` / an
   * index / iteration), which yields a value whose global names are unknown
   * (`gnAny`) and so considers every function it holds. Such a function is
   * therefore not a candidate of a NAMED call. Round 7 recorded these as
   * "stored where no name is readable", candidates of EVERY global call — and
   * the compiler's own session middleware (`_scrml_session_store.set(sid,
   * _rec)`) writes a value read from the global heap back into it, so every
   * global function became a candidate of every global call: name scoping was
   * a no-op in any module with a session (and examples like g2-deep blamed the
   * compiler's `_scrml_sqlite_data_dir` for a global store — a false E-PROTECT-006
   * on main — at 100+ s for 32 functions).
   */
  private globalFnsSlot = new Set<Closure>();
  /** Set while an element-position write (a MUTATING method's) is recorded. */
  private slotWrite = false;

  // ---- THE COMPILER-OWNED SESSION STORE, BY SUMMARY (S449 round 9) ----------
  // Every server module that serves a session declares `_scrml_session_store`
  // (`session-store-emit.ts`): an object kept in the GLOBAL heap
  // (`globalThis.__scrml_session_stores[path]`, or the `globalThis
  // .__scrml_session_store` Map). Walked, it is faithful but ruinous: the store
  // is ONE object shared by every module, so its alias class unites every
  // module's session machinery — and, through the element model of `get`, every
  // request and record that touches it — into one class (examples/23: 1.6 s →
  // 100 s at round 9; one class of 3,429 cells and 323 functions). Separating the
  // global heap by top-level name (round 9 direction b) does not help: the store
  // is genuinely one object, and the session class alone was 3,161 cells / 300
  // functions / 85 s (measured). So, like the `_scrml_protect_*` helpers, it is
  // modelled — recognized by its EXACT emitted text (an author who writes the same
  // text gets the same code, so the summary stays exact), and only its own three
  // calls are summarized:
  //   - `.set(k, v)` — the SQLite variant stores `JSON.stringify(v)`: Symbol-keyed
  //     column markers do not survive, so a row is stored with every unrevealed
  //     column NAKED (the memory variant keeps `v` as is). The store is in the
  //     global heap, so what it holds is written there (the global-store rule:
  //     protected data outside a row is `E-PROTECT-006`).
  //   - `.get(k)` — what any `.set` stored (SQLite: as JSON — fresh, naked), or
  //     (memory) an element of the global heap's data.
  //   - `.delete(k)` — nothing.
  // The global slot may hold an AUTHOR's object instead (written there first, or
  // its methods overwritten): each call also applies every function the global
  // heap holds when the arguments matter, and joins what those functions return —
  // the ordinary global-receiver rule, with names unknown (fail closed). Any OTHER
  // use of the binding (a field write, passing it on) sees it as what it is: a
  // value read from the global heap.
  private sessionStores = new Map<string, "sqlite" | "memory">();

  /**
   * r9 re-review — THE SUMMARY IS A FAIL-CLOSED PRECONDITION, decided once per
   * compile. Three bypasses in one round (a copied record, unsummarised routes, an
   * overwritten method — `_scrml_session_store.get = function (k) { return
   * u.passwordHash }` served the hash) all came from the summary applying while the
   * program touched the store some other way. So the summary applies to a compile
   * ONLY IF every program reference to the store, or to anything it can be reached
   * through, is in an ALLOWED position; any other reference anywhere disables it and
   * the store is analysed by the faithful global model (sound — slow only for a
   * program that reaches into it). The ALLOW-LIST, over every identifier and every
   * property key / string of the emitted server modules outside the recognized
   * store declarations:
   *   1. the store binding `_scrml_session_store` — ONLY as `B.get(…)`, `B.set(…)`,
   *      `B.delete(…)`: a plain (non-`new`) call whose callee is a non-computed
   *      member of the bare binding;
   *   2. the global object's names (`globalThis`, `self`, `global`, `window`) — ONLY
   *      as the object of a NON-computed member whose name is neither the registry's
   *      nor one that is the global object again (`globalThis.globalThis`, `.self`,
   *      …), or as the operand of `typeof` (a string);
   *   3. the registry names (`__scrml_session_stores`, `__scrml_session_store`) —
   *      NEVER, as an identifier, a property name or a string.
   * Why that covers every route to the store object: it lives only in the global
   * object under a registry name and in the binding. Reaching it needs either the
   * binding (rule 1: only the three summarised calls), the registry name (rule 3:
   * spelled anywhere → off), or the global object used as a VALUE — computed key,
   * enumeration, alias, argument, spread, `in`, `with` (rule 2: any of those → off);
   * the remaining way to obtain the global object, a code evaluator
   * (`Function("return this")`), is refused outright. Server modules are strict ESM,
   * so a bare function's `this` is not the global object.
   */
  private sessionSummaryOk = false;
  private sessionSummaryPrecondition(): boolean {
    const REGISTRY = new Set(["__scrml_session_stores", "__scrml_session_store"]);
    // Properties of the global object that are the global object itself.
    const SELF_REFERENCES = new Set([...GLOBAL_OBJECT_NAMES, "frames", "parent", "top"]);
    const STORE = "_scrml_session_store";
    let any = false;
    let ok = true;
    for (const mod of this.mods) {
      // The recognized declarations are the compiler's own text — not program uses.
      const skip = new Set<any>();
      for (const st of mod.root.body) {
        const d = st?.type === "ExportNamedDeclaration" ? st.declaration : st;
        if (d?.type !== "VariableDeclaration") continue;
        const text = mod.src.slice(d.start, d.end);
        if (text === SESSION_STORE_SQLITE_TEXT || text === SESSION_STORE_MEMORY_TEXT) { skip.add(d); any = true; }
      }
      const visit = (n: any, parent: any, key: string): void => {
        if (!ok || !n || typeof n !== "object") return;
        if (Array.isArray(n)) { for (const c of n) visit(c, parent, key); return; }
        if (typeof n.type !== "string" || skip.has(n)) return;
        if (n.type === "Identifier") {
          // Property / key positions name a property, not a binding.
          const isKey = (parent?.type === "MemberExpression" && key === "property" && !parent.computed)
            || ((parent?.type === "Property" || parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") && key === "key" && !parent.computed);
          if (isKey) { if (REGISTRY.has(n.name)) ok = false; return; }
          if (REGISTRY.has(n.name)) { ok = false; return; }
          if (n.name === STORE) {
            const allowed = parent?.type === "MemberExpression" && key === "object" && !parent.computed
              && (parent.property?.name === "get" || parent.property?.name === "set" || parent.property?.name === "delete")
              && this.parentOf.get(parent)?.node?.type === "CallExpression" && this.parentOf.get(parent)?.key === "callee";
            if (!allowed) ok = false;
            return;
          }
          if (GLOBAL_OBJECT_NAMES.has(n.name)) {
            // (Not a member that IS the global object again: `globalThis.globalThis[k]`.)
            const allowed = (parent?.type === "MemberExpression" && key === "object" && !parent.computed
                && !REGISTRY.has(parent.property?.name) && !SELF_REFERENCES.has(parent.property?.name))
              // `typeof globalThis` yields a string (the compiler's channel broadcast emits it).
              || (parent?.type === "UnaryExpression" && parent.operator === "typeof");
            if (!allowed) ok = false;
            return;
          }
          return;
        }
        if (n.type === "Literal" && typeof n.value === "string" && REGISTRY.has(n.value)) { ok = false; return; }
        if (n.type === "TemplateElement" && [...REGISTRY].some((r) => (n.value?.cooked ?? "").includes(r))) { ok = false; return; }
        for (const k in n) {
          if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
          const v = n[k];
          if (v && typeof v === "object") {
            if (Array.isArray(v)) { for (const c of v) if (c && typeof c === "object") { this.parentOf.set(c, { node: n, key: k }); visit(c, n, k); } }
            else { this.parentOf.set(v, { node: n, key: k }); visit(v, n, k); }
          }
        }
      };
      visit(mod.root, null, "");
      if (!ok) break;
    }
    this.parentOf = new WeakMap();
    if (process.env.SCRML_PROTECT_FLOW_DEBUG && any) console.error(`[protect-flow] session-store summary ${ok ? "applies" : "DISABLED (a program use outside the allow-list)"}`);
    return any && ok;
  }
  private parentOf = new WeakMap<any, { node: any; key: string }>();

  /** A module-scope `const _scrml_session_store = …` the compiler emitted: bind it (see above). */
  private sessionStoreDecl(node: any, scope: Scope): boolean {
    if (!this.sessionSummaryOk) return false;
    if (node.declarations.length !== 1 || node.declarations[0].id?.type !== "Identifier") return false;
    const text = this.curMod!.src.slice(node.start, node.end);
    const variant = text === SESSION_STORE_SQLITE_TEXT ? "sqlite" : text === SESSION_STORE_MEMORY_TEXT ? "memory" : null;
    if (variant === null) return false;
    const name = node.declarations[0].id.name;
    this.sessionStores.set(`${scope.id}:${name}`, variant);
    // r9 fix round (R1/R4): the binding IS the store — ONE object of the global
    // heap, given its own alias cell (`SESSION_STORE_CELL`, shared by every module):
    // every summarised `.set` writes it and every `.get` reads it back. (Under the
    // precondition above those three calls are the ONLY program uses of the store;
    // any alias, computed member or registry access disables the summary.) It also
    // carries what the global heap holds but not the global heap's alias cell:
    // uniting the two is the round-9 performance cliff.
    const g = this.readGlobal(variant === "sqlite" ? "__scrml_session_stores" : "__scrml_session_store");
    const held = dataOnly(variant === "sqlite" ? elemOf(g) : g);
    held.fns = new Set(g.fns);
    held.refs = new Set([SESSION_STORE_CELL]);
    this.mergeBinding(name, scope, held);
    return true;
  }

  /** `<store>.get / .set / .delete` on a recognized session-store binding: its variant, else null. */
  private sessionStoreOf(m: any, scope: Scope): "sqlite" | "memory" | null {
    if (m.computed || m.object?.type !== "Identifier" || m.property?.type !== "Identifier") return null;
    if (m.property.name !== "get" && m.property.name !== "set" && m.property.name !== "delete") return null;
    const s = this.resolve(m.object.name, scope);
    if (!s || s.parent !== null) return null;
    return this.sessionStores.get(`${s.id}:${m.object.name}`) ?? null;
  }

  /**
   * Is `fn` the compiler's own `_scrml_session_middleware` — a module-top-level
   * function declaration of that name in a module that declares the recognized
   * store? (An author's same-named top-level declaration there is a duplicate
   * declaration: the module does not parse, and the flow fails closed.)
   */
  private inSessionMiddleware(fn: Instance | null): boolean {
    const n = fn?.stat.node;
    return !!n && n.type === "FunctionDeclaration" && fn!.stat.name === "_scrml_session_middleware" && !this.fnParent.get(n);
  }

  /** Everything that has reached the store, by any route (r9 fix round). */
  private sessionStoreContents(): Taint {
    return this.withCellContents({ ...clean(), refs: new Set([SESSION_STORE_CELL]) });
  }

  private sessionStoreCall(variant: "sqlite" | "memory", m: any, args: Taint[], node: any, fn: Instance | null): Taint {
    const recv = this.getBinding(m.object.name, fn?.scope ?? this.curMod!.scope);
    // An author's object may sit in the slot (fail closed — see above).
    let own = clean();
    const cands = this.globalCallMatters(args) ? this.globalCandidates(new Set(), null) : new Set<Closure>();
    if (cands.size > 0) {
      this.recordThis(cands, recv);
      own = this.applyFns(cands, args, undefined, node, fn);
    }
    const authored = join(own, this.globalFnRetFor(null));
    const method = m.property.name;
    if (method === "set") {
      const v = args[1] ?? clean();
      // SQLite: JSON keeps no function, no marker — every unrevealed column of a row
      // comes back naked. MEMORY: a `Map` keeps the very object (r9 fix round R1:
      // round 9 stored a data-only copy, so `store.get("k").h = h` in one request and
      // `store.get("k").h` in the next served the hash — the second read never saw
      // the first write).
      if (variant === "sqlite") {
        const json: Taint = { ...clean(), scalar: everything(v, this.site(node, fn)), deep: everything(v, this.site(node, fn)) };
        this.writeCell(SESSION_STORE_CELL, anyDepth(containerOf(json)));
      } else {
        this.writeCell(SESSION_STORE_CELL, this.inSessionMiddleware(fn) ? anyDepth(containerOf(dataOnly(v))) : containerOf(v));
      }
      return authored;
    }
    if (method === "get") {
      const contents = this.sessionStoreContents();
      if (variant === "sqlite") {
        // A fresh object parsed from JSON: everything the store holds, naked.
        const all = everything(contents, this.site(node, fn));
        return join({ ...clean(), scalar: all, deep: new Map(all), k: 2 }, authored);
      }
      // A `Map` hands back the LIVE stored object — its alias cells and functions
      // with it (R1) — except to the compiler's own middleware, which only reads
      // the record's fields and writes back a clean CSRF token: there a copy of the
      // data is exact for every protected flow, and the live reference would make
      // every request and session object it touches one alias class with the store
      // (measured: g2-deep 0.3 s → 20 s and a false E-PROTECT-006).
      if (this.inSessionMiddleware(fn)) {
        const el = elemOf(dataOnly(contents));
        delete el.refs;
        return join(el, authored);
      }
      return join(elemOf(contents), authored);
    }
    return authored;
  }

  private getBinding(name: string, scope: Scope, depth = 0): Taint {
    const s = this.resolve(name, scope);
    if (!s) return this.readGlobal(name);
    if (s.parent === null) {
      const imp = s.mod.imports.get(name);
      if (imp) return this.importValue(imp, depth);
    }
    const key = `${s.id}:${name}`;
    const own = this.bindings.get(key) ?? clean();
    const writes = this.classWrites.get(this.find(key));
    const t = writes ? join(own, writes) : own;
    // What is written INTO the object does not change its prototype (r9 fix round).
    const r: Taint = { ...t, refs: new Set([key]) };
    if (own.pproto) r.pproto = true; else delete r.pproto;
    return r;
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
    this.uniteAll(key, t.refs);
    // A write INTO an alias class may sit at any depth of its objects (round 8).
    const plain = isWrite || !resolved ? anyDepth({ ...t }) : { ...t };
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
    const prevStored = store.get(slot);
    if (prevStored !== undefined && subsumes(prevStored, plain)) return;
    const prev = prevStored ?? clean();
    const next = join(prev, plain);
    if (taintKey(prev) !== taintKey(next)) {
      store.set(slot, next);
      this.changed = true;
    } else if (!store.has(slot)) {
      store.set(slot, next);
    }
  }

  private addRet(inst: Instance, t: Taint): void {
    if (subsumes(inst.ret, t)) return;
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
        if (scope.parent === null && this.sessionStoreDecl(node, scope)) return;
        for (const d of node.declarations) {
          const v = d.init ? this.evalExpr(d.init, scope, fn) : clean();
          this.bindPattern(d.id, v, scope, fn);
          if (d.id?.type === "Identifier" && node.kind === "const" && this.isSqlConstruction(d.init, scope)) {
            const s = this.resolve(d.id.name, scope);
            if (s) this.sqlClients.add(`${s.id}:${d.id.name}`);
          }
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
        // `for await` resolves each element as `await` does (round 7).
        const el = node.type === "ForOfStatement" ? (node.await ? this.settle(elemOf(right)) : elemOf(right)) : clean();
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
        // Round 9: `String = f` rebinds a platform built-in (a free name is a global binding).
        if (!this.resolve(p.name, scope)) this.globalRebind(p.name, p, fn);
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
        if (ownOf(t).size > 0) {
          // `o.f = function …` runs with `this` = o, and — under a key the
          // language may call it by (a coercion hook, an iterator, a thenable,
          // `toJSON`, or a key the compiler cannot read) — is analysed as so
          // invoked: what it returns is part of o (S447 round 7; round 6e did
          // this for `toJSON` / an unreadable key only).
          t = join(t, this.storeFns(ownOf(t), objT, p, fn, p.computed ? this.literalKey(p.property, scope) : propName));
        }
        // Round 9: writing a property OF the global object rebinds a global name.
        if (this.isGlobalObject(objT)) this.globalRebind(p.computed ? this.literalKey(p.property, scope) : propName, p, fn, p.computed ? p.property : undefined);
        const at = { node: p, fn };
        if (freeRoot && globalName !== null && t.fns.size > 0) {
          this.recordGlobalFns(globalName, t.fns);
          this.namedGlobalWrite = true;
          try { this.writeThrough(p.object, objT, containerOf(join(t, k)), scope, at); } finally { this.namedGlobalWrite = false; }
          return;
        }
        this.writeThrough(p.object, objT, containerOf(join(t, k)), scope, at);
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

  private writeThrough(expr: any, exprT: Taint, t: Taint, scope: Scope, at?: { node: any; fn: Instance | null }): void {
    if (at && this.platformTarget(exprT, t, expr, scope)) {
      this.poison(at.node, at.fn, "writes into a platform-owned object (a built-in prototype, or a function stored onto a built-in such as `Object`, `JSON` or `console`)");
    }
    this.mutateRoot(expr, t, scope);
    for (const r of refsOf(exprT)) this.writeCell(r, t);
  }

  // ---- THE PLATFORM IS NOT THE PROGRAM'S (S449 round 9 — see PLATFORM_GLOBALS) ----
  /** Writes that replace part of the platform, keyed by site: each is E-PROTECT-006. */
  private poisoned = new Map<string, { mod: Mod; site: string; what: string }>();
  private poison(node: any, fn: Instance | null, what: string): void {
    const site = this.site(node, fn);
    const key = `${this.curMod!.filePath}\u0000${site}`;
    if (!this.poisoned.has(key)) this.poisoned.set(key, { mod: this.curMod!, site, what });
  }
  /**
   * Does writing `written` into `target` (the object `expr` evaluates to) modify
   * the platform? Any write into a value that may BE a built-in prototype /
   * constructor (`plat`: every object may inherit it); or a FUNCTION stored onto
   * a platform object named by its path (`JSON.stringify = f`,
   * `globalThis.console.log = f`) or by a binding of one (`const J = JSON;
   * J.stringify = f`). (Not "any global value": the global heap is one
   * field-insensitive object, so every value touched by it holds every function
   * stored in it — measured: that reading refused the compiler's own
   * `_scrml_sqlite_data_dir` `parts.push(part)`.)
   */
  private platformTarget(target: Taint, written: Taint, expr: any, scope: Scope): boolean {
    if (target.plat) return true;
    return written.fns.size > 0 && this.namesPlatform(expr, scope);
  }
  /** Is `expr` a path rooted at a platform global (directly, or through a binding whose own value was read from one)? */
  private namesPlatform(expr: any, scope: Scope): boolean {
    let e = expr;
    const segs: string[] = [];
    while (e && (e.type === "MemberExpression" || e.type === "ChainExpression" || e.type === "ParenthesizedExpression")) {
      if (e.type === "MemberExpression") {
        const k = e.computed ? staticKey(e.property) : (e.property?.name ?? null);
        segs.unshift(k ?? "\u0000");
        e = e.object;
      } else e = e.expression;
    }
    if (e?.type !== "Identifier") return false;
    const s = this.resolve(e.name, scope);
    let names: string[];
    if (!s) names = [e.name, ...segs];
    else {
      const own = this.bindings.get(`${s.id}:${e.name}`);
      if (!own?.gn || own.gnAny) return false;
      names = [...own.gn, ...segs];
    }
    for (const n of names) {
      if (GLOBAL_OBJECT_NAMES.has(n)) continue;
      return PLATFORM_GLOBALS.has(n);
    }
    return false;
  }
  /** A function value the PROGRAM made (every function it may be is a compile closure, none read from the global heap). */
  private isProgramFunction(t: Taint): boolean {
    const own = ownOf(t);
    if (own.size === 0 || t.plat || this.isGlobalValue(t)) return false;
    for (const c of own) if (!c.node) return false;
    return true;
  }
  /** An object the PROGRAM made (no built-in, no global value, and something is known of it). */
  private isProgramObject(t: Taint): boolean {
    return !t.plat && !t.platIn && informative(t) && !this.isGlobalValue(t);
  }
  /** May `t` be a function — one the program holds, a built-in, or a value the analysis knows nothing of? */
  private mayBeFunction(t: Taint): boolean {
    if (ownOf(t).size > 0 || t.plat || this.isGlobalValue(t)) return true;
    // No information at all (a host result, a parameter no caller shows): fail closed.
    return !t.row && t.fns.size === 0 && refsOf(t).size === 0 && t.scalar.size === 0 && t.deep.size === 0 && !t.k;
  }
  /** Is `t` the global object itself (`globalThis`, `self`, an alias of it)? */
  private isGlobalObject(t: Taint): boolean {
    if (!this.isGlobalValue(t) || t.gnAny || !t.gn || t.gn.size === 0) return false;
    for (const n of t.gn) if (!GLOBAL_OBJECT_NAMES.has(n)) return false;
    return true;
  }
  /** A write of global binding `key` (null = a key the compiler cannot read): rebinding a platform name is refused. */
  private globalRebind(key: string | null, node: any, fn: Instance | null, keyNode?: any): void {
    // (r9 fix round R3: a computed key whose STATIC PREFIX no platform name starts
    // with — `globalThis["cache_" + id]` — cannot rebind one.)
    if (key === null && keyNode) {
      const pre = keyPrefix(keyNode);
      if (pre && ![...PLATFORM_GLOBALS].some((n) => n.startsWith(pre))) return;
    }
    if (key === null || PLATFORM_GLOBALS.has(key)) {
      this.poison(node, fn, key === null
        ? "writes a global binding under a key the compiler cannot read (it may rebind a platform built-in such as `String` or `Object`)"
        : `rebinds the platform built-in \`${key}\``);
    }
  }

  /** Merge a container write into the alias class of binding cell `key`. */
  private writeCell(key: string, t: Taint): void {
    this.uniteAll(key, t.refs);
    // An alias class holds objects at DIFFERENT depths (a field read aliases
    // into its container's class), so what is written into it may sit at any
    // depth of any of them (round 8 — see `RowPart.paths`).
    const plain = anyDepth({ ...t });
    delete plain.refs;
    const slot = this.find(key);
    this.globalStore(slot, plain);
    const prevStored = this.classWrites.get(slot);
    if (prevStored !== undefined && subsumes(prevStored, plain)) return;
    const prev = prevStored ?? clean();
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
    /** The read yields (or may yield) a row — an element of a row array, or a row held in a field. */
    let rowOut = false;
    if (o.row) {
      // S447 round 8 — WHERE the row sits decides what a read yields (see
      // `RowPart.paths`): a COLUMN only where the value may itself be the row;
      // the row itself wherever a path continues through this key.
      const { column, next } = readPaths(o.row.paths, dynamic ? null : key, numeric);
      if (next.size > 0) {
        r.row = { ...copyRow(o.row), paths: next };
        rowOut = true;
      }
      if (column && dynamic) {
        // `u[k]` — any column.
        for (const c of unrevealed(o.row)) r.scalar.set(c, this.site(node, fn));
      } else if (column && !numeric && key !== null) {
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
    const namedColumnOffRow = o.row !== null && !dynamic && !numeric && o.deep.size === 0 && !rowOut;
    if (!namedColumnOffRow && refsOf(o).size > 0) r.refs = new Set(refsOf(o));
    // A field of a value read from the global heap is read through one more name (round 8).
    // An element (an index, or a key the compiler cannot read) is not a name.
    if (o.gnAny || (o.gn && (dynamic || numeric))) r.gnAny = true;
    else if (o.gn) r.gn = new Set([...o.gn, ...(key !== null ? [key] : [])]);
    // A column read straight off a row is a primitive: its `.length` is the
    // §14.8.9 allowlisted derived count. Anything that merged container
    // contents (`o.deep`) may be an object with its own `length` — default.
    if (columnRead && namedColumnOffRow && o.fns.size === 0) r.len = new Map();
    if (o.k) r.k = o.k; // a part of a constant is constant; of a runtime value, runtime
    // Round 9: `x.prototype` / `x.__proto__` / `x.constructor` may be a built-in's
    // prototype or constructor (`({}).constructor.prototype` IS Object.prototype),
    // and a field of a container that holds one may be it. (A field OF a
    // prototype — `Object.prototype.toString` — is a function, not a prototype.)
    // (r9 fix round R3: only when the owner may be a BUILT-IN — `.prototype` of a
    // function the program made, and `.__proto__` / `.constructor` of an object
    // whose prototype the program set (`pproto`), are the program's own: scrml has
    // no `class`, so `Pt.prototype.norm = function …` IS how adopters build types.)
    if (o.platIn || (!dynamic && key !== null && INTRINSIC_LINK_KEYS.has(key)
        && (key === "prototype" ? !this.isProgramFunction(o) : !o.pproto))) r.plat = true;
    // …and `.constructor` may be `Function`; `globalThis.eval` is `eval` (round 9 — see `evaluator`).
    // (r9 fix round R3: a `.constructor` is `Function` only when its owner may be a
    // FUNCTION — `new o.constructor()` of a program object is not code evaluation.)
    if (!dynamic && ((key === "constructor" && this.mayBeFunction(o)) || (key !== null && CODE_EVALUATORS.has(key) && (o.gn || o.gnAny)))) r.fns.add(this.evaluator);
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
        return this.readGlobal("import.meta");
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
        // A tagged template IS a call: `tag(strings, ...values)`. S447 round 7:
        // the values were bound from the FIRST parameter on, so `(s, v) => v`
        // saw a clean `v` (measured: `` tag`${u.passwordHash}` `` and a tag
        // reached through a method served the hash). The first argument is the
        // literal strings array; a member tag runs with `this` = its object.
        const tagNode = node.tag?.type === "ChainExpression" ? node.tag.expression : node.tag;
        const tagT = this.evalExpr(node.tag, scope, fn);
        this.evaluated(tagT.fns, node, fn); // `Function`…`` (round 9)
        const recv = tagNode?.type === "MemberExpression" ? this.evalExpr(tagNode.object, scope, fn) : null;
        const values = node.quasi.expressions.map((e: any) => this.evalExpr(e, scope, fn));
        const strings: Taint = { ...clean(), k: 1, len: new Map() };
        const tagPath = this.globalPath(node.tag, scope);
        if (tagPath !== null || this.isGlobalValue(tagT)) {
          // A GLOBAL tag (`String.raw`…``) is a platform function — plus any
          // function stored in the global heap under a name on its path.
          // (Round 8: through an alias too — the tag's global names, `Taint.gn`.)
          const gf = this.carriesProtected(values)
            ? this.globalCandidates(tagT.fns, tagPath !== null ? this.pathNames(tagPath) : this.globalNames(tagT, []))
            : new Set<Closure>();
          if (gf.size > 0 && recv) this.recordThis(gf, recv);
          const viaGlobal = gf.size > 0 ? this.applyFns(gf, [strings, ...values], undefined, node, fn) : clean();
          return join(viaGlobal, this.unknownCall(tagPath, [strings, ...values], node, fn));
        }
        if (this.hasCallable(tagT)) {
          if (recv) this.recordThis(tagT.fns, recv);
          return this.applyFns(tagT.fns, [strings, ...values], undefined, node, fn);
        }
        // `_scrml_sql`…`` / `tx`…`` — the compiler's own SQL client: a query. Its
        // interpolations are bound parameters (server-side use), and its result is
        // a row read from the database: a DB round trip is outside the egress
        // guarantee (F5).
        if (this.isSqlClient(tagNode, scope)) return { ...clean(), k: 2 };
        // Any other tag the analysis holds no function for — `String.raw`, a
        // function a host call made (`String.raw.bind(String)`), a parameter no
        // caller shows — is code the compiler cannot see into: FAIL CLOSED.
        // (It used to be assumed to be a query, and a host-made tag served the
        // hash — round 7, measured.)
        return this.unknownCall(null, [strings, ...values], node, fn);
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
        // The functions this literal stores, and under which key (null = a key
        // the compiler cannot read, or one a spread copied in).
        const stored: Array<{ fns: Set<Closure>; key: string | null; accessor: boolean; copy?: true }> = [];
        // r9 fix round: a literal `__proto__: p` with `p` program-made sets a program prototype.
        let protoSet = false;
        for (const pr of node.properties) {
          if (pr.type === "SpreadElement") {
            // `{...row}` copies the enumerable Symbol descriptor: still a row —
            // and every own property at the SAME depth (`{ ...t }.h` is `t.h`).
            const v = this.evalExpr(pr.argument, scope, fn);
            r = join(r, containerOf(v, null));
            if (v.fns.size > 0) stored.push({ fns: v.fns, key: null, accessor: false, copy: true });
            continue;
          }
          // A protected value used as a KEY is part of the container too —
          // `{ [h]: 1 }` serializes as `{"SECRET":1}` (S441 round 3, N1) — and a
          // key OBJECT is coerced to a property key by its own `toString` (its
          // hooks' results are part of it: see `storeFns`).
          if (pr.computed) r = join(r, containerOf(keyOnly(this.evalExpr(pr.key, scope, fn))));
          const v = this.evalExpr(pr.value, scope, fn);
          const key = pr.computed ? this.literalKey(pr.key, scope) : (pr.key?.type === "Identifier" ? pr.key.name : staticKey(pr.key));
          // The value sits under its key (round 8: `{ h: u }.h` is the row). A
          // key the compiler cannot read may be any name; an accessor's value is
          // what its getter returns (a hook — see `storeFns`).
          // `__proto__: p` (a plain, non-computed key) SETS THE PROTOTYPE: `p`'s
          // properties are read off the object itself — the row at any depth.
          if (!pr.computed && !pr.shorthand && key === "__proto__") protoSet = this.isProgramObject(v) || (pr.value?.type === "Literal" && pr.value.value === null);
          r = join(r, !pr.computed && !pr.shorthand && key === "__proto__" ? anyDepth(containerOf(v, null)) : containerOf(v, key ?? ANY_KEY));
          // Only a function the property IS is stored under its key — a nested
          // object's functions belong to that object (`ownOf`).
          if (ownOf(v).size > 0) {
            stored.push({ fns: ownOf(v), key, accessor: pr.kind === "get" || pr.kind === "set" });
          }
        }
        if (stored.length === 0) { if (protoSet) r.pproto = true; return r; }
        // S447 round 7 — an object holding functions is an object their `this`
        // can name: it gets an allocation cell, so a write through `this`
        // (`{ h: "", set(r) { this.h = r.passwordHash } }`) lands in it; and a
        // function it stores where the language may call it (a protocol key, a
        // computed key, an accessor, a spread-in key) is analysed as so invoked,
        // with `this` = the object (S443 round 6e: getters and `toJSON` only).
        const cell = this.allocCell("obj", node);
        r.refs = new Set([...refsOf(r), cell]);
        let gained = clean();
        for (const s of stored) gained = join(gained, s.copy ? this.copyFns(s.fns, r, node, fn) : this.storeFns(s.fns, r, node, fn, s.key, s.accessor));
        const lit = this.withCellContents(join(r, gained));
        if (protoSet) lit.pproto = true;
        return lit;
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
        // `x instanceof C` CALLS `C[Symbol.hasInstance](x)` — a function the
        // right operand holds receives the LEFT operand (round 7, measured: a
        // `hasInstance` that copied `x.passwordHash` out served it). The result
        // is still a boolean; the call's effects are what matter.
        if (node.operator === "instanceof" && (rr.fns.size > 0 || this.isGlobalValue(rr))) {
          // A GLOBAL right operand (`x instanceof Response`) carries whatever
          // anything ever stored in the global heap: only the functions stored
          // under a name on its path are candidates (see `globalFnsByName`).
          // Round 8: the right operand's global NAMES travel with it, so an alias
          // (`const { C } = globalThis`, `const C = globalThis.C`, `P.C` with
          // `const P = process`) reaches the hook stored under `C` exactly as
          // `globalThis.C` does — and an operand read through a path that cannot
          // be named reaches every function it holds (fail closed). Round 7
          // looked only at a SPELLED global path and called nothing for an alias
          // (measured: all three served the hash on base and round 7).
          const gpath = this.globalPath(node.right, scope);
          const hooks = gpath !== null || this.isGlobalValue(rr)
            ? (this.carriesProtected([l]) ? this.globalCandidates(rr.fns, gpath !== null ? this.pathNames(gpath) : this.globalNames(rr, [])) : new Set<Closure>())
            : rr.fns;
          if (hooks.size > 0) {
            this.recordThis(hooks, rr);
            this.applyFns(hooks, [l], undefined, node, fn);
          }
        }
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
        // Round 8: `a ??= b` / `a ||= b` / `a &&= b` evaluates to `a`'s CURRENT value
        // when it does not assign — `let a = u; (a ||= 1).passwordHash` and
        // `(t.h ??= 1).passwordHash` served the hash on base (measured over HTTP);
        // it read as `b` alone. S449 round 9: the current value keeps its ALIAS
        // CELLS, wherever it lives — it IS the object the target holds. Round 8
        // dropped them for a left operand in the global heap, so `const x =
        // (globalThis.k ??= {}); x.h = u.passwordHash; return { v: globalThis.k.h }`
        // (and `||=`, `&&=`, an aliased / nested / computed-key / `process` target,
        // an array `push`, a `Map` `set`) served the hash over all three sinks
        // (measured on base). Round 8 dropped them because the compiler's own
        // session-store declaration — `(globalThis.__scrml_session_stores ??= {})
        // [path] ??= (…)()`, in every server module — then made every module's
        // session machinery one alias class (examples/23: 1.6 s → 100 s, measured
        // again at round 9). That declaration is now modelled by summary and never
        // reaches this rule (`sessionStoreDecl`), so the rule is exact everywhere.
        if (node.operator === "||=" || node.operator === "&&=" || node.operator === "??=") {
          return join(this.evalExpr(node.left, scope, fn), rv);
        }
        // r8b: `x = (target = v)` — the value IS the object the target now holds,
        // so it is in the target's alias class: `const x = (globalThis.k = {});
        // x.h = u.passwordHash` wrote into the global heap and served the hash
        // (base and round 8, measured) — the literal had no alias cell to unite.
        if (node.operator === "=" && (node.left.type === "MemberExpression" || node.left.type === "Identifier")) {
          const target = this.evalExpr(node.left, scope, fn);
          if (target.refs && target.refs.size > 0) return { ...v, refs: new Set([...refsOf(v), ...target.refs]) };
        }
        return v;
      }
      case "SequenceExpression": {
        let last = clean();
        for (const e of node.expressions) last = this.evalExpr(e, scope, fn);
        return last;
      }
      case "AwaitExpression": {
        // S447 round 7 — `await v` RESOLVES a thenable: it calls `v.then(resolve,
        // reject)` and evaluates to what `then` passes to `resolve`. Every server
        // function's body runs as `await (async () => { … })()`, so a server
        // function that RETURNS `{ then: (res) => res(u.passwordHash) }` shipped
        // the hash (measured). See `settle`.
        return this.settle(this.evalExpr(node.argument, scope, fn));
      }
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
    // The returns are joined ONCE (round 8, perf: joining them one at a time
    // re-copied the growing union per callee — quadratic in a wide call).
    const parts: Taint[] = [];
    // One `arguments` object for every callee of this call (round 8, perf).
    let argsObj: Taint | undefined;
    for (const c of fns) {
      if (c.resolver !== undefined) {
        const prev = this.resolved.get(c.resolver) ?? clean();
        const next = join(prev, everyParam ?? args[0] ?? clean());
        if (taintKey(next) !== taintKey(prev)) { this.resolved.set(c.resolver, next); this.changed = true; }
        continue;
      }
      if (c.rejecter) { this.addThrown(everyParam ?? args[0] ?? clean()); continue; }
      if (c.evaluator) { this.evaluated(fns, node, fn); continue; }
      if (c.bound) {
        // A bound function calls its target with the bound arguments FIRST (round 9).
        // (A bound function re-bound into itself — `b = b.bind(null, 1)` read
        // flow-insensitively — shifts its arguments without bound on re-entry:
        // there every parameter receives every argument, fail closed.)
        const info = this.boundInfo.get(c.cid);
        if (info && info.targets.size > 0) {
          const reentry = this.boundActive.has(c.cid);
          const pre = info.pre.map((p) => p ?? clean());
          if (!reentry) this.boundActive.add(c.cid);
          try {
            const targets = reentry ? this.unbound(info.targets) : info.targets;
            parts.push(everyParam || reentry
              ? this.applyFns(targets, [], join(everyParam ?? clean(), ...pre, ...args), node, fn)
              : this.applyFns(targets, [...pre, ...args], undefined, node, fn));
          } finally { if (!reentry) this.boundActive.delete(c.cid); }
        }
        continue;
      }
      if (c.host) { parts.push(this.hostCall(c.host, everyParam ? [everyParam] : args, node, fn)); continue; }
      if (argsObj === undefined && c.node && c.node.type !== "ArrowFunctionExpression") argsObj = this.argumentsObject(args, everyParam);
      const inst = this.instanceFor(c, args, everyParam, argsObj);
      if (!inst) continue;
      parts.push(inst.stat.isGen ? containerOf(join(inst.yields, inst.ret)) : inst.ret);
    }
    return join(...parts);
  }

  /**
   * A call into code the compile does not contain (a stdlib / npm import).
   * FAIL CLOSED: everything protected the arguments carry comes out protected,
   * unless the callee is an allowlisted DERIVER (a one-way digest / boolean).
   */
  private hostCall(host: { source: string; imported: string }, args: Taint[], node: any, fn: Instance | null): Taint {
    // An allowlisted stdlib deriver is the compiler's own code, and it never
    // calls a function argument: it is not handed to the opaque-callback
    // over-approximation (a coercion hook on an argument is covered where the
    // hook was stored — `storeFns`). Round 7: applying every function the
    // field-insensitive model believes `passwordArg` might be (examples/23's
    // request body aliases the request, which holds the session object) with the
    // hash, inside `verifyPassword`, wrote the hash into the session through
    // `this` — the round-6e false positive on the login.
    if (isStdlibDeriver(host.source, host.imported, node, args)) return clean();
    const cb = this.opaqueCallbacks(null, args, node, fn);
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
    if (stdlibModuleOf(host.source) !== "data") return null;
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
    let cb = path !== null && LANGUAGE_COERCIONS.has(path) ? clean() : this.opaqueCallbacks(null, args, node, fn);
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
          row: { tags: new Set([id]), cols: new Set(cols === "*" ? [] : cols), all: cols === "*", revealed: new Set(), paths: new Set([ROW_SELF]) },
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
      if (name === "_scrml_db_guard" || name === "_scrml_db_request_scope") {
        // §19.10.6 (S449) — the transaction-mutex runtime (codegen/sql-tx-guard.ts),
        // modelled exactly rather than walked: `_scrml_db_guard(handle, …)` forwards
        // every query to `handle` and returns its results unchanged, and
        // `_scrml_db_request_scope(handler)` calls `handler` with the same arguments
        // and returns its result unchanged — both are the identity on data. Walking
        // them is not just slow but pathological: their Proxy + closure + queue body
        // took the fixpoint from milliseconds to ~140 s per compile (measured).
        return args[0] ?? clean();
      }
      if (isModelledHelperName(name)) {
        // `_scrml_tenant_redact(v, t)` / `_scrml_tenant_scope(rows, …)` preserve the
        // protect descriptor on survivors (§14.8.10 composes inside §14.8.9).
        return args[0] ?? clean();
      }
    }

    // --- method calls ----------------------------------------------------------
    if (callee.type === "MemberExpression" || (callee.type === "ChainExpression" && callee.expression.type === "MemberExpression")) {
      const m = callee.type === "ChainExpression" ? callee.expression : callee;
      const path = this.globalPath(m, scope);
      const store = node.type === "CallExpression" ? this.sessionStoreOf(m, scope) : null;
      if (store !== null) return this.sessionStoreCall(store, m, args, node, fn);
      // S449 round 9 — a function the PROGRAM stored on a global path is applied
      // BEFORE any built-in model of that path returns (when the call matters): the
      // built-in may have been replaced through a route the platform-write rule
      // cannot name (`function patch(J) { J.stringify = f } patch(JSON)` served the
      // hash on base — the SERIALIZING model returned first). Unnamed stores reach
      // every global call; named ones the calls that name them (`globalCandidates`).
      const recvEarly = path !== null ? this.evalExpr(m.object, scope, fn) : null;
      let pathOwn = clean();
      if (path !== null) {
        const cands = this.globalCandidates(new Set(), this.pathNames(path));
        if (cands.size > 0 && this.globalCallMatters(args)) {
          this.recordThis(cands, recvEarly ?? clean());
          pathOwn = this.applyFns(cands, args, undefined, node, fn);
        } else if (cands.size > 0) {
          // Not applied (nothing protected or callable is passed) — but what they
          // RETURN is still the call's result (r9 re-review: see `retsOf`).
          pathOwn = this.retsOf(cands);
        }
      }
      if (path === "Response.json") {
        this.sink(args[0] ?? clean(), fn, "serializer-json");
        for (const a of args.slice(1)) this.sink(a, fn, "serializer");
        return pathOwn;
      }
      if (path === "Response.redirect") {
        for (const a of args) this.sink(a, fn, "serializer");
        return pathOwn;
      }
      if (path === "Array.from" && args[1] && this.hasCallable(args[1])) {
        // `Array.from(rows, r => r.passwordHash)` — the mapper is a `.map`.
        return join(pathOwn, this.callbackMethod("map", args[0] ?? clean(), [args[1]], node, fn));
      }
      if (path === "Promise.reject") {
        this.addThrown(args[0] ?? clean());
        return pathOwn;
      }
      if (path === "Object.defineProperty" || path === "Reflect.defineProperty") {
        // The descriptor's `value` / getter become a field of the target, and a
        // redefinition by an unreadable key may HIDE a column marker (a
        // non-enumerable marker is dropped by the next spread) — L4.
        const desc = args[2] ?? clean();
        // A getter / setter / value function runs with `this` = the target (6e, round 7).
        const got = this.storeDescriptors(desc, args[0] ?? clean(), node, fn, this.literalKey(node.arguments[1], scope));
        const written = anyDepth(containerOf(join(desc, got, keyOnly(args[1] ?? clean()))));
        if (this.isGlobalObject(args[0] ?? clean())) this.globalRebind(this.literalKey(node.arguments[1], scope), node, fn);
        this.writeThrough(node.arguments[0], args[0] ?? clean(), written, scope, { node, fn });
        if (this.literalKey(node.arguments[1], scope) === null) this.markerRemoved(node.arguments[0], args[0] ?? clean(), node, fn, scope);
        return join(pathOwn, args[0] ?? clean(), written);
      }
      if (path === "Object.defineProperties" || path === "Reflect.set" || path === "Reflect.deleteProperty") {
        // Keys and values of the second argument (or the key + value) are written
        // into the target; a redefinition / removal by an unreadable key may
        // drop a column marker (L4). A function among them runs with `this` = the target (6e).
        const got = path === "Reflect.set"
          ? this.storeFns(ownOf(args[2] ?? clean()), args[0] ?? clean(), node, fn, this.literalKey(node.arguments[1], scope))
          : this.storeDescriptors(args[1] ?? clean(), args[0] ?? clean(), node, fn, null);
        const written = anyDepth(path === "Object.defineProperties"
          ? containerOf(join(args[1] ?? clean(), got))
          : containerOf(join(keyOnly(args[1] ?? clean()), args[2] ?? clean(), got)));
        if (path !== "Reflect.deleteProperty" && this.isGlobalObject(args[0] ?? clean())) {
          this.globalRebind(path === "Reflect.set" ? this.literalKey(node.arguments[1], scope) : null, node, fn);
        }
        this.writeThrough(node.arguments[0], args[0] ?? clean(), written, scope, path === "Reflect.deleteProperty" ? undefined : { node, fn });
        if (path === "Object.defineProperties" || (path === "Reflect.deleteProperty" && this.literalKey(node.arguments[1], scope) === null)) {
          this.markerRemoved(node.arguments[0], args[0] ?? clean(), node, fn, scope);
        }
        return path === "Object.defineProperties" ? join(pathOwn, args[0] ?? clean(), written) : pathOwn;
      }
      if (path !== null) {
        const b = this.builtin(path, args, node, fn);
        if (b) return join(pathOwn, b, this.opaqueCallbacks(null, args, node, fn));
        if (DERIVER_CALLS.has(path)) {
          this.opaqueCallbacks(null, args, node, fn); // side effects only: the result is derived
          return pathOwn;
        }
      }
      const recv = recvEarly ?? this.evalExpr(m.object, scope, fn);
      let method: string | null = null;
      if (m.computed) { this.evalExpr(m.property, scope, fn); method = staticKey(m.property); }
      else if (m.property.type === "Identifier") method = m.property.name;

      // Bytes leaving the server: a channel publish, an SSE chunk, a WS send.
      const sinkArg = method === "publish" ? 1 : (method === "enqueue" || method === "send") ? 0 : -1;
      if (sinkArg >= 0) this.sink(args[sinkArg] ?? clean(), fn, "serializer");

      // `res.call(x, h)` / `res.apply(x, [h])` on a parameter: what it is handed.
      if (method === "call" && args.length > 1) this.recordParamCall(m.object, join(...args.slice(1)), scope);
      if (method === "apply" && args[1]) this.recordParamCall(m.object, elemOf(args[1]), scope);
      if ((method === "call" || method === "apply") && this.mayBePlatformFunction(recv) && node.arguments[0] && node.arguments[0].type !== "SpreadElement") {
        // Round 8: `Array.prototype.push.call(arr, u)` — a PLATFORM method run
        // with an explicit receiver may write its arguments INTO it (push,
        // splice, set, Object.assign …); which one is not followed: fail closed.
        const written = method === "call" ? join(...args.slice(1)) : elemOf(args[1] ?? clean());
        this.writeThrough(node.arguments[0], args[0] ?? clean(), anyDepth(containerOf(written)), scope, { node, fn });
      }
      // `f.call(x, …)` / `f.apply(x, list)` / `f.bind(x, …)` — the functions the
      // receiver may BE, run as the platform's call / apply / bind would. S449
      // round 9: a receiver read from the GLOBAL heap holds every function ever
      // stored there — that is not a model of the receiver. Round 8 applied all of
      // them as `Reflect`'s own and returned, so `Reflect.apply(globalThis.arr[0],
      // null, [u])` never called the element (served the hash on base). Now only
      // the functions stored under a name the receiver was read through are its
      // candidates (when the call matters), and the call ALSO takes the platform
      // model below — the receiver may be a built-in, with another signature.
      let selfCall = clean();
      if ((method === "call" || method === "apply" || method === "bind") && this.hasCallable(recv)) {
        const recvIsGlobal = path !== null || this.isGlobalValue(recv);
        // (r9 fix round R2: `bind` CALLS nothing — the arguments that matter are those of
        // the later call of what it returns, so its candidates are never gated on its
        // own arguments. Gated, `globalThis.a.f.bind({})` came back function-less and
        // `b(u.passwordHash)` served the hash — main rejected it.)
        const selfFns = !recvIsGlobal ? recv.fns
          : method === "bind" || this.globalCallMatters(args) ? this.globalCandidates(recv.fns, this.calleeNames(m.object, recv, scope)) : new Set<Closure>();
        if (selfFns.size > 0) {
          // The first argument IS `this` (round 7: `stash.call(u)` writing `this.x`).
          this.recordThis(selfFns, args[0] ?? clean());
          if (method === "call") selfCall = this.applyFns(selfFns, args.slice(1), undefined, node, fn);
          // `f.apply(this, list)`: every parameter may receive any list element.
          else if (method === "apply") selfCall = this.applyFns(selfFns, [], elemOf(args[1] ?? clean()), node, fn);
          // `f.bind(o, a, b)` is a function that calls `f(a, b, …)` (round 9: see `bindFns`).
          else selfCall = this.bindFns(selfFns, args.slice(1), node);
        }
        if (!recvIsGlobal) return selfCall;
      }

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
      // `client.begin((tx) => …)` — `tx` is the client's transaction handle.
      if (method === "begin" && this.isSqlClient(m.object, scope)) {
        const cbNode = node.arguments[0];
        if (isFnNode(cbNode) && cbNode.params[0]?.type === "Identifier") this.sqlParams.set(cbNode, cbNode.params[0].name);
      }
      // A method stored in an object the compile built (`api.f(x)`), or a
      // function value reached through a host namespace.
      const viaField = this.memberRead(recv, method, method === null, node, fn);
      // Round 9: `x.constructor(…)`, `globalThis.eval(…)`, `Function.call(…)` — the code evaluators.
      if (method === "constructor" || (method !== null && CODE_EVALUATORS.has(method))) this.evaluated(viaField.fns, node, fn);
      if (method === "call" || method === "apply" || method === "bind") this.evaluated(ownOf(recv), node, fn);
      // A method reached from the GLOBAL heap (`Math.abs(…)`, `process.env.x.trim()`,
      // `const O = Object; O.keys(…)`) is a platform API — unless a function was
      // stored in a global under a name on its path (`globalThis.clamp(…)`), which
      // is applied (only when protected data is passed) and whose returns join
      // the result. See `globalFnsByName`.
      const recvGlobal = path !== null || this.isGlobalValue(recv);
      // The global names the call reaches functions under (round 8): the spelled
      // path, or the names the receiver was read through — null when they
      // cannot be named (then every function it holds is a candidate).
      // (An index is an element, not a name: `globalThis.fs[0](u)` — unknown.)
      // (An element — an index, a computed key such as `[Symbol.iterator]` — is not a name: unknown.)
      const gNames: Set<string> | null = method === null || /^\d+$/.test(method) ? null
        : path !== null ? this.pathNames(path) : recvGlobal ? this.globalNames(recv, [method]) : null;
      // S447 round 7 — a function the compile stored on the receiver is CALLED,
      // with `this` = the receiver, WHATEVER its name: a user method named like a
      // built-in (`o.set(u)`, `o.map(f)`, `o.get(k)`) used to take the built-in's
      // model only, and `o.set = function (r) { this.h = r.passwordHash };
      // o.set(u); return o` served the hash (measured). The built-in model below
      // still applies on top (the receiver may be a real Map / array).
      //
      // S447 round 8 — and so for a receiver in the GLOBAL heap: round 7 skipped
      // the stored-function call there and reached a global function only from
      // the generic global block AFTER the built-in models returned, so `const g =
      // globalThis.box; g.set(u)` was modelled as a Map write alone and served the
      // hash (measured on base and round 7; `g.map(u)`, `g.forEach(u)` the same).
      // Every global value holds every global-stored function (one heap), so the
      // candidates are those stored under a name the call reaches (`gNames`);
      // applied only when protected data is passed, as before (perf).
      let own = join(pathOwn, selfCall);
      if (this.hasCallable(viaField) || recvGlobal) {
        // r9 re-review: a global receiver's candidates the call does not apply (no
        // protected or callable argument — the round-6b perf gate) still contribute
        // what they RETURN. Before, only the "any other method" path joined them, so
        // a program-stored method named like a built-in (`get`, `set`, `push`, `map`
        // …) returned nothing: `store.get = function (k) { return u.passwordHash };
        // store.get("k")` served the hash with the store in the global heap.
        const matters = !recvGlobal || this.globalCallMatters(args);
        const all = recvGlobal ? this.globalCandidates(viaField.fns, gNames) : viaField.fns;
        if (!matters && all.size > 0) own = join(own, this.retsOf(all));
        const cands = matters ? all : new Set<Closure>();
        if (cands.size > 0) {
          // `new o.F(…)` constructs; `o.m(…)` runs with `this` = the receiver.
          if (node.type === "NewExpression") own = join(own, this.construct(cands, args, node, fn));
          else {
            this.recordThis(cands, recv);
            own = join(own, this.applyFns(cands, args, undefined, node, fn));
          }
        }
      }

      if (method !== null && CALLBACK_METHODS.has(method)) {
        const res = this.callbackMethod(method, recv, args, node, fn);
        // Round 9 — a callback the compiler cannot see into (a host function, a
        // function a platform call made: `Function.prototype.call.bind(…)`) is
        // handed each ELEMENT (and the `thisArg`): it may call any function among
        // them with anything it holds (the unknown-callee rule, L1).
        const cb = args[0] ?? clean();
        const l1 = [...cb.fns].some((f) => !f.host) ? clean() : this.opaqueCallbacks(recv, [...args, elemOf(recv)], node, fn);
        const species = SPECIES_METHODS.has(method) ? this.speciesResult(recv, elemOf(res), node, fn) : clean();
        return join(own, res, l1, species);
      }

      if (method !== null && MUTATING_METHODS.has(method)) {
        // `m.set(k, v)` stores the KEY too (N1) — and a `Map` holds the key VALUE
        // itself, not its string form: `keys()`, `entries()` and iteration hand back
        // the very object / function (S449 round 9: `m.set(f, 1); for (const [g] of
        // m) g(u)` served the hash — the key was kept as labels only).
        const written = method === "set" ? join(args[0] ?? clean(), args[1] ?? clean()) : method === "splice" ? join(...args.slice(2)) : join(...args);
        // An ELEMENT position (round 8 — see `globalFnsSlot`).
        const prevSlot = this.slotWrite;
        this.slotWrite = true;
        try { this.writeThrough(m.object, recv, containerOf(written), scope, { node, fn }); } finally { this.slotWrite = prevSlot; }
        if (method === "splice") own = join(own, this.speciesResult(recv, elemOf(recv), node, fn));
        const cbm = this.opaqueCallbacks(path === null ? recv : dataOnly(recv), args, node, fn); // `store.update(fn)` calls it
        return method === "push" || method === "unshift" ? join(own, cbm) : join(own, recv, containerOf(written), cbm);
      }
      let r = own;
      // L1 — a method the analysis has no model for may call any function it is
      // handed (a compile-defined method is walked exactly instead, above).
      if (recvGlobal || !this.hasCallable(viaField)) r = join(r, this.opaqueCallbacks(recvGlobal ? dataOnly(recv) : recv, args, node, fn));
      // L4 — reflection reached from the global heap may remove a row's marker.
      if (recvGlobal) this.reflectionMayRemoveMarkers(args, node, fn, scope);

      // S449 round 9 — an element-returning built-in hands back the receiver's
      // ELEMENTS, functions and alias cells included (an element of a global
      // collection IS a global-heap value, reached by no name — `elemOf` sets
      // `gnAny`), plus what its arguments place in the result. A computed method
      // key may name any method (fail closed). See `ELEMENT_RESULT_METHODS`.
      if (method === null || ELEMENT_RESULT_METHODS.has(method)) {
        const placed = args.map((a) => join(a, elemOf(a)));
        const els = join(elemOf(recv), ...placed);
        r = join(r, anyDepth(containerOf(els)));
        if (method === null || SPECIES_METHODS.has(method)) r = join(r, this.speciesResult(recv, els, node, fn));
      }
      // …and one that returns the receiver itself IS the receiver.
      if (method !== null && RECEIVER_RESULT_METHODS.has(method)) r = join(r, recv);

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
      // (Round 8: it may hand back the receiver or ANY part of it — the row at any depth.)
      const out: Taint = { row: rowAnywhere(recv.row), scalar: new Map(recv.scalar), deep: new Map(recv.deep), fns: new Set() };
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
      return recvGlobal ? join(r, out, this.globalFnRetFor(gNames)) : join(r, out);
    }

    // --- plain calls -------------------------------------------------------------
    const ct = this.evalExpr(callee, scope, fn);
    this.evaluated(ct.fns, node, fn);
    if (callee.type === "Identifier" && args.length > 0) this.recordParamCall(callee, join(...args), scope);
    const path = this.globalPath(callee, scope);
    // A GLOBAL callee may be a function something stored in the global heap
    // (L3) — applied — but it is also the platform built-in of that name, which
    // keeps its own (fail-closed) model below.
    const gfPlain = path !== null ? this.globalFnsFor(path.split(".")) : null;
    const viaGlobal = gfPlain !== null && gfPlain.size > 0 && this.globalCallMatters(args)
      ? this.applyFns(gfPlain, args, undefined, node, fn)
      : null;
    if (path === null && this.hasCallable(ct)) {
      return node.type === "NewExpression" ? this.construct(ct.fns, args, node, fn) : this.applyFns(ct.fns, args, undefined, node, fn);
    }
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
      if (b) return LANGUAGE_COERCIONS.has(path) ? b : join(b, this.opaqueCallbacks(null, args, node, fn));
      // L4 — an unmodelled global (reflection) handed a row may remove a marker.
      if (!DERIVER_CALLS.has(path)) this.reflectionMayRemoveMarkers(args, node, fn, fn?.scope ?? this.curMod!.scope);
      // S449 round 9 — an unmodelled platform CONSTRUCTOR may keep what it is
      // handed (`new WeakRef(o)`, `new WeakSet([o])`, an error's `cause`): the new
      // object holds its arguments — functions and alias cells included — and
      // hands them back (`w.deref().m(u)` served the hash: the result held none).
      if (node.type === "NewExpression" && !DERIVER_CALLS.has(path)) {
        return join(this.unknownCall(path, args, node, fn), lenDefault(containerOf(join(...args))));
      }
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
    // A HOST function handed to a host call is not re-applied: what it could
    // return is already the outer call's fail-closed result (every protected
    // label of the same values), and re-applying it recursed without bound —
    // `import { a, b } from "lib"; a(b)` overflowed the stack (round 7, measured
    // on base: the compile crashed).
    for (const a of args) for (const f of a.fns) if (!f.host) fns.add(f);
    if (fns.size === 0) return clean();
    const all = join(...(recv ? [recv] : []), ...args);
    // Code the compiler has no model for may call them with any `this` it holds
    // (an array method's `thisArg`, `Reflect.apply(f, o, …)`) — round 7.
    this.recordThis(fns, all);
    const every = everything(all, `${this.site(node, fn)} — handed to a callback of code the compiler has no model for`);
    const param: Taint = {
      row: rowAnywhere(all.row), // any part of anything the callee holds (round 8)
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
  /**
   * S447 round 7 — `this` is the RECEIVER. Every route by which a function can
   * be handed a receiver records it here, per function node (context-insensitive,
   * fail closed — the union of every receiver it may run with):
   *   - stored on an object (`o.f = function …`, an object-literal method /
   *     accessor, a `defineProperty` descriptor, `Object.assign`) — see `storeFns`;
   *   - a method call `recv.m(…)` — the receiver of the call;
   *   - `f.call(x, …)`, `f.apply(x, …)`, `f.bind(x)` — `x`;
   *   - an array callback's `thisArg` (`rows.forEach(fn, x)`);
   *   - any invocation by code the compiler has no model for (a host / platform
   *     callee may pass any value it holds as `this`) — see `opaqueCallbacks`;
   *   - `new F(…)` — the fresh object (an allocation cell) — see `construct`.
   * The recorded value KEEPS its alias cells (and its function values), so a READ
   * through `this` sees everything written into the receiver, and a WRITE through
   * `this` (`this.x = h`) lands in the receiver's alias class exactly as `o.x = h`
   * does. It never UNITES classes: `this` is not a binding, so nothing is merged —
   * the round-6e attempt that aliased `this` to its object unified the compiler's
   * own session object with every protected value (a false E-PROTECT-006 on
   * examples/23's login). Round 6e modelled reads only; measured at round 7,
   * `u.stash = function () { this.x = this.passwordHash }; u.stash(); return u` and
   * `o.set = function (r) { this.h = r.passwordHash }; o.set(u); return o` served
   * the hash through the response, `/__mountHydrate` and the SSR state script.
   */
  private recordThis(fns: Set<Closure>, obj: Taint): void {
    if (fns.size === 0) return;
    let data: Taint | null = null;
    let key = "";
    for (const c of fns) {
      if (!c.node) continue;
      // An arrow has no `this` of its own (it reads its enclosing function's).
      if (c.node.type === "ArrowFunctionExpression") continue;
      if (data === null) {
        data = { ...dataOnly(obj), fns: new Set(obj.fns) };
        if (obj.refs && obj.refs.size > 0) data.refs = new Set(obj.refs);
        key = taintKey(data);
      }
      // Each distinct receiver is recorded once per function; the union is
      // formed when `this` is read (`thisTaint`).
      let seen = this.thisSeen.get(c.node);
      if (!seen) { seen = new Map(); this.thisSeen.set(c.node, seen); }
      if (seen.has(key)) continue;
      seen.set(key, data);
      this.thisOf.delete(c.node);
      this.changed = true;
    }
  }
  /** Every distinct receiver recorded per function node (key -> value). */
  private thisSeen = new Map<any, Map<string, Taint>>();
  /** `this` inside the walked function (an arrow's is its enclosing function's). */
  private thisTaint(fn: Instance | null): Taint {
    let node = fn?.stat.node ?? null;
    while (node && node.type === "ArrowFunctionExpression") node = this.fnParent.get(node) ?? null;
    if (!node) return clean();
    let t = this.thisOf.get(node);
    if (!t) {
      const seen = this.thisSeen.get(node);
      if (!seen) return clean();
      t = join(...seen.values());
      this.thisOf.set(node, t);
    }
    return this.withCellContents(t);
  }

  /** `t` joined with everything written into the alias classes it may be (a read of the object). */
  private withCellContents(t: Taint): Taint {
    // Each alias CLASS once (round 8, perf: a value whose cells have all been
    // united — a long chain of objects — joined the same class N times).
    const roots = new Set<string>();
    for (const k of refsOf(t)) roots.add(this.find(k));
    const parts: Taint[] = [{ ...t, refs: t.refs ? new Set(t.refs) : undefined }];
    for (const root of roots) {
      const w = this.classWrites.get(root);
      if (w) parts.push(w);
    }
    if (parts.length === 1) return parts[0];
    const out = join(...parts);
    // Contents do not change the object's prototype (r9 fix round).
    if (t.pproto) out.pproto = true; else delete out.pproto;
    return out;
  }

  /** An allocation-site alias cell (an object the program creates at `node`). */
  private allocCell(kind: string, node: any): string {
    return `\u0000${kind}:${this.curMod!.idx}:${node.start}`;
  }

  /**
   * S447 round 7 — a function STORED ON AN OBJECT may be invoked by the LANGUAGE,
   * with `this` = the object, wherever the object is used: a coercion hook
   * (`toString`, `valueOf`, `[Symbol.toPrimitive]` — a template, `+`, `String()`,
   * a computed key), an iterator (`[Symbol.iterator]`, and the `next` of the
   * iterator it returns — spread, `for…of`, destructuring, `yield*`), an
   * accessor (a getter on read or spread, a setter on write), `toJSON` (the
   * serializer). The rule is the mechanism, not a list of shapes: a function
   * stored where the language may call it — under a key in
   * `LANGUAGE_INVOKED_KEYS`, as an accessor, or under a key the compiler cannot
   * read (every Symbol hook is a computed key; aliasing `Symbol` cannot escape
   * this) — is analysed as so invoked: `this` = the object, its parameters
   * receive everything the object holds (whatever is written into it — what a
   * setter is handed), and what it returns is part of the object. A coercion,
   * iteration or spread of the object therefore yields its hooks' results
   * through the ordinary container rules. Every stored function, hook or not,
   * gets the object as a `this` (`recordThis`). A thenable's `then` is resolved
   * where the language resolves it — `settle`. Measured before round 7
   * (served): `` `${{ toString: () => h }}` ``, `o + 0` with a `valueOf`,
   * `[...{ [Symbol.iterator]: function* () { yield h } }]`, `for…of` and
   * `const [a] = o` over it each shipped the value.
   *
   * Returns what the object gains (the hooks' returns, as contents).
   */
  private storeFns(fns: Set<Closure>, obj: Taint, node: any, fn: Instance | null, key: string | null, accessor = false): Taint {
    if (fns.size === 0) return clean();
    this.recordThis(fns, obj);
    if (key === null || key === "then") this.addAll(this.thenFns, fns);
    if (!accessor && !mayBeInvokedByLanguage(key)) return clean();
    this.addAll(this.hookFns, fns);
    if (!accessor) return this.invokeHooks(fns, obj, node, fn);
    // r8b: an ACCESSOR's return IS the property's value — a function it returns
    // is a function stored under that key: callable as a method (`o.m(u)` with
    // `get m() { return function (r) { … } }`) and, under a key the language
    // may call (`toString` …), a hook in its own right. Both served the hash on
    // base and round 8 (the getter's return was kept as data only).
    const param = anyDepth(dataOnly(this.withCellContents(obj)));
    const ret = this.applyFns(fns, [], param, node, fn);
    let gained = anyDepth(containerOf(dataOnly(ret)));
    const retFns = new Set<Closure>();
    for (const f of ownOf(ret)) if (!fns.has(f)) retFns.add(f);
    if (retFns.size > 0) {
      gained = join(gained, { ...clean(), fns: retFns, own: new Set() });
      gained = join(gained, this.storeFns(retFns, obj, node, fn, key, false));
    }
    return gained;
  }

  /**
   * THE descriptor path (r8c): a property-descriptor (or a map of them) applied to
   * `target` — `Object.defineProperty` / `Reflect.defineProperty` (one key),
   * `Object.defineProperties` and `Object.create`'s second argument (any key).
   * Every function a descriptor holds — `get`, `set`, `value` — is stored as an
   * accessor would be: `this` = the target, invoked as the language would, and a
   * function a getter RETURNS is stored under the key in its own right.
   */
  private storeDescriptors(descs: Taint, target: Taint, node: any, fn: Instance | null, key: string | null): Taint {
    return this.storeFns(descs.fns, target, node, fn, key, true);
  }

  /**
   * A COPY of an object's properties (`{ ...src }`, `Object.assign(o, src)`)
   * keeps each function under the key it had: it adds no new hook, but every
   * hook it copies now runs with `this` = the copy (`{ ...proto, secret: h }`
   * whose `toString` reads `this.secret`).
   */
  private copyFns(fns: Set<Closure>, obj: Taint, node: any, fn: Instance | null): Taint {
    const hooks = new Set<Closure>();
    for (const c of fns) if (this.hookFns.has(c)) hooks.add(c);
    if (hooks.size === 0) return clean();
    this.recordThis(hooks, obj);
    return this.invokeHooks(hooks, obj, node, fn);
  }

  /** Invoke `hooks` as the language would, with `this` = `obj`: their returns are part of `obj`. */
  private invokeHooks(hooks: Set<Closure>, obj: Taint, node: any, fn: Instance | null): Taint {
    // The parameters receive anything the object holds, and the returns are
    // part of the object — at a position the analysis does not follow (round 8).
    const param = anyDepth(dataOnly(this.withCellContents(obj)));
    return anyDepth(containerOf(dataOnly(this.applyFns(hooks, [], param, node, fn))));
  }

  private addAll(into: Set<Closure>, fns: Set<Closure>): void {
    for (const c of fns) if (!into.has(c)) { into.add(c); this.changed = true; }
  }

  /** Functions stored where the language may invoke them (see `LANGUAGE_INVOKED_KEYS`). */
  private hookFns = new Set<Closure>();

  /**
   * What each function passes to calls of its own PARAMETERS (per function
   * node): for a thenable's `then(resolve, reject)` that is exactly what the
   * `await` evaluates to. Recorded where the call is written (`res(h)`, an
   * inner arrow calling it, `res.call(…)`), so no stand-in function value is
   * threaded through the program — one per `await` site was measured to spread
   * through examples/23's session object and not finish in 100 s.
   */
  private paramCallArgs = new Map<any, Taint>();
  private recordParamCall(callee: any, args: Taint, scope: Scope): void {
    if (callee?.type !== "Identifier") return;
    const s = this.resolve(callee.name, scope);
    if (!s || s.parent === null) return;
    const fnNode = this.fnOfNames.get(s.names);
    if (!fnNode || !fnNode.params.some((p: any) => p.type === "Identifier" && p.name === callee.name)) return;
    const prev = this.paramCallArgs.get(fnNode) ?? clean();
    const next = join(prev, args);
    if (taintKey(next) !== taintKey(prev)) { this.paramCallArgs.set(fnNode, next); this.changed = true; }
  }

  /**
   * `await v` (and each element of `for await`) — the language RESOLVES a
   * thenable: it calls `v.then(resolve, reject)` with `this` = `v`, and the
   * result is what `then` passes to `resolve`. Every function `v` holds that may
   * be its `then` (`thenFns`: stored under `then` or under a key the compiler
   * cannot read) contributes what it passes to its parameters. A resolution to
   * another thenable resolves again.
   */
  private settle(v: Taint): Taint {
    let out = v;
    const seen = new Set<Closure>();
    for (let depth = 0; depth < 4; depth++) {
      const hooks = new Set<Closure>();
      for (const c of out.fns) if (this.thenFns.has(c) && !seen.has(c)) { hooks.add(c); seen.add(c); }
      if (hooks.size === 0) break;
      this.recordThis(hooks, out);
      let got = clean();
      for (const c of this.unbound(hooks)) { const a = this.paramCallArgs.get(c.node); if (a) got = join(got, a); }
      out = join(out, got);
    }
    return out;
  }
  /**
   * Functions stored under `then` or under a key the compiler cannot read —
   * the only ones `await` may call as a thenable's `then`.
   */
  private thenFns = new Set<Closure>();

  /**
   * `new F(…)` of a function the analysis holds: `F` runs with `this` = a fresh
   * object (an allocation cell per `new` site), and the result is that object
   * (or what `F` returns). Measured before round 7: `const F = function (r) {
   * this.h = r.passwordHash }; return new F(u)` served the hash.
   */
  private construct(fns: Set<Closure>, args: Taint[], node: any, fn: Instance | null): Taint {
    const cell = this.allocCell("new", node);
    // The fresh object is not a function, and — when every constructor is one the
    // program made — its prototype is that function's `.prototype` (r9 fix round).
    const inst: Taint = { ...clean(), refs: new Set([cell]), own: new Set() };
    if ([...fns].every((c) => !!c.node)) inst.pproto = true;
    this.recordThis(fns, inst);
    const ret = this.applyFns(fns, args, undefined, node, fn);
    return join(this.withCellContents(inst), ret);
  }

  /** The global names a call through `objNode` (whose value is `t`) reaches functions under. */
  private calleeNames(objNode: any, t: Taint, scope: Scope): Set<string> | null {
    const p = this.globalPath(objNode, scope);
    return p !== null ? this.pathNames(p) : this.globalNames(t, []);
  }

  /**
   * S449 round 9 — `f.bind(thisArg, a, b)` with leading arguments is a NEW
   * function that calls `f(a, b, …rest)`. Round 8 returned `f` itself, so a later
   * `bound(h)` bound `h` to `f`'s FIRST parameter, not its third: `const g =
   * function (y, x) { s = x }; g.bind({}, 1)(u.passwordHash)` served the hash (all
   * three sinks, measured on base; also handed to a global callee). The bound
   * function is a pseudo-closure, one per `bind` site: applied, it prepends the
   * bound arguments (each position the join of every value bound there).
   */
  private boundInfo = new Map<number, { targets: Set<Closure>; pre: Taint[] }>();
  private boundActive = new Set<number>();
  private bindFns(fns: Set<Closure>, pre: Taint[], node: any): Taint {
    if (pre.length === 0) return { ...clean(), fns: new Set(fns) };
    const key = `bound:${this.curMod!.idx}:${node.start}`;
    let c = this.closures.get(key);
    if (!c) {
      c = { cid: this.cidSeq++, bound: true };
      this.closures.set(key, c);
      this.boundInfo.set(c.cid, { targets: new Set(), pre: [] });
    }
    const info = this.boundInfo.get(c.cid)!;
    for (const f of fns) if (!info.targets.has(f)) { info.targets.add(f); this.changed = true; }
    pre.forEach((p, i) => {
      const prev = info.pre[i] ?? clean();
      const next = join(prev, p);
      if (taintKey(next) !== taintKey(prev)) { info.pre[i] = next; this.changed = true; }
    });
    return { ...clean(), fns: new Set([c]) };
  }
  /** The functions behind `fns`, every bound function replaced (transitively) by what it calls. */
  private unbound(fns: Set<Closure>): Set<Closure> {
    if (![...fns].some((f) => f.bound)) return fns;
    const out = new Set<Closure>();
    const seen = new Set<number>();
    const stack = [...fns];
    while (stack.length > 0) {
      const c = stack.pop()!;
      if (!c.bound) { out.add(c); continue; }
      if (seen.has(c.cid)) continue;
      seen.add(c.cid);
      for (const t of this.boundInfo.get(c.cid)?.targets ?? []) stack.push(t);
    }
    return out;
  }

  /**
   * S449 round 9 — Array SPECIES (`SPECIES_METHODS`): the result is built by
   * `new receiver.constructor[Symbol.species](n)` and the elements are written
   * into what that returns. A function the receiver holds that the language may
   * call (`hookFns`: `Symbol.species` is a computed key) may be that constructor:
   * it is constructed, and every object it returns receives `elements`.
   */
  private speciesResult(recv: Taint, elements: Taint, node: any, fn: Instance | null): Taint {
    let hooks: Set<Closure> | null = null;
    for (const f of recv.fns) if (this.hookFns.has(f)) (hooks ??= new Set()).add(f);
    if (!hooks) return clean();
    const made = this.construct(hooks, [clean()], node, fn);
    const placed = anyDepth(containerOf(elements));
    for (const r of refsOf(made)) this.writeCell(r, placed);
    return made;
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

  /**
   * The compiler's own SQL client, by IDENTITY (not by name): a binding
   * initialized by `new SQL(…)` where `SQL` is the `bun` import, or the
   * transaction handle a `.begin((tx) => …)` callback on such a client receives.
   * Only these may be a tag the analysis holds no function for and still read
   * as a query (round 7).
   */
  private sqlClients = new Set<string>();
  private sqlParams = new Map<any, string>();
  private fnOfNames = new WeakMap<Set<string>, any>();
  private isSqlClient(tag: any, scope: Scope, depth = 0): boolean {
    if (tag?.type !== "Identifier") return false;
    const s = this.resolve(tag.name, scope);
    if (!s) return false;
    if (s.parent === null) {
      const imp = s.mod.imports.get(tag.name);
      if (imp) {
        const local = imp.target && depth < 8 ? imp.target.exports.get(imp.imported) : undefined;
        return local !== undefined && this.isSqlClient({ type: "Identifier", name: local }, imp.target!.scope, depth + 1);
      }
      return this.sqlClients.has(`${s.id}:${tag.name}`);
    }
    const fnNode = this.fnOfNames.get(s.names);
    if (fnNode && this.sqlParams.get(fnNode) === tag.name) return true;
    return this.sqlClients.has(`${s.id}:${tag.name}`);
  }
  /** `new SQL(…)` with `SQL` imported from `bun`. */
  private isSqlConstruction(init: any, scope: Scope): boolean {
    // §19.10.6 (S449) — every emitted handle is `_scrml_db_guard(<handle>, …)`, the
    // compiler's transaction-mutex wrapper (codegen/sql-tx-guard.ts). It forwards every
    // query to the handle it wraps, so it IS that client: see through it — by identity,
    // the module-scope compiler function, never a local of the same name.
    if (
      init?.type === "CallExpression" && init.callee?.type === "Identifier" &&
      init.callee.name === "_scrml_db_guard" && init.arguments?.length >= 1
    ) {
      const g = this.resolve(init.callee.name, scope);
      if (g && g.parent === null && !g.mod.imports.has(init.callee.name)) {
        return this.isSqlConstruction(init.arguments[0], scope);
      }
    }
    if (init?.type !== "NewExpression" || init.callee?.type !== "Identifier") return false;
    const s = this.resolve(init.callee.name, scope);
    if (!s || s.parent !== null) return false;
    const imp = s.mod.imports.get(init.callee.name);
    return !!imp && imp.source === "bun" && imp.imported === "SQL";
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
        // Round 8: …and those members' FUNCTIONS (`Reflect.get(o, "set")` is
        // the method; `Object.values(globalThis)[0].set(u)` calls a stored one).
        // Reached through a key list the compiler does not follow, so a global
        // member's names are unknown (fail closed).
        for (const a of args) for (const f of a.fns) r.fns.add(f);
        if (r.fns.size > 0 && args.some((a) => this.isGlobalValue(a))) r.gnAny = true;
        // Round 9: `Object.fromEntries` BUILDS an object whose keys come from data —
        // a function among the values is stored under a key the compiler cannot
        // read, which the language may call (`toString`, `valueOf`, a Symbol hook):
        // stored as such, `this` = the new object (an allocation cell).
        // (`Object.fromEntries([["toString", function () { s = this.h }], ["h", h]])`
        // then `String(o)` served the hash on base.)
        if (path === "Object.fromEntries" && r.fns.size > 0) {
          const cell = this.allocCell("fromEntries", node);
          r.refs = new Set([...refsOf(r), cell]);
          this.writeCell(cell, anyDepth(containerOf(dataOnly(r))));
          return this.withCellContents(join(r, this.storeFns(new Set(r.fns), r, node, fn, null)));
        }
      }
      return r;
    }
    if (path === "Reflect.apply" && node?.arguments?.[1] && node.arguments[1].type !== "SpreadElement" && this.mayBePlatformFunction(args[0] ?? clean())) {
      // Round 8: a platform function run with an explicit receiver may write its
      // arguments into it (`Reflect.apply(Array.prototype.push, arr, [u])`).
      this.writeThrough(node.arguments[1], args[1] ?? clean(), anyDepth(containerOf(elemOf(args[2] ?? clean()))), fn?.scope ?? this.curMod!.scope, { node, fn });
    }
    if (path === "Reflect.apply" && this.hasCallable(args[0] ?? clean())) {
      // Round 9: `Reflect.apply(f, thisArg, list)` CALLS `f` with `this` = thisArg
      // and every parameter any element of the list — exactly `f.apply(thisArg, list)`.
      // (`Reflect.apply(globalThis.arr[0], null, [u])` served the hash on base: the
      // `.apply` model took the global heap's functions as `Reflect`'s own.)
      this.recordThis(args[0].fns, args[1] ?? clean());
      return this.applyFns(args[0].fns, [], elemOf(args[2] ?? clean()), node, fn);
    }
    if (path === "Object.setPrototypeOf" || path === "Reflect.setPrototypeOf") {
      // `o` now INHERITS everything `p` holds, and every later write into `p`
      // is readable through `o` (`o.h` after `p.h = h`) — one alias class, and
      // `p`'s current contents are written into it (round 5, F4).
      const o = args[0] ?? clean();
      const p = args[1] ?? clean();
      // Round 9: re-parenting a built-in prototype hands every object of that kind
      // whatever the new parent holds (`Object.setPrototypeOf(Array.prototype, evil)`).
      if (o.plat) this.poison(node, fn, "re-parents a built-in prototype");
      for (const a of refsOf(o)) for (const b of refsOf(p)) this.unite(a, b);
      if (node?.arguments?.[0]) this.writeThrough(node.arguments[0], o, containerOf(p), fn?.scope ?? this.curMod!.scope);
      // The returned object reads through to `p` at any depth (round 8).
      return path === "Reflect.setPrototypeOf" ? clean() : join(o, anyDepth(containerOf(p)));
    }
    if (path === "Object.create") {
      // A fresh object whose prototype IS `p`: it reads through to `p`'s class —
      // `p`'s own properties are read off it at depth 0 (round 8: any depth).
      const proto = containerOf(args[0] ?? clean());
      // r9 fix round: its prototype is the PROGRAM's when `p` is (or `null`).
      const progProto = (node?.arguments?.[0]?.type === "Literal" && node.arguments[0].value === null) || this.isProgramObject(args[0] ?? clean());
      const mark = (t: Taint): Taint => { if (progProto) t.pproto = true; return t; };
      if (!args[1]) return mark(lenDefault(anyDepth(proto)));
      // r8c: the second argument is a property-DESCRIPTOR map, exactly as for
      // `Object.defineProperties` — its getters / setters / values are stored on
      // the new object (an allocation cell) through the one descriptor path, so
      // a getter-returned `toString` is a hook with `this` = the object. Round 8
      // read it as plain data and, with coercions no longer opaque, served
      // `Object.create({}, { toString: { get: () => function () { s = this.h } } … })`
      // (S239 re-review, measured over HTTP; base rejected it).
      const cell = this.allocCell("create", node);
      const obj: Taint = { ...clean(), refs: new Set([cell]) };
      const got = this.storeDescriptors(args[1], obj, node, fn, null);
      this.writeCell(cell, anyDepth(containerOf(join(args[1], got))));
      return mark(lenDefault(anyDepth(join(proto, this.withCellContents(obj)))));
    }
    if (path === "Object.getPrototypeOf" || path === "Reflect.getPrototypeOf") {
      // …and the prototype of an ordinary value IS a built-in's (round 9).
      // (r9 fix round R3: unless the program set it — `pproto`.)
      const pr = lenDefault(anyDepth(elemOf(args[0] ?? clean())));
      if (!args[0]?.pproto) pr.plat = true;
      return pr;
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
      // `Object.assign` copies every own enumerable property, each under its own
      // key — the hooks among them now run with `this` = the target.
      const got = this.copyFns(join(...args.slice(1)).fns, args[0] ?? clean(), node, fn);
      // Round 9: assigning onto the global object rebinds every key the sources carry.
      if (this.isGlobalObject(args[0] ?? clean())) {
        for (const src of node.arguments.slice(1)) {
          const keys = src?.type === "ObjectExpression" && src.properties.every((pr: any) => pr.type === "Property" && !pr.computed)
            ? src.properties.map((pr: any) => pr.key?.type === "Identifier" ? pr.key.name : staticKey(pr.key))
            : [null];
          for (const k of keys) this.globalRebind(k, node, fn);
        }
      }
      this.writeThrough(node.arguments[0], args[0] ?? clean(), containerOf(join(...args.slice(1), got)), fn?.scope ?? this.curMod!.scope, { node, fn });
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
      if (path === "Array.of" || path === "Array") return lenDefault(join(...args.map((a) => containerOf(a))));
      // A `Map` / `Set` built from entries holds each entry's VALUE one level up
      // from where the entries list held it — a position the analysis does not
      // follow (round 8: the row at any depth). The others hand back their
      // argument (`Object.freeze(o)`, `Promise.resolve(v)`, `Array.from(xs)`).
      if (path === "Map" || path === "Set" || path === "WeakMap" || path === "Object") return lenDefault(anyDepth(join(...args)));
      return lenDefault(join(...args));
    }
    return null;
  }

  private callbackMethod(method: string, recv: Taint, args: Taint[], node: any, fn: Instance | null): Taint {
    const cb = args[0] ?? clean();
    const el = elemOf(recv);
    let cbRet = clean();
    if (this.hasCallable(cb)) {
      // `rows.forEach(fn, thisArg)` — the second argument is the callback's `this`.
      if (args[1] && method !== "reduce" && method !== "reduceRight" && method !== "then" && method !== "catch" && method !== "finally") {
        this.recordThis(cb.fns, args[1]);
      }
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
        // Flattening moves the callbacks' array elements up a level (round 8).
        return anyDepth(containerOf(cbRet));
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
