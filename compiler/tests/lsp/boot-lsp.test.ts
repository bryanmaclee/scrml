/**
 * The bootstrap LSP (lsp-boot/server.ts), driven over stdio as an editor drives it.
 * change-id: s469-boot-lsp.
 *
 * Every test spawns a real server process and speaks JSON-RPC to it (Content-Length framing).
 * The bootstrap bundle is loaded once in beforeAll so each server starts from the warm disk cache.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadBoot } from "../../../scripts/scrml-boot.ts";
import { crashDiagnostic, toLspDiagnostics } from "../../../lsp-boot/diagnostics.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const SERVER = join(ROOT, "lsp-boot", "server.ts");

// ─────────────────────────────────────────────────────────────────────────────
// A tiny LSP client.
// ─────────────────────────────────────────────────────────────────────────────

type Msg = { id?: number; method?: string; params?: any; result?: any; error?: any };

class Client {
  proc: ReturnType<typeof Bun.spawn>;
  messages: Msg[] = [];
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  exited: Promise<number>;

  constructor(env: Record<string, string> = {}) {
    this.proc = Bun.spawn(["bun", SERVER, "--stdio"], {
      cwd: ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env },
    });
    this.exited = this.proc.exited;
    void this.read();
  }

  private async read() {
    const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      this.buf = Buffer.concat([this.buf, Buffer.from(value)]);
      for (;;) {
        const sep = this.buf.indexOf("\r\n\r\n");
        if (sep < 0) break;
        const m = /Content-Length: (\d+)/i.exec(this.buf.subarray(0, sep).toString());
        if (!m) throw new Error("bad header");
        const len = Number(m[1]);
        if (this.buf.length < sep + 4 + len) break;
        const msg = JSON.parse(this.buf.subarray(sep + 4, sep + 4 + len).toString()) as Msg;
        this.buf = this.buf.subarray(sep + 4 + len);
        this.messages.push(msg);
        for (const w of [...this.waiters]) if (w.pred(msg)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(msg); }
      }
    }
  }

  send(m: object) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...m });
    (this.proc.stdin as any).write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    (this.proc.stdin as any).flush?.();
  }

  request(method: string, params: any): Promise<Msg> {
    const id = this.nextId++;
    const p = this.wait((m) => m.id === id && m.method === undefined, 60_000);
    this.send({ id, method, params });
    return p;
  }

  notify(method: string, params: any) { this.send({ method, params }); }

  wait(pred: (m: Msg) => boolean, ms = 15_000): Promise<Msg> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timed out waiting (${ms} ms); got: ${JSON.stringify(this.messages.map((m) => m.method ?? m.id))}`)), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); res(m); } });
    });
  }

  /** The next publishDiagnostics for `uri` after `after` messages have been seen. */
  nextDiagnostics(uri: string, ms = 15_000): Promise<Msg> {
    return this.wait((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri, ms);
  }

  published(uri: string): any[][] {
    return this.messages.filter((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri).map((m) => m.params.diagnostics);
  }

  logs(): string[] {
    return this.messages.filter((m) => m.method === "window/logMessage").map((m) => String(m.params.message));
  }

  async init(rootDir: string) {
    const r = await this.request("initialize", { processId: process.pid, rootUri: pathToFileURL(rootDir).href, capabilities: {} });
    this.notify("initialized", {});
    return r;
  }

  open(uri: string, text: string, version = 1) {
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId: "scrml", version, text } });
  }

  changeFull(uri: string, version: number, text: string) {
    this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  changeRange(uri: string, version: number, range: any, text: string) {
    this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ range, text }] });
  }

  async stop(): Promise<number> {
    await this.request("shutdown", null);
    this.notify("exit", null);
    return await this.exited;
  }

  kill() { try { this.proc.kill(); } catch { /* gone */ } }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures.
// ─────────────────────────────────────────────────────────────────────────────

const GOOD = `<program>
    type Guess:enum = { Yes, No }

    let <inputVal:string=""/>
    <g:Guess | not=(Guess.toEnum(@inputVal))/>

    <main>
        <form><input type="text" bind:value=@inputVal/></form>
        <p id="say">\${match @g { .Yes :> "yeppers", .No :> "nope", not :> "not a guess", }}</p>
        <p id="real" if=(@g is given)>you picked a real answer</p>
    </main>
</program>
`;
// line 9 (0-based 8): `@g` misspelled `@gg`
const BAD = GOOD.replace("${match @g {", "${match @gg {");
const BAD_LINE = 8;
const BAD_COL = BAD.split("\n")[BAD_LINE].indexOf("@gg");

let dir = "";
const clients: Client[] = [];
function client(env: Record<string, string> = {}) {
  const c = new Client(env);
  clients.push(c);
  return c;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "scrml-boot-lsp-test-"));
  await loadBoot(); // warm the disk cache so each server loads in ~0.15 s
}, 300_000);

afterAll(() => {
  for (const c of clients) c.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure mapping.
// ─────────────────────────────────────────────────────────────────────────────

describe("diagnostic mapping", () => {
  test("1-based line/col + span end → 0-based LSP range; severity, code, source", () => {
    const [d] = toLspDiagnostics(
      [{ severity: "warning", code: "W-X", message: "m", file: "/p/a.scrml", line: 2, col: 3, endLine: 2, endCol: 6 }],
      "/p/a.scrml", "x\nabcdefg\n",
    );
    expect(d).toEqual({ range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, severity: 2, code: "W-X", source: "scrml-boot", message: "m" });
  });

  test("a diagnostic in an imported file lands on the import line, with relatedInformation", () => {
    const text = `\${\n    import { C } from "./b.scrml";\n}\n<program></program>\n`;
    const [d] = toLspDiagnostics([{ severity: "error", code: "E-SCOPE-001", message: "nope", file: "/p/b.scrml", line: 3, col: 5, endLine: 3, endCol: 9 }], "/p/a.scrml", text);
    expect(d.range.start.line).toBe(1);
    expect(d.message).toBe("in b.scrml:3:5: nope");
    expect(d.relatedInformation?.[0].location.uri).toBe("file:///p/b.scrml");
    expect(d.relatedInformation?.[0].location.range.start).toEqual({ line: 2, character: 4 });
  });

  test("no position → the first line; a crash is one Error", () => {
    const [d] = toLspDiagnostics([{ severity: "error", code: "E-BOOTSTRAP-UNSUPPORTED", message: "refused" }], "/p/a.scrml", "<program>\nx");
    expect(d.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 9 } });
    const c = crashDiagnostic("<program>", "boom");
    expect(c).toMatchObject({ severity: 1, source: "scrml-boot", code: "scrml-boot-crash", message: "scrml-boot crashed: boom" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Over stdio.
// ─────────────────────────────────────────────────────────────────────────────

describe("lsp-boot over stdio", () => {
  test("diagnostics come from the buffer, not the disk; an incremental fix clears them; shutdown/exit", async () => {
    const file = join(dir, "guess.scrml");
    writeFileSync(file, GOOD); // the DISK is clean
    const uri = pathToFileURL(file).href;
    const c = client();
    const init = await c.init(dir);
    expect(init.result.capabilities.textDocumentSync).toBe(2); // incremental
    expect(init.result.capabilities.hoverProvider).toBeUndefined(); // not faked
    expect(init.result.capabilities.definitionProvider).toBeUndefined();

    let p = c.nextDiagnostics(uri, 60_000);
    c.open(uri, BAD); // the BUFFER has the error
    const d1 = (await p).params.diagnostics;
    expect(d1.length).toBeGreaterThanOrEqual(1);
    expect(d1[0]).toMatchObject({
      severity: 1, code: "E-SCOPE-001", source: "scrml-boot",
      range: { start: { line: BAD_LINE, character: BAD_COL }, end: { line: BAD_LINE, character: BAD_COL + 3 } },
    });

    // fix it with an incremental edit: delete one `g` of `@gg`
    p = c.nextDiagnostics(uri);
    c.changeRange(uri, 2, { start: { line: BAD_LINE, character: BAD_COL + 2 }, end: { line: BAD_LINE, character: BAD_COL + 3 } }, "");
    expect((await p).params.diagnostics).toEqual([]);

    // break the buffer again; the disk is still clean
    p = c.nextDiagnostics(uri);
    c.changeFull(uri, 3, BAD);
    expect((await p).params.diagnostics[0].code).toBe("E-SCOPE-001");

    // close clears
    p = c.nextDiagnostics(uri);
    c.notify("textDocument/didClose", { textDocument: { uri } });
    expect((await p).params.diagnostics).toEqual([]);

    expect(await c.stop()).toBe(0);
  }, 90_000);

  test("an unsaved buffer (no file on disk) and an unsaved imported module compile from memory", async () => {
    const a = join(dir, "never-saved-a.scrml");
    const b = join(dir, "never-saved-b.scrml");
    const aUri = pathToFileURL(a).href, bUri = pathToFileURL(b).href;
    const A = `\${\n    import { Color } from "./never-saved-b.scrml";\n}\n<program>\n    let <c:Color=.Red/>\n    <main><p>hi</p></main>\n</program>\n`;
    const B_OK = `\${\n    export type Color:enum = { Red, Blue }\n}\n`;
    const B_BAD = `\${\n    export type Color:enum = { Red, Blue }\n    export fn f() -> int { return nope; }\n}\n`;
    const c = client();
    await c.init(dir);
    let pb = c.nextDiagnostics(bUri, 60_000);
    c.open(bUri, B_OK);
    await pb;
    let pa = c.nextDiagnostics(aUri);
    c.open(aUri, A);
    expect((await pa).params.diagnostics).toEqual([]);

    // editing b (still unsaved) re-checks a, which now reports b's error on its import line
    pa = c.nextDiagnostics(aUri);
    c.changeFull(bUri, 2, B_BAD);
    const da = (await pa).params.diagnostics;
    expect(da).toHaveLength(1);
    expect(da[0].range.start.line).toBe(1);
    expect(da[0].message).toContain("never-saved-b.scrml:3:");
    expect(da[0].relatedInformation[0].location.uri).toBe(bUri);
    c.kill();
  }, 90_000);

  test("debounce: a burst of edits is one compile, of the last text", async () => {
    const uri = pathToFileURL(join(dir, "burst.scrml")).href;
    const c = client({ SCRML_BOOT_LSP_DEBOUNCE_MS: "150" });
    await c.init(dir);
    let p = c.nextDiagnostics(uri, 60_000);
    c.open(uri, GOOD);
    await p;
    const before = c.published(uri).length;
    // 10 edits 20 ms apart (well inside the debounce), alternating bad/good, ending bad
    for (let v = 2; v <= 11; v++) {
      c.changeFull(uri, v, v % 2 === 1 ? BAD : GOOD);
      await sleep(20);
    }
    p = c.nextDiagnostics(uri);
    const last = (await p).params.diagnostics;
    expect(last[0].code).toBe("E-SCOPE-001");
    await sleep(500); // nothing else arrives
    expect(c.published(uri).length - before).toBe(1);
    c.kill();
  }, 90_000);

  test("a stale compile never overwrites a newer one", async () => {
    // the first compile is slow (1.2 s) and has an error; a fix lands while it runs. With
    // cancellation off, the slow run finishes — its result must be dropped.
    const uri = pathToFileURL(join(dir, "stale.scrml")).href;
    const c = client({ SCRML_BOOT_LSP_TEST_FAULTS: "1", SCRML_BOOT_LSP_DEBOUNCE_MS: "20", SCRML_BOOT_LSP_CANCEL_AFTER_MS: "100000" });
    await c.init(dir);
    await c.wait((m) => m.method === "window/logMessage" && /bootstrap .* in \d+ ms/.test(m.params.message), 60_000);
    c.open(uri, BAD + "// @@scrml-boot-lsp:slow=1200@@\n");
    await sleep(400); // the slow compile is running
    const p = c.nextDiagnostics(uri);
    c.changeFull(uri, 2, GOOD);
    expect((await p).params.diagnostics).toEqual([]);
    await sleep(300);
    expect(c.published(uri)).toEqual([[]]); // the erroring v1 result was never published
    c.kill();
  }, 90_000);

  test("a superseded long compile is cancelled (the worker is restarted)", async () => {
    const uri = pathToFileURL(join(dir, "cancel.scrml")).href;
    const c = client({ SCRML_BOOT_LSP_TEST_FAULTS: "1", SCRML_BOOT_LSP_DEBOUNCE_MS: "20", SCRML_BOOT_LSP_CANCEL_AFTER_MS: "100" });
    await c.init(dir);
    await c.wait((m) => m.method === "window/logMessage" && /bootstrap .* in \d+ ms/.test(m.params.message), 60_000);
    c.open(uri, BAD + "// @@scrml-boot-lsp:slow=5000@@\n");
    await sleep(300);
    const t0 = performance.now();
    const p = c.nextDiagnostics(uri);
    c.changeFull(uri, 2, GOOD);
    expect((await p).params.diagnostics).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(4000); // did not wait out the 5 s compile
    expect(c.logs().some((l) => l.includes("cancelled a superseded compile"))).toBe(true);
    expect(c.published(uri)).toEqual([[]]);
    c.kill();
  }, 90_000);

  test("a bootstrap crash is one Error on line 1, and the server recovers", async () => {
    const uri = pathToFileURL(join(dir, "crash.scrml")).href;
    const c = client({ SCRML_BOOT_LSP_TEST_FAULTS: "1", SCRML_BOOT_LSP_DEBOUNCE_MS: "20" });
    await c.init(dir);
    let p = c.nextDiagnostics(uri, 60_000);
    c.open(uri, GOOD + "// @@scrml-boot-lsp:crash@@\n");
    const d = (await p).params.diagnostics;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 1, source: "scrml-boot", code: "scrml-boot-crash", range: { start: { line: 0, character: 0 } } });
    expect(d[0].message).toStartWith("scrml-boot crashed: ");
    expect(d[0].message).toContain("injected crash");

    p = c.nextDiagnostics(uri);
    c.changeFull(uri, 2, GOOD);
    expect((await p).params.diagnostics).toEqual([]);
    c.kill();
  }, 90_000);

  test("a hung compile times out into a crash diagnostic; a fresh worker serves the next edit", async () => {
    const uri = pathToFileURL(join(dir, "hang.scrml")).href;
    const c = client({ SCRML_BOOT_LSP_TEST_FAULTS: "1", SCRML_BOOT_LSP_DEBOUNCE_MS: "20", SCRML_BOOT_LSP_TIMEOUT_MS: "1000" });
    await c.init(dir);
    let p = c.nextDiagnostics(uri, 60_000);
    c.open(uri, GOOD + "// @@scrml-boot-lsp:hang@@\n");
    const d = (await p).params.diagnostics;
    expect(d).toHaveLength(1);
    expect(d[0].code).toBe("scrml-boot-crash");
    expect(d[0].message).toContain("did not finish within 1000 ms");

    p = c.nextDiagnostics(uri);
    c.changeFull(uri, 2, BAD);
    expect((await p).params.diagnostics[0].code).toBe("E-SCOPE-001");
    expect(await c.stop()).toBe(0);
  }, 90_000);
});
