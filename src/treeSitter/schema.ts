import type { Tree, SyntaxNode } from "./parser";
import type { SimpleRange } from "./queries";

/**
 * Reuses the `FieldSpec` shape already present in `data/keyword-db.json`
 * (see `KeywordDb` in `language-server/server.ts`) so the same schema data
 * drives hover, completion, and now diagnostics.
 */
export interface FieldSpec {
  type?: string;
  options?: string[];
  required?: boolean;
  default?: unknown;
  description?: string;
  keywords?: Record<string, FieldSpec>;
}

export type DictSchema = Record<string, FieldSpec>;

export type SchemaDiagnosticSeverity = "error" | "warning" | "hint";

export interface SchemaDiagnostic {
  range: SimpleRange;
  message: string;
  severity: SchemaDiagnosticSeverity;
  /** For "Unknown key" diagnostics: the schema's real key names at this
   *  nesting level, so a client-side quick-fix can offer the closest one
   *  without re-deriving the applicable schema itself. */
  data?: { candidates: string[] };
}

function nodeRange(node: SyntaxNode): SimpleRange {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

const BOOLEAN_LITERALS = new Set(["true", "false", "yes", "no", "on", "off"]);
const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

interface DirectMembers {
  entries: Map<string, SyntaxNode>;
  blocks: Map<string, SyntaxNode>;
}

function directMembers(node: SyntaxNode): DirectMembers {
  const entries = new Map<string, SyntaxNode>();
  const blocks = new Map<string, SyntaxNode>();
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === "entry") {
      const key = child.childForFieldName("key");
      if (key && !entries.has(key.text)) entries.set(key.text, child);
    } else if (child.type === "block") {
      const name = child.childForFieldName("name");
      if (name && !blocks.has(name.text)) blocks.set(name.text, child);
    }
  }
  return { entries, blocks };
}

/** Unwraps the grammar's `value` wrapper node to the actual identifier/
 * string/number/dollar_reference/list/dimension_set node inside it. */
function unwrapValue(node: SyntaxNode): SyntaxNode {
  if (node.type === "value") return node.namedChild(0) ?? node;
  return node;
}

/** Values only known once OpenFOAM reads the dictionary: a $reference,
 * #eval/#calc, ${{ }}, #codeStream or #{ }# code. */
const DEFERRED_VALUE_TYPES = new Set([
  "dollar_reference",
  "expression_directive",
  "inline_expression",
  "code_stream_directive",
  "verbatim",
]);

function checkValue(entryNode: SyntaxNode, key: string, spec: FieldSpec, out: SchemaDiagnostic[]) {
  const values = entryNode
    .childrenForFieldName("value")
    .filter((v): v is SyntaxNode => v != null)
    .map(unwrapValue);
  if (!values.length) return;
  const hasReference = values.some(v => DEFERRED_VALUE_TYPES.has(v.type));
  if (hasReference) return; // can't statically validate a value it doesn't know yet

  if (spec.options?.length) {
    const rawJoined = values.map(v => v.text).join(" ");
    const bare = rawJoined.replace(/^"(.*)"$/, "$1");
    if (!spec.options.includes(rawJoined) && !spec.options.includes(bare)) {
      out.push({
        range: nodeRange(values[0]),
        severity: "error",
        message: `'${rawJoined}' is not a valid value for '${key}'. Valid: ${spec.options.join(", ")}`,
      });
      return;
    }
  }

  // Conservative type checks only where a false positive is very unlikely
  // (dimensioned/qualified forms like `uniform (0 0 0)` or `constant 5`
  // make single-token numeric/vector checks too noisy to be worthwhile).
  if (spec.type === "boolean" && values.length === 1) {
    if (!BOOLEAN_LITERALS.has(values[0].text)) {
      out.push({
        range: nodeRange(values[0]),
        severity: "warning",
        message: `Expected a boolean (true/false/yes/no/on/off) for '${key}', got '${values[0].text}'`,
      });
    }
  } else if ((spec.type === "scalar" || spec.type === "number") && values.length === 1 && values[0].type === "identifier") {
    if (!NUMBER_RE.test(values[0].text)) {
      out.push({
        range: nodeRange(values[0]),
        severity: "warning",
        message: `Expected a number for '${key}', got '${values[0].text}'`,
      });
    }
  }
}

/** True if `node`'s members aren't all written out in it: a direct `#include`
 * (or other directive) or a `$merge` can supply keys this file doesn't show,
 * so a "missing required key" can't be decided from the text. */
function hasOpaqueMembers(node: SyntaxNode): boolean {
  return node.namedChildren.some(c => c != null && (c.type === "directive" || c.type === "merge_entry"));
}

/** Every name referenced as a `$variable` anywhere in the file (including
 * inside #eval bodies, which are single tokens), split into its scoped
 * parts so `$:a.b` and `$/a/b` count for both `a` and `b`. */
// Keyed by the Tree: web-tree-sitter hands out a new Node object on every access.
const referencedNamesCache = new WeakMap<object, Set<string>>();
function referencedNames(node: SyntaxNode): Set<string> {
  let names = referencedNamesCache.get(node.tree);
  if (!names) {
    names = new Set();
    for (const m of node.tree.rootNode.text.matchAll(/\$\{?([A-Za-z_./:][\w./:-]*)/g)) {
      for (const part of m[1].split(/[./:]+/)) if (part) names.add(part);
    }
    referencedNamesCache.set(node.tree, names);
  }
  return names;
}

/** A key that isn't in the schema is still fine if it's a user variable:
 * referenced as `$key`, or defined by an expression (`x #eval{ ... };`). */
function isUserVariable(key: string, entryNode: SyntaxNode): boolean {
  if (referencedNames(entryNode).has(key)) return true;
  return entryNode.childrenForFieldName("value").some(v => v != null && DEFERRED_VALUE_TYPES.has(unwrapValue(v).type));
}

function validateNode(node: SyntaxNode, schema: DictSchema, out: SchemaDiagnostic[], ignoreKeys: ReadonlySet<string>) {
  const { entries, blocks } = directMembers(node);
  const candidates = Object.keys(schema);

  for (const [key, entryNode] of entries) {
    if (ignoreKeys.has(key)) continue;
    const spec = schema[key];
    if (!spec) {
      if (isUserVariable(key, entryNode)) continue;
      const keyNode = entryNode.childForFieldName("key") ?? entryNode;
      out.push({
        range: nodeRange(keyNode),
        severity: "warning",
        message: `Unknown key '${key}'`,
        data: { candidates },
      });
      continue;
    }
    checkValue(entryNode, key, spec, out);
  }

  for (const [key, blockNode] of blocks) {
    if (ignoreKeys.has(key)) continue;
    const spec = schema[key];
    if (!spec) {
      if (referencedNames(blockNode).has(key)) continue;
      const nameNode = blockNode.childForFieldName("name") ?? blockNode;
      out.push({
        range: nodeRange(nameNode),
        severity: "warning",
        message: `Unknown key '${key}'`,
        data: { candidates },
      });
      continue;
    }
    if (spec.type === "dict" && spec.keywords) {
      validateNode(blockNode, spec.keywords, out, EMPTY_SET);
    }
  }

  if (hasOpaqueMembers(node)) return;
  for (const [key, spec] of Object.entries(schema)) {
    if (!spec.required) continue;
    if (entries.has(key) || blocks.has(key)) continue;
    out.push({
      range: nodeRange(node),
      severity: "error",
      message: `Missing required key '${key}'`,
    });
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();
/** Present at the top of every OpenFOAM/Helyx dictionary file — never part
 * of a file-type-specific schema, so always excluded from top-level
 * unknown-key checking. */
const DEFAULT_IGNORE_KEYS: ReadonlySet<string> = new Set(["FoamFile"]);

/**
 * Validates the top-level entries/blocks of `tree` against `schema`:
 * unknown keys, missing required keys, enum (`options`) mismatches, and a
 * conservative boolean/number type check. Nested `type: "dict"` fields
 * recurse into the matching named block using that field's own `keywords`.
 */
export function validate(tree: Tree, schema: DictSchema, ignoreKeys: ReadonlySet<string> = DEFAULT_IGNORE_KEYS): SchemaDiagnostic[] {
  const out: SchemaDiagnostic[] = [];
  validateNode(tree.rootNode, schema, out, ignoreKeys);
  return out;
}

/**
 * Validates a specific named top-level block (e.g. `castellatedMeshControls`
 * inside a `snappyHexMeshDict`) against `schema`, instead of the whole file.
 */
export function validateBlock(tree: Tree, blockName: string, schema: DictSchema): SchemaDiagnostic[] {
  const { blocks } = directMembers(tree.rootNode);
  const block = blocks.get(blockName);
  if (!block) return [];
  const out: SchemaDiagnostic[] = [];
  validateNode(block, schema, out, EMPTY_SET);
  return out;
}

/** Validates an arbitrary block/source_file node directly (e.g. one
 * particular boundary patch's sub-block, found via `directBlocks`).
 * Internal to `validateBoundaryConditions()` below — not part of the
 * module's public surface since nothing else needs it. */
function validateSyntaxNode(node: SyntaxNode, schema: DictSchema): SchemaDiagnostic[] {
  const out: SchemaDiagnostic[] = [];
  validateNode(node, schema, out, EMPTY_SET);
  return out;
}

/** The direct child blocks of `node`, keyed by name — e.g. every patch
 * inside a `boundaryField { ... }` block. */
function directBlocks(node: SyntaxNode): Map<string, SyntaxNode> {
  return directMembers(node).blocks;
}

/** The direct child entry of `node` with the given key, if any. */
function directEntry(node: SyntaxNode, key: string): SyntaxNode | undefined {
  return directMembers(node).entries.get(key);
}

/** The single value node of an entry (unwrapped), or undefined. */
function entryValueText(entryNode: SyntaxNode): string | undefined {
  const values = entryNode.childrenForFieldName("value").filter((v): v is SyntaxNode => v != null);
  return values.length ? unwrapValue(values[0]).text : undefined;
}

/**
 * Validates each patch inside a `boundaryField { ... }` block against the
 * keyword schema for its declared `type` (e.g. a `fixedValue` patch
 * missing its required `value`). `boundaryConditions` is
 * `KeywordDb.boundaryConditions` — keyed by BC type name, each with a
 * `keywords: DictSchema`.
 */
export function validateBoundaryConditions(
  tree: Tree,
  boundaryConditions: Record<string, { keywords?: DictSchema }>,
): SchemaDiagnostic[] {
  const bfBlock = directBlocks(tree.rootNode).get("boundaryField");
  if (!bfBlock) return [];
  // The condition data describes fvPatchFields; point fields use different ones.
  const fieldClass = directBlocks(tree.rootNode).get("FoamFile");
  const cls = fieldClass ? directEntry(fieldClass, "class") : undefined;
  if (cls && /^point/.test(entryValueText(cls) ?? "")) return [];
  const out: SchemaDiagnostic[] = [];
  for (const [, patchBlock] of directBlocks(bfBlock)) {
    const typeEntry = directEntry(patchBlock, "type");
    const bcType = typeEntry ? entryValueText(typeEntry) : undefined;
    if (!bcType) continue;
    const bcSpec = boundaryConditions[bcType];
    if (!bcSpec?.keywords) continue;
    out.push(...validateSyntaxNode(patchBlock, bcSpec.keywords));
  }
  return out;
}

/**
 * Boundary-condition type names applicable to `fieldType`
 * (scalar/vector/tensor/symmTensor), via `BcInfo.appliesTo` — e.g. `noSlip`
 * and `pressureInletOutletVelocity` only apply to vector fields (`U`),
 * while `totalPressure`/`fixedFluxPressure` only apply to scalar fields
 * (`p`). When `fieldType` is unknown, or a BC declares no `appliesTo`,
 * it's included (permissive default — never hide a real option just
 * because the field type couldn't be determined).
 */
export function boundaryConditionsForFieldType(
  boundaryConditions: Record<string, { appliesTo?: string[] }>,
  fieldType: string | undefined,
): string[] {
  return Object.keys(boundaryConditions).filter(name => {
    const appliesTo = boundaryConditions[name].appliesTo;
    if (!fieldType || !appliesTo?.length) return true;
    return appliesTo.includes(fieldType);
  });
}

/** Every parse-`ERROR` node in the tree, as diagnostics. New capability — the
 * old hand-scanned diagnostics never surfaced raw parse errors at all. */
export function collectParseErrors(tree: Tree): SchemaDiagnostic[] {
  const out: SchemaDiagnostic[] = [];
  // The cursor must be deleted explicitly: web-tree-sitter 0.27's
  // FinalizationRegistry path for TreeCursor frees whatever cursor is in its
  // shared transfer buffer, not this one, which corrupts the Wasm heap and
  // eventually crashes the server ("memory access out of bounds").
  const cursor = tree.walk();
  const visit = (): void => {
    const node = cursor.currentNode;
    if (node.type === "ERROR" || node.isMissing) {
      out.push({
        range: nodeRange(node),
        severity: "error",
        message: node.isMissing ? `Syntax error: missing '${node.type}'` : "Syntax error",
      });
    }
    if (cursor.gotoFirstChild()) {
      do { visit(); } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  try { visit(); } finally { cursor.delete(); }
  return out;
}
