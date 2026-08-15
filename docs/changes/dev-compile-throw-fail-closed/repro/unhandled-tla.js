// Probe 6: same as probe 2 but the module ends in a never-resolving top-level
// await (the exact shape of cli.js -> runDev's `await new Promise(() => {})`).
// Hypothesis: THIS is why the real dev process survives the unhandled rejection.
const server = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
console.log("serving on", server.port);
setTimeout(async () => { throw new Error("boom in async timer cb"); }, 10);
setTimeout(async () => {
  const r = await fetch(`http://localhost:${server.port}/`);
  console.log("still alive after 300ms; fetch status", r.status);
  process.exit(0);
}, 300);
await new Promise(() => {});
