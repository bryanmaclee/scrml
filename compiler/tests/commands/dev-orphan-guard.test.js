// g-dev-watcher-tests-leak-server-processes — the dev server's parent-death
// guard. When `scrml dev` is spawned by a harness/agent that is later
// force-killed (no chance to reap), the child must detect the vanished parent
// and shut down rather than survive as an orphan holding fs.watch (inotify)
// handles — enough orphans exhaust the machine's inotify budget (EMFILE) and no
// dev server or watcher test can start (the failure #577 measured: 89 orphans).
//
// These tests pin the guard's DECISION helper deterministically (no spawning,
// so no flake and no leak of their own). The full spawn→kill→self-exit wiring
// is exercised in production; installing it as a live test would itself risk the
// orphaning it guards against.
import { describe, test, expect } from "bun:test";
import { launchingProcessGone } from "../../src/commands/dev.js";

describe("scrml dev — parent-death guard (g-dev-watcher-tests-leak-server-processes)", () => {
  test("the real launching parent is reported ALIVE (ppid matches, process exists)", () => {
    // process.ppid is this runner's live parent; launchPpid === ppid → not gone.
    expect(launchingProcessGone(process.ppid)).toBe(false);
  });

  test("a launch ppid that no longer matches process.ppid is reported GONE (Linux reparent signal)", () => {
    // Simulate reparenting: the recorded launch ppid differs from the current
    // ppid, which is exactly what a Linux parent-death reparent produces.
    const reparentedAway = process.ppid + 1_000_000;
    expect(launchingProcessGone(reparentedAway)).toBe(true);
  });

  test("a nonexistent launch pid is reported GONE (cross-OS kill(pid,0) existence probe)", () => {
    // A pid far above any live process: the ppid-mismatch branch fires first
    // here, but this also documents that a vanished launcher is never alive.
    expect(launchingProcessGone(2_147_483_646)).toBe(true);
  });
});
