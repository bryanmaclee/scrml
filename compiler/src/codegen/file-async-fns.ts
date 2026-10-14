/**
 * file-async-fns.ts — S466 r7 (g-imported-async-server-fn-not-awaited-s465, HIGH-A root fix).
 *
 * THE ONE answer to "which file-scope names does the SERVER emit / call async" for a file.
 *
 * SPEC §13.2: "An async-colored function is one the compiler emits `async`: a server
 * function, a Promise-returning standard-library function, or any function that
 * (transitively) calls one."
 *
 * Before r7 every server emitter ran its OWN fixpoint over its OWN subset of the file:
 * the ss1 value-export block over the EXPORTED functions only (so a non-exported helper
 * `function inner(p, h) { return verifyPassword(p, h) }` was never coloured and
 * `export function check` shipped `if (!inner(p, h))` — a Promise, always truthy: a wrong
 * password was accepted); the cross-module export analysis over every function but
 * without the file's server functions; codegen/index.ts's r6 binding pass over yet another
 * set. Each answered the same question differently.
 *
 * Now the set is computed ONCE per file, by `computeFileAsyncFnNames`, over EVERY
 * file-scope function the file declares — `function` declarations (exported or not,
 * `server function`s included) and function-valued bindings (`const f = (…) => …`) — as
 * a fixpoint over the call graph, seeded by:
 *   - a body that does `?{}` / `_{}`, or is declared `async`;
 *   - a call to a Promise-returning standard-library export;
 *   - a call to an async function imported from another `.scrml` module (resolved by that
 *     module's OWN set — the same function, memoized per file, in codegen/index.ts);
 *   - the file's server functions: on the server each one is an `async` in-process peer,
 *     so it is a MEMBER of the set (a call to it is awaited) and colours its callers.
 * The result also holds the async imported locals themselves.
 *
 * codegen/index.ts stashes the set on the FileAST (`_asyncFnNames`, mirrored onto a
 * TABResult's `.ast`); every server reader asks `asyncFnNamesOfFile` — the ss1 value
 * exports, the D-5 module-binding closure, the route / peer call sites (through
 * `buildServerCalleeImportMap`), and the cross-module importers (an import is awaited iff
 * the declaring module's set holds the export).
 */
import { computeAsyncFnNames } from "./emit-library-shared.ts";
import { collectTopLevelStatements } from "./collect.ts";
import { fnValuedBindingsOf } from "./fn-valued-bindings.ts";
import { buildCalleeImportMap, asyncImportedLocalsOfFile } from "./scheduling.ts";

type AnyFile = Record<string, unknown>;
/** MOD's per-module export registry (opaque here — handed through to the stdlib classifier). */
type ExportRegistryLike = Map<string, Map<string, unknown>>;

export interface FileAsyncInputs {
  /** LOCAL names binding an async function of another module (or a Promise-returning `scrml:` export). */
  asyncImportedLocals?: Set<string> | null;
  /** The file's server-boundary function names (route inference + `server function`). */
  serverFnNames?: Set<string> | null;
  /** MOD per-module export metadata (the stdlib `isAsync` source of truth). */
  exportRegistry?: ExportRegistryLike | null;
}

/** The file's server-boundary function names, read off the route map (or `isServer` without one). */
export function serverFnNamesOfFile(
  fileAST: unknown,
  routeMap?: { functions?: Map<string, unknown> } | null,
): Set<string> {
  const out = new Set<string>();
  const fp = (fileAST as { filePath?: string } | null)?.filePath ?? "";
  for (const st of collectTopLevelStatements(fileAST as never) as unknown as AnyFile[]) {
    if (!st || st.kind !== "function-decl" || typeof st.name !== "string" || !st.name) continue;
    if (st.isServer === true) { out.add(st.name); continue; }
    const span = st.span as { start?: number } | undefined;
    const r = (routeMap?.functions && span) ? routeMap.functions.get(`${fp}::${span.start}`) as { boundary?: string } | undefined : undefined;
    if (r?.boundary === "server") out.add(st.name);
  }
  return out;
}

/** Compute the file's async name set (see the module docblock). */
export function computeFileAsyncFnNames(fileAST: unknown, inputs: FileAsyncInputs): Set<string> {
  const top = collectTopLevelStatements(fileAST as never) as unknown as AnyFile[];
  const fns = [
    ...top.filter((st) => st && st.kind === "function-decl" && typeof st.name === "string"),
    ...fnValuedBindingsOf(top).map((b) => b.pseudoFn as unknown as AnyFile),
  ];
  const server = inputs.serverFnNames ?? new Set<string>();
  const registry = inputs.exportRegistry ?? null;
  const calleeMap = buildCalleeImportMap(fileAST as never);
  // The fixpoint, with the server functions as TRIGGERS (a caller of one is async)…
  const byBody = computeAsyncFnNames(fns as never, null, new Set(inputs.asyncImportedLocals ?? []),
    registry ? calleeMap : null, registry as never, server);
  // …and as MEMBERS (each one IS an async peer on the server).
  const all = new Set<string>([...byBody, ...server]);
  BY_BODY.set(all, byBody);
  return all;
}

/**
 * The part of a file's set that is async for a reason OTHER than being a server function
 * itself (its body does `?{}` / awaits / calls something async). The ss1 value-export
 * block keeps its pre-r7 skip of a server function whose body is server-context-only
 * (`session.set`, `meta`, a `<transaction>`) and has no such reason — that function is a
 * request entry point, not a value an importer can run in-process.
 */
const BY_BODY = new WeakMap<Set<string>, Set<string>>();
export function asyncByBodyOf(fileSet: Set<string>): Set<string> {
  return BY_BODY.get(fileSet) ?? fileSet;
}

/** Fill `target` (a memo's pre-registered set) with a computed file set, keeping its by-body part. */
export function adoptFileAsyncSet(target: Set<string>, computed: Set<string>): void {
  for (const n of computed) target.add(n);
  BY_BODY.set(target, asyncByBodyOf(computed));
}

const KEY = "_asyncFnNames";

/** Stash the file's set (codegen/index.ts, once per file). Mirrored onto a TABResult's `.ast`. */
export function setFileAsyncFnNames(fileAST: unknown, names: Set<string>): void {
  if (!fileAST || typeof fileAST !== "object") return;
  (fileAST as AnyFile)[KEY] = names;
  const inner = (fileAST as AnyFile).ast;
  if (inner && typeof inner === "object" && inner !== fileAST) (inner as AnyFile)[KEY] = names;
}

/**
 * The file's async name set — the stash codegen/index.ts computed.
 *
 * S466 r8 — an emitter driven WITHOUT that stash (outside runCG) cannot know which names
 * are async (no stdlib registry, no imported modules): it FAILS CLOSED, treating every
 * file-scope function and function-valued binding (and every async import it was told
 * about) as async — an `await` on a sync value is harmless, a missing one tests a
 * Promise.
 */
export function asyncFnNamesOfFile(fileAST: unknown): Set<string> {
  if (!fileAST || typeof fileAST !== "object") return new Set();
  const v = (fileAST as AnyFile)[KEY] ?? ((fileAST as AnyFile).ast as AnyFile | undefined)?.[KEY];
  if (v instanceof Set) return v as Set<string>;
  const top = collectTopLevelStatements(fileAST as never) as unknown as AnyFile[];
  const all = new Set<string>(asyncImportedLocalsOfFile(fileAST as never));
  for (const st of top) if (st && st.kind === "function-decl" && typeof st.name === "string" && st.name) all.add(st.name);
  for (const b of fnValuedBindingsOf(top)) all.add(b.name);
  return all;
}

/**
 * S466 r8 (HIGH-1) — THE rule for the declared-name set a MODULE-LEVEL binding is emitted
 * with, shared by the server D-5 closure and the client's top-level emission. Emitters
 * use `declaredNames` as the shadow test ("a name declared here is a local, not the
 * async function of that name"); a module binding is not a local, so an async one must
 * not appear in it — else `const v = (p, h) => !w(p, h)` reads `w` as a shadowing local
 * and its call is not awaited (r7 fixed the client copy by hand; the server copy kept the
 * bug). The binding's own parameters and inner declarations are added by the emitters
 * as usual, so a real shadow (`const v = (w) => w()`) still shadows.
 */
export function moduleLevelDeclaredNames(moduleNames: Iterable<string>, asyncNames: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const n of moduleNames) if (!asyncNames.has(n)) out.add(n);
  return out;
}

/** The file's async FUNCTION-VALUED bindings (`const w = (a) => check(a)`) — the set ∩ the bindings. */
export function asyncFnValuedBindingsOfFile(fileAST: unknown): Set<string> {
  // A binding is async by its BODY: a binding that merely shares a name with a server
  // function elsewhere in the file (a channel's `server function onOpen` beside a
  // top-level `const onOpen = …`) is not that function.
  const all = asyncByBodyOf(asyncFnNamesOfFile(fileAST));
  const out = new Set<string>();
  if (all.size === 0) return out;
  for (const b of fnValuedBindingsOf(collectTopLevelStatements(fileAST as never) as unknown[])) {
    if (all.has(b.name)) out.add(b.name);
  }
  return out;
}
