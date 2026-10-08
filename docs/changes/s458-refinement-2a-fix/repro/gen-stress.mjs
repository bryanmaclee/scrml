// S458 2a-fix F3 — the exponential-output stress case from the 2a review:
// 4 levels of structs, each struct reusing the level below K times, 40 refined
// fields in total, 30 functions taking / building the top struct.
// Usage: bun gen-stress.mjs <out.scrml> [K=3] [FNS=30]
import { writeFileSync } from "fs";
const out = process.argv[2];
const K = +(process.argv[3] ?? 3);
const FNS = +(process.argv[4] ?? 30);
const L = [];
let refined = 0;
const field = (i) => { refined++; return i % 2 ? `f${i}: number(>${i})` : `s${i}: string(.length >= ${i % 5})`; };
// level 0: 10 refined fields
L.push(`    type S0:struct = { ${Array.from({ length: 10 }, (_, i) => field(i)).join(", ")} }`);
for (let lvl = 1; lvl < 4; lvl++) {
  const fs = Array.from({ length: K }, (_, i) => `c${i}: S${lvl - 1}`);
  for (let i = 0; i < 10; i++) fs.push(field(lvl * 10 + i));
  L.push(`    type S${lvl}:struct = { ${fs.join(", ")} }`);
}
for (let i = 0; i < FNS; i++) {
  L.push(`    function take${i}(x: S3) { return x.f31 }`);
}
L.push(`    <top>: S3 | not = not`);
L.push(`    function setTop(v) { @top = v }`);
const uses = Array.from({ length: FNS }, (_, i) => `<p>\${take${i}(@top)}</p>`).join("\n");
const src = `\${\n${L.join("\n")}\n}\n<program>\n<button id="b" onclick=\${setTop(not)}>b</button>\n${uses}\n</program>\n`;
writeFileSync(out, src);
console.log(`wrote ${out}: ${refined} refined fields, K=${K}, ${FNS} functions`);
