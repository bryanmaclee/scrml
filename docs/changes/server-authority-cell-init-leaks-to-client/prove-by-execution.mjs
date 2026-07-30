import { Window } from "happy-dom";
import { readFileSync } from "fs";
import vm from "node:vm";
const win = new Window({ url: "http://localhost/" });
win.document.write(readFileSync("./out-canonical/canonical.html", "utf8"));
const sandbox = { window: win, document: win.document, console,
  location: win.location, navigator: win.navigator, fetch: async () => ({ ok:true, json: async()=>({}) }),
  setTimeout, clearTimeout, queueMicrotask, requestAnimationFrame:(f)=>setTimeout(f,0), URL, crypto };
sandbox.globalThis = sandbox; sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(readFileSync("./out-canonical/scrml-runtime.01vnoh4e.js","utf8"), ctx);
// SPY on the real runtime setter the IIFE wrappers delegate to.
vm.runInContext(`
  globalThis.__setCalls = [];
  const __orig = _scrml_reactive_set;
  _scrml_reactive_set = function(k, v){ globalThis.__setCalls.push([k, v]); return __orig.apply(this, arguments); };
`, ctx);
try { vm.runInContext(readFileSync("./out-canonical/canonical.client.js","utf8"), ctx); }
catch (e) { console.log("client threw:", e.message); }
const calls = vm.runInContext("globalThis.__setCalls.map(([k,v]) => k + ' = ' + JSON.stringify(v))", ctx);
console.log(">>> reactive SETs that EXECUTED in the client runtime:");
for (const c of calls) console.log("   ", c);
