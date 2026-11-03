// Format each file via the server; write changed results into a mirror tree.
// Usage: node fmt.js <server.js> <handled.json> <srcRoot> <mirrorRoot> <out.json>
const fs = require("fs"); const path = require("path");
const { Client } = require("./lsp-client");
const [serverJs, list, srcRoot, mirror, out] = process.argv.slice(2);
const files = JSON.parse(fs.readFileSync(list, "utf8")).filter(f => !f.endsWith(".m4"));

function apply(text, edits) {
  const lines = text.split("\n"); const starts = [0];
  for (const l of lines) starts.push(starts[starts.length - 1] + l.length + 1);
  const off = p => Math.min(starts[Math.min(p.line, lines.length)] + p.character, text.length);
  edits = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  for (const e of edits) text = text.slice(0, off(e.range.start)) + e.newText + text.slice(off(e.range.end));
  return text;
}

(async () => {
  const c = new Client(serverJs);
  await c.init(srcRoot);
  await new Promise(r => setTimeout(r, 2000));
  const res = [];
  for (let i = 0; i < files.length; i += 25) {
    await Promise.all(files.slice(i, i + 25).map(async f => {
      const text = fs.readFileSync(f, "utf8"); const uri = c.open(f, text);
      await new Promise(r => setTimeout(r, 50));
      let edits, err;
      try { edits = await c.req("textDocument/formatting", { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } }); }
      catch (e) { err = e.message; }
      c.close(uri);
      if (err) return res.push({ f, err });
      const formatted = apply(text, edits || []);
      // idempotence: format the formatted text again
      const uri2 = c.open(f + ".__second", formatted);
      await new Promise(r => setTimeout(r, 50));
      const edits2 = await c.req("textDocument/formatting", { textDocument: { uri: uri2 }, options: { tabSize: 4, insertSpaces: true } }).catch(() => []);
      c.close(uri2);
      const idempotent = apply(formatted, edits2 || []) === formatted;
      const changed = formatted !== text;
      if (changed) { const m = path.join(mirror, path.relative(srcRoot, f)); fs.mkdirSync(path.dirname(m), { recursive: true }); fs.writeFileSync(m, formatted); }
      res.push({ f, changed, idempotent, nEdits: (edits || []).length });
    }));
  }
  fs.writeFileSync(out, JSON.stringify(res));
  console.log(`formatted ${res.length}; changed ${res.filter(r => r.changed).length}; errors ${res.filter(r => r.err).length}; non-idempotent ${res.filter(r => r.idempotent === false).length}`);
  await c.shutdown().catch(() => {}); process.exit(0);
})();
