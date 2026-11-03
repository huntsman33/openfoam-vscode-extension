#!/bin/bash
# Regenerate the parser from grammar.js, run the corpus tests, build the wasm, and copy the
# package into node_modules (npm installs file: dependencies as a copy, not a link).
set -euo pipefail
cd "$(dirname "$0")/../../vendor/tree-sitter-openfoam"
npx --yes tree-sitter-cli@0.27 generate
npx --yes tree-sitter-cli@0.27 test
npx --yes tree-sitter-cli@0.27 build --wasm -o tree-sitter-openfoam.wasm
rm -rf ../../node_modules/tree-sitter-openfoam
mkdir -p ../../node_modules/tree-sitter-openfoam
cp -r grammar.js package.json queries src tree-sitter.json tree-sitter-openfoam.wasm README.md ../../node_modules/tree-sitter-openfoam/
