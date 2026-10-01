// Diff two corpus-measure.ts outputs: which files gain / lose error codes.
//   bun corpus-diff.ts <base.json> <head.json>
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2);
const base: Record<string, string[]> = JSON.parse(readFileSync(a, "utf8"));
const head: Record<string, string[]> = JSON.parse(readFileSync(b, "utf8"));
const newlyFailing: string[] = [];
const newlyPassing: string[] = [];
const changed: string[] = [];
for (const f of Object.keys(head).sort()) {
  const bc = base[f] ?? [];
  const hc = head[f];
  const added = hc.filter((c) => !bc.includes(c));
  const removed = bc.filter((c) => !hc.includes(c));
  if (bc.length === 0 && hc.length > 0) newlyFailing.push(`${f}  +${added.join(",")}`);
  else if (bc.length > 0 && hc.length === 0) newlyPassing.push(`${f}  -${removed.join(",")}`);
  else if (added.length || removed.length) changed.push(`${f}  +[${added.join(",")}] -[${removed.join(",")}]`);
}
console.log(`files: ${Object.keys(head).length}`);
console.log(`NEWLY FAILING (${newlyFailing.length}):`); for (const l of newlyFailing) console.log("  " + l);
console.log(`NEWLY PASSING (${newlyPassing.length}):`); for (const l of newlyPassing) console.log("  " + l);
console.log(`CODE SET CHANGED, still failing (${changed.length}):`); for (const l of changed) console.log("  " + l);
