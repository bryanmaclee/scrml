// native-engine-substrate-instance-share.test.js — S163 native-parser-swap fix.
//
// THE BUG (root-caused S163): through the native parser, an engine-bearing
// file silently DROPPED the entire §51.0 engine substrate (transition table,
// §51.0.C var-init, §51.0.D mount/body-render, §51.0.F `_scrml_engine_direct_set`
// rule-validated transition writes) — it compiled clean but emitted `<engine>`
// as a dumb reactive cell (`_scrml_reactive_set`).
//
// Root cause: the native pipeline synthesized TWO distinct `engine-decl`
// instances — one in `FileAST.nodes` (parse-file.js `synthEngineNode`) and a
// SEPARATE one in `FileAST.machineDecls` (collect-hoisted.js re-synthesized via
// `synthEngineDecl`). SYM PASS 10/11 stamped `_record`/`engineMeta` onto the
// `nodes` copy ONLY; codegen (`collectC12EngineDecls`, emit-engine.ts) reads
// `machineDecls`-first -> the un-stamped copy -> `isC12EngineDecl` returned
// false -> the engine fell out of codegen scope -> substrate dropped.
//
// THE FIX: `nativeParseFile` now derives `machineDecls` from the already-mapped
// `nodes` (`collectMachineDeclsFromNodes`), so each `machineDecls[]` entry IS
// the `nodes` engine-decl instance — exactly as live's `collectHoisted(nodes)`
// `machineDecls.push(node)` (ast-builder.js L13616). `collect-hoisted.js` no
// longer synthesizes engines. Engine `bodyChildren` are now mapped ASTNodes so
// nested `<engine>` is a structural engine-decl reachable by SYM + codegen.
//
// S449 RE-POINT: this file used to compile under the retired full-pipeline
// `--parser=scrml-native` flag. `nativeParseFile`'s engine synthesis is reached
// in production (component-expander re-parses a component body natively and
// collects the engines declared inside it), so the fix is asserted on the
// native tree — every `machineDecls` entry IS the `nodes` engine-decl instance,
// outer and nested — and the §51.0 substrate is asserted on the default
// pipeline's emit (R26 byte-presence, not fatal-error-absence — the S139 trap).

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";
import { unNamespaceEngineNames } from "../helpers/chunk-scope.js";
import { nativeAst, findNodes, errorsOf } from "../helpers/native-ast.js";

function compileDefault(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-engsub-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      clientJs: unNamespaceEngineNames(existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// A minimal modern-form engine: `for=` + state-children with `rule=`. The
// §51.0.F transition writes (`@phaseTag = PhaseTag.Loading`) lower to
// `_scrml_engine_direct_set(...)` (rule-validated) — NOT plain
// `_scrml_reactive_set` — when the engine is in codegen scope.
const BASIC_ENGINE = [
  "${",
  "    type PhaseTag : enum = { Idle, Loading, Done }",
  "}",
  "",
  "<engine for=PhaseTag initial=.Idle>",
  "    <Idle rule=.Loading></>",
  "    <Loading rule=.Done></>",
  "    <Done rule=.Idle></>",
  "</>",
  "",
  "<div>",
  "    <p>Phase: ${@phaseTag.variant}</>",
  "    <button onclick=${@phaseTag = PhaseTag.Loading}>Load</>",
  "    <button onclick=${@phaseTag = PhaseTag.Done}>Finish</>",
  "    <button onclick=${@phaseTag = PhaseTag.Idle}>Reset</>",
  "</div>",
].join("\n");

// A nested-engine file (§51.0.Q.1): PlayMode engine inside the Playing
// state-child of the AppMode engine. BOTH engines must get substrate.
const NESTED_ENGINE = [
  "${",
  "    type AppMode  : enum = { Title, Playing, Paused }",
  "    type PlayMode : enum = { Exploring, Battle }",
  "}",
  "",
  "<engine for=AppMode initial=.Title>",
  "    <Title rule=.Playing></>",
  "    <Playing rule=(.Title | .Paused)>",
  "        <engine for=PlayMode initial=.Exploring>",
  "            <Exploring rule=.Battle></>",
  "            <Battle rule=.Exploring></>",
  "        </>",
  "    </>",
  "    <Paused rule=.Playing></>",
  "</>",
  "",
  "<div>App: ${@appMode.variant}</div>",
].join("\n");

describe("native-engine substrate — instance sharing (S163), native tree", () => {
  test("machineDecls[0] IS the nodes engine-decl instance (one synthesis, not two)", () => {
    const nat = nativeAst(BASIC_ENGINE);
    expect(errorsOf(nat)).toEqual([]);
    const inNodes = findNodes(nat.ast.nodes, (n) => n.kind === "engine-decl");
    expect(inNodes).toHaveLength(1);
    expect(nat.ast.machineDecls).toHaveLength(1);
    expect(nat.ast.machineDecls[0]).toBe(inNodes[0]);
    expect(inNodes[0].governedType).toBe("PhaseTag");
  });

  test("outer AND nested engines are structural engine-decls shared with machineDecls (S163 bodyChildren)", () => {
    const nat = nativeAst(NESTED_ENGINE);
    expect(errorsOf(nat)).toEqual([]);
    const inNodes = findNodes(nat.ast.nodes, (n) => n.kind === "engine-decl");
    expect(inNodes.map((e) => e.governedType)).toEqual(["AppMode", "PlayMode"]);
    expect(nat.ast.machineDecls).toHaveLength(2);
    for (const m of nat.ast.machineDecls) expect(inNodes.includes(m)).toBe(true);
  });
});

describe("§51.0 engine substrate — default pipeline emit", () => {
  test("transition table + rule-validated direct_set writes + var-init, compiled clean", () => {
    const def = compileDefault(BASIC_ENGINE, "basic");
    expect(def.errors.length).toBe(0);
    expect(def.clientJs).toContain("__scrml_engine_phaseTag_transitions");
    expect(def.clientJs).toContain("_scrml_engine_direct_set");
    expect(def.clientJs).not.toMatch(/_scrml_reactive_set\("phaseTag",\s*PhaseTag\./);
    expect(def.clientJs).toContain("auto-declared engine variable: phaseTag");
  });

  test("outer AND nested engine transition tables both emitted", () => {
    const def = compileDefault(NESTED_ENGINE, "nested");
    expect(def.clientJs).toContain("__scrml_engine_appMode_transitions");
    expect(def.clientJs).toContain("__scrml_engine_playMode_transitions");
  });
});
