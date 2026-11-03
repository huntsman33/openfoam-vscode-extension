#!/bin/bash
# Format every file in a list with the language server, then check how OpenFOAM reads
# each changed file before and after (foamDictionary output must be identical) and
# that formatting is idempotent. Needs OpenFOAM loaded.
# Usage: format-check.sh <server.js> <files.txt> <source root> <work dir>
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
server=$1 list=$2 root=$3 work=$4
# The mirror starts as a full copy, so files the changed ones #include are there too.
rm -rf "$work" && mkdir -p "$work" && cp -r "$root" "$work/mirror"
python3 -I -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read().split()))' "$list" > "$work/files.json"
node "$D/format-roundtrip.js" "$server" "$work/files.json" "$root" "$work/mirror" "$work/format.json"
python3 -I -c 'import json,sys; [print(r["f"]) for r in json.load(open(sys.argv[1])) if r.get("changed")]' "$work/format.json" > "$work/changed.txt"
MIRROR=$work/mirror SRC_ROOT=$root xargs -r -P 16 -n1 "$D/foam-compare.sh" < "$work/changed.txt" > "$work/compare.txt" || true
echo "OpenFOAM's reading of the changed files:"; cut -d' ' -f1 "$work/compare.txt" | sort | uniq -c
