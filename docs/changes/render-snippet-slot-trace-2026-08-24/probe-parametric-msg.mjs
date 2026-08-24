/**
 * S372 trace probe — the SECOND decision site (parametric snippet path).
 *
 * With the LIVE re-parse forced (proxy for the translate-expr.js:296 fix), the
 * parametric row compiles to E-CODEGEN-INVALID-LOGIC. Capture the message so the
 * fix dispatch knows the second site is component-expander.ts:3153-3161, which
 * pushes the substituted lambda body as a RAW STRING `bare-expr.expr` with no
 * exprNode — i.e. markup text handed to codegen as a JS expression.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-parametric-msg.mjs
 */
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";

const R =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-msg";
mkdirSync(R, { recursive: true });
const D = "$";

const src = [
  "<program>", "", "  <mode> = \"a\"", "",
  "  const Row = <div class=\"row\" props={ label: string, control: snippet(n: string) }>",
  "    <span class=\"c\">" + D + "{render control(label)}</span>",
  "    <match @mode>", "      <is \"a\"></is>", "      <else></else>", "    </match>",
  "  </>", "",
  "  <div class=\"app\"><Row label=\"LBL\" control={ (n) => <strong>" + D + "{n}</strong> }/></div>",
  "", "</program>", "",
].join("\n");

const f = resolve(R, "m.scrml");
writeFileSync(f, src);
const r = compileScrml({ inputFiles: [f], write: true, outputDir: resolve(R, "out") });
for (const e of r.errors ?? []) {
  console.log(`${e.code} :: ${String(e.message).slice(0, 500)}`);
}
if ((r.errors ?? []).length === 0) console.log("(no errors)");
