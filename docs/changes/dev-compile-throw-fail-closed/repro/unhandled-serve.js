// Probe 2: same throw shape but with a live Bun.serve() keeping the process up
// (the real dev.js shape). Does the server survive the unhandled rejection?
const server = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
console.log("serving on", server.port);
setTimeout(async () => { throw new Error("boom in async timer cb"); }, 10);
setTimeout(async () => {
  const r = await fetch(`http://localhost:${server.port}/`);
  console.log("still alive after 300ms; fetch status", r.status);
  process.exit(0);
}, 300);
