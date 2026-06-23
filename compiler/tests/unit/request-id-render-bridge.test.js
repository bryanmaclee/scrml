/**
 * request-id-render-bridge.test.js — `<#id>` render bridge for `<request>` state.
 *
 * Regression: change-id `request-id-render-bridge-2026-06-22`
 * (gap `g-request-id-render-bridge-unwired`, HIGH).
 *
 * The bug: a `<request id="x" url=/api=>` correctly emits a fetch into
 * `var _scrml_request_<id> = { loading, data, error, stale }` and mutates it on
 * resolve, BUT the markup `<#id>` ref did NOT read that object — it lowered to
 * `_scrml_input_state_registry.get("<id>")` (the §36 input-state registry, which
 * a `<request>` never populates → `undefined` → throw / silent static shell). The
 * fetch+decode half was correct (A2 W4) but the RENDER bridge was unwired, AND the
 * state object was a plain (non-reactive) object so resolve never re-rendered.
 *
 * The clean-bridge fix (3 seams + 2 parse fixes + an ordering fix):
 *   Seam 1  — `_scrml_request_<id>` is `_scrml_deep_reactive(...)`-wrapped (its
 *             `.data`/`.loading`/`.error` mutations auto-trigger effects via the
 *             Proxy); the dead `_scrml_notify(...)` calls are removed.
 *   Seam 2  — `<#id>` refs whose id names a `<request>` route to `_scrml_request_<id>`
 *             in interpolation, `<match on=>`, `if=`, and file-scope const, instead of
 *             the §36 input-state registry. §36 input-state refs are UNCHANGED.
 *   Seam 3  — the binding takes the `_scrml_effect`-wrapped reactive path (the Proxy
 *             auto-tracks the read → re-renders on fetch resolve).
 *   Parse   — `if=<#id>.member` preserves its `.member` chain (was dropped at tokenize)
 *             AND no longer false-fires E-SCOPE-001 on the lowered `_scrml_input_<id>_`.
 *   Ordering— the `var _scrml_request_<id> = _scrml_deep_reactive(...)` decl is hoisted
 *             before top-level logic so a file-scope `const <x> = <#id>.data` does not
 *             throw `undefined.data` at module-init.
 *
 * Coverage:
 *   §1  state object is deep-reactive; no _scrml_notify leak (url= AND api=)
 *   §2  ${<#id>.data} interpolation reads _scrml_request_<id> + is _scrml_effect-wrapped
 *   §3  <match on=${<#id>.data}> dispatch reads _scrml_request_<id> + is effect-wrapped
 *   §4  if=<#id>.loading/.error/.data — member preserved, routed, effect-wrapped, GREEN
 *   §5  file-scope const <x> = <#id>.data — routed + hoisted (no undefined.data throw)
 *   §6  §36 input-state <#cursor> still lowers to the registry (NOT regressed to request)
 *   §7  emitted JS parses (node-style new Function) for every form
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/request-render-bridge");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

function clientJs(result, path) {
  return result.outputs.get(path).clientJs;
}

// A module-parse smoke: strip the leading import + assume the runtime globals.
function parses(js) {
  const stripped = js.replace(/^\s*\/\/[^\n]*\n/gm, "").replace(/^\s*import\s[^;]*;/gm, "");
  return () => new Function(stripped);
}

let urlInterpFx, apiInterpFx, matchOnFx, ifAttrFx, constFx, inputStateFx;
// S213 ss15 items 3+4+5 — lift-path fixtures.
let liftForInterpFx, liftBareIfFx, liftInputStateFx, liftSpecEx1Fx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // url= mode + ${<#id>.data} interpolation.
  urlInterpFx = fix("url-interp.scrml", `<program>
    <div>\${<#feed>.data}</>
    <request id="feed" url="/api/feed">
    </>
</>
`);

  // api= mode + ${<#id>.data}/.loading interpolation (typed external API §60.4).
  apiInterpFx = fix("api-interp.scrml", `<api base="https://api.example.com">
  getStatus(StatusQuery) -> GET "/status" : StatusResult
</api>

<program>
    type StatusQuery:struct = { id: int }
    type StatusResult:enum = { Up, Down }

    <q>: StatusQuery = { id: 1 }

    <request id="svc" api="getStatus" args=@q>
    </>

    <div>\${<#svc>.loading}</>
</>
`);

  // <match on=${<#id>.data}> block form.
  matchOnFx = fix("match-on.scrml", `<program>
    type Phase:enum = { Idle, Ready }

    <match for=Phase on=\${<#feed>.data}>
      <Idle>
        <p>idle</p>
      </>
      <Ready>
        <p>ready</p>
      </>
    </>
    <request id="feed" url="/api/feed">
    </>
</>
`);

  // if=<#id>.loading / .error / .data attribute form.
  ifAttrFx = fix("if-attr.scrml", `<program>
    <p if=<#feed>.loading>Loading...</>
    <p if=<#feed>.error>Failed</>
    <h1 if=<#feed>.data>Loaded</>
    <request id="feed" url="/api/feed">
    </>
</>
`);

  // file-scope const <x> = <#id>.data.
  constFx = fix("const-ref.scrml", `<program>
    <request id="feed" url="/api/feed">
    </>

    \${ const <snapshot> = <#feed>.data }

    <div>\${@snapshot}</>
</>
`);

  // §36 input-state <#cursor> — MUST stay registry-based (NOT routed to request).
  inputStateFx = fix("input-state.scrml", `<program>
    <mouse id="cursor"/>
    <div>\${<#cursor>.x}</>
</>
`);

  // S213 ss15 item 3 — ${ for (…) { lift <h1>${<#id>.data}</h1> } } LIFT-PATH
  // interpolation. The nested ${…} interpolation must NOT content-split (no
  // leaked "feed_.data}" literal text node), must route to _scrml_request_feed,
  // and must be _scrml_effect-wrapped.
  liftForInterpFx = fix("lift-for-interp.scrml", `<program>
    \${ for (x of [1,2,3]) { lift <h1>\${<#feed>.data}</h1> } }
    <request id="feed" url="/api/feed">
    </>
</>
`);

  // S213 ss15 item 4 — bare ${ if (<#id>.loading) { lift } } LIFT-PATH if
  // condition. The condition must route to _scrml_request_feed (NOT the §36
  // registry).
  liftBareIfFx = fix("lift-bare-if.scrml", `<program>
    \${ if (<#feed>.loading) { lift <p>Loading...</p> } }
    <request id="feed" url="/api/feed">
    </>
</>
`);

  // S213 ss15 — §36 input-state regression IN A LIFT body. A <#cursor> control
  // (NOT a <request>) inside a for/lift MUST keep the registry lowering.
  liftInputStateFx = fix("lift-input-state.scrml", `<program>
    <mouse id="cursor"/>
    \${ for (x of [1,2,3]) { lift <h1>\${<#cursor>.x}</h1> } }
</>
`);

  // S213 ss15 item 5 — migrated SPEC §6.7.7 Worked Example 1 (the ${ }-wrapped
  // if/else-if/else chain in a <div>). End-to-end check the lift path is fixed:
  // compiles clean + routes <#profile> to _scrml_request_profile.
  //
  // NB: the verbatim SPEC example uses `not <#profile>.stale` for boolean
  // negation, which fires E-TYPE-045 (`not` is the §42 absence VALUE, not a
  // logical-negation operator) — a SECOND latent defect in the example, surfaced
  // to PA separately. This fixture uses the canonical `!<#profile>.stale` so the
  // lift-PATH fix can be verified end-to-end without the unrelated `not` defect
  // masking it.
  liftSpecEx1Fx = fix("lift-spec-ex1.scrml", `<program>
    <userId> = 42

    <request id="profile" url="/api/user/42">
    </>

    <div>
        \${
            if (<#profile>.loading && !<#profile>.stale) {
                lift <p>Loading...</>
            } else if (<#profile>.error) {
                lift <p>Error: \${<#profile>.error.message}</>
                lift <button onclick=\${<#profile>.refetch()}>Retry</>
            } else {
                lift <h1>\${<#profile>.data}</>
            }
        }
    </>
</>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §1: state object is deep-reactive; no _scrml_notify leak
// ---------------------------------------------------------------------------

describe("§1: _scrml_request_<id> is deep-reactive; no _scrml_notify leak", () => {
  test("url= mode wraps the state object in _scrml_deep_reactive", () => {
    const result = compile(urlInterpFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, urlInterpFx);
    expect(js).toMatch(/var _scrml_request_feed = _scrml_deep_reactive\(\{ loading: true, data: null, error: null, stale: false \}\)/);
  });

  test("the dead _scrml_notify(...) call is NOT emitted (it never existed in runtime)", () => {
    const result = compile(urlInterpFx);
    const js = clientJs(result, urlInterpFx);
    expect(js).not.toMatch(/_scrml_notify\(/);
  });

  test("api= mode also wraps the state object in _scrml_deep_reactive + no notify", () => {
    const result = compile(apiInterpFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, apiInterpFx);
    expect(js).toMatch(/var _scrml_request_svc = _scrml_deep_reactive\(\{ loading: true, data: null, error: null, stale: false \}\)/);
    expect(js).not.toMatch(/_scrml_notify\(/);
  });
});

// ---------------------------------------------------------------------------
// §2: ${<#id>.data} interpolation reads _scrml_request_<id> + is effect-wrapped
// ---------------------------------------------------------------------------

describe("§2: ${<#id>.data} interpolation routes to _scrml_request_<id> + reactive", () => {
  test("the interpolation reads _scrml_request_feed.data (NOT the §36 input-state registry)", () => {
    const result = compile(urlInterpFx);
    const js = clientJs(result, urlInterpFx);
    expect(js).toMatch(/_scrml_render_value\(el, _scrml_request_feed\.data\)/);
    expect(js).not.toMatch(/_scrml_input_state_registry\.get\("feed"\)/);
  });

  test("the interpolation binding is _scrml_effect-wrapped (re-renders on resolve)", () => {
    const result = compile(urlInterpFx);
    const js = clientJs(result, urlInterpFx);
    expect(js).toMatch(/_scrml_effect\(function\(\) \{ _scrml_render_value\(el, _scrml_request_feed\.data\); \}\)/);
  });

  test("api= mode interpolation routes to _scrml_request_svc.loading", () => {
    const result = compile(apiInterpFx);
    const js = clientJs(result, apiInterpFx);
    expect(js).toMatch(/_scrml_request_svc\.loading/);
    expect(js).not.toMatch(/_scrml_input_state_registry\.get\("svc"\)/);
  });
});

// ---------------------------------------------------------------------------
// §3: <match on=${<#id>.data}> dispatch reads _scrml_request_<id> + effect-wrapped
// ---------------------------------------------------------------------------

describe("§3: <match on=${<#id>.data}> routes to _scrml_request_<id> + reactive", () => {
  test("the match dispatch reads _scrml_request_feed.data (NOT the registry)", () => {
    const result = compile(matchOnFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, matchOnFx);
    expect(js).toMatch(/_dispatch\(_scrml_request_feed\.data\)/);
    expect(js).not.toMatch(/_scrml_input_state_registry\.get\("feed"\)/);
  });

  test("the match dispatch is _scrml_effect-wrapped", () => {
    const result = compile(matchOnFx);
    const js = clientJs(result, matchOnFx);
    expect(js).toMatch(/_scrml_effect\(function\(\) \{[\s\S]*_dispatch\(_scrml_request_feed\.data\)/);
  });
});

// ---------------------------------------------------------------------------
// §4: if=<#id>.member — member preserved, routed, effect-wrapped, GREEN
// ---------------------------------------------------------------------------

describe("§4: if=<#id>.member routes to _scrml_request_<id> + reactive (no E-SCOPE-001)", () => {
  test("compiles GREEN (the lowered _scrml_input_feed_ ref no longer fires E-SCOPE-001)", () => {
    const result = compile(ifAttrFx);
    expect(result.errors).toEqual([]);
  });

  test("if= conditions read _scrml_request_feed.loading/.error/.data (member preserved + routed)", () => {
    const result = compile(ifAttrFx);
    const js = clientJs(result, ifAttrFx);
    expect(js).toMatch(/_scrml_request_feed\.loading/);
    expect(js).toMatch(/_scrml_request_feed\.error/);
    // the if=<#feed>.data condition (member preserved — NOT dropped to the bare base)
    expect(js).toMatch(/\(_scrml_request_feed\.data\)/);
  });

  test("the if= mount/unmount controller is _scrml_effect-wrapped", () => {
    const result = compile(ifAttrFx);
    const js = clientJs(result, ifAttrFx);
    expect(js).toMatch(/_scrml_effect\(function\(\) \{[\s\S]*_scrml_request_feed\.loading/);
  });
});

// ---------------------------------------------------------------------------
// §5: file-scope const <x> = <#id>.data — routed + hoisted (no undefined.data throw)
// ---------------------------------------------------------------------------

describe("§5: const <x> = <#id>.data routes + hoists the state-object decl", () => {
  test("the const reads _scrml_request_feed.data", () => {
    const result = compile(constFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, constFx);
    expect(js).toMatch(/const snapshot = _scrml_request_feed\.data/);
  });

  test("the deep-reactive state-object decl is HOISTED before the const read (no module-init throw)", () => {
    const result = compile(constFx);
    const js = clientJs(result, constFx);
    const declIdx = js.indexOf("var _scrml_request_feed = _scrml_deep_reactive(");
    const readIdx = js.indexOf("const snapshot = _scrml_request_feed.data");
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(declIdx).toBeLessThan(readIdx);
  });

  test("the state object is declared exactly once (not re-created at the late init)", () => {
    const result = compile(constFx);
    const js = clientJs(result, constFx);
    const decls = js.match(/var _scrml_request_feed = _scrml_deep_reactive\(/g) ?? [];
    expect(decls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §6: §36 input-state <#cursor> stays registry-based (NOT regressed to request)
// ---------------------------------------------------------------------------

describe("§6: §36 input-state refs keep the input-state registry lowering", () => {
  test("a non-request <#cursor> still lowers to _scrml_input_state_registry (render-once, §36.6)", () => {
    const result = compile(inputStateFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, inputStateFx);
    expect(js).toMatch(/_scrml_input_state_registry\.get\("cursor"\)/);
    expect(js).not.toMatch(/_scrml_request_cursor/);
  });
});

// ---------------------------------------------------------------------------
// §8: LIFT-PATH render bridge (S213 ss15 items 3+4) — `<#id>` refs inside a
//     `lift` body route to _scrml_request_<id> (not the §36 registry), the
//     nested ${…} interpolation does NOT content-split, and request reads are
//     _scrml_effect-wrapped. §36 input-state lift refs are UNCHANGED.
// ---------------------------------------------------------------------------

describe("§8: lift-path <#id> request refs route + reactive (items 3+4)", () => {
  test("item 3: ${ for(){ lift <h1>${<#feed>.data}</h1> } } routes to _scrml_request_feed", () => {
    const result = compile(liftForInterpFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, liftForInterpFx);
    // routed to the request state object, NOT the §36 input-state registry
    expect(js).toMatch(/_scrml_request_feed\.data/);
    expect(js).not.toMatch(/_scrml_input_state_registry\.get\("feed"\)/);
  });

  test("item 3: no content-split corruption (no leaked \"feed_.data}\" literal text node)", () => {
    const result = compile(liftForInterpFx);
    const js = clientJs(result, liftForInterpFx);
    // The g-request-lift-nested-interp-mangle bug leaked a literal text node
    // `createTextNode("feed_.data}")`. It must be GONE.
    expect(js).not.toMatch(/feed_\.data\}/);
    expect(js).not.toMatch(/createTextNode\("feed/);
    // exactly ONE request-state binding for the interpolation
    const matches = js.match(/_scrml_request_feed\.data/g) || [];
    // (>=1 in the lift body; the fetch sidecar also references .data, so just
    // assert the lift body produced a binding — not the leak.)
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  test("item 3: the lift-body request read is _scrml_effect-wrapped (Seam 3)", () => {
    const result = compile(liftForInterpFx);
    const js = clientJs(result, liftForInterpFx);
    expect(js).toMatch(/_scrml_effect\(function\(\) \{ _scrml_lift_tn_\d+\.textContent = String\(\(_scrml_request_feed\.data\) \?\? ""\); \}\)/);
  });

  test("item 4: bare ${ if(<#feed>.loading){ lift } } condition routes to _scrml_request_feed", () => {
    const result = compile(liftBareIfFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, liftBareIfFx);
    expect(js).toMatch(/if \(_scrml_request_feed\.loading\)/);
    expect(js).not.toMatch(/_scrml_input_state_registry\.get\("feed"\)/);
  });

  test("§36 regression: a <#cursor> input-state lift ref STILL uses the registry (not routed to request)", () => {
    const result = compile(liftInputStateFx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, liftInputStateFx);
    expect(js).toMatch(/_scrml_input_state_registry\.get\("cursor"\)/);
    expect(js).not.toMatch(/_scrml_request_cursor/);
    // a §36 render-once ref is NOT effect-wrapped
    expect(js).not.toMatch(/_scrml_effect\(function\(\)[^)]*_scrml_input_state_registry\.get\("cursor"\)/);
  });

  test("item 5: migrated SPEC §6.7.7 Example 1 compiles CLEAN and routes <#profile> to _scrml_request_profile", () => {
    const result = compile(liftSpecEx1Fx);
    expect(result.errors).toEqual([]);
    const js = clientJs(result, liftSpecEx1Fx);
    expect(js).toMatch(/_scrml_request_profile/);
    expect(js).not.toMatch(/_scrml_input_state_registry\.get\("profile"\)/);
    // no content-split leak from the nested ${<#profile>.error.message} interp
    expect(js).not.toMatch(/profile_\./);
  });
});

// ---------------------------------------------------------------------------
// §7: every emitted form parses as a module
// ---------------------------------------------------------------------------

describe("§7: emitted JS parses for every bridged form", () => {
  for (const [name, getFx] of [
    ["url= interpolation", () => urlInterpFx],
    ["api= interpolation", () => apiInterpFx],
    ["<match on=>", () => matchOnFx],
    ["if= attr", () => ifAttrFx],
    ["file-scope const", () => constFx],
    ["lift for-interp (item 3)", () => liftForInterpFx],
    ["lift bare-if (item 4)", () => liftBareIfFx],
    ["lift §36 input-state regression", () => liftInputStateFx],
    ["lift SPEC §6.7.7 Example 1 (item 5)", () => liftSpecEx1Fx],
  ]) {
    test(`${name} output parses`, () => {
      const fx = getFx();
      const result = compile(fx);
      const js = clientJs(result, fx);
      expect(parses(js)).not.toThrow();
    });
  }
});
