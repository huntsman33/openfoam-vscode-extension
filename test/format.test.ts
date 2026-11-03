import { describe, it, expect } from "vitest";
import { formatOpenFoam } from "../src/language-server/format";

describe("formatOpenFoam", () => {
  it("indents blocks and splits `name {`", () => {
    expect(formatOpenFoam("a {\nb 1;\n}\n")).toBe("a\n{\n    b 1;\n}\n");
  });

  it("indents multi-line lists", () => {
    expect(formatOpenFoam("vertices\n(\n(0 0 0)\n(1 0 0)\n);\n")).toBe("vertices\n(\n    (0 0 0)\n    (1 0 0)\n);\n");
  });

  it("leaves #{ ... #} code exactly as written, including its braces", () => {
    const text = "inlet\n{\n    code\n    #{\n  if (x) {\n      y();\n  }\n    #};\n}\n";
    expect(formatOpenFoam(text)).toBe(text);
  });

  it("doesn't split a line ending in #{ or a multi-line #eval{", () => {
    expect(formatOpenFoam("code #{\nint i;\n#};\n")).toBe("code #{\nint i;\n#};\n");
    expect(formatOpenFoam("x #eval{\n1 + 2\n};\n")).toBe("x #eval{\n    1 + 2\n};\n");
  });

  it("ignores braces and parentheses in strings and comments", () => {
    const text = 'a "{(";\n// }\nb 1; /* ) */\n';
    expect(formatOpenFoam(text)).toBe(text);
  });

  it("keeps a multi-line comment banner as written", () => {
    const text = "/*----*\\\n|  \\\\   F ield |\n\\*----*/\nFoamFile\n{\n    version 2.0;\n}\n";
    expect(formatOpenFoam(text)).toBe(text);
  });

  it("is idempotent", () => {
    const text = "a{\nb (1 2\n3);\n  c #{ x #};\n}\n\n\n\nd 1;\n";
    const once = formatOpenFoam(text);
    expect(formatOpenFoam(once)).toBe(once);
  });
});
