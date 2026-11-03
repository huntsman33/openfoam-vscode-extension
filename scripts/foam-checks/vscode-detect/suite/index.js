// Open each file and record the language VS Code assigns it; writes results.json.
const vscode = require("vscode"); const path = require("path"); const fs = require("fs");
const ws = process.env.FOAM_DETECT_WS;
const cases = [
  // [path in the workspace, expected language]
  ["case/system/controlDict", "openfoam"],         // on the extension's filename list (activates it)
  ["case/0.orig/alphat", "openfoam"],              // 0.orig folder, name not on the list
  ["case/0.orig/p_rgh", "openfoam"],
  ["case/system/caseParams", "openfoam"],          // system/, no extension
  ["case/0.orig/U.air", "openfoam"],               // FoamFile header, unknown extension
  ["case/system/blockMeshDict.main", "openfoam"],
  ["case/system/blockMeshDict.m4", "plaintext"],   // m4 template: left alone
  ["case/compare.py", "python"],
  ["case/notes.txt", "plaintext"],
  ["case/CASE.md", "markdown"],
];
exports.run = async () => {
  const results = [];
  for (const [rel, expected] of cases) {
    const doc = await vscode.workspace.openTextDocument(path.join(ws, rel));
    await vscode.window.showTextDocument(doc);
    let lang = doc.languageId;
    for (let i = 0; i < 40 && lang !== expected; i++) {
      await new Promise(r => setTimeout(r, 100));
      lang = vscode.window.activeTextEditor?.document.languageId ?? lang;
    }
    results.push({ name: rel, pass: lang === expected, detail: `expected ${expected}, got ${lang}` });
  }
  fs.writeFileSync(path.join(__dirname, "..", "results.json"), JSON.stringify(results, null, 1));
};
