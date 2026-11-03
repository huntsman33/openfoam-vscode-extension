// Run suite/index.js in a throwaway headless VS Code with the extension loaded.
// Usage: node run.js <extension folder> <workspace> [nss lib folder]
const path = require("path");
const { runTests } = require("@vscode/test-electron");
const [extDir, ws, nssLib] = process.argv.slice(2);
if (nssLib) process.env.LD_LIBRARY_PATH = `${nssLib}:${process.env.LD_LIBRARY_PATH || ""}`;
process.env.FOAM_DETECT_WS = path.resolve(ws);

runTests({
  cachePath: path.join(__dirname, ".vscode-test"),
  extensionDevelopmentPath: path.resolve(extDir),
  extensionTestsPath: path.join(__dirname, "suite", "index.js"),
  // --disable-extensions disables installed extensions only; this one still loads.
  launchArgs: [path.resolve(ws), "--ozone-platform=headless", "--disable-extensions", "--disable-gpu",
    "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust",
    `--user-data-dir=${path.join(__dirname, ".udd")}`],
}).then(() => console.log("TESTS FINISHED"), e => { console.error("RUN FAILED", e); process.exit(1); });
