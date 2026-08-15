// Probe: what does Bun do with a throw inside an async setTimeout callback
// (the exact shape of dev.js scheduleRecompile's debounce callback)?
setTimeout(async () => { throw new Error("boom in async timer cb"); }, 10);
setTimeout(() => { console.log("still alive after 200ms"); }, 200);
setTimeout(() => { console.log("exiting normally"); process.exit(0); }, 400);
