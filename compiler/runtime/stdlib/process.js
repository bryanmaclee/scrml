// scrml:process — runtime shim
//
// Hand-written ES module mirroring stdlib/process/index.scrml. Server-only:
// scrml:process is in SERVER_ONLY_SCRML_MODULES (§12.2 Trigger 3); all
// exports use Node/Bun `process` global.
//
// Surface (must match stdlib/process/index.scrml exports):
//   - cwd()             → string
//   - env(key)          → string | null
//   - argv()            → string[]
//   - platform()        → string
//   - exit(code?)       → never
//   - uptime()          → number (seconds)
//   - memoryUsage()     → { heapUsed, heapTotal, rss }

export function cwd() {
  return process.cwd();
}

export function env(key) {
  // Mirror scrml: undefined/null key → not. Missing env var → not.
  if (key === null || key === undefined) return null;
  const val = process.env[String(key)];
  return val !== undefined && val !== null ? val : null;
}

export function argv() {
  return Array.from(process.argv);
}

export function platform() {
  return process.platform;
}

export function exit(code) {
  process.exit(code !== undefined && code !== null ? code : 0);
}

export function uptime() {
  return process.uptime();
}

export function memoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
  };
}
