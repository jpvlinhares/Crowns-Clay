/**
 * TerrainDef & OverlayDef — the first content definitions (doc 06 §9), plus
 * the M8 slice of the Definition Database (Engine §13). Loading = parse every
 * defs/ file through the validator core, enforce referential integrity
 * (unique ids, exact biome-code coverage), and freeze the result.
 */
// NOTE: sim depends on data (TDD §3), never the reverse — so the biome-code
// count is mirrored here as a constant; a cross-check test in @crowns/sim
// asserts it equals worldgen's BIOME_COUNT (terrain.test.ts there).
export const TERRAIN_BIOME_CODES = 10;
import { v, type Validator } from './validate.js';
import { loadModLayers, type DefKindSpec, type LoadReport, type ModSource } from './mods.js';
import { buildingValidator, resourceValidator, type BuildingDef, type ResourceDef } from './buildings.js';
import { edictValidator, type EdictDef } from './edicts.js';

export interface TerrainDef {
  readonly id: string;
  readonly name: string;
  readonly biomeCode: number;
  readonly colors: { readonly base: number; readonly accent: number };
  readonly movementCost: number;
  readonly buildableTags: readonly string[];
  readonly defenseBonus: number;
  readonly tags: readonly string[];
}

export interface OverlayDef {
  readonly id: string;
  readonly kind: 'river' | 'lake';
  readonly color: number;
}

export const terrainValidator: Validator<TerrainDef> = v.object({
  id: v.id(),
  name: v.string({ minLength: 1 }),
  biomeCode: v.number({ min: 0, max: TERRAIN_BIOME_CODES - 1, integer: true }),
  colors: v.object({ base: v.color(), accent: v.color() }),
  movementCost: v.number({ min: 0, max: 10 }),
  buildableTags: v.array(v.string({ minLength: 1 })),
  defenseBonus: v.number({ min: 0, max: 1 }),
  tags: v.array(v.string({ minLength: 1 })),
}) as Validator<TerrainDef>;

export const overlayValidator: Validator<OverlayDef> = v.object({
  id: v.id(),
  kind: v.literal('river', 'lake'),
  color: v.color(),
}) as Validator<OverlayDef>;

export class DefinitionDatabase {
  private constructor(
    readonly terrainById: ReadonlyMap<string, TerrainDef>,
    readonly terrainByCode: readonly TerrainDef[], // indexed by biomeCode
    readonly overlays: ReadonlyMap<'river' | 'lake', OverlayDef>,
    readonly resources: ReadonlyMap<string, ResourceDef>,
    readonly buildings: ReadonlyMap<string, BuildingDef>,
    readonly edicts: ReadonlyMap<string, EdictDef>,
  ) {}

  /** Load a single-mod content set (convenience; delegates to the mod loader). */
  static load(files: Readonly<Record<string, string>>): DefinitionDatabase {
    return DefinitionDatabase.loadMods([{ files }]).db;
  }

  /** Load and merge multiple mod layers (doc 09) → database + report. */
  static loadMods(
    sources: readonly ModSource[],
    options: { gameVersion?: string; userOrder?: readonly string[] } = {},
  ): { db: DefinitionDatabase; report: LoadReport } {
    const { defs, report } = loadModLayers(sources, TERRAIN_KINDS, options);
    const terrain = [...(defs.get('terrain') as Map<string, unknown>).values()] as TerrainDef[];
    const overlays = [...(defs.get('overlay') as Map<string, unknown>).values()] as OverlayDef[];
    const resources = [...(defs.get('resource') as Map<string, unknown>).values()] as ResourceDef[];
    const buildings = [...(defs.get('building') as Map<string, unknown>).values()] as BuildingDef[];
    const edicts = [...(defs.get('edict') as Map<string, unknown>).values()] as EdictDef[];
    return { db: DefinitionDatabase.fromValidated(terrain, overlays, resources, buildings, edicts), report };
  }

  /** Integrity gate over already-validated defs (unique ids, exact coverage). */
  static fromValidated(
    terrain: readonly TerrainDef[],
    overlays: readonly OverlayDef[],
    resources: readonly ResourceDef[] = [],
    buildings: readonly BuildingDef[] = [],
    edicts: readonly EdictDef[] = [],
  ): DefinitionDatabase {
    // referential integrity: unique ids, exact biome coverage, overlay kinds
    const byId = new Map<string, TerrainDef>();
    const byCode: TerrainDef[] = new Array<TerrainDef>(TERRAIN_BIOME_CODES);
    const integrity: string[] = [];
    for (const def of terrain) {
      if (byId.has(def.id)) integrity.push(`duplicate terrain id '${def.id}'`);
      byId.set(def.id, def);
      if (byCode[def.biomeCode] !== undefined) {
        integrity.push(`biome code ${def.biomeCode} claimed by both '${(byCode[def.biomeCode] as TerrainDef).id}' and '${def.id}'`);
      }
      byCode[def.biomeCode] = def;
    }
    for (let code = 0; code < TERRAIN_BIOME_CODES; code++) {
      if (byCode[code] === undefined) integrity.push(`biome code ${code} has no terrain def`);
    }
    const overlayMap = new Map<'river' | 'lake', OverlayDef>();
    for (const def of overlays) {
      if (overlayMap.has(def.kind)) integrity.push(`duplicate overlay kind '${def.kind}'`);
      overlayMap.set(def.kind, def);
    }
    for (const kind of ['river', 'lake'] as const) {
      if (!overlayMap.has(kind)) integrity.push(`missing overlay def for '${kind}'`);
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    const resourceMap = new Map(resources.map((r) => [r.id, r]));
    const buildingMap = new Map(buildings.map((b) => [b.id, b]));
    // cross-kind references: building costs and recipe yields must name real resources
    for (const b of buildings) {
      for (const resId of Object.keys(b.cost)) {
        if (!resourceMap.has(resId)) integrity.push(`building '${b.id}' cost references unknown resource '${resId}'`);
      }
      for (const [ri, recipe] of (b.recipes ?? []).entries()) {
        for (const y of [...recipe.inputs, ...recipe.outputs]) {
          if (!resourceMap.has(y.resource)) {
            integrity.push(`building '${b.id}' recipe[${ri}] references unknown resource '${y.resource}'`);
          }
        }
      }
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    const edictMap = new Map(edicts.map((e) => [e.id, e]));
    return new DefinitionDatabase(byId, byCode, overlayMap, resourceMap, buildingMap, edictMap);
  }
}

/** Def-kind registry for the current content schema (grows every milestone). */
export const TERRAIN_KINDS: readonly DefKindSpec<unknown>[] = [
  { kind: 'terrain', pathPrefix: 'defs/terrain/', validator: terrainValidator as Validator<unknown> },
  { kind: 'overlay', pathPrefix: 'defs/overlays/', validator: overlayValidator as Validator<unknown> },
  { kind: 'resource', pathPrefix: 'defs/resources/', validator: resourceValidator as Validator<unknown> },
  { kind: 'building', pathPrefix: 'defs/buildings/', validator: buildingValidator as Validator<unknown> },
  { kind: 'edict', pathPrefix: 'defs/edicts/', validator: edictValidator as Validator<unknown> },
];
