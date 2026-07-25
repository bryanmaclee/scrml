// native-engine-substrate-instance-share.test.js — S163 native-parser-swap fix.
//
// THE BUG (root-caused S163): under `--parser=scrml-native`, an engine-bearing
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
// This test asserts the §51.0 substrate is PRESENT under native, identical in
// kind to default (R26 byte-presence, not fatal-error-absence — the S139 trap).

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { unNamespaceEngineNames } from "../helpers/chunk-scope.js";

// compileWith — compile `source` to client.js under `parser` (null = default
// live BS+TAB; "scrml-native" = native pipeline). Returns errors + warnings +
// client.js text. Mirrors native-each-promotion.test.js's helper.
function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-engsub-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: unNamespaceEngineNames(clientJs),
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

describe("native-engine substrate — instance sharing (S163)", () => {
  test("native emits the §51.0.F transition table (was DROPPED pre-S163)", () => {
    const nat = compileWith(BASIC_ENGINE, "scrml-native", "basic-table");
    expect(nat.clientJs).toContain("__scrml_engine_phaseTag_transitions");
  });

  test("native emits §51.0.F transition writes as _scrml_engine_direct_set, not a dumb reactive cell", () => {
    const nat = compileWith(BASIC_ENGINE, "scrml-native", "basic-direct");
    // The rule-validated write IS present...
    expect(nat.clientJs).toContain("_scrml_engine_direct_set");
    // ...and the §51.0.F engine writes are NOT downgraded to plain
    // `_scrml_reactive_set("phaseTag", PhaseTag.X)` (the dropped-substrate symptom).
    expect(nat.clientJs).not.toMatch(/_scrml_reactive_set\("phaseTag",\s*PhaseTag\./);
  });

  test("native engine substrate is identical in KIND to default (byte-presence parity)", () => {
    const nat = compileWith(BASIC_ENGINE, "scrml-native", "basic-parity-nat");
    const def = compileWith(BASIC_ENGINE, null, "basic-parity-def");
    const countOf = (s, needle) => s.split(needle).length - 1;
    // Same number of transition-table refs, var-init, and direct_set writes.
    expect(countOf(nat.clientJs, "__scrml_engine_phaseTag_transitions"))
      .toBe(countOf(def.clientJs, "__scrml_engine_phaseTag_transitions"));
    expect(countOf(nat.clientJs, "_scrml_engine_direct_set"))
      .toBe(countOf(def.clientJs, "_scrml_engine_direct_set"));
    // The §51.0.C engine var-init comment marker is present in both.
    expect(nat.clientJs).toContain("auto-declared engine variable: phaseTag");
    expect(def.clientJs).toContain("auto-declared engine variable: phaseTag");
  });

  test("native client.js compiles clean AND emits valid JS substrate", () => {
    const nat = compileWith(BASIC_ENGINE, "scrml-native", "basic-clean");
    // No fatal errors (the file compiled).
    expect(nat.errors.length).toBe(0);
    // Substrate present (the actual fix — clean-compile alone was the S139 trap).
    expect(nat.clientJs).toContain("__scrml_engine_phaseTag_transitions");
    expect(nat.clientJs).toContain("_scrml_engine_direct_set");
  });

  test("native emits substrate for BOTH the outer AND the nested engine (S163 bodyChildren)", () => {
    const nat = compileWith(NESTED_ENGINE, "scrml-native", "nested-nat");
    const def = compileWith(NESTED_ENGINE, null, "nested-def");
    // Outer (appMode) and nested (playMode) transition tables BOTH present...
    expect(nat.clientJs).toContain("__scrml_engine_appMode_transitions");
    expect(nat.clientJs).toContain("__scrml_engine_playMode_transitions");
    // ...matching default, which has always emitted both.
    expect(def.clientJs).toContain("__scrml_engine_appMode_transitions");
    expect(def.clientJs).toContain("__scrml_engine_playMode_transitions");
  });
});
