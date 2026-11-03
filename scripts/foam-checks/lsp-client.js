// Minimal LSP stdio client for the packaged OpenFOAM language server.
const { spawn } = require("child_process");
const fs = require("fs");
const { pathToFileURL } = require("url");

class Client {
  constructor(serverJs) {
    this.p = spawn(process.execPath, [serverJs, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    this.buf = Buffer.alloc(0); this.id = 0; this.pending = new Map();
    this.diagWaiters = new Map(); this.diags = new Map(); this.logs = [];
    this.p.stderr.on("data", d => this.logs.push("STDERR " + d));
    this.p.on("exit", c => { this.exited = c; });
    this.p.stdout.on("data", d => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
  }
  drain() {
    for (;;) {
      const h = this.buf.indexOf("\r\n\r\n"); if (h < 0) return;
      const len = +/Content-Length: (\d+)/i.exec(this.buf.slice(0, h).toString())[1];
      if (this.buf.length < h + 4 + len) return;
      const msg = JSON.parse(this.buf.slice(h + 4, h + 4 + len).toString());
      this.buf = this.buf.slice(h + 4 + len);
      this.handle(msg);
    }
  }
  handle(m) {
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === "textDocument/publishDiagnostics") {
      this.diags.set(m.params.uri, m.params.diagnostics);
      const w = this.diagWaiters.get(m.params.uri); if (w) { this.diagWaiters.delete(m.params.uri); w(m.params.diagnostics); }
    } else if (m.method === "window/logMessage") {
      this.logs.push(m.params.message);
    } else if (m.id !== undefined) {           // server->client request
      const result = m.method === "workspace/configuration" ? m.params.items.map(() => null) : null;
      this.send({ jsonrpc: "2.0", id: m.id, result });
    }
  }
  send(o) { const s = JSON.stringify(o); this.p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); }
  req(method, params, timeout = 15000) {
    const id = ++this.id; this.send({ jsonrpc: "2.0", id, method, params });
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error(`timeout ${method}`)); }, timeout);
    });
  }
  notify(method, params) { this.send({ jsonrpc: "2.0", method, params }); }
  async init(rootDir) {
    const r = await this.req("initialize", { processId: process.pid, rootUri: pathToFileURL(rootDir).href,
      capabilities: { textDocument: { semanticTokens: { requests: { full: true } } } } });
    this.notify("initialized", {});
    return r;
  }
  open(file, text = fs.readFileSync(file, "utf8")) {
    const uri = pathToFileURL(file).href;
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId: "openfoam", version: 1, text } });
    return uri;
  }
  waitDiags(uri, timeout = 20000) {
    return new Promise(res => {
      this.diagWaiters.set(uri, res);
      setTimeout(() => { if (this.diagWaiters.delete(uri)) res(null); }, timeout);
    });
  }
  close(uri) { this.notify("textDocument/didClose", { textDocument: { uri } }); }
  shutdown() { return this.req("shutdown", null).then(() => this.notify("exit")); }
}
module.exports = { Client };
