/**
 * Mod loader (roadmap M10; doc 09 §1–§7).
 *
 * Pipeline: manifests → enablement (game version, dependencies, conflicts,
 * fixpoint) → order (dependency topo-sort, then loadAfter, then user order,
 * cycles disabled with a named chain) → layer merge (later same-id REPLACES) →
 * patch application (surgical ops that survive upstream updates) → per-kind
 * validation + referential integrity → immutable DefinitionDatabase + report.
 *
 * Mod-level problems DISABLE the offending mod with readable reasons; def-level
 * problems in the merged result are FATAL with mod-prefixed file paths — a
 * broken content set must never half-load into a campaign (doc 09 §3).
 */
import { fnv1a32 } from '@crowns/core';
import { parseJson5Subset, v, formatErrors, type ValidationError, type Validator } from './validate.js';
import { satisfies } from './semver.js';

export const GAME_VERSION = '1.0.0';

export interface ModSource {
  /** path → raw text; must include 'mod.json5'. */
  readonly files: Readonly<Record<string, string>>;
}

export interface ModManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly gameVersion: string;
  readonly dependencies: readonly { readonly id: string; readonly version: string }[];
  readonly loadAfter: readonly string[];
  readonly conflicts: readonly string[];
  readonly tags: readonly string[];
  readonly authors: readonly string[];
}

const manifestValidator: Validator<ModManifest> = v.object(
  {
    id: v.string({ minLength: 1 }),
    name: v.string({ minLength: 1 }),
    version: v.string({ minLength: 1 }),
    gameVersion: v.string({ minLength: 1 }),
    dependencies: v.array(v.object({ id: v.string({ minLength: 1 }), version: v.string({ minLength: 1 }) })),
    loadAfter: v.array(v.string({ minLength: 1 })),
    conflicts: v.array(v.string({ minLength: 1 })),
    tags: v.array(v.string({ minLength: 1 })),
    authors: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['conflicts', 'tags', 'authors', 'loadAfter', 'dependencies'] },
) as Validator<ModManifest>;

// ---------------------------------------------------------------- patches

interface PatchDoc {
  readonly patch: string;
  readonly ops: readonly Record<string, unknown>[];
}

const patchValidator: Validator<PatchDoc> = v.object({
  patch: v.id(),
  ops: v.array(v.record(), { minItems: 1 }),
}) as unknown as Validator<PatchDoc>;

function navigate(root: Record<string, unknown>, dotPath: string): { parent: Record<string, unknown>; key: string } | string {
  const parts = dotPath.split('.');
  let node: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    const current = node as Record<string, unknown>;
    if (typeof current[key] !== 'object' || current[key] === null) {
      if (current[key] === undefined) current[key] = {}; // create-on-set friendliness
      else return `path segment '${parts.slice(0, i + 1).join('.')}' is not an object`;
    }
    node = current[key];
  }
  return { parent: node as Record<string, unknown>, key: parts[parts.length - 1] as string };
}

function applyPatchOps(
  target: Record<string, unknown>,
  ops: readonly Record<string, unknown>[],
  label: string,
  errors: string[],
): void {
  for (const [index, op] of ops.entries()) {
    const at = (path: unknown): { parent: Record<string, unknown>; key: string } | null => {
      if (typeof path !== 'string' || path.length === 0) {
        errors.push(`${label} op[${index}]: path must be a non-empty string`);
        return null;
      }
      const nav = navigate(target, path);
      if (typeof nav === 'string') {
        errors.push(`${label} op[${index}]: ${nav}`);
        return null;
      }
      return nav;
    };
    if ('set' in op) {
      const nav = at(op['set']);
      if (nav !== null) nav.parent[nav.key] = op['value'];
    } else if ('mergeAppend' in op) {
      const nav = at(op['mergeAppend']);
      if (nav === null) continue;
      const existing = nav.parent[nav.key];
      if (!Array.isArray(existing)) {
        errors.push(`${label} op[${index}]: mergeAppend target '${String(op['mergeAppend'])}' is not an array`);
        continue;
      }
      const value = op['value'];
      if (Array.isArray(value)) existing.push(...(value as unknown[]));
      else existing.push(value);
    } else if ('remove' in op) {
      const nav = at(op['remove']);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- patch op keys are author-supplied by design (doc 09 §7)
      if (nav !== null) delete nav.parent[nav.key];
    } else {
      errors.push(`${label} op[${index}]: unknown op (use set | mergeAppend | remove)`);
    }
  }
}

// ---------------------------------------------------------------- kinds

export interface DefKindSpec<T> {
  readonly kind: string;
  readonly pathPrefix: string; // 'defs/terrain/'
  readonly validator: Validator<T>;
}

// ---------------------------------------------------------------- loading

/** Per-layer identity for save embedding & reconciliation (doc 09 §5, OQ-4). */
export interface ModManifestEntry {
  readonly modId: string;
  readonly version: string;
  /** fnv1a32 over every enabled layer file's contents, sorted by path — a
   *  cheap content fingerprint that changes when a rebalance edits a def
   *  without bumping `version` (doc 06 §13's `hash` field). */
  readonly hash: number;
}

export interface LoadReport {
  /** Final enabled layer order. */
  readonly order: string[];
  readonly disabled: { readonly id: string; readonly reasons: string[] }[];
  /** Def ids provided by ≥2 layers, with the winning layer (doc 09 §6). */
  readonly overrides: { readonly defId: string; readonly layers: string[]; readonly winner: string }[];
  readonly patched: { readonly defId: string; readonly by: string[] }[];
  /** Identity of every enabled layer, in `order` — embedded in saves (doc 09 §5). */
  readonly manifest: ModManifestEntry[];
}

/**
 * Preview a mod's identity (id/name/version/tags) without running the full
 * enablement/order/merge pipeline — for a Mods screen listing candidates
 * before they're selected (roadmap M39). Returns null on a missing or
 * malformed manifest rather than throwing: a listing UI shows it disabled,
 * loadModLayers still reports the precise reason if the mod is enabled.
 */
export function parseModManifestPreview(
  files: Readonly<Record<string, string>>,
): { readonly id: string; readonly name: string; readonly version: string; readonly tags: readonly string[] } | null {
  const raw = files['mod.json5'];
  if (raw === undefined) return null;
  try {
    const errors: ValidationError[] = [];
    const manifest = manifestValidator(parseJson5Subset('mod.json5', raw), '', errors, 'mod.json5');
    if (errors.length > 0) return null;
    return { id: manifest.id, name: manifest.name, version: manifest.version, tags: manifest.tags ?? [] };
  } catch {
    return null;
  }
}

interface RawDef {
  value: Record<string, unknown>;
  providedBy: string[]; // layer ids in order
  patchedBy: string[];
  file: string; // winning source, mod-prefixed
}

export function resolveLoadOrder(
  manifests: readonly ModManifest[],
  gameVersion: string,
  userOrder: readonly string[] = [],
): { order: string[]; disabled: Map<string, string[]> } {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const disabled = new Map<string, string[]>();
  const reason = (id: string, why: string): void => {
    const list = disabled.get(id);
    if (list === undefined) disabled.set(id, [why]);
    else if (!list.includes(why)) list.push(why);
  };

  // enablement fixpoint
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of manifests) {
      if (disabled.has(m.id)) continue;
      if (!satisfies(gameVersion, m.gameVersion)) {
        reason(m.id, `requires game ${m.gameVersion}, running ${gameVersion}`);
        changed = true;
        continue;
      }
      for (const dep of m.dependencies) {
        const target = byId.get(dep.id);
        if (target === undefined) reason(m.id, `missing dependency '${dep.id}'`);
        else if (disabled.has(dep.id)) reason(m.id, `dependency '${dep.id}' is disabled`);
        else if (!satisfies(target.version, dep.version)) {
          reason(m.id, `dependency '${dep.id}' version ${target.version} does not satisfy ${dep.version}`);
        }
      }
      for (const foe of m.conflicts) {
        if (byId.has(foe) && !disabled.has(foe)) reason(m.id, `conflicts with enabled mod '${foe}'`);
      }
      if (disabled.has(m.id)) changed = true;
    }
  }

  // topological order: dependency edges + loadAfter edges (Kahn), determinist
  // tie-break by (userOrder position, id)
  const enabled = manifests.filter((m) => !disabled.has(m.id));
  const rank = (id: string): number => {
    const i = userOrder.indexOf(id);
    return i === -1 ? userOrder.length : i;
  };
  const edges = new Map<string, Set<string>>(); // prerequisite → dependents
  const inDegree = new Map<string, number>(enabled.map((m) => [m.id, 0]));
  const addEdge = (before: string, after: string): void => {
    if (!inDegree.has(before) || !inDegree.has(after)) return;
    const set = edges.get(before) ?? new Set<string>();
    if (!set.has(after)) {
      set.add(after);
      edges.set(before, set);
      inDegree.set(after, (inDegree.get(after) as number) + 1);
    }
  };
  for (const m of enabled) {
    for (const dep of m.dependencies) addEdge(dep.id, m.id);
    for (const after of m.loadAfter) addEdge(after, m.id);
  }
  const ready = enabled.filter((m) => inDegree.get(m.id) === 0).map((m) => m.id);
  const sortReady = (): void => {
    ready.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  };
  const order: string[] = [];
  sortReady();
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const dependent of edges.get(id) ?? []) {
      const d = (inDegree.get(dependent) as number) - 1;
      inDegree.set(dependent, d);
      if (d === 0) {
        ready.push(dependent);
        sortReady();
      }
    }
  }
  const inCycle = enabled.filter((m) => !order.includes(m.id));
  if (inCycle.length > 0) {
    const chain = inCycle.map((m) => m.id).join(' → ');
    for (const m of inCycle) reason(m.id, `dependency cycle: ${chain}`);
  }
  return { order, disabled };
}

export function loadModLayers<TKinds extends readonly DefKindSpec<unknown>[]>(
  sources: readonly ModSource[],
  kinds: TKinds,
  options: { gameVersion?: string; userOrder?: readonly string[] } = {},
): { defs: Map<string, Map<string, unknown>>; report: LoadReport } {
  const gameVersion = options.gameVersion ?? GAME_VERSION;

  // 1) manifests
  const manifests: ModManifest[] = [];
  const preDisabled: { id: string; reasons: string[] }[] = [];
  for (const [index, source] of sources.entries()) {
    const raw = source.files['mod.json5'];
    const label = `mod #${index}`;
    if (raw === undefined) {
      preDisabled.push({ id: label, reasons: ['missing mod.json5'] });
      continue;
    }
    const errors: ValidationError[] = [];
    const manifest = manifestValidator(parseJson5Subset(`${label}/mod.json5`, raw), '', errors, `${label}/mod.json5`);
    if (errors.length > 0) {
      preDisabled.push({ id: label, reasons: [`invalid manifest:\n${formatErrors(errors)}`] });
      continue;
    }
    manifests.push({
      ...manifest,
      dependencies: manifest.dependencies ?? [],
      loadAfter: manifest.loadAfter ?? [],
      conflicts: manifest.conflicts ?? [],
      tags: manifest.tags ?? [],
      authors: manifest.authors ?? [],
    });
  }
  const sourceById = new Map<string, ModSource>();
  for (const [index, source] of sources.entries()) {
    const manifest = manifests.find((m) => source.files['mod.json5'] !== undefined && m.id === (parseJson5Subset('x', source.files['mod.json5']) as { id?: string }).id);
    if (manifest !== undefined) sourceById.set(manifest.id, sources[index] as ModSource);
  }

  // 2) enablement + order
  const { order, disabled } = resolveLoadOrder(manifests, gameVersion, options.userOrder ?? []);

  // 3) merge layers: later same-id REPLACES
  const raws = new Map<string, Map<string, RawDef>>(kinds.map((k) => [k.kind, new Map()]));
  const patchFatal: string[] = [];
  for (const layerId of order) {
    const files = (sourceById.get(layerId) as ModSource).files;
    for (const path of Object.keys(files).sort()) {
      const kind = kinds.find((k) => path.startsWith(k.pathPrefix) && path.endsWith('.json5'));
      if (kind === undefined) continue;
      const parsed = parseJson5Subset(`${layerId}:${path}`, files[path] as string);
      if (!Array.isArray(parsed)) {
        patchFatal.push(`${layerId}:${path}: expected an array of defs`);
        continue;
      }
      for (const entry of parsed) {
        const id = (entry as { id?: unknown }).id;
        if (typeof id !== 'string') {
          patchFatal.push(`${layerId}:${path}: def without a string 'id'`);
          continue;
        }
        const bucket = raws.get(kind.kind) as Map<string, RawDef>;
        const existing = bucket.get(id);
        if (existing === undefined) {
          bucket.set(id, {
            value: JSON.parse(JSON.stringify(entry)) as Record<string, unknown>,
            providedBy: [layerId],
            patchedBy: [],
            file: `${layerId}:${path}`,
          });
        } else {
          existing.value = JSON.parse(JSON.stringify(entry)) as Record<string, unknown>; // replace
          existing.providedBy.push(layerId);
          existing.file = `${layerId}:${path}`;
        }
      }
    }
  }

  // 4) patches (in layer order, after all provides)
  for (const layerId of order) {
    const files = (sourceById.get(layerId) as ModSource).files;
    for (const path of Object.keys(files).sort()) {
      if (!path.startsWith('patches/') || !path.endsWith('.json5')) continue;
      const label = `${layerId}:${path}`;
      const parsed = parseJson5Subset(label, files[path] as string);
      const errors: ValidationError[] = [];
      const docs = v.array(patchValidator)(parsed, '', errors, label);
      if (errors.length > 0) {
        patchFatal.push(formatErrors(errors));
        continue;
      }
      for (const doc of docs) {
        const bucket = [...raws.values()].find((b) => b.has(doc.patch));
        if (bucket === undefined) {
          patchFatal.push(`${label}: patch target '${doc.patch}' does not exist in any loaded layer`);
          continue;
        }
        const raw = bucket.get(doc.patch) as RawDef;
        applyPatchOps(raw.value, doc.ops, `${label} (patch '${doc.patch}')`, patchFatal);
        if (!raw.patchedBy.includes(layerId)) raw.patchedBy.push(layerId);
      }
    }
  }
  if (patchFatal.length > 0) {
    throw new Error(`mod content failed to merge:\n  ${patchFatal.join('\n  ')}`);
  }

  // 5) validate merged results per kind
  const validationErrors: ValidationError[] = [];
  const defs = new Map<string, Map<string, unknown>>();
  for (const kind of kinds) {
    const out = new Map<string, unknown>();
    for (const [id, raw] of raws.get(kind.kind) as Map<string, RawDef>) {
      out.set(id, kind.validator(raw.value, '', validationErrors, raw.file));
    }
    defs.set(kind.kind, out);
  }
  if (validationErrors.length > 0) {
    throw new Error(`content validation failed:\n${formatErrors(validationErrors)}`);
  }

  // 6) report
  const overrides: LoadReport['overrides'] = [];
  const patched: LoadReport['patched'] = [];
  for (const bucket of raws.values()) {
    for (const [defId, raw] of bucket) {
      if (raw.providedBy.length > 1) {
        overrides.push({ defId, layers: [...raw.providedBy], winner: raw.providedBy[raw.providedBy.length - 1] as string });
      }
      if (raw.patchedBy.length > 0) patched.push({ defId, by: [...raw.patchedBy] });
    }
  }
  const manifestById = new Map(manifests.map((m) => [m.id, m]));
  const manifest: ModManifestEntry[] = order.map((id) => {
    const files = (sourceById.get(id) as ModSource).files;
    const content = Object.keys(files).sort().map((path) => `${path}\n${files[path] as string}`).join(' ');
    return { modId: id, version: (manifestById.get(id) as ModManifest).version, hash: fnv1a32(content) };
  });
  return {
    defs,
    report: {
      order,
      disabled: [
        ...preDisabled,
        ...[...disabled.entries()].map(([id, reasons]) => ({ id, reasons })),
      ],
      overrides,
      patched,
      manifest,
    },
  };
}
