// Compile every review reproducer with a compiler tree; print the fatal codes.
//   bun docs/changes/s441-async-escape-f4-f5/review-repro/run.ts <compilerRoot>
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const here = import.meta.dir;
const { compileScrml } = await import(join(root, "compiler/src/api.js"));
for (const e of readdirSync(here).sort()) {
  const p = join(here, e);
  const file = statSync(p).isDirectory() ? join(p, "case.scrml") : (e.endsWith(".scrml") ? p : null);
  if (!file) continue;
  const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  const codes = [...new Set((r.errors || [])
    .filter((x: any) => x.severity !== "warning" && x.severity !== "info" && !/^[WI]-/.test(x.code ?? ""))
    .map((x: any) => x.code))];
  console.log(`${e.padEnd(34)} ${codes.length ? codes.join(",") : "(compiles)"}`);
}
