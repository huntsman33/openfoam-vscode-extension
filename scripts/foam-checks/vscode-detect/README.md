# File-detection check in a real VS Code

Opens files of each kind in a throwaway, headless VS Code with this extension
loaded, and records the language VS Code assigns each one (`results.json`).

```bash
cd scripts/foam-checks/vscode-detect
npm install --no-save @vscode/test-electron
./make-workspace.sh ws                    # needs OpenFOAM loaded ($FOAM_TUTORIALS)
node run.js ../../.. ws                   # extension folder, workspace
```

On WSL without a display, run with `env -u DISPLAY -u WAYLAND_DISPLAY`. If
Electron can't find `libnss3`/`libnspr4`, extract them with
`apt-get download libnss3 libnspr4` + `dpkg-deb -x` and pass the extracted
`usr/lib/x86_64-linux-gnu` folder as a third argument.
