/**
 * g-if-attr-per-field-synth-cell-crashes-boot (S372) — the `if=`/`show=` TOGGLE
 * lowering for a §55 synth-surface cell.
 *
 * THE SAME DEFECT CLASS AS GH #262 / #275, IN A FOURTH LOCATION. Bug 61 (S140)
 * made an `@<compound>[.field].<synthProp>` read collapse to the dotted synth
 * cell instead of member access on the compound VALUE object; #262 extended it
 * into function bodies (see `i262-synth-read-in-function-body.test.js`, the
 * sibling of this file). What neither reached is
 * `emit-event-wiring.ts:computeDisplayToggleCondition`'s `varName` + `dotPath`
 * branch, which serves a `variable-ref` attribute value — `if=@f.isValid` with
 * no parentheses. That branch consulted nothing and emitted a root-segment
 * reactive read plus a literal JS member chain, so ONE predicate lowered TWO
 * ways depending on how the author spelled it:
 *
 *     if=(@signup.isValid)   -> _scrml_reactive_get("signup.isValid")   correct
 *     if=@signup.isValid     -> _scrml_reactive_get("signup").isValid   wrong
 *
 * The compound is a §6.3 Variant C NAMESPACE — its value object carries only
 * its FIELD keys, and each field's value lives in a flat cell — so the wrong
 * form is wrong in two ways at once:
 *
 *   compound-level (`.isValid`/`.touched`/`.errors`/`.submitted`) reads
 *   `undefined`: falsy forever, no throw, gated subtree never mounts, SILENT;
 *
 *   per-field (`.name.touched`) dereferences `null`: the TypeError lands inside
 *   `_scrml_nav_rewire` under `_scrml_boot`, killing every interpolation on the
 *   page.
 *
 * This file pins the EMIT contract. The EXECUTION acceptance — which is what
 * actually proves the page is alive, since a lowering assertion cannot see a
 * dead boot — is `compiler/tests/browser/g-if-attr-synth-cell-toggle.browser.test.js`.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { runTS } from "../../src/type-system.ts";
import { runRI } from "../../src/route-inference.js";
import { runCG } from "../../src/code-generator.js";
import { foldChunkAccessors } from "../helpers/chunk-scope.js";
import { resolveSynthCellPrefix } from "../../src/codegen/emit-expr.ts";

function compileClient(source, filePath = "/test/g-if-attr-synth.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const fileAST = { filePath, ...ast };
  runSYM({ filePath, ast: fileAST });
  runTS({ files: [fileAST] });
  let routeMap = { functions: new Map() };
  let depGraph = { nodes: new Map(), edges: [] };
  try {
    const ri = runRI({ files: [fileAST] });
    routeMap = ri.routeMap ?? routeMap;
    depGraph = ri.depGraph ?? depGraph;
  } catch { /* client-only form needs no route inference */ }
  const cg = runCG({ files: [fileAST], routeMap, depGraph, protectAnalysis: { views: new Map() } });
  const out = cg.outputs.get(filePath) ?? [...cg.outputs.values()][0];
  return { clientJs: foldChunkAccessors(out.clientJs), errors: cg.errors ?? [] };
}

// Built by join(), not a template literal — the fixture carries a scrml `${…}`
// interpolation that a JS template literal would try to evaluate.
function fixture(gatedAttr) {
  return [
    "<program>",
    "",
    "<flag> = true",
    "",
    "<signup>",
    '    <name req length(>=2)> = <input type="text"/>',
    "</>",
    "",
    "<span " + gatedAttr + ">GATED</span>",
    '<p id="ctl">${@flag}</p>',
    "",
    "</program>",
    "",
  ].join("\n");
}

describe("g-if-attr-synth-toggle — a `variable-ref` if= resolves the flat synth cell", () => {
  // The shapes that COLLAPSE as a BARE read. Every one has a SCALAR runtime
  // value, so its truthiness as an `if=` gate is meaningful. Nothing else
  // collapses bare — see STAYS_ON_BASE_LOWERING below.
  const COLLAPSES = [
    ["@signup.isValid", "signup.isValid", "compound-level isValid — boolean"],
    ["@signup.submitted", "signup.submitted", "compound-level submitted — boolean"],
    ["@signup.name.isValid", "signup.name.isValid", "per-field, 3-level — boolean"],
    ["@signup.name.touched", "signup.name.touched", "per-field, 3-level — boolean"],
  ];

  for (const [cond, key, label] of COLLAPSES) {
    test(`if=${cond} (${label}) -> _scrml_reactive_get("${key}")`, () => {
      const { clientJs, errors } = compileClient(fixture(`if=${cond}`));
      expect(errors.filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
      expect(clientJs).toContain(`_scrml_reactive_get("${key}")`);
      // The pre-fix string, which for the 3-level rows dereferences null at boot.
      const memberChain = `_scrml_reactive_get("signup").${key.slice("signup.".length)}`;
      expect(clientJs).not.toContain(memberChain);
    });
  }

  // ⚑ THE SHAPES THAT MUST *NOT* COLLAPSE — these assert the BASE lowering on
  // purpose, and asserting the collapsed form here would be asserting a
  // REGRESSION.
  //
  // §55's COMPOUND-LEVEL `errors` and `touched` are OBJECT MAPS keyed by field
  // name, not scalars:
  //
  //   _scrml_derived_declare("signup.errors",  () => ({ name: get("signup.name.errors") }));
  //   _scrml_derived_declare("signup.touched", () => ({ name: get("signup.name.touched") }));
  //
  // An object literal is ALWAYS TRUTHY, so collapsing these turns a gate that
  // read `undefined` (never mounts) into one that is unconditionally true — a
  // pristine, untouched form would render its error block at boot. MEASURED on
  // the shipped runtime chunk: base `mount@boot=false`, naive-collapse
  // `mount@boot=true`.
  //
  // ⚑ THE CELL SHAPE IS NOT THE BUG AND IS NOT FIXED HERE. §6.11's table says
  // `touched` is `boolean` and `errors` is `string[]`; the implementation
  // disagrees. PRIMER §13.7 B11 records the object-map shape as INTENTIONAL per
  // §55 and calls §6.11 a non-blocking spec-prose drift for a separate
  // amendment. So truthiness over a rollup map is MEANINGLESS, and which of
  // {always-true, never-true, diagnose} is correct is an OPEN OPERATOR RULING.
  // Until it is ruled, these rows stay byte-identical to main.
  //
  // ⚑ PER-FIELD `errors` IS IN THIS TABLE BECAUSE OF A METHOD ERROR WORTH MORE
  // THAN THE RULE. Two rounds justified collapsing it on "base is a DEAD PAGE
  // there anyway" — measured on ONE field-declaration form:
  //
  //     <name req length(>=2)> = <input type="text"/>   markup-typed
  //     <name req length(>=2)> = ""                     literal-init
  //
  // The markup-typed compound value is `{name: null}`, so a 3-level read
  // dereferences null and throws. The literal-init value is `{name: ""}`, so the
  // same read is merely `undefined` — NO crash, boot alive, gate correctly
  // false. MEASURED base, literal-init: `ctl="true"`, gate false. Collapsing
  // there takes a CORRECT gate to a permanently-visible error block.
  // Fatal->wrong on one declaration form does not license correct->wrong on
  // another. WHEN A FIXTURE HAS A DECLARATION FORM, VARY THE DECLARATION FORM
  // BEFORE CONCLUDING.
  //
  // ⚑ RESIDUAL, NAMED NOT HIDDEN: `if=@field.errors` on a MARKUP-TYPED field is
  // still a dead page, exactly as on main. Open limb of the filed HIGH.
  const STAYS_ON_BASE_LOWERING = [
    ["@signup.touched", "signup", "touched", "compound-level touched — OBJECT MAP, always truthy"],
    ["@signup.errors", "signup", "errors", "compound-level errors — OBJECT MAP, always truthy"],
    ["@signup.name.errors", "signup", "name.errors", "PER-FIELD errors — ARRAY, `[]` is as truthy as `{}`"],
  ];

  for (const [cond, root, leafPath, label] of STAYS_ON_BASE_LOWERING) {
    test(`if=${cond} (${label}) keeps the BASE member-access lowering — open ruling`, () => {
      const { clientJs, errors } = compileClient(fixture(`if=${cond}`));
      expect(errors.filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
      expect(clientJs).toContain(`_scrml_reactive_get("${root}").${leafPath}`);
      expect(clientJs).not.toContain(`_scrml_reactive_get("${cond.slice(1)}")`);
    });
  }

  // ⚑ A TAIL FLIPS THE DECISION — BUT ONLY WHEN IT LANDS ON A SCALAR.
  // The truthiness objection applies to any read whose VALUE is always truthy:
  // `get("signup.errors").length` is a correct, non-truthy-forever gate. What it
  // would otherwise fall back to is `get("signup").errors.length` —
  // `undefined.length` — which THROWS inside `_scrml_boot` and unwires every
  // interpolation on the page. Measured on base AND on the first cut of this
  // gate: `ctl=""`, TypeError, on BOTH declaration forms.
  const TAIL_BEARING = [
    ["@signup.errors.length", "signup.errors", ".length", "errors rollup + a CONTAINER property"],
    ["@signup.touched.name", "signup.touched", ".name", "touched rollup + a FIELD key -> boolean"],
    ["@signup.name.errors.length", "signup.name.errors", ".length", "per-field array + .length"],
  ];

  for (const [cond, key, tail, label] of TAIL_BEARING) {
    test(`if=${cond} (${label}) COLLAPSES — a tail-bearing read is not truthy-forever`, () => {
      const { clientJs, errors } = compileClient(fixture(`if=${cond}`));
      expect(errors.filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
      expect(clientJs).toContain(`_scrml_reactive_get("${key}")${tail}`);
      // The page-killing base chain must be gone.
      const root = key.split(".")[0];
      const chain = `_scrml_reactive_get("${root}").${key.slice(root.length + 1)}${tail}`;
      expect(clientJs).not.toContain(chain);
    });
  }

  // ⚑ A NON-EMPTY TAIL IS NOT ENOUGH — IT MUST LAND ON A SCALAR. The first cut
  // of the tail term admitted ANY non-empty tail, which re-introduced the exact
  // always-true gate the shape gate exists to prevent, via a different path:
  //
  //   `@signup.errors.name`  -> get("signup.errors").name  -> []  ALWAYS TRUTHY
  //
  // because the `errors` rollup maps each field to an ARRAY and `[]` is as
  // truthy as `{}`. Measured on a PRISTINE, FULLY-VALID form: the gate mounted
  // at boot. Its sibling does NOT have this problem —
  //
  //   `@signup.touched.name` -> get("signup.touched").name -> false  SCALAR
  //
  // because the `touched` rollup maps each field to a BOOLEAN. So the
  // discriminator is the ROLLUP'S VALUE TYPE, not the presence of a tail.
  //
  // DERIVED, not enumerated: `<prefix>.<tailSeg>.errors ∈ synthCellKeys` is
  // "this tail segment names a field of this compound".
  test("if=@signup.errors.name — a tail INTO the errors rollup's value space still DECLINES", () => {
    const { clientJs, errors } = compileClient(fixture("if=@signup.errors.name"));
    expect(errors.filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_get("signup").errors.name');
    expect(clientJs).not.toContain('_scrml_reactive_get("signup.errors").name');
  });

  test("if=@signup.touched.name — the SAME tail shape on the boolean rollup COLLAPSES", () => {
    // Same syntactic shape, opposite outcome, purely because of the rollup's
    // value type. This pair is what proves the test is derived and not a
    // leaf-name allow-list.
    const { clientJs } = compileClient(fixture("if=@signup.touched.name"));
    expect(clientJs).toContain('_scrml_reactive_get("signup.touched").name');
    expect(clientJs).not.toContain('_scrml_reactive_get("signup").touched.name');
  });

  // ⚑ A NESTED COMPOUND IS NOT A FIELD, AND THE ONE-TERM TEST COULD NOT TELL.
  // `collectSynthCellKeys` emits `<compound>.<nestedCompound>.errors` too (a
  // nested compound gets its own full surface), but the compound-level `errors`
  // ROLLUP keys only `fieldChildren` — emit-synth-surface.ts iterates
  // `fieldChildren`, which EXCLUDES compound-typed children. So a nested
  // compound name is REGISTERED yet is NOT a key of the rollup:
  // `get("signup.errors").addr` is `undefined`, a correct false gate, i.e.
  // exactly the shape where collapsing is right.
  //
  // The one-term test declined it and fell back to `get("signup").errors.addr`
  // -> `undefined.addr` -> TypeError in `_scrml_boot` -> whole page unwired.
  //
  // `submitted` is the discriminator and is compound-ONLY (§55.7). VERIFIED on
  // this fixture: `signup.addr.submitted` IS registered, `signup.name.submitted`
  // is NOT.
  const NESTED_SRC = (cond) => [
    "<program>",
    "",
    "<flag> = true",
    "",
    "<signup>",
    "    <addr>",
    '        <city req length(>=2)> = ""',
    "    </>",
    '    <name req length(>=2)> = ""',
    "</>",
    "",
    "<span if=" + cond + ">GATED</span>",
    "",
    "</program>",
    "",
  ].join("\n");

  test("the nested-vs-field discriminator is DERIVED — `submitted` is compound-only", () => {
    const { clientJs } = compileClient(NESTED_SRC("@signup.isValid"));
    // The two registrations the discriminator reads. If these ever diverge the
    // test above them is unsound, so pin them here rather than assume.
    expect(clientJs).toContain('_scrml_reactive_set("signup.addr.submitted"');
    expect(clientJs).not.toContain('_scrml_reactive_set("signup.name.submitted"');
  });

  test("if=@signup.errors.addr — a NESTED COMPOUND tail COLLAPSES (it is not a rollup key)", () => {
    const { clientJs, errors } = compileClient(NESTED_SRC("@signup.errors.addr"));
    expect(errors.filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_get("signup.errors").addr');
    // The page-killing base chain must be gone.
    expect(clientJs).not.toContain('_scrml_reactive_get("signup").errors.addr');
  });

  test("if=@signup.errors.name — a FIELD tail on the SAME fixture still DECLINES", () => {
    // Same source, same syntactic shape, opposite outcome — purely because
    // `addr` is a compound and `name` is a field. This pair is what proves the
    // discriminator is derived and not a name list.
    const { clientJs } = compileClient(NESTED_SRC("@signup.errors.name"));
    expect(clientJs).toContain('_scrml_reactive_get("signup").errors.name');
    expect(clientJs).not.toContain('_scrml_reactive_get("signup.errors").name');
  });

  test("the compound-level/per-field split is DERIVED from synthCellKeys, not hand-listed", () => {
    // `submitted` is emitted for a compound parent and NOT for a field child
    // (§55.7), so `<prefix>.submitted ∈ synthCellKeys` IS the "prefix is a
    // compound parent" test. That is what separates the two tables above, and it
    // reads the same artifact the collapse reads, so gate and outcome cannot
    // drift. Same leaf name, opposite outcome, purely because of the prefix:
    const compound = compileClient(fixture("if=@signup.touched")).clientJs;
    const perField = compileClient(fixture("if=@signup.name.touched")).clientJs;
    expect(compound).toContain('_scrml_reactive_get("signup").touched');
    expect(perField).toContain('_scrml_reactive_get("signup.name.touched")');
  });

  test("the bare and PARENTHESISED spellings of one predicate emit the same condition", () => {
    // They route to different branches of computeDisplayToggleCondition. Two
    // lowerings for one predicate is the defect; this is the invariant — for
    // every shape that collapses.
    for (const cond of ["@signup.isValid", "@signup.name.touched", "@signup.submitted", "@signup.name.isValid"]) {
      const bare = compileClient(fixture(`if=${cond}`)).clientJs;
      const paren = compileClient(fixture(`if=(${cond})`)).clientJs;
      const key = cond.slice(1);
      expect(bare).toContain(`_scrml_reactive_get("${key}")`);
      expect(paren).toContain(`_scrml_reactive_get("${key}")`);
    }
  });

  test("for the always-truthy rows the spellings still DIVERGE — and that is PRE-EXISTING, not introduced", () => {
    // Honest accounting of what this change does NOT unify. The parenthesised
    // form routes through `emitExprField` -> `emitMember`, whose Bug-61 collapse
    // has ALWAYS fired for these keys; the bare form now deliberately declines.
    // So the two spellings disagree for compound `touched` / `errors`.
    //
    // MEASURED ON BOTH REVISIONS — base b0abcbc6 and this branch are
    // BYTE-IDENTICAL on all four of these, executed against the shipped runtime
    // chunk:
    //
    //   if=@signup.touched     mount@boot=false  get("signup").touched
    //   if=(@signup.touched)   mount@boot=true   get("signup.touched")
    //   if=@signup.errors      mount@boot=false  get("signup").errors
    //   if=(@signup.errors)    mount@boot=true   get("signup.errors")
    //
    // Unifying them requires deciding what truthiness over a §55 rollup map
    // MEANS, which is the open operator ruling. Doing it by collapsing the bare
    // form regresses a pristine form to "always shows the error block"; doing it
    // by changing `emitMember` alters expression-position reads far outside this
    // defect. Neither is this dispatch's call, so the divergence is PINNED here
    // rather than left to be rediscovered.
    for (const cond of ["@signup.touched", "@signup.errors", "@signup.name.errors"]) {
      const leaf = cond.slice("@signup.".length);
      const bare = compileClient(fixture(`if=${cond}`)).clientJs;
      const paren = compileClient(fixture(`if=(${cond})`)).clientJs;
      expect(bare).toContain(`_scrml_reactive_get("signup").${leaf}`);
      expect(paren).toContain(`_scrml_reactive_get("${cond.slice(1)}")`);
    }
  });

  test("show= shares the lowering (same binding record, same decision site)", () => {
    const { clientJs } = compileClient(fixture("show=@signup.name.touched"));
    expect(clientJs).toContain('_scrml_reactive_get("signup.name.touched")');
    expect(clientJs).not.toContain('_scrml_reactive_get("signup").name.touched');
  });

  test("a NON-synth compound field keeps its pre-existing member-access lowering", () => {
    // Nothing was narrowed: `@signup.name` is not a synth cell, fails the
    // membership test, and takes the identical path it always took.
    const { clientJs } = compileClient(fixture("if=@signup.name"));
    expect(clientJs).toContain('_scrml_reactive_get("signup").name');
  });

  test("S140 OVER-FIRE GUARD — a plain cell with a field NAMED like a synth prop is untouched", () => {
    const src = [
      "<program>",
      "",
      '<config> = { errors: ["boom"] }',
      "",
      "<span if=@config.errors>GATED</span>",
      "",
      "</program>",
      "",
    ].join("\n");
    const { clientJs } = compileClient(src);
    // `config.errors` is not a REGISTERED synth cell, so the collapse must
    // decline — routing it would read an unregistered key and return undefined.
    expect(clientJs).toContain('_scrml_reactive_get("config").errors');
    expect(clientJs).not.toContain('_scrml_reactive_get("config.errors")');
  });
});

describe("resolveSynthCellPrefix — ONE of the §55 collapse rules, not the only one", () => {
  // ⚑ THE EARLIER VERSION OF THIS COMMENT WAS FALSE AND THAT WAS THE HARM.
  // It said "three call sites now share this, including emitMember's AST path."
  // TWO share it — the raw-string statement fallback
  // (`collapseSynthSurfaceRefsInRaw`) and the `if=`/`show=` toggle lowering.
  //
  // `emitMember` DOES NOT. It carries its own `synthDottedKey` walk with a
  // DIFFERENT RESOLUTION ORDER:
  //
  //   resolveSynthCellPrefix — EARLIEST registered prefix
  //   synthDottedKey         — LONGEST key first
  //
  // They agree wherever only one prefix is registered, which is why this went
  // unnoticed, and DISAGREE when a compound has a field literally NAMED like a
  // synth property. PA-REPRODUCED on `<signup> <errors req> = "" </>`, where
  // both `signup.errors` (the rollup) and `signup.errors.isValid` (that field's
  // own per-field key) are registered:
  //
  //   if=@signup.errors.isValid     to  get("signup.errors").isValid    WRONG
  //   if=(@signup.errors.isValid)   to  get("signup.errors.isValid")    CORRECT
  //
  // So `emitMember` is the RIGHT one there and this helper is the wrong one.
  // Converging them is an AST-member-path change with its own blast radius and
  // is FILED SEPARATELY, deliberately not done on this branch. A comment that
  // claims the drift is closed is how the next author stops looking — hence
  // this block.
  //
  // The cases below pin THIS helper's contract; they do not assert parity with
  // `emitMember` and must not be read as doing so.
  const KEYS = new Set(["f.isValid", "f.errors", "f.name.touched", "f.name.errors"]);

  test("returns the registered dotted key with an empty tail for an exact hit", () => {
    expect(resolveSynthCellPrefix(["f", "isValid"], KEYS)).toEqual({ dotted: "f.isValid", tail: "" });
    expect(resolveSynthCellPrefix(["f", "name", "touched"], KEYS)).toEqual({ dotted: "f.name.touched", tail: "" });
  });

  test("collapses at the EARLIEST registered synth property and keeps the remaining tail", () => {
    // `@f.errors.length` gives `_scrml_reactive_get("f.errors").length`.
    // emitMember reaches the same emission on THIS shape, but by
    // longest-key-first rather than by calling this function — see the
    // divergence note on the describe above.
    expect(resolveSynthCellPrefix(["f", "errors", "length"], KEYS)).toEqual({ dotted: "f.errors", tail: ".length" });
    // A multi-segment tail, kept to IDENTIFIER segments. `f.errors` is the §55
    // rollup map keyed by field name, so `@f.errors.name.length` is a real read:
    // `_scrml_reactive_get("f.errors").name.length`.
    expect(resolveSynthCellPrefix(["f", "errors", "name", "length"], KEYS))
      .toEqual({ dotted: "f.errors", tail: ".name.length" });
    // ⚑ NOT asserted: a NUMERIC segment. The helper joins its tail with `.`, so
    // `["f","name","errors","0","tag"]` would yield `.0.tag` and the caller would
    // emit `_scrml_reactive_get("f.name.errors").0.tag` — a JS SYNTAX ERROR.
    // Pinning that would enshrine an invalid-JS contract on an exported helper.
    // It is unreachable from all three callers today (the raw-string CHAIN regex
    // matches `[A-Za-z_$][A-Za-z0-9_$]*` only; `emitMember` walks static ident
    // properties; the toggle's `dotPath` comes from a `variable-ref` attr name),
    // so this is a latent sharp edge on the export, recorded rather than pinned.
  });

  test("declines when the leaf is not a synth property name", () => {
    expect(resolveSynthCellPrefix(["f", "name"], KEYS)).toBeNull();
    expect(resolveSynthCellPrefix(["f", "whatever"], KEYS)).toBeNull();
  });

  test("declines when the leaf IS a synth property name but the key is UNREGISTERED", () => {
    // The S140 over-fire guard, at the helper level.
    expect(resolveSynthCellPrefix(["config", "errors"], KEYS)).toBeNull();
    expect(resolveSynthCellPrefix(["f", "submitted"], KEYS)).toBeNull();
  });

  test("declines on a bare root, and on an absent or empty key set", () => {
    expect(resolveSynthCellPrefix(["f"], KEYS)).toBeNull();
    expect(resolveSynthCellPrefix(["f", "isValid"], null)).toBeNull();
    expect(resolveSynthCellPrefix(["f", "isValid"], new Set())).toBeNull();
  });
});
