/**
 * Test helper — stand in for host globals under the S457 host-global alias.
 *
 * Compiler-emitted code reaches every host global through one alias the runtime
 * (or a server / worker / library artifact) declares first:
 *
 *     const _scrml_g = globalThis;      (a server / library / tool / worker artifact)
 *     var _scrml_g = globalThis;        (the client runtime — chunk scripts read it)
 *
 * and spells `_scrml_g.fetch(…)`, `_scrml_g.document.querySelector(…)`,
 * `new _scrml_g.Response(…)` (codegen/host-global-alias.ts). That is what keeps a
 * user binding named `fetch` from capturing the compiler's `fetch`, and it is also
 * why a harness can no longer stub a host global by SHADOWING it
 * (`new Function("fetch", code)(stub)`): the compiler's references never read the
 * shadow. A harness stubs host globals by giving the alias a VIEW of the global
 * object instead:
 *
 *     const host = hostView({ fetch: stub, document });
 *     new Function("__scrml_host__", rebindHostAlias(runtimeJs) + clientJs)(host);
 *
 * The view inherits every other global from `globalThis`, so only the overrides
 * change. Writes through the alias (`_scrml_g._scrml_active_server = …`) land on
 * the view, not on the real global — local to the harness.
 */

/** The alias declaration every artifact (and the runtime) starts with. */
const ALIAS_DECL = /^(const|var) _scrml_g = globalThis;.*$/m;

/** A view of `globalThis` with `overrides` on top. */
export function hostView(overrides = {}) {
  const v = Object.create(globalThis);
  for (const [k, val] of Object.entries(overrides)) {
    Object.defineProperty(v, k, { value: val, writable: true, configurable: true, enumerable: true });
  }
  return v;
}

/**
 * `js` with its alias declaration pointed at `binding` (default `__scrml_host__`,
 * a parameter the harness passes a `hostView(...)` for). Throws if `js` declares
 * no alias — a harness that expects to stub host globals and silently does not is
 * a test that passes for the wrong reason.
 */
export function rebindHostAlias(js, binding = "__scrml_host__") {
  if (!ALIAS_DECL.test(js)) throw new Error("rebindHostAlias: no `const|var _scrml_g = globalThis;` declaration in this code");
  return js.replace(ALIAS_DECL, (_m, kw) => `${kw} _scrml_g = ${binding};`);
}
