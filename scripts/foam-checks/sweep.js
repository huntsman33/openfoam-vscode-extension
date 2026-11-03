// Open every file in a list with the language server and record its diagnostics.
// Every file in the list should be one OpenFOAM accepts (see valid-files.sh), so any
// error reported is a false positive.
// Usage: node sweep.js <server.js> <files.txt> <workspace root> <out.json>
const fs = require("fs");
const { Client } = require("./lsp-client");
const [serverJs, list, root, out] = process.argv.slice(2);
const files = fs.readFileSync(list, "utf8").trim().split("\n").filter(Boolean);
const SEV = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

async function start() {
  const c = new Client(serverJs);
  await c.init(root);
  await new Promise(r => setTimeout(r, 2000));       // let tree-sitter load
  return c;
}

(async () => {
  let c = await start(); const crashes = [];
  const results = []; const BATCH = 25; const t0 = Date.now();
  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(files.slice(i, i + BATCH).map(async f => {
      let text; try { text = fs.readFileSync(f, "utf8"); } catch { return; }
      const uri = c.open(f, text);
      const d = await c.waitDiags(uri);
      results.push({ f, timeout: d === null,
        diags: (d || []).map(x => ({ sev: SEV[x.severity], msg: x.message, line: x.range.start.line + 1 })) });
      c.close(uri);
    }));
    if (c.exited !== undefined) {
      // The server died during this batch: report it, restart, and carry on.
      const batch = files.slice(i, i + BATCH);
      crashes.push({ at: i, exit: c.exited, files: batch, log: c.logs.slice(-5) });
      console.log(`SERVER EXITED (${c.exited}) in batch at file ${i}; last log:\n  ` +
                  c.logs.slice(-5).join("\n  ").slice(0, 2000));
      c = await start();
    }
  }
  results.sort((a, b) => a.f.localeCompare(b.f));
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  if (crashes.length) fs.writeFileSync(out.replace(/\.json$/, "") + ".crashes.json", JSON.stringify(crashes, null, 1));
  const withErr = results.filter(r => r.diags.some(d => d.sev === "error"));
  const count = s => results.reduce((n, r) => n + r.diags.filter(d => d.sev === s).length, 0);
  console.log(`${results.length} files in ${(Date.now() - t0) / 1000}s: ${withErr.length} with errors ` +
              `(${count("error")} errors, ${count("warning")} warnings), ${results.filter(r => r.timeout).length} timeouts, ${crashes.length} server crashes`);
  await c.shutdown().catch(() => {}); process.exit(0);
})();
