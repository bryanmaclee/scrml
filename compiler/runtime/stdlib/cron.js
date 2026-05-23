// scrml:cron — runtime shim
//
// Hand-written ES module mirroring stdlib/cron/index.scrml. Thin wrapper
// over Bun.cron (Bun ≥ 1.3.12). Server-side only — uses the global Bun.cron;
// any call in a non-Bun runtime will fail with a clear ReferenceError on
// `Bun`.
//
// Surface (must match stdlib/cron/index.scrml exports):
//   - schedule(pattern, handler)              → CronJob handle
//   - nextOccurrence(pattern, relativeDate?)  → Date | null
//   - stop(job)                               — convenience wrapper

export function schedule(pattern, handler) {
  return Bun.cron(pattern, handler);
}

export function nextOccurrence(pattern, relativeDate) {
  return Bun.cron.parse(pattern, relativeDate);
}

export function stop(job) {
  if (job && typeof job.stop === "function") {
    job.stop();
  }
}
