/**
 * stdlib-path — unit tests for scrml:path
 *
 * Tests each path function directly using node:path.
 * Functions extracted here match stdlib/path/index.scrml exactly
 * (minus server {} wrappers, since tests run in Bun).
 *
 * Coverage:
 *   P1-P4   join
 *   P5-P8   resolve
 *   P9-P11  dirname
 *   P12-P15 basename
 *   P16-P18 extname
 *   P19-P21 relative
 *   P22-P24 normalize
 */

import { describe, test, expect } from "bun:test";
import path from "node:path";

// ---------------------------------------------------------------------------
// Function re-definitions (mirror stdlib/path/index.scrml logic)
// ---------------------------------------------------------------------------

// POSIX-normalize native separators (mirrors stdlib/path/index.scrml's
// toPosixSep). Node emits `\` on Windows; scrml:path output is `/`-separated
// on every host by contract. On POSIX this is a no-op.
function toPosixSep(p) {
    if (p == null) return p
    return p.split("\\").join("/")
}

function join(...segments) {
    const filtered = segments.filter(s => s != null)
    if (filtered.length === 0) return "."
    return toPosixSep(path.join(...filtered))
}

function resolve(...segments) {
    // path.posix.resolve keeps `/`-rooted paths `/`-rooted on Windows (native
    // path.resolve would drive-root them, e.g. `/usr` → `C:\usr`). Identical to
    // path.resolve on POSIX. Mirrors stdlib/path/index.scrml.
    const filtered = segments.filter(s => s != null)
    if (filtered.length === 0) return toPosixSep(path.posix.resolve())
    return toPosixSep(path.posix.resolve(...filtered))
}

function dirname(filePath) {
    if (filePath == null) return "."
    return toPosixSep(path.dirname(filePath))
}

function basename(filePath, ext) {
    if (filePath == null) return ""
    if (ext != null) return path.basename(filePath, ext)
    return path.basename(filePath)
}

function extname(filePath) {
    if (filePath == null) return ""
    return path.extname(filePath)
}

function relative(from, to) {
    if (from == null) from = "."
    if (to == null) to = "."
    return toPosixSep(path.relative(from, to))
}

function normalize(filePath) {
    if (filePath == null) return "."
    return toPosixSep(path.normalize(filePath))
}

const sep = "/"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scrml:path — join", () => {
    test("P1: basic two segments", () => {
        expect(join("src", "index.js")).toBe("src/index.js")
    })
    test("P2: multiple segments", () => {
        expect(join("src", "components", "App.js")).toBe("src/components/App.js")
    })
    test("P3: empty/null segments ignored", () => {
        expect(join("a", null, "b", undefined, "c")).toBe("a/b/c")
    })
    test("P4: relative .. resolved", () => {
        expect(join("a", "..", "b")).toBe("b")
    })
})

describe("scrml:path — resolve", () => {
    test("P5: absolute path stays absolute", () => {
        expect(resolve("/usr", "local", "bin")).toBe("/usr/local/bin")
    })
    test("P6: relative segments appended to cwd", () => {
        const result = resolve("src", "index.js")
        // OS-portable absolute check: a Windows absolute path is drive-rooted
        // (`C:/…`), not `/`-rooted, so `startsWith("/")` is a POSIX-only
        // assertion. path.isAbsolute() is separator- and host-aware.
        expect(path.isAbsolute(result)).toBe(true)
        expect(result.endsWith("src/index.js")).toBe(true)
    })
    test("P7: later absolute overrides earlier", () => {
        expect(resolve("/a", "/b", "c")).toBe("/b/c")
    })
    test("P8: null segments ignored", () => {
        expect(resolve("/usr", null, "bin")).toBe("/usr/bin")
    })
})

describe("scrml:path — dirname", () => {
    test("P9: basic nested path", () => {
        expect(dirname("/usr/local/bin/node")).toBe("/usr/local/bin")
    })
    test("P10: relative path", () => {
        expect(dirname("src/index.js")).toBe("src")
    })
    test("P11: root returns root", () => {
        expect(dirname("/")).toBe("/")
    })
})

describe("scrml:path — basename", () => {
    test("P12: basic filename", () => {
        expect(basename("/usr/local/bin/node")).toBe("node")
    })
    test("P13: strip extension", () => {
        expect(basename("src/index.ts", ".ts")).toBe("index")
    })
    test("P14: only strips matching extension", () => {
        expect(basename("archive.tar.gz", ".gz")).toBe("archive.tar")
    })
    test("P15: null returns empty string", () => {
        expect(basename(null)).toBe("")
    })
})

describe("scrml:path — extname", () => {
    test("P16: basic extension", () => {
        expect(extname("index.js")).toBe(".js")
    })
    test("P17: no extension", () => {
        expect(extname("README")).toBe("")
    })
    test("P18: dotfile has no extension", () => {
        expect(extname(".gitignore")).toBe("")
    })
})

describe("scrml:path — relative", () => {
    test("P19: basic relative computation", () => {
        expect(relative("/usr/local", "/usr/local/bin/node")).toBe("bin/node")
    })
    test("P20: same directory returns empty", () => {
        expect(relative("/a/b", "/a/b")).toBe("")
    })
    test("P21: cross-tree relative", () => {
        expect(relative("/a/b/c", "/a/d/e")).toBe("../../d/e")
    })
})

describe("scrml:path — normalize", () => {
    test("P22: resolves .. segments", () => {
        expect(normalize("/usr/local/../bin")).toBe("/usr/bin")
    })
    test("P23: collapses double slashes", () => {
        expect(normalize("a//b///c")).toBe("a/b/c")
    })
    test("P24: mixed . and ..", () => {
        expect(normalize("a/./b/../c")).toBe("a/c")
    })
})

describe("scrml:path — sep", () => {
    test("P25: sep is forward slash on POSIX", () => {
        expect(sep).toBe("/")
    })
})
