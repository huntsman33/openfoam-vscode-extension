/**
 * Formats an OpenFOAM dictionary: re-indents by brace and parenthesis depth
 * (4 spaces, so multi-line lists are indented too), puts the `{` of a
 * `name {` block on its own line, and collapses runs of 3+ blank lines to 2.
 *
 * Text OpenFOAM doesn't treat as dictionary structure is left alone, so
 * formatting never changes what OpenFOAM reads:
 * - `#{ ... #}` verbatim code (coded conditions, #codeStream, #eval) is
 *   copied through exactly, and its braces don't count towards depth;
 * - braces and parentheses inside strings and comments don't count either,
 *   and lines inside a multi-line comment (e.g. the header banner) are kept
 *   as is;
 * - only a single plain word followed by `{` is split onto two lines, never
 *   `x #eval{`, `${{`, or a key with values before the brace.
 */
export function formatOpenFoam(text: string): string {
  const out: string[] = [];
  let depth = 0;
  let inVerbatim = false;
  let inBlockComment = false;
  const ind = (n: number) => "    ".repeat(Math.max(0, n));

  for (const rawLine of text.split("\n")) {
    // A line that starts inside verbatim code or a block comment is copied
    // unchanged; scanning still runs to find where that region ends.
    const startsInside = inVerbatim || inBlockComment;
    const scan = scanLine(rawLine, inVerbatim, inBlockComment);
    inVerbatim = scan.inVerbatim;
    inBlockComment = scan.inBlockComment;
    if (startsInside) { out.push(rawLine); continue; }

    const stripped = rawLine.trim();
    if (!stripped) { out.push(""); continue; }
    // Braces and parentheses both set the depth; a line's own balanced pairs
    // (`div(phi,U)`, `hex (...) (...)`) cancel out.
    const opens = scan.opens + scan.parenOpens, closes = scan.closes + scan.parenCloses;

    // Standalone closing brace(s)
    if (opens === 0 && closes > 0) {
      depth = Math.max(0, depth - closes);
      out.push(ind(depth) + stripped);
      continue;
    }

    // `name {`: OpenFOAM style puts the brace on its own line.
    if (scan.opens === 1 && opens === 1 && closes === 0 && stripped.endsWith("{")) {
      const prefix = stripped.slice(0, -1).trim();
      if (/^[^\s#$"{]\S*$/.test(prefix) && !scan.inVerbatim) {
        out.push(ind(depth) + prefix);
        out.push(ind(depth) + "{");
      } else {
        out.push(ind(depth) + stripped);
      }
      depth++;
      continue;
    }

    // Mixed braces on the same line
    if (opens > 0 || closes > 0) {
      if (closes > opens) depth = Math.max(0, depth - (closes - opens));
      out.push(ind(depth) + stripped);
      if (opens > closes) depth += opens - closes;
      continue;
    }

    out.push(ind(depth) + stripped);
  }

  // Collapse 3+ consecutive blank lines to 2
  const collapsed: string[] = [];
  let blanks = 0;
  for (const line of out) {
    if (!line.trim()) { if (++blanks <= 2) collapsed.push(""); }
    else { blanks = 0; collapsed.push(line); }
  }
  return collapsed.join("\n");
}

/**
 * Counts the structural braces and parentheses on one line, skipping strings,
 * comments and verbatim code, and reports whether a verbatim block or block
 * comment is still open at the end of the line.
 */
function scanLine(line: string, inVerbatim: boolean, inBlockComment: boolean) {
  let opens = 0, closes = 0, parenOpens = 0, parenCloses = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i], next = line[i + 1];
    if (inVerbatim) {
      if (c === "#" && next === "}") { inVerbatim = false; i++; }
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (c === "/" && next === "/") break;
    if (c === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (c === "#" && next === "{") { inVerbatim = true; i++; continue; }
    if (c === '"') {
      for (i++; i < line.length && line[i] !== '"'; i++) if (line[i] === "\\") i++;
      continue;
    }
    if (c === "{") opens++;
    else if (c === "}") closes++;
    else if (c === "(") parenOpens++;
    else if (c === ")") {
      // A `)` closing a `(` opened on this line cancels it rather than dedenting.
      if (parenOpens > 0) parenOpens--; else parenCloses++;
    }
  }
  return { opens, closes, parenOpens, parenCloses, inVerbatim, inBlockComment };
}
