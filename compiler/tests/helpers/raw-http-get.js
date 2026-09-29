/**
 * A raw HTTP/1.1 GET over a TCP socket, for tests that must send a request path
 * EXACTLY as written. `fetch` (and `new URL`) normalize `..` segments out of the
 * path before anything is sent, so a traversal probe written with `fetch` never
 * reaches the server at all and passes for the wrong reason.
 *
 * Resolves as soon as ONE complete response is in (by Content-Length, or a chunked
 * terminator), because a keep-alive peer — the `scrml dev` proxy — may not close
 * the socket even when asked to.
 *
 * @param {number} port
 * @param {string} path  sent verbatim on the request line
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function rawGet(port, path) {
  return await new Promise((resolveGet, rejectGet) => {
    let buf = "";
    let done = false;
    const finish = (sock) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (sock) sock.end(); } catch { /* already closed */ }
      const status = Number((/^HTTP\/1\.1 (\d{3})/.exec(buf) || [])[1] || 0);
      const h = buf.indexOf("\r\n\r\n");
      resolveGet({ status, body: h === -1 ? "" : buf.slice(h + 4) });
    };
    const complete = () => {
      const h = buf.indexOf("\r\n\r\n");
      if (h === -1) return false;
      const head = buf.slice(0, h).toLowerCase();
      const body = buf.slice(h + 4);
      const cl = /\r\ncontent-length:\s*(\d+)/.exec(head);
      if (cl) return new TextEncoder().encode(body).length >= Number(cl[1]);
      if (/\r\ntransfer-encoding:\s*chunked/.test(head)) return body.endsWith("0\r\n\r\n");
      return false;
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      rejectGet(new Error(`timeout GET ${path}`));
    }, 10_000);
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(sock) {
          sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
        },
        data(sock, chunk) {
          buf += new TextDecoder().decode(chunk);
          if (complete()) finish(sock);
        },
        close() { finish(null); },
        error(_sock, err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          rejectGet(err);
        },
      },
    }).catch((err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rejectGet(err);
    });
  });
}
