/**
 * Per-process temp root for `bun test` (S448, change-id s448-test-tmp-root).
 * Registered as a `[test] preload` in the repo-root `bunfig.toml`, so it runs once,
 * before any test file, in every `bun test` process launched from the repo root.
 *
 * WHY. The suite leaks temp files. One run of the pre-commit subset left ~870 top-level
 * entries / ~6,800 files in /tmp (S448 measurement; 529 test files call tmpdir()/mkdtemp,
 * ~100 never clean up, and several that try still leak — class-dynamic-import-reject
 * alone left 212 `cdireject*` dirs per run). Every agent commit runs that hook; on a
 * machine whose /tmp is wiped at boot the backlog reached ~1M files and a 1h45m boot.
 * Fixing 529 files one by one would not stay fixed, so this fixes the PLACE instead.
 *
 * WHAT. Creates `<base>/<pid>-<random>`, points TMPDIR (and TEMP / TMP, which Windows
 * reads) at it, and removes it when the process ends. bun's `os.tmpdir()` reads TMPDIR at
 * call time, so every `tmpdir()` / `mkdtemp(join(tmpdir(), …))` caller lands inside the
 * root, and every child process a test spawns inherits it — whether or not the test
 * cleans up after itself.
 *
 * CHILD PROCESSES. `child_process.*` and `Bun.$` pass the live `process.env`, but
 * `Bun.spawn` / `Bun.spawnSync` called WITHOUT an `env` option use the environment the
 * process STARTED with (bun 1.4.2, verified) — so the TMPDIR set here would not reach
 * them. We therefore wrap those two: when (and only when) a call passes no `env`, it gets
 * the startup environment plus TMPDIR/TEMP/TMP pointing at the root. Every other variable
 * the child sees is exactly what it saw before; calls that pass `env` are untouched.
 *
 * REMOVAL. `bun test` 1.4.2 does NOT emit `process.on("exit")` / `"beforeExit"` when a run
 * ends normally, and a `--bail` abort (the pre-commit hook runs with `--bail`) skips even
 * `afterAll`. So removal is layered:
 *   1. a global `afterAll` (registered from this preload => runs once, after every file);
 *   2. `process.on("exit")` — covers runs that end through an explicit `process.exit()`;
 *   3. SIGINT / SIGTERM / SIGHUP: remove, then re-deliver the signal so the exit status is
 *      the signal's;
 *   4. POSIX backstop: a detached `sh` watchdog that waits for this pid to disappear and
 *      then removes the root — covers `--bail`, crashes and SIGKILL;
 *   5. stale-root prune at startup (below) — covers anything the above missed, notably a
 *      Windows run whose open sqlite handle made the rm fail with EBUSY.
 *
 * <base>. `SCRML_TEST_TMP_BASE` if set; otherwise `${XDG_CACHE_HOME:-~/.cache}/scrml-test-tmp`.
 * A caller's pre-set TMPDIR is deliberately NOT used as the base: the rule is always
 * "<base>/<pid>-<rand>", with exactly one knob (SCRML_TEST_TMP_BASE) to move it. That keeps
 * the location — and the stale-root prune — in one predictable directory.
 *
 * ⚑ <base> MUST NOT sit inside a git repo or under a directory holding a scrml.toml.
 * Project-root discovery (and chunk-namespace.ts's no-project-root tier) walks UP from a
 * source file looking for scrml.toml / .git; the tests that compile throwaway projects in
 * tmpdir rely on finding NEITHER. A repo-local scratch dir would silently change what those
 * tests test. So the base is checked (lexically and after realpath); if unsafe we fall back
 * to `<original os.tmpdir()>/scrml-test-tmp` (still per-process, still removed); if that is
 * unsafe too, TMPDIR is left untouched (the pre-S448 behaviour). Either fallback prints one
 * warning line — fail SAFE for test semantics, never fail the run.
 *
 * STALE ROOTS. On start, sibling roots older than 24h whose pid is no longer alive are
 * removed. A live process's root is never touched — overlapping suite runs are routine.
 */
import { afterAll } from "bun:test";
import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "fs";
import { homedir, tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { randomBytes } from "crypto";

const STALE_MS = 24 * 60 * 60 * 1000;
const ROOT_NAME = /^(\d+)-[0-9a-f]+$/;

/** True when `dir` or any ancestor holds a `.git` or a `scrml.toml`. */
function hasProjectAncestor(dir) {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, ".git")) || existsSync(join(cur, "scrml.toml"))) return true;
    const up = dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
}

/** Create `base`; return its real path if neither it nor its real path has a project ancestor. */
function safeBase(base) {
  try {
    if (hasProjectAncestor(base)) return null;
    mkdirSync(base, { recursive: true });
    const real = realpathSync(base);
    if (hasProjectAncestor(real)) return null;
    return real;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = exists but not ours. Anything other than ESRCH: assume alive (never delete).
    return e?.code !== "ESRCH";
  }
}

function rmQuiet(p) {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    /* EBUSY (Windows open handle) etc. — the watchdog or the next run's prune reaps it */
  }
}

function pruneStale(base) {
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const m = ROOT_NAME.exec(name);
    if (!m) continue;
    const p = join(base, name);
    try {
      if (now - statSync(p).mtimeMs < STALE_MS) continue;
    } catch {
      continue;
    }
    if (pidAlive(Number(m[1]))) continue;
    rmQuiet(p);
  }
}

/** Detached POSIX watchdog: removes `root` once this process is gone, however it died. */
function startWatchdog(root, base) {
  if (process.platform === "win32") return;
  try {
    const child = spawn(
      "/bin/sh",
      ["-c", 'while kill -0 "$1" 2>/dev/null; do sleep 1; done; rm -rf -- "$2"', "scrml-test-tmp-watchdog", String(process.pid), root],
      { cwd: base, detached: true, stdio: "ignore" },
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no /bin/sh — the in-process hooks and the stale prune still apply */
  }
}

/** Make `Bun.spawn` / `Bun.spawnSync` calls that pass no `env` see the temp root (see header). */
function routeBunSpawnEnv(childEnv) {
  if (typeof Bun === "undefined") return;
  const withEnv = (args) => {
    const [first, second] = args;
    if (Array.isArray(first)) {
      if (second == null) return [first, { env: childEnv }, ...args.slice(2)];
      if (typeof second === "object" && second.env === undefined) {
        return [first, { ...second, env: childEnv }, ...args.slice(2)];
      }
    } else if (first && typeof first === "object" && first.env === undefined) {
      return [{ ...first, env: childEnv }, ...args.slice(1)];
    }
    return args;
  };
  const spawnOrig = Bun.spawn;
  const spawnSyncOrig = Bun.spawnSync;
  Bun.spawn = function spawn(...args) {
    return spawnOrig.apply(this, withEnv(args));
  };
  Bun.spawnSync = function spawnSync(...args) {
    return spawnSyncOrig.apply(this, withEnv(args));
  };
}

function install() {
  const startupEnv = { ...process.env };
  const originalTmp = tmpdir();
  const xdg = process.env.XDG_CACHE_HOME;
  const preferred =
    process.env.SCRML_TEST_TMP_BASE ||
    join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache"), "scrml-test-tmp");

  let base = safeBase(preferred);
  if (base === null) {
    const fallback = join(originalTmp, "scrml-test-tmp");
    base = safeBase(fallback);
    console.warn(
      base === null
        ? `[tmp-root-preload] ${preferred} and ${fallback} are inside a git repo / scrml.toml project — leaving TMPDIR=${originalTmp} unchanged (tests will leak into it)`
        : `[tmp-root-preload] ${preferred} is unusable (inside a git repo / scrml.toml project, or not creatable) — using ${fallback}`,
    );
    if (base === null) return;
  }

  pruneStale(base);

  const root = join(base, `${process.pid}-${randomBytes(6).toString("hex")}`);
  mkdirSync(root, { recursive: true });
  process.env.TMPDIR = root;
  process.env.TEMP = root;
  process.env.TMP = root;
  routeBunSpawnEnv({ ...startupEnv, TMPDIR: root, TEMP: root, TMP: root });

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    rmQuiet(root);
  };
  afterAll(cleanup);
  process.on("exit", cleanup);
  startWatchdog(root, base);

  // Signals: remove the root, then re-deliver the signal with our listener gone so the
  // process dies of it (correct exit status). If something else also listens for the
  // signal, it owns the behaviour — leave it alone; the watchdog still cleans up.
  const SIGNUM = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };
  for (const sig of Object.keys(SIGNUM)) {
    if (process.platform === "win32" && sig === "SIGHUP") continue;
    const onSignal = () => {
      if (process.listenerCount(sig) > 1) return;
      cleanup();
      process.removeListener(sig, onSignal);
      if (process.platform === "win32") process.exit(128 + SIGNUM[sig]);
      try {
        process.kill(process.pid, sig);
      } catch {
        process.exit(128 + SIGNUM[sig]);
      }
    };
    try {
      process.on(sig, onSignal);
    } catch {
      /* signal not supported on this platform */
    }
  }
}

install();
