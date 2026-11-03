import type { FieldSpec } from "../treeSitter/schema";

/**
 * Corrections to data/keyword-db.json, applied when the server loads it.
 * Kept in code rather than edited into the JSON so that regenerating the
 * database (`npm run update-database`) can't silently undo them. Each list
 * was taken from OpenFOAM v2606 itself (the "Valid ... types" message it
 * prints for an unknown name) unless noted.
 */

// decomposePar's list, plus ptscotch (libptscotchDecomp, loaded in parallel)
// and assembly (used by the v2606 adjoint motorBike tutorials).
const DECOMPOSITION_METHODS = [
  "hierarchical", "kahip", "manual", "metis", "multiLevel", "none", "random",
  "scotch", "simple", "structured", "ptscotch", "assembly",
];

// Incompressible RAS models, plus buoyantKEpsilon from the compressible list.
const RAS_MODELS = [
  "EBRSM", "GEKO", "LRR", "LamBremhorstKE", "LaunderSharmaKE", "LienCubicKE",
  "LienLeschziner", "RNGkEpsilon", "SSG", "ShihQuadraticKE", "SpalartAllmaras",
  "kEpsilon", "kEpsilonLopesdaCosta", "kEpsilonPhitF", "kL", "kOmega", "kOmegaSST",
  "kOmegaSSTLM", "kOmegaSSTSAS", "kkLOmega", "qZeta", "realizableKE", "buoyantKEpsilon",
];

const LES_MODELS = [
  "DeardorffDiffStress", "Smagorinsky", "SpalartAllmarasDDES", "SpalartAllmarasDES",
  "SpalartAllmarasIDDES", "WALE", "dynamicKEqn", "dynamicLagrangian", "kEqn",
  "kOmegaSSTDDES", "kOmegaSSTDES", "kOmegaSSTIDDES", "sigma",
];

// Optimisation/debug switch blocks a case controlDict may override.
const CONTROL_DICT_SWITCH_BLOCKS = [
  "DebugSwitches", "InfoSwitches", "OptimisationSwitches", "DimensionedConstants", "DimensionSets",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function addOptions(spec: FieldSpec | undefined, options: string[]) {
  if (!spec) return;
  spec.options = [...new Set([...(spec.options ?? []), ...options])];
}

export function applyDbOverrides(db: Db): void {
  // writeControl: OpenFOAM accepts `adjustable` as well as `adjustableRunTime`.
  addOptions(db.controlDict?.keywords?.writeControl, ["adjustable"]);
  for (const k of CONTROL_DICT_SWITCH_BLOCKS) {
    if (db.controlDict?.keywords && !db.controlDict.keywords[k]) db.controlDict.keywords[k] = { type: "dict" };
  }

  if (db.decomposePar) {
    addOptions(db.decomposePar.method, DECOMPOSITION_METHODS);
    // The generic `coeffs` sub-dictionary, accepted for every method.
    db.decomposePar.coeffs ??= { type: "dict" };
  }

  db.turbulenceModels ??= { RAS: {}, LES: {} };
  for (const [kind, names] of [["RAS", RAS_MODELS], ["LES", LES_MODELS]] as const) {
    db.turbulenceModels[kind] ??= {};
    for (const n of names) db.turbulenceModels[kind][n] ??= { brief: "", coefficients: {} };
  }

  // totalPressure reads U and phi with defaults ("U", "phi").
  const tp = db.boundaryConditions?.totalPressure?.keywords;
  if (tp?.U) tp.U.required = false;
  if (tp?.phi) tp.phi.required = false;

  // Conditions that set their own value when `value` is absent (from
  // inletValue, p0, the flow rate, the internal field, or a profile).
  for (const bc of VALUE_OPTIONAL_BCS) {
    const v = db.boundaryConditions?.[bc]?.keywords?.value;
    if (v) v.required = false;
  }

  // Keys with defaults, or read only when needed (multi-region and meshing
  // cases legitimately omit them).
  const notRequired: (FieldSpec | undefined)[] = [
    db.controlDict?.keywords?.startFrom,
    db.snappyHexMesh?.addLayersControls?.layers,
    // v2606 also accepts the plural `locationsInMesh` (checked by hand in the server).
    db.snappyHexMesh?.castellatedMeshControls?.locationInMesh,
  ];
  for (const spec of notRequired) if (spec) spec.required = false;

  // Documented v2606 keys missing from the data. (OpenFOAM ignores unknown
  // keys, so these only remove "Unknown key" warnings.)
  for (const [name, bc] of Object.entries<{ keywords?: Record<string, FieldSpec> }>(db.boundaryConditions ?? {})) {
    if (!bc.keywords) continue;
    const extra = [...BC_EXTRA_KEYS["*"], ...(BC_EXTRA_KEYS[name] ?? []),
                   ...(name.endsWith("WallFunction") ? WALL_FUNCTION_KEYS : [])];
    for (const k of extra) bc.keywords[k] ??= { type: "word" };
  }
  addKeys(db.controlDict?.keywords, ["maxDi"]);
  addKeys(db.snappyHexMesh?.addLayersControls, ["slipFeatureAngle", "nRelaxedIter"]);
  addKeys(db.snappyHexMesh?.meshQualityControls, ["relaxed"]);
  addKeys(db.decomposePar, DECOMPOSITION_METHODS.map(m => `${m}Coeffs`));
}

function addKeys(schema: Record<string, FieldSpec> | undefined, keys: string[]) {
  if (schema) for (const k of keys) schema[k] ??= {};
}

const WALL_FUNCTION_KEYS = ["Cmu", "kappa", "E"];

const BC_EXTRA_KEYS: Record<string, string[]> = {
  "*": ["value", "patchType"],
  inletOutlet: ["phi"],
  outletInlet: ["phi"],
  pressureInletOutletVelocity: ["phi", "inletValue", "tangentialVelocity"],
  totalPressure: ["phi", "rho", "psi", "gamma"],
  prghTotalPressure: ["rho"],
  flowRateInletVelocity: ["rhoInlet", "rho", "extrapolateProfile"],
  externalWallHeatFluxTemperature: [
    "mode", "Q", "q", "h", "Ta", "kappaMethod", "kappa", "thicknessLayers", "kappaLayers",
    "relaxation", "emissivity", "qr", "qrRelaxation",
  ],
};

const VALUE_OPTIONAL_BCS = [
  "inletOutlet", "totalPressure", "prghTotalPressure", "flowRateInletVelocity",
  "pressureInletOutletVelocity", "atmBoundaryLayerInletVelocity", "turbulentDFSEMInlet",
  "externalWallHeatFluxTemperature", "kqRWallFunction", "zeroGradient",
];
