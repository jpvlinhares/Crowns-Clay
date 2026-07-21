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
import { unitValidator, type UnitDef } from './units.js';
import { techValidator, ERA_ORDER, type TechDef } from './techs.js';
import { eventValidator, type EventDef, type EffectExpr, type PredicateExpr } from './events.js';
import { traitValidator, type TraitDef } from './traits.js';
import { personalityValidator, type AIPersonalityDef } from './personalities.js';
import { castleTemplateValidator, type CastleTemplateDef } from './castleTemplates.js';
import { audioCueValidator, musicPlaylistValidator, type AudioCueDef, type MusicPlaylistDef } from './audio.js';

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
    readonly units: ReadonlyMap<string, UnitDef>,
    readonly techs: ReadonlyMap<string, TechDef>,
    readonly events: ReadonlyMap<string, EventDef>,
    readonly traits: ReadonlyMap<string, TraitDef>,
    readonly personalities: ReadonlyMap<string, AIPersonalityDef>,
    readonly audioCues: ReadonlyMap<string, AudioCueDef>,
    readonly musicPlaylists: ReadonlyMap<string, MusicPlaylistDef>,
    /** M52 (doc 07 §5): AI castle layout archetypes for the defence layer. */
    readonly castleTemplates: ReadonlyMap<string, CastleTemplateDef>,
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
    const units = [...(defs.get('unit') as Map<string, unknown>).values()] as UnitDef[];
    const techs = [...(defs.get('tech') as Map<string, unknown>).values()] as TechDef[];
    const events = [...(defs.get('event') as Map<string, unknown>).values()] as EventDef[];
    const traits = [...(defs.get('trait') as Map<string, unknown>).values()] as TraitDef[];
    const personalities = [...(defs.get('personality') as Map<string, unknown>).values()] as AIPersonalityDef[];
    const audioCues = [...(defs.get('audioCue') as Map<string, unknown>).values()] as AudioCueDef[];
    const musicPlaylists = [...(defs.get('musicPlaylist') as Map<string, unknown>).values()] as MusicPlaylistDef[];
    const castleTemplates = [...(defs.get('castleTemplate') as Map<string, unknown>).values()] as CastleTemplateDef[];
    return {
      db: DefinitionDatabase.fromValidated(
        terrain, overlays, resources, buildings, edicts, units, techs, events, traits, personalities, audioCues, musicPlaylists,
        castleTemplates,
      ),
      report,
    };
  }

  /** Integrity gate over already-validated defs (unique ids, exact coverage). */
  static fromValidated(
    terrain: readonly TerrainDef[],
    overlays: readonly OverlayDef[],
    resources: readonly ResourceDef[] = [],
    buildings: readonly BuildingDef[] = [],
    edicts: readonly EdictDef[] = [],
    units: readonly UnitDef[] = [],
    techs: readonly TechDef[] = [],
    events: readonly EventDef[] = [],
    traits: readonly TraitDef[] = [],
    personalities: readonly AIPersonalityDef[] = [],
    audioCues: readonly AudioCueDef[] = [],
    musicPlaylists: readonly MusicPlaylistDef[] = [],
    castleTemplates: readonly CastleTemplateDef[] = [],
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
    const unitMap = new Map(units.map((u) => [u.id, u]));
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
      for (const unitId of b.military?.recruits ?? []) {
        if (!unitMap.has(unitId)) integrity.push(`building '${b.id}' military.recruits references unknown unit '${unitId}'`);
      }
    }
    for (const u of units) {
      for (const resId of Object.keys(u.cost)) {
        if (!resourceMap.has(resId)) integrity.push(`unit '${u.id}' cost references unknown resource '${resId}'`);
      }
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    const edictMap = new Map(edicts.map((e) => [e.id, e]));

    // M32: tech DAG validation — unique ids (checked via Map construction below, duplicates
    // silently last-write-wins like every other kind, so check explicitly first), prerequisites
    // reference real techs, tier/era monotonic along every prerequisite edge (a tech can't
    // require a LATER tech), unlocks reference real building/unit/edict ids, and the
    // prerequisite graph is acyclic (Kahn's algorithm — mirrors mods.ts's load-order topo-sort).
    const techSeen = new Set<string>();
    for (const t of techs) {
      if (techSeen.has(t.id)) integrity.push(`duplicate tech id '${t.id}'`);
      techSeen.add(t.id);
    }
    const techMap = new Map(techs.map((t) => [t.id, t]));
    // 1.0 content-completeness: a unit's recruit gate must name a real tech (referential,
    // mirroring `unlocks` below). Checked here rather than in the unit block above because
    // that block throws before techMap is built.
    for (const u of units) {
      if (u.requiresTech !== undefined && !techMap.has(u.requiresTech)) {
        integrity.push(`unit '${u.id}' requiresTech references unknown tech '${u.requiresTech}'`);
      }
    }
    for (const t of techs) {
      for (const preId of t.prerequisites) {
        const pre = techMap.get(preId);
        if (pre === undefined) {
          integrity.push(`tech '${t.id}' prerequisite references unknown tech '${preId}'`);
          continue;
        }
        if (pre.tier > t.tier) {
          integrity.push(`tech '${t.id}' (tier ${t.tier}) has a higher-tier prerequisite '${preId}' (tier ${pre.tier})`);
        }
        if (ERA_ORDER.indexOf(pre.era) > ERA_ORDER.indexOf(t.era)) {
          integrity.push(`tech '${t.id}' (era ${t.era}) has a later-era prerequisite '${preId}' (era ${pre.era})`);
        }
      }
      for (const buildingId of t.unlocks?.buildings ?? []) {
        if (!buildingMap.has(buildingId)) integrity.push(`tech '${t.id}' unlocks references unknown building '${buildingId}'`);
      }
      for (const unitId of t.unlocks?.units ?? []) {
        if (!unitMap.has(unitId)) integrity.push(`tech '${t.id}' unlocks references unknown unit '${unitId}'`);
      }
      for (const edictId of t.unlocks?.edicts ?? []) {
        if (!edictMap.has(edictId)) integrity.push(`tech '${t.id}' unlocks references unknown edict '${edictId}'`);
      }
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    // acyclic check (Kahn): only run once every edge above is known-valid
    const inDegree = new Map<string, number>(techs.map((t) => [t.id, 0]));
    const dependents = new Map<string, string[]>();
    for (const t of techs) {
      for (const preId of t.prerequisites) {
        inDegree.set(t.id, (inDegree.get(t.id) as number) + 1);
        const list = dependents.get(preId) ?? [];
        list.push(t.id);
        dependents.set(preId, list);
      }
    }
    const ready = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    let visited = 0;
    while (ready.length > 0) {
      const id = ready.pop() as string;
      visited++;
      for (const dep of dependents.get(id) ?? []) {
        const d = (inDegree.get(dep) as number) - 1;
        inDegree.set(dep, d);
        if (d === 0) ready.push(dep);
      }
    }
    if (visited < techs.length) {
      const stuck = [...inDegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
      integrity.push(`tech prerequisite graph has a cycle involving: ${stuck.sort().join(', ')}`);
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }

    // M33: event referential integrity — hasEdict/hasTech predicates and grantResource/
    // removeResource effects must name real defs (unknown-command `command` effects aren't
    // checked here — the command registry is a sim-layer concept this package doesn't see).
    const checkPredicate = (eventId: string, expr: PredicateExpr): void => {
      if ('all' in expr) return expr.all.forEach((e) => checkPredicate(eventId, e));
      if ('any' in expr) return expr.any.forEach((e) => checkPredicate(eventId, e));
      if ('not' in expr) return checkPredicate(eventId, expr.not);
      if ('hasEdict' in expr && !edictMap.has(expr.hasEdict)) {
        integrity.push(`event '${eventId}' predicate references unknown edict '${expr.hasEdict}'`);
      }
      if ('hasTech' in expr && !techMap.has(expr.hasTech)) {
        integrity.push(`event '${eventId}' predicate references unknown tech '${expr.hasTech}'`);
      }
    };
    const checkEffect = (eventId: string, effect: EffectExpr): void => {
      if ('grantResource' in effect && !resourceMap.has(effect.grantResource.resource)) {
        integrity.push(`event '${eventId}' grantResource references unknown resource '${effect.grantResource.resource}'`);
      }
      if ('removeResource' in effect && !resourceMap.has(effect.removeResource.resource)) {
        integrity.push(`event '${eventId}' removeResource references unknown resource '${effect.removeResource.resource}'`);
      }
    };
    const eventSeen = new Set<string>();
    for (const e of events) {
      if (eventSeen.has(e.id)) integrity.push(`duplicate event id '${e.id}'`);
      eventSeen.add(e.id);
      checkPredicate(e.id, e.trigger);
      for (const wm of e.weightModifiers ?? []) checkPredicate(e.id, wm.condition);
      for (const choice of e.choices) {
        if (choice.requirements !== undefined) checkPredicate(e.id, choice.requirements);
        for (const effect of choice.effects) checkEffect(e.id, effect);
      }
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    const eventMap = new Map(events.map((e) => [e.id, e]));

    // M34: traits are self-contained skill-delta bundles — only a unique-id check applies.
    const traitSeen = new Set<string>();
    for (const t of traits) {
      if (traitSeen.has(t.id)) integrity.push(`duplicate trait id '${t.id}'`);
      traitSeen.add(t.id);
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    const traitMap = new Map(traits.map((t) => [t.id, t]));

    // M36: personalities are self-contained (`planBiases` keys are ai/planner.ts PlanArchetype
    // ids — a sim-layer concept this package doesn't see, same reasoning as event 'command'
    // effects above) — only a unique-id check applies.
    const personalitySeen = new Set<string>();
    for (const p of personalities) {
      if (personalitySeen.has(p.id)) integrity.push(`duplicate personality id '${p.id}'`);
      personalitySeen.add(p.id);
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    const personalityMap = new Map(personalities.map((p) => [p.id, p]));

    // M41: cues/playlists are self-contained (no cross-kind references — `trackIds` name
    // @crowns/audio synthesis patterns, a presentation-layer concept this package doesn't see,
    // same reasoning M36's personality `planBiases` keys already used) — unique-id checks only.
    const cueSeen = new Set<string>();
    for (const c of audioCues) {
      if (cueSeen.has(c.id)) integrity.push(`duplicate audio cue id '${c.id}'`);
      cueSeen.add(c.id);
    }
    const playlistSeen = new Set<string>();
    for (const p of musicPlaylists) {
      if (playlistSeen.has(p.id)) integrity.push(`duplicate music playlist id '${p.id}'`);
      playlistSeen.add(p.id);
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    // M52: castle templates — plan entries must name real DEFENSIVE buildings
    const templateSeen = new Set<string>();
    for (const ct of castleTemplates) {
      if (templateSeen.has(ct.id)) integrity.push(`duplicate castle-template id '${ct.id}'`);
      templateSeen.add(ct.id);
      for (const [ei, entry] of ct.plan.entries()) {
        const b = buildingMap.get(entry.def);
        if (b === undefined) integrity.push(`castle-template '${ct.id}' plan[${ei}] references unknown building '${entry.def}'`);
        else if (b.defense === undefined) integrity.push(`castle-template '${ct.id}' plan[${ei}] building '${entry.def}' is not defensive`);
      }
    }
    if (integrity.length > 0) {
      throw new Error(`content integrity failed:\n  ${integrity.join('\n  ')}`);
    }
    const audioCueMap = new Map(audioCues.map((c) => [c.id, c]));
    const musicPlaylistMap = new Map(musicPlaylists.map((p) => [p.id, p]));
    const castleTemplateMap = new Map(castleTemplates.map((ct) => [ct.id, ct]));

    return new DefinitionDatabase(
      byId, byCode, overlayMap, resourceMap, buildingMap, edictMap, unitMap, techMap, eventMap, traitMap, personalityMap,
      audioCueMap, musicPlaylistMap, castleTemplateMap,
    );
  }
}

/** Def-kind registry for the current content schema (grows every milestone). */
export const TERRAIN_KINDS: readonly DefKindSpec<unknown>[] = [
  { kind: 'terrain', pathPrefix: 'defs/terrain/', validator: terrainValidator as Validator<unknown> },
  { kind: 'overlay', pathPrefix: 'defs/overlays/', validator: overlayValidator as Validator<unknown> },
  { kind: 'resource', pathPrefix: 'defs/resources/', validator: resourceValidator as Validator<unknown> },
  { kind: 'building', pathPrefix: 'defs/buildings/', validator: buildingValidator as Validator<unknown> },
  { kind: 'edict', pathPrefix: 'defs/edicts/', validator: edictValidator as Validator<unknown> },
  { kind: 'unit', pathPrefix: 'defs/units/', validator: unitValidator as Validator<unknown> },
  { kind: 'tech', pathPrefix: 'defs/techs/', validator: techValidator as Validator<unknown> },
  { kind: 'event', pathPrefix: 'defs/events/', validator: eventValidator as Validator<unknown> },
  { kind: 'trait', pathPrefix: 'defs/traits/', validator: traitValidator as Validator<unknown> },
  { kind: 'personality', pathPrefix: 'defs/personalities/', validator: personalityValidator as Validator<unknown> },
  { kind: 'audioCue', pathPrefix: 'defs/cues/', validator: audioCueValidator as Validator<unknown> },
  { kind: 'musicPlaylist', pathPrefix: 'defs/playlists/', validator: musicPlaylistValidator as Validator<unknown> },
  { kind: 'castleTemplate', pathPrefix: 'defs/castle-templates/', validator: castleTemplateValidator as Validator<unknown> },
];
