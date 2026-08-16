/**
 * dev-watcher-snapshot-identity.test.js
 *
 * S346 review finding F1, pinned. The watcher decides "did a source change?"
 * from a stat snapshot. With `{mtimeMs, size, ino}` alone that decision is
 * EVASIBLE: an in-place same-length write followed by `utimesSync(f, atime,
 * mtime)` restores mtime exactly (measured identical to sub-millisecond
 * precision), keeps the size, and keeps the inode — so the sweep runs, sees
 * nothing, and dev serves the OLD bundle at 200 while disk holds the new
 * source. That is the silent stale-serve class #518 closed, reintroduced by
 * the dir-watch + snapshot design.
 *
 * `ctimeMs` closes it BY CONSTRUCTION: POSIX exposes no API to set ctime, and
 * any content or metadata write moves it. This pins that the evasion is dead
 * without enumerating which tools perform such writes.
 *
 * RED before the ctimeMs field was added (the edit is never detected); GREEN after.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, statSync, utimesSync, openSync, writeSync, closeSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("dev watcher snapshot identity — a timestamp-restoring in-place write cannot hide", () => {
  test("an in-place same-length write with mtime restored still moves ctime, so the snapshot sees it", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-snapid-"));
    try {
      const f = join(dir, "entry.scrml");
      writeFileSync(f, "<program>\n<div>Hello v1 pad</div>\n</program>\n");
      const before = statSync(f);

      // The evasion: same length, written in place, mtime restored precisely.
      const fd = openSync(f, "r+");
      writeSync(fd, Buffer.from("Hullo"), 0, 5, 21);
      closeSync(fd);
      utimesSync(f, before.atimeMs / 1000, before.mtimeMs / 1000);
      const after = statSync(f);

      // The three fields the pre-fix tuple used are ALL preserved — this is the
      // premise of the finding, asserted so the pin fails loudly if a future
      // platform/filesystem stops preserving them (which would make it vacuous).
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.size).toBe(before.size);
      expect(String(after.ino)).toBe(String(before.ino));

      // ctime is the field that cannot be restored.
      expect(after.ctimeMs).not.toBe(before.ctimeMs);

      // The snapshot comparison the watcher actually performs.
      const snap = (st) => ({ mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size, ino: Number(st.ino) || 0 });
      const prev = snap(before), cur = snap(after);
      const changed = prev.mtimeMs !== cur.mtimeMs || prev.ctimeMs !== cur.ctimeMs
        || prev.size !== cur.size || prev.ino !== cur.ino;
      expect(changed).toBe(true);

      // And the pre-fix tuple would have missed it — the regression this pins.
      const preFixChanged = prev.mtimeMs !== cur.mtimeMs || prev.size !== cur.size || prev.ino !== cur.ino;
      expect(preFixChanged).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
