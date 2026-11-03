// Diagnostics must not flag valid OpenFOAM: user variables, #include-supplied
// keys, deferred values, include path forms, and the corrected keyword data.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import { validate, validateBoundaryConditions, collectParseErrors } from "../src/treeSitter/schema";
import { FVSOLUTION_TOP_LEVEL, TURBULENCE_PROPERTIES_TOP_LEVEL } from "../src/treeSitter/knownSchemas";
import { resolveInclude, resolveIncludeDirective, expandOpenFoamTags } from "../src/language-server/caseContext";
import { applyDbOverrides } from "../src/language-server/dbOverrides";

let parser: Parser;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let caseDir: string;

beforeAll(async () => {
  parser = await getParser();
  db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "keyword-db.json"), "utf8"));
  applyDbOverrides(db);
  // A minimal case on disk for include resolution.
  caseDir = fs.mkdtempSync(path.join(os.tmpdir(), "foamcase-"));
  fs.mkdirSync(path.join(caseDir, "system"));
  fs.mkdirSync(path.join(caseDir, "0.orig"));
  fs.writeFileSync(path.join(caseDir, "system", "controlDict"), "application simpleFoam;\n");
  fs.writeFileSync(path.join(caseDir, "system", "caseParams"), "L 1;\n");
});

afterAll(() => fs.rmSync(caseDir, { recursive: true, force: true }));

const parse = (text: string) => parseText(parser, text);
const messages = (diags: { message: string }[]) => diags.map(d => d.message);
// The controlDict snippets below are partial, so ignore its required keys.
const notMissingKey = (diags: { message: string }[]) => messages(diags).filter(m => !m.startsWith("Missing required key"));

describe("schema checks on valid OpenFOAM", () => {
  it("doesn't report user variables (used as $name, or defined by #eval) as unknown keys", () => {
    const tree = parse("L 10;\nxIn #eval{ -$L };\nendTime $L;\n");
    expect(notMissingKey(validate(tree, db.controlDict.keywords))).toEqual([]);
  });

  it("still reports a genuinely unknown key", () => {
    const tree = parse("endTim 10;\n");
    expect(messages(validate(tree, db.controlDict.keywords))).toContain("Unknown key 'endTim'");
  });

  it("skips required-key checks where an #include can supply them", () => {
    const tree = parse('#include "../system/caseParams"\nRAS { RASModel kOmegaSST; }\n');
    expect(messages(validate(tree, TURBULENCE_PROPERTIES_TOP_LEVEL))).not.toContain("Missing required key 'simulationType'");
  });

  it("still requires simulationType when nothing can supply it", () => {
    const tree = parse("RAS { RASModel kOmegaSST; }\n");
    expect(messages(validate(tree, TURBULENCE_PROPERTIES_TOP_LEVEL))).toContain("Missing required key 'simulationType'");
  });

  it("skips option checks on #eval values", () => {
    const tree = parse("writeControl #eval{ 1 };\n");
    expect(notMissingKey(validate(tree, db.controlDict.keywords))).toEqual([]);
  });

  it("accepts writeControl adjustable", () => {
    expect(notMissingKey(validate(parse("writeControl adjustable;\n"), db.controlDict.keywords))).toEqual([]);
  });

  it("doesn't require solvers in fvSolution", () => {
    expect(validate(parse("SIMPLE { nNonOrthogonalCorrectors 0; }\n"), FVSOLUTION_TOP_LEVEL)).toEqual([]);
  });

  it("accepts totalPressure without U or value, and inletOutlet without value", () => {
    const tree = parse(`FoamFile { class volScalarField; object p_rgh; }
boundaryField
{
    side { type totalPressure; p0 uniform 0; }
    top  { type inletOutlet; inletValue uniform 0; }
}
`);
    expect(validateBoundaryConditions(tree, db.boundaryConditions).filter(d => d.severity === "error")).toEqual([]);
  });

  it("still requires value on fixedValue", () => {
    const tree = parse("FoamFile { class volScalarField; }\nboundaryField { inlet { type fixedValue; } }\n");
    expect(messages(validateBoundaryConditions(tree, db.boundaryConditions))).toContain("Missing required key 'value'");
  });

  it("doesn't apply fvPatchField data to point fields", () => {
    const tree = parse("FoamFile { class pointVectorField; }\nboundaryField { hull { type calculated; } }\n");
    expect(validateBoundaryConditions(tree, db.boundaryConditions)).toEqual([]);
  });

  it("collects parse errors repeatedly without crashing", () => {
    for (let i = 0; i < 200; i++) expect(collectParseErrors(parse("a { b 1 }\n")).length).toBeGreaterThan(0);
  });
});

describe("include paths", () => {
  const from = () => pathToFileURL(path.join(caseDir, "0.orig", "U")).href;

  it("expands <system>, <constant> and <case>", () => {
    expect(expandOpenFoamTags("<system>/caseParams", caseDir)).toBe(path.join(caseDir, "system", "caseParams"));
    expect(expandOpenFoamTags("<constant>/g", caseDir)).toBe(path.join(caseDir, "constant", "g"));
    expect(expandOpenFoamTags("<case>/x", caseDir)).toBe(path.join(caseDir, "x"));
  });

  it("resolves <system>/file and ../system/file", () => {
    const target = path.join(caseDir, "system", "caseParams");
    expect(resolveInclude('"<system>/caseParams"', from(), caseDir)).toBe(target);
    expect(resolveInclude("../system/caseParams", from(), caseDir)).toBe(target);
  });

  it("reports a missing #include, but never a missing #includeIfPresent or #sinclude", () => {
    expect(resolveIncludeDirective("#include", "../system/nope", from(), caseDir)).toBeNull();
    expect(resolveIncludeDirective("#includeIfPresent", "../system/nope", from(), caseDir)).toBeUndefined();
    expect(resolveIncludeDirective("#sinclude", "../system/nope", from(), caseDir)).toBeUndefined();
  });

  it("treats an unexpandable variable as unknown, not missing", () => {
    expect(resolveIncludeDirective("#include", "$NOT_SET_ANYWHERE/x", from(), caseDir)).toBeUndefined();
  });
});
