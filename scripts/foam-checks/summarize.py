#!/usr/bin/env python3
"""Summarise a sweep.js result, optionally against a baseline.

Usage: summarize.py <result.json> [<baseline.json>]
Prints error/warning counts by message kind; with a baseline, also lists files
whose error count went up (regressions) and how many improved.
"""
import json, re, sys
from collections import Counter


def kinds(results, sev):
    return Counter(re.sub(r"'[^']*'", "'X'", re.sub(r"\d+", "N", d["msg"]))
                   for r in results for d in r["diags"] if d["sev"] == sev)


def errors(results):
    return {r["f"]: sum(d["sev"] == "error" for d in r["diags"]) for r in results}


res = json.load(open(sys.argv[1]))
err = errors(res)
print(f"{len(res)} files, {sum(1 for n in err.values() if n)} with errors, "
      f"{sum(err.values())} errors, {sum(kinds(res, 'warning').values())} warnings")
for sev in ("error", "warning"):
    print(f"\n{sev}s by kind:")
    for msg, n in kinds(res, sev).most_common(15):
        print(f"  {n:6d}  {msg[:100]}")
if len(sys.argv) > 2:
    base = errors(json.load(open(sys.argv[2])))
    worse = sorted(f for f in err if err[f] > base.get(f, 0))
    better = sum(1 for f in err if err[f] < base.get(f, 0))
    print(f"\nvs baseline: {better} files improved, {len(worse)} regressed")
    for f in worse[:30]:
        print(f"  {base.get(f, 0)} -> {err[f]}  {f}")
