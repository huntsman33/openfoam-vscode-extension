// Parse files with the grammar alone (no language server) and list tree-sitter
// ERROR and MISSING nodes. Fast enough to run over every tutorial after each change.
// Usage: node parse-check.js [--wasm <file>] [--quiet] <file>... | --list <files.txt>
const fs = require("fs"); const path = require("path");
const { Parser, Language } = require("web-tree-sitter");
const args = process.argv.slice(2);
let wasm = path.join(__dirname, "../../vendor/tree-sitter-openfoam/tree-sitter-openfoam.wasm"), quiet = false, files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--wasm") wasm = args[++i];
  else if (args[i] === "--quiet") quiet = true;
  else if (args[i] === "--list") files.push(...fs.readFileSync(args[++i], "utf8").trim().split("\n").filter(Boolean));
  else files.push(args[i]);
}
(async () => {
  await Parser.init();
  const parser = new Parser(); parser.setLanguage(await Language.load(wasm));
  let bad = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8"); const errs = [];
    (function walk(n) {
      if (n.type === "ERROR" || n.isMissing) errs.push(`  ${f}:${n.startPosition.row + 1}: ` +
        (n.isMissing ? `missing ${n.type}` : `error  ${n.text.slice(0, 60).replace(/\s+/g, " ")}`));
      else if (n.hasError) for (const c of n.children) walk(c);
    })(parser.parse(text).rootNode);
    if (errs.length) { bad++; if (!quiet) console.log(errs.join("\n")); }
  }
  console.log(`${files.length} files parsed, ${bad} with syntax errors`);
})();
