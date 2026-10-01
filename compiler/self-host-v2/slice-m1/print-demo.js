// print-demo.js — print a slice-M1 program's JS + HTML to stdout (a dev aid).
// usage: bun compiler/self-host-v2/slice-m1/print-demo.js counter|dropdown|valuesem [js|html]
import { loadBootstrap } from "./harness.js";

const which = process.argv[2] ?? "counter";
const part = process.argv[3] ?? "js";
const { mods } = loadBootstrap();
const core = mods[`${which}.core`][`${which}Core`]();
const out = mods.print.printProgram(core, `${which}.client.js`, "scrml-runtime.js");
console.log(part === "html" ? out.html : out.js);
