// ENTRY-NESS CENSUS — repointed from the held prod-root-fallback branch
// (`worktree-agent-a7754ec5541a9ab8f:docs/changes/prod-root-fallback-gated-2026-09-05/rulecensus.ts`)
// and extended for entry-ness-unification-2026-09-05.
//
// TWO CHANGES vs the original, both deliberate:
//
//  1. The worktree root is an ARGUMENT, not a hardcoded const. The original
//     pinned one agent's worktree path at its top, which makes it a
//     single-use artifact.
//
//  2. It reports the RECORDED classification alongside the reconstructions, so
//     the before/after is a comparison and not two separate runs. R2/R3 are
//     evaluated BOTH the legacy way (the discarded local predicates, replicated
//     here verbatim from the pre-change `ast-builder.js`) and the new way (the
//     recorded `fileShape`), so a single run shows what moved.
//
// Usage: bun run <this> <worktreeRoot> <appDir>
import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";

const WT = process.argv[2];
const dir = process.argv[3];
if (!WT || !dir) {
  console.error("usage: bun run rulecensus.ts <worktreeRoot> <appDir>");
  process.exit(2);
}

const { splitBlocks } = await import(`${WT}/compiler/src/block-splitter.js`);
const { buildAST } = await import(`${WT}/compiler/src/ast-builder.js`);
const { computeFileShape } = await import(`${WT}/compiler/src/compute-pgo-flags.ts`);
// ⚑ The PRE-CHANGE `isPureModuleFile` admitted a §23.6 `<foreign lang>` library decl as
// NON-disqualifying markup. R2 below MUST carry that clause or it under-counts the
// legacy suppression set and manufactures a favourable delta. See the note at R2.
const { isForeignLangLibDecl } = await import(`${WT}/compiler/src/library-shape.js`);

function walk(d: string): string[] {
  const acc: string[] = [];
  for (const e of readdirSync(d).sort()) {
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e !== "dist" && e !== "node_modules") acc.push(...walk(p));
    } else if (e.endsWith(".scrml")) acc.push(p);
  }
  return acc;
}

const ROUTE_PREFIXES = ["/routes/", "/pages/"];
const files = walk(dir);

type Row = {
  rel: string;
  hasProgramRoot: boolean; // R1 auth-graph · codegen · tool-program (rule A)
  pureModule: boolean; // R2 the DISCARDED ast-builder isPureModuleFile (rule B)
  nonEntryPage: boolean; // R3 the DISCARDED ast-builder isNonEntryPageFile (rule B)
  noTopLevelPage: boolean; // R4 the prod-root-fallback arc's rule (rule D)
  notUnderRouteDir: boolean; // R5 route-inference ROUTE_PREFIXES (rule F)
  fileShape: string; // NEW — the RECORDED fact
  w001: number; // W-PROGRAM-001 fires
};

const rows: Row[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  let out: any;
  try {
    out = buildAST(splitBlocks(f, src), null);
  } catch (e) {
    console.log(`  !! ${relative(dir, f)}: ${(e as Error).message.slice(0, 60)}`);
    continue;
  }
  const a = out.ast ?? out;
  computeFileShape(a); // simulate the Stage 3.004 PRECG seam
  const nodes = Array.isArray(a.nodes) ? a.nodes : [];
  const hasProgramRoot = a.hasProgramRoot === true;
  // R2/R3 replicate the PRE-CHANGE local consts VERBATIM, so "before" is measured
  // rather than remembered.
  //
  // ⛑ CORRECTED (fix round). This probe was inherited from the held prod-root-fallback
  // branch with `|| isForeignLangLibDecl(n)` MISSING from R2, and the "verbatim" claim
  // above was then written over the top of the discrepancy without checking it. The
  // effect was not cosmetic: on `conformance/cases/foreign` the census reported
  // `legacy "unrecognized shape -> WARN" (7)` against `now fires (0)`, crediting this
  // change with fixing seven spurious warnings — while its OWN histogram showed all
  // eight non-program files as `pure-module`, a category that existed at base and was
  // ALREADY suppressed there. The true delta is ZERO. The flagship numbers survived
  // only because that app happens to contain no `<foreign lang>` decls.
  //
  // A verification instrument that manufactures a favourable delta is worse than no
  // instrument. The clause is restored from `git show origin/main:compiler/src/ast-builder.js`.
  const pureModule =
    !hasProgramRoot &&
    nodes.length > 0 &&
    nodes.every((n: any) => n && (n.kind !== "markup" || isForeignLangLibDecl(n)));
  const nonEntryPage =
    !hasProgramRoot && nodes.some((n: any) => n && n.kind === "markup" && n.tag === "page");
  const noTopLevelPage = !nodes.some((n: any) => n && n.kind === "markup" && n.tag === "page");
  const norm = f.replace(/\\/g, "/");
  const notUnderRouteDir = !ROUTE_PREFIXES.some((p) => norm.indexOf(p) !== -1);
  const w001 = (out.errors ?? []).filter((e: any) => e?.code === "W-PROGRAM-001").length;
  rows.push({
    rel: relative(dir, f),
    hasProgramRoot,
    pureModule,
    nonEntryPage,
    noTopLevelPage,
    notUnderRouteDir,
    fileShape: String(a.fileShape),
    w001,
  });
}

const b = (x: boolean) => (x ? "Y" : ".");
console.log(`\n${"file".padEnd(44)} R1prog R2pure R3page R4mine R5pos  W001  fileShape`);
console.log("-".repeat(104));
for (const r of rows) {
  console.log(
    `${r.rel.padEnd(44)}   ${b(r.hasProgramRoot)}      ${b(r.pureModule)}      ` +
      `${b(r.nonEntryPage)}      ${b(r.noTopLevelPage)}     ${b(r.notUnderRouteDir)}` +
      `    ${r.w001}    ${r.fileShape}`,
  );
}

// ---------------------------------------------------------------------------
// THE QUESTION EACH RULE IS ACTUALLY ANSWERING.
//
// The original probe asked "which files does each rule call THE ENTRY", and
// treated disagreement as the defect. That framing does not survive SPEC §40.8:
//
//   "The entry file is the file resolved by the build root."
//
// Entry identity is a BUILD fact. No rule below can answer it from a FileAST, so
// "make them all agree on the entry" is not a reachable goal — R1 and R4/R5
// answer DIFFERENT questions and SHOULD differ. What IS reachable, and what this
// census now measures, is that every rule that asks "what SHAPE is this file"
// gets the same answer from the same place.
// ---------------------------------------------------------------------------

const setR1 = rows.filter((r) => r.hasProgramRoot).map((r) => r.rel);
const setR4 = rows.filter((r) => r.noTopLevelPage).map((r) => r.rel);
const setR5 = rows.filter((r) => r.notUnderRouteDir).map((r) => r.rel);
const setR23 = rows
  .filter((r) => r.hasProgramRoot || (!r.pureModule && !r.nonEntryPage))
  .map((r) => r.rel);
const setShape = rows.filter((r) => r.fileShape === "program").map((r) => r.rel);

console.log(`\nDECLARES-A-TOP-LEVEL-<program> (the file fact, per rule)`);
console.log(`  R1  hasProgramRoot            (${setR1.length}): ${JSON.stringify(setR1)}`);
console.log(`  NEW fileShape === "program"   (${setShape.length}): ${JSON.stringify(setShape)}`);
console.log(
  `  AGREE: ${JSON.stringify(setR1) === JSON.stringify(setShape) ? "YES" : "NO"}`,
);

console.log(`\nSHAPE-CLASSIFICATION AGREEMENT (the claim this change makes)`);
const legacyShapeSet = rows.filter(
  (r) => !r.hasProgramRoot && !r.pureModule && !r.nonEntryPage,
);
console.log(
  `  legacy "unrecognized shape -> WARN" (${legacyShapeSet.length}): ` +
    JSON.stringify(legacyShapeSet.map((r) => r.rel)),
);
const nowWarn = rows.filter((r) => r.w001 > 0);
console.log(
  `  now W-PROGRAM-001 fires             (${nowWarn.length}): ` +
    JSON.stringify(nowWarn.map((r) => r.rel)),
);
const shapeHisto: Record<string, number> = {};
for (const r of rows) shapeHisto[r.fileShape] = (shapeHisto[r.fileShape] ?? 0) + 1;
console.log(`  fileShape histogram: ${JSON.stringify(shapeHisto)}`);

console.log(`\nPOSITION / ROUTE-DERIVATION RULES (a DIFFERENT question — see note above)`);
console.log(
  `  R4  no top-level <page>       (${setR4.length}): ` +
    `${JSON.stringify(setR4.slice(0, 8))}${setR4.length > 8 ? " ..." : ""}`,
);
console.log(
  `  R5  not under pages//routes/  (${setR5.length}): ` +
    `${JSON.stringify(setR5.slice(0, 8))}${setR5.length > 8 ? " ..." : ""}`,
);
console.log(`  R23 legacy 3-way implied-entry(${setR23.length})`);
