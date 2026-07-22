/**
 * Binds a composed simulation session to a TransportPort speaking the protocol
 * (TDD §1/§4). Transport-agnostic: the browser worker entry (sim.worker.ts)
 * and headless tools use the same bridge, so behaviour is identical everywhere.
 *
 * M6 session = the wanderers composition (also the golden-replay scenario):
 * the first thing the renderer shows is, deliberately, a world whose exact
 * evolution is pinned by committed fixtures.
 */
import type { AudioCatalog, CampaignSettings, FromSimMessage, ModReconciliation, ModReport, PanelArmyRec, PanelDefencePostRec, PanelDefenceState, PanelDefenceStructureRec, PanelEnemyIntelRec, PanelKingdomRec, PanelUnitRec, PlayerPanels, TerrainSnapshot, ToSimMessage, TransportPort, UICatalog, WorldMeta } from '@crowns/protocol';
import { EXAMPLE_MOD_FILES, parseModManifestPreview, type DefinitionDatabase, type LoadReport, type ModSource } from '@crowns/data';
import {
  DEFENCE_MAP_SIZE, STANCES, TickDriver, composeCampaign, defenceFootprintOf, difficultyFromSettings, encodeDefenceMap, reconcileModManifest, modReconciliationHasFindings, victoryFromSettings,
  type CampaignComposition, type CampaignSave, type Kernel, type SaveManager, type TickResult, type World,
} from '@crowns/sim';
import type { EntityId, Locale } from '@crowns/core';
import { choiceOutcomes } from './eventOutcomes.js';
import { SnapshotEmitter } from './snapshots.js';
import { BuildingEmitter, RoadEmitter, TerritoryEmitter, VillageStatsEmitter } from './buildingEmitter.js';
import { composeTerra, type ModSelection, type SandboxOptions } from './terra.js';
import { autosaveSlot, estimateStorage, getSlot, isStorageTight, pruneAutosaveRing, putSlot, requestPersistence } from './saveStore.js';

/** Every mod bundled with this build, available for the Mods screen to enable (roadmap M39). */
export const AVAILABLE_MODS: readonly { readonly dir: string; readonly id: string; readonly name: string; readonly version: string; readonly tags: readonly string[] }[] =
  Object.entries(EXAMPLE_MOD_FILES)
    .map(([dir, files]) => {
      const preview = parseModManifestPreview(files);
      return preview === null ? null : { dir, ...preview };
    })
    .filter((m): m is { dir: string; id: string; name: string; version: string; tags: readonly string[] } => m !== null);

/** Resolve Mods-screen selections (manifest ids) to loadable sources, in the requested order. */
function resolveModSelection(enabled: readonly string[], order: readonly string[]): ModSelection {
  const byId = new Map(AVAILABLE_MODS.map((m) => [m.id, m]));
  const chosen = enabled.map((id) => byId.get(id)).filter((m): m is (typeof AVAILABLE_MODS)[number] => m !== undefined);
  const sources: ModSource[] = chosen.map((m) => ({ files: EXAMPLE_MOD_FILES[m.dir] as Readonly<Record<string, string>> }));
  return { sources, order: order.filter((id) => chosen.some((m) => m.id === id)) };
}

export interface SimSession {
  readonly kernel: Kernel;
  readonly driver: TickDriver;
  readonly emitter: SnapshotEmitter;
  readonly worldMeta: WorldMeta;
  readonly terrain: TerrainSnapshot;
  readonly world: World;
  readonly buildingEmitter: BuildingEmitter;
  readonly villageEmitter: VillageStatsEmitter;
  readonly roadEmitter: RoadEmitter;
  /** Territory/fog overlay (M22) — emits nothing for today's single-kingdom terra-demo session. */
  readonly territoryEmitter: TerritoryEmitter;
  readonly saves: SaveManager;
  /** Player-facing content catalog (M18) — defs projected for the ui package. */
  readonly catalog: UICatalog;
  /** Cue table + music playlists (M41) — defs projected for the audio package. */
  readonly audioCatalog: AudioCatalog;
  /** Resolved mod layer order/conflicts (Mods screen, M39). */
  readonly modReport: LoadReport;
  /** GDD §17 sandbox mode (roadmap M40) — gates the privileged sandbox.* commands. */
  readonly sandbox: boolean;
  /** M47.7: live player-panel projection — null on the terra composition (no war stack). */
  readonly panels: (() => PlayerPanels) | null;
  kingdomInfo(): { activeEdicts: string[] };
  /** Read-only placement probe for the footprint preview: runs the sim's ONE placement
   * rulebook (`VillageOps.validatePlacement`) without mutating anything, and returns the
   * def's footprint so the client can draw the outline straight from the reply. Unknown
   * def → not placeable, 1×1 (a harmless default the renderer can still outline). */
  previewPlacement(villageId: number, defId: string, x: number, y: number): { ok: boolean; w: number; h: number };
  /** M62: the defence-layer counterpart — runs the sim's OWN `defence.build` bounds/terrain/
   * occupancy rulebook read-only (no command, no mutation) so the Castle panel's footprint
   * preview honours the identical rule the command will. `x`/`y` are the structure origin.
   * `{ ok: false }` on the terra composition (no defence layer) or an unknown def. */
  previewDefenceBuild(villageId: number, defId: string, x: number, y: number): { ok: boolean };
}

/**
 * Compose the full multi-kingdom campaign for the app (M47.6; doc 12 R1) —
 * ONE option-builder shared by the live worker session, the 'campaign-demo'
 * golden scenario, and the save corpus, so the fixtures pin exactly what the
 * player plays. Content personalities drive the AI kingdoms; the player is
 * kingdom 0 (issuer 1), villages founded at fairness-checked worldgen sites.
 */
export function composeCampaignForApp(
  seed: number,
  campaign: CampaignSettings,
  mods?: ModSelection,
  sandbox?: SandboxOptions,
  localeId?: string,
  clock?: () => number,
): CampaignComposition {
  const difficulty = difficultyFromSettings(campaign);
  return composeCampaign({
    seed,
    kingdomCount: campaign.kingdomCount,
    mapSize: campaign.mapSize,
    ...(difficulty !== undefined ? { difficulty } : {}),
    victory: victoryFromSettings(campaign),
    personalities: 'content',
    mods: { sources: [...(mods?.sources ?? [])], ...(mods?.order !== undefined ? { order: mods.order } : {}) },
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(localeId !== undefined ? { localeId } : {}),
    ...(clock !== undefined ? { clock } : {}),
    settings: campaign,
    startingPopulation: { children: 12, adults: 30, elders: 5 }, // terra's cohorts — enough spare adults to recruit
    villageNameOf: (k) => (k === 0 ? 'Firstholm' : `Kingdom ${k}`),
  });
}

/**
 * Live player-scoped panel projection (M47.7; doc 12 R1 "minimum viable panels").
 * Fog-gated server-side: an undiscovered kingdom shows existence only. Reads run
 * OUTSIDE any system's access scope (between ticks), so unscoped world reads are safe.
 */
function buildPanelsProjection(cc: CampaignComposition): () => PlayerPanels {
  const { world, kingdomGame, diplomacyGame, militaryGame, armiesGame, siegeGame, combatGame, researchGame, victoryGame, fog, game, db, kernel } = cc;
  const idx = (id: number): number => id & 0x3fffff;
  return (): PlayerPanels => {
    const kingdomIds = kingdomGame.kingdomEntities().map((e) => e as number);
    const playerId = kingdomIds[0] ?? 0;
    const names = world.readObj(game.comps.VillageName);

    const kingdoms: PanelKingdomRec[] = [];
    for (let k = 1; k < kingdomIds.length; k++) {
      const kid = kingdomIds[k] as number;
      const vi = cc.villageOf(k);
      const discovered = vi !== null && fog.isKnown(0, vi);
      kingdoms.push({
        index: k,
        name: vi !== null ? (names.tryGet(vi) ?? `Kingdom ${k}`) : `Kingdom ${k}`,
        discovered,
        defeated: victoryGame.isDefeated(kid as never),
        opinion: discovered ? diplomacyGame.state.opinionOf(playerId, kid) : 0,
        reputation: discovered ? diplomacyGame.state.reputationOf(kid) : 0,
        atWar: diplomacyGame.state.isAtWar(playerId, kid),
        warExhaustion: diplomacyGame.state.warExhaustionOf(playerId, kid),
        pacts: (['nonAggression', 'trade', 'alliance'] as const).filter((p) => diplomacyGame.state.hasPact(playerId, kid, p)),
        knownFor: discovered ? cc.personalityTagsOf(k) : [],
        vassalOfPlayer: diplomacyGame.state.lordOf(kid) === playerId,
        playerIsVassal: diplomacyGame.state.lordOf(playerId) === kid,
      });
    }

    const u = world.read(militaryGame.Unit);
    const units: PanelUnitRec[] = [];
    world.query([militaryGame.Unit]).forEach((ui, entity) => {
      if ((u.kingdomId[ui] as number) !== playerId) return;
      units.push({
        id: entity as number,
        name: militaryGame.ops.unitDef(u.def[ui] as number).name,
        count: u.count[ui] as number,
        complete: (u.complete[ui] as number) === 1,
        armyId: u.armyId[ui] as number,
      });
    });

    const a = world.read(militaryGame.Army);
    const m = world.read(armiesGame.ArmyMovement);
    const armyNames = world.readObj(militaryGame.ArmyName);
    const armies: PanelArmyRec[] = [];
    world.query([militaryGame.Army]).forEach((ai, entity) => {
      if ((a.kingdomId[ai] as number) !== playerId) return;
      let strength = 0;
      world.query([militaryGame.Unit]).forEach((ui) => {
        if ((u.armyId[ui] as number) === (entity as number) && (u.complete[ui] as number) === 1) strength += u.count[ui] as number;
      });
      armies.push({
        id: entity as number,
        name: armyNames.tryGet(ai) ?? `Army ${idx(entity as number)}`,
        x: Math.round(m.x[ai] as number),
        y: Math.round(m.y[ai] as number),
        stance: STANCES[m.stance[ai] as number] ?? 'march',
        strength,
        siegeOf: siegeGame.state.siegeOfArmy(entity as number)?.castle ?? null,
        inBattle: combatGame.state.engagementOf(entity as number) !== undefined,
      });
    });

    const activeRaw = researchGame.activeResearch(playerId as never);
    const known: string[] = [];
    for (const techId of db.techs.keys()) if (researchGame.isKnown(playerId as never, techId)) known.push(techId);
    const research = {
      active: activeRaw === undefined
        ? null
        : {
            techId: activeRaw.techId,
            name: db.techs.get(activeRaw.techId)?.name ?? activeRaw.techId,
            progress: activeRaw.progress,
            cost: researchGame.costOf(playerId as never, activeRaw.techId),
          },
      available: researchGame.availableTechs(playerId as never).map((techId) => ({
        techId,
        name: db.techs.get(techId)?.name ?? techId,
        branch: db.techs.get(techId)?.branch ?? '',
        cost: researchGame.costOf(playerId as never, techId),
      })),
      knownCount: known.length,
      totalCount: db.techs.size,
      known,
    };

    const w = victoryGame.winner();
    const victory = {
      tracks: victoryGame.tracksOf(playerId as never, kernel.currentTick).map((t) => ({ type: t.type, progress: t.progress })),
      prestige: victoryGame.prestigeOf(playerId as never),
      winner: w === null ? null : { kingdomIndex: kingdomIds.indexOf(w.kingdomId), type: w.type },
      playerDefeated: victoryGame.isDefeated(playerId as never),
    };

    // ---- defence layer (M50): the PLAYER's own castle map, structures, and garrison posts ----
    // M57: village-keyed — the player's OPERATED village (capital, or its rebind target),
    // not kingdom 0 directly.
    const playerVillage = cc.villageOf(0);
    const defence = ((): PanelDefenceState | null => {
      if (playerVillage === null) return null;
      const map = cc.defenceGame.mapOf(playerVillage);
      if (map === undefined) return null;
      const s = world.read(cc.defenceGame.DefenceStructure);
      const fort = world.read(cc.defenceGame.Fortification);
      const structures: PanelDefenceStructureRec[] = [];
      world.query([cc.defenceGame.DefenceStructure]).forEach((si, entity) => {
        if (((s.village[si] as number) & 0x3fffff) !== playerVillage) return;
        const def = game.ops.buildingDef(s.def[si] as number);
        const fp = defenceFootprintOf(def);
        structures.push({
          id: entity as number,
          defId: def.id,
          name: def.name,
          kind: def.defense?.kind ?? 'wall',
          x: s.x[si] as number,
          y: s.y[si] as number,
          w: fp.w,
          h: fp.h,
          hp: fort.hp[idx(entity as number)] as number,
          maxHp: fort.maxHp[idx(entity as number)] as number,
        });
      });
      const post = world.read(cc.defenceGame.DefencePost);
      const posts: PanelDefencePostRec[] = [];
      world.query([cc.defenceGame.DefencePost, militaryGame.Unit]).forEach((pi, entity) => {
        if ((u.kingdomId[pi] as number) !== playerId) return;
        posts.push({ unitId: entity as number, x: post.x[pi] as number, y: post.y[pi] as number });
      });
      const buildable = [...db.buildings.values()]
        // M59: kind-based, not id-based — the keep-core scale is genesis-only.
        .filter((def) => def.defense !== undefined && def.defense.kind !== 'keep')
        .map((def) => ({
          defId: def.id,
          name: def.name,
          kind: def.defense?.kind ?? 'wall',
          w: def.footprint.w,
          h: def.footprint.h,
          cost: Object.entries(def.cost).map(([resId, amount]): [string, number] => [db.resources.get(resId)?.name ?? resId, amount]),
        }));
      // M58: repair — cost display-ready like `buildable[].cost`, and the in-flight window.
      const repairCost = [...cc.defenceGame.repairCostOf(playerVillage)].map(
        ([resId, amount]): [string, number] => [db.resources.get(resId)?.name ?? resId, amount],
      );
      const repairingUntil = cc.defenceGame.repairingUntil(playerVillage) ?? null;
      return {
        villageId: playerVillage, size: DEFENCE_MAP_SIZE, tiles: encodeDefenceMap(map.tiles),
        structures, posts, buildable, repairCost, repairingUntil,
      };
    })();

    // ---- enemy intel (M54, ADR-4 §4): the player's STALE snapshot of each rival capital —
    // structures as last seen (hp 0/0: state is not visible from outside the walls),
    // garrison as the player's own noisy belief. Empty until first scouting contact. ----
    const enemyIntel: PanelEnemyIntelRec[] = [];
    if (cc.intelGame !== null) {
      for (let k = 1; k < kingdomIds.length; k++) {
        const snap = cc.intelGame.state.get(0, k);
        const vi = cc.villageOf(k);
        // M57: intel stays capital-scoped (doc 07 §4) — the rival's CAPITAL village's layer.
        const map = vi === null ? undefined : cc.defenceGame.mapOf(vi);
        if (snap === undefined || map === undefined) continue;
        const believed = cc.believedGarrisonOf(0, k);
        enemyIntel.push({
          kingdom: k,
          name: vi !== null ? (names.tryGet(vi) ?? `Kingdom ${k}`) : `Kingdom ${k}`,
          size: DEFENCE_MAP_SIZE,
          tiles: encodeDefenceMap(map.tiles),
          asOfTick: snap.tick,
          structures: snap.structures.map((s) => {
            const def = db.buildings.get(s.def);
            return {
              id: 0,
              defId: s.def,
              name: def?.name ?? s.def,
              kind: def?.defense?.kind ?? 'wall',
              x: s.x,
              y: s.y,
              w: s.w,
              h: s.h,
              hp: 0,
              maxHp: 0,
            };
          }),
          believedGarrison: believed === undefined ? null : Math.round(believed),
        });
      }
    }

    return { kingdoms, units, armies, research, victory, defence, enemyIntel };
  };
}

/** Player-facing content projections (M18/M41/M43) — shared verbatim by both compositions. */
function buildCatalogs(db: DefinitionDatabase, locale: Locale, includeUnits: boolean): { catalog: UICatalog; audioCatalog: AudioCatalog } {
  const catalog: UICatalog = {
    ...(includeUnits
      ? {
          units: [...db.units.values()].map((def) => ({
            id: def.id,
            name: def.name,
            unitClass: def.class,
            popCost: def.popCost.count,
            costGold: def.costGold,
            upkeepGold: def.upkeepGold,
            cost: Object.entries(def.cost).map(([resId, amount]): [string, number] => [
              db.resources.get(resId)?.name ?? resId,
              amount,
            ]),
            recruitTicks: def.recruitTicks,
            ...(def.requiresTech !== undefined
              ? { requiresTech: def.requiresTech, requiresTechName: db.techs.get(def.requiresTech)?.name ?? def.requiresTech }
              : {}),
          })),
        }
      : {}),
    buildings: [...db.buildings.values()]
      .filter((def) => !def.tags.includes('center')) // centres come from settlers, not the palette
      // M56 (ADR-4 Amendment A1): castle-category defs belong to the defence-map palette
      // (buildable, above), not this village-map one — village.ops.place() rejects them too
      // (belt-and-braces, matching the earlier 2026-07-20 investigation's approach).
      .filter((def) => def.category !== 'castle')
      .map((def) => ({
        id: def.id,
        name: def.name,
        category: def.category,
        w: def.footprint.w,
        h: def.footprint.h,
        tier: def.requires?.villageTier ?? 1,
        cost: Object.entries(def.cost).map(([resId, amount]): [string, number] => [
          db.resources.get(resId)?.name ?? resId,
          amount,
        ]),
      })),
    edicts: [...db.edicts.values()].map((def) => ({
      id: def.id,
      name: def.name,
      upkeep: def.upkeep,
      modifiers: def.modifiers.map((m) => ({ target: m.target, op: m.op, value: m.value })),
    })),
    // M43: display text for the event-choice dialog — resolved by id off the GameEvent stream's
    // `event.fired`/`event.resolved`, the same "sim worker projects DefinitionDatabase once" shape
    // buildings/edicts already use. M44: def.text/choice.text are locale KEYS (@crowns/core
    // `LocalizedText`), resolved here against the base locale — the catalog the client receives
    // has always been plain display strings, so nothing downstream of this projection changes.
    events: [...db.events.values()].map((def) => ({
      id: def.id,
      title: locale.resolve(def.text.title),
      body: locale.resolve(def.text.body),
      ...(def.blocking === true ? { blocking: true } : {}), // only blocking events pause the sim (M-era)
      choices: def.choices.map((choice) => {
        // surface the choice's outcomes (from its effects) so each option states what it gains/costs
        const outcomes = choiceOutcomes(choice.effects, (resId) => db.resources.get(resId)?.name ?? resId);
        return { id: choice.id, text: locale.resolve(choice.text), ...(outcomes.length > 0 ? { outcomes } : {}) };
      }),
    })),
  };
  const audioCatalog: AudioCatalog = {
    cues: [...db.audioCues.values()].map((def) => ({
      id: def.id,
      event: def.event,
      bus: def.bus,
      gain: def.gain,
      waveform: def.waveform,
      frequencyHz: def.frequencyHz,
      durationMs: def.durationMs,
      placeholder: def.placeholder,
    })),
    playlists: [...db.musicPlaylists.values()].map((def) => ({
      id: def.id,
      tension: def.tension,
      ...(def.era !== undefined ? { era: def.era } : {}),
      ...(def.season !== undefined ? { season: def.season } : {}),
      gain: def.gain,
      trackIds: def.trackIds,
      placeholder: def.placeholder,
    })),
  };
  return { catalog, audioCatalog };
}

export function createSession(
  seed: number,
  clock?: () => number,
  mods?: ModSelection,
  sandbox?: SandboxOptions,
  localeId?: string,
  campaign?: CampaignSettings,
): SimSession {
  // M47.6: `campaign` present = the unified multi-kingdom composition (composeCampaignForApp);
  // absent = the classic single-kingdom terra composition (golden scenario 'terra-demo').
  const c =
    campaign !== undefined
      ? composeCampaignForApp(seed, campaign, mods, sandbox, localeId, clock)
      : composeTerra(seed, clock, mods, sandbox, localeId);
  const terrain = 'terrainSnapshot' in c ? c.terrainSnapshot : c.terrain;
  if (terrain === null) throw new Error('createSession: composition produced no terrain snapshot');
  if (c.modReport === null) throw new Error('createSession: composition produced no mod report');
  if (c.worldDef === null) throw new Error('createSession: composition ran no worldgen');
  const fog = 'fog' in c ? c.fog : null;
  const panels = 'victoryGame' in c ? buildPanelsProjection(c) : null; // M47.7
  const { catalog, audioCatalog } = buildCatalogs(c.db, c.locale, panels !== null);
  // Tile-space centre of the PLAYER's own starting village (kingdom index 0 —
  // the same "player is kingdom 0" convention TerritoryEmitter's fog uses). Lets
  // the client open the camera on the player's keep, not the map centre. Single-
  // kingdom compositions (terra-demo) have no VillageOwner → first village wins.
  const playerHome = (): { x: number; y: number } | null => {
    const player = c.kingdomGame.kingdomEntities()[0];
    const VillageOwner = c.kingdomGame.VillageOwner;
    const core = c.world.read(c.game.comps.VillageCore);
    const owner = VillageOwner !== undefined ? c.world.read(VillageOwner) : null;
    let home: { x: number; y: number } | null = null;
    c.world.query([c.game.comps.VillageCore]).forEach((vi) => {
      if (home !== null) return;
      if (owner !== null && player !== undefined && (owner.kingdom[vi] as number) !== (player as number)) return;
      home = { x: core.centerX[vi] as number, y: core.centerY[vi] as number };
    });
    return home;
  };
  return {
    panels,
    catalog,
    audioCatalog,
    kingdomInfo() {
      const kingdom = c.kingdomGame.kingdomEntity();
      if (kingdom === null) return { activeEdicts: [] };
      const active = c.world.readObj(c.kingdomGame.ActiveEdicts).tryGet((kingdom as number) & 0x3fffff);
      const ids = [...c.db.edicts.keys()].sort();
      const home = playerHome();
      return {
        activeEdicts: [...(active?.keys() ?? [])].sort((a, b) => a - b).map((code) => ids[code] as string),
        // M43: unresolved event dialogs from before this snapshot (e.g. a save loaded mid-tutorial)
        pendingEvents: c.eventsGame.pendingChoices(kingdom),
        id: kingdom as number, // M47.6: lets the client claim only its own event.fired dialogs
        ...(home !== null ? { home } : {}),
      };
    },
    previewPlacement(villageId, defId, x, y) {
      const def = c.db.buildings.get(defId);
      if (def === undefined) return { ok: false, w: 1, h: 1 };
      const verdict = c.game.ops.validatePlacement(def, x | 0, y | 0, villageId as EntityId);
      return { ok: verdict.ok, w: def.footprint.w, h: def.footprint.h };
    },
    previewDefenceBuild(villageId, defId, x, y) {
      if (!('defenceGame' in c)) return { ok: false }; // terra composition has no layer
      const def = c.db.buildings.get(defId);
      if (def === undefined) return { ok: false };
      // `villageId` is the player-village index the panel projection carries; the real command
      // masks it the same way, so masking here keeps the probe and the command in lock-step.
      return { ok: c.defenceGame.placementReason(villageId & 0x3fffff, def, x | 0, y | 0) === null };
    },
    kernel: c.kernel,
    driver: new TickDriver(c.kernel, { maxTicksPerAdvance: 32 }),
    emitter: new SnapshotEmitter(c.world, c.Position),
    worldMeta: { widthTiles: c.worldDef.width, heightTiles: c.worldDef.height },
    terrain,
    world: c.world,
    buildingEmitter: new BuildingEmitter(c.world, c.game),
    villageEmitter: new VillageStatsEmitter(c.world, c.game, c.popGame.Population, c.db, c.statMods, c.kingdomGame),
    roadEmitter: new RoadEmitter(c.logiGame.roads),
    territoryEmitter: new TerritoryEmitter(c.world, c.game, c.kingdomGame, fog),
    saves: c.saves,
    modReport: c.modReport,
    sandbox: c.sandbox,
  };
}

/** LoadReport (data-package shape) → the protocol's plain wire ModReport. */
function toModReportWire(report: LoadReport): ModReport {
  return {
    order: report.order,
    disabled: report.disabled.map((d) => ({ id: d.id, reasons: d.reasons })),
    overrides: report.overrides,
    patched: report.patched,
  };
}

/** ModReconciliationReport (sim-package shape) → the protocol's plain wire form. */
function toModReconciliationWire(r: ReturnType<typeof reconcileModManifest>): ModReconciliation {
  return {
    missing: r.missing.map((m) => ({ modId: m.modId, version: m.version })),
    added: r.added.map((m) => ({ modId: m.modId, version: m.version })),
    versionChanged: r.versionChanged.map((c) => ({ modId: c.saved.modId, saved: c.saved.version, installed: c.installed.version })),
    contentChanged: r.contentChanged.map((c) => ({ modId: c.saved.modId, version: c.saved.version })),
  };
}

export function connectKernelToPort(port: TransportPort, clock?: () => number): void {
  let session: SimSession | null = null;
  let telemetryEvery = 0; // 0 = off
  let lastTelemetryTick = 0;
  let autosaveCounter = 0;
  let storagePersisted = false;
  let storageAdvisorySent = false; // roadmap M44: one advisory per session, not per autosave

  const send = (message: FromSimMessage): void => port.postMessage(message);

  /** Risk R6 tripwire check, run alongside the autosave scheduler (same cadence, doc 11 §3/§4):
   * quota estimate <2× current footprint narrows the ring and tells the player once. */
  const checkStorageQuota = (): void => {
    if (storageAdvisorySent) return;
    void estimateStorage().then((estimate) => {
      if (estimate === null || !isStorageTight(estimate)) return;
      storageAdvisorySent = true;
      void pruneAutosaveRing(1); // doc 11 §3 "managed ring": narrow from AUTOSAVE_RING(3) under pressure
      send({ kind: 'storageAdvisory', usageBytes: estimate.usageBytes, quotaBytes: estimate.quotaBytes, persisted: storagePersisted });
    });
  };

  const sendReady = (seed: number): void => {
    if (session === null) return;
    send({ kind: 'ready', seed, availableMods: AVAILABLE_MODS, modReport: toModReportWire(session.modReport), sandbox: session.sandbox });
  };

  /** M47.7: push a fresh panel projection (campaign sessions only). */
  const sendPanels = (): void => {
    if (session === null || session.panels === null) return;
    send({ kind: 'panels', tick: session.kernel.currentTick, panels: session.panels() });
  };

  const sendFullSnapshot = (): void => {
    if (session === null) return;
    const territory = session.territoryEmitter.full();
    send({
      kind: 'snapshotFull',
      tick: session.kernel.currentTick,
      world: session.worldMeta,
      terrain: session.terrain,
      entities: session.emitter.full(),
      buildings: session.buildingEmitter.full(),
      roads: session.roadEmitter.full(),
      catalog: session.catalog,
      audio: session.audioCatalog,
      kingdom: session.kingdomInfo(),
      territory: territory.territory,
      fogRevealed: territory.fogRevealed,
    });
    sendPanels(); // M47.7: panels bootstrap alongside every full snapshot (init/setMods/load)
  };

  /**
   * Rebuild the session from a save payload and hydrate it (TDD §8 load path).
   * Re-applies whatever mod set is CURRENTLY active (the player's live Mods-screen
   * choice, not whatever the save was originally written with) — reconciliation
   * (OQ-4) compares the save's embedded manifest against that installed set and
   * reports differences, but never blocks: best-effort load is the ratified
   * policy, with an automatic pre-load backup export as the safety net.
   */
  const loadFromPayload = (payload: string): void => {
    try {
      const save = JSON.parse(payload) as CampaignSave;
      const installedIds = session !== null ? session.modReport.order.filter((id) => id !== 'base') : [];
      const currentSandbox: SandboxOptions | undefined =
        session !== null && session.sandbox ? { ironman: session.saves.getSandboxFlags().ironman } : undefined;
      // M47.6: the header's campaign settings drive recomposition — the kernel's restoreState
      // demands an identical composition, so the save itself says what to build (R1 round-trip).
      const next = createSession(
        save.header.seed, clock, resolveModSelection(installedIds, installedIds), currentSandbox,
        undefined, save.header.campaign,
      );
      const modReport = reconcileModManifest(save.header.modManifest, next.saves.getModManifest());
      if (modReconciliationHasFindings(modReport)) {
        // OQ-4's mandatory pre-load backup: the untouched save, exported before
        // any best-effort reconciliation touches it.
        send({ kind: 'exportResult', payload });
      }
      const migrations = next.saves.hydrate(save); // throws on format/seed/section mismatch — old session stays live
      session = next;
      send({ kind: 'loadResult', ok: true, tick: session.kernel.currentTick, migrations, modReport: toModReconciliationWire(modReport) });
      sendFullSnapshot();
    } catch (error) {
      send({
        kind: 'loadResult',
        ok: false,
        tick: session?.kernel.currentTick ?? 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /** Serialize between ticks in the worker (doc 11: no main/sim stall). */
  const saveToSlot = (slot: string): void => {
    if (session === null) return;
    const payload = JSON.stringify(session.saves.snapshot());
    void putSlot(slot, payload)
      .then(() => send({ kind: 'saveResult', slot, ok: true, bytes: payload.length }))
      .catch((error: unknown) =>
        send({ kind: 'saveResult', slot, ok: false, bytes: 0, error: error instanceof Error ? error.message : String(error) }),
      );
  };
  const flush = (results: TickResult[]): void => {
    if (session === null || results.length === 0) return;
    send({
      kind: 'ticked',
      fromTick: (results[0] as TickResult).tick,
      toTick: (results[results.length - 1] as TickResult).tick,
      events: results.flatMap((r) => [...r.events]),
      executed: results.flatMap((r) => [...r.executed]),
    });
    // autosave scheduler (doc 05 §10): every season boundary, into the ring —
    // between ticks, in the worker, and only where IndexedDB exists
    if (typeof indexedDB !== 'undefined' && results.some((r) => r.events.some((e) => e.type === 'time.seasonStarted'))) {
      saveToSlot(autosaveSlot(autosaveCounter++));
      checkStorageQuota(); // roadmap M44: same cadence as the autosave scheduler itself
    }
    const { spawned, moved, despawned } = session.emitter.delta();
    const b = session.buildingEmitter.delta();
    const villageStats = session.villageEmitter.delta();
    const roadsAdded = session.roadEmitter.delta();
    const territory = session.territoryEmitter.delta();
    if (
      spawned.length > 0 || moved.length > 0 || despawned.length > 0 || villageStats.length > 0 ||
      b.added.length > 0 || b.progress.length > 0 || b.removed.length > 0 || roadsAdded.length > 0 ||
      territory.territoryAdded.length > 0 || territory.fogRevealedAdded.length > 0
    ) {
      send({
        kind: 'snapshotDelta',
        tick: session.kernel.currentTick,
        spawned,
        moved,
        despawned,
        villageStats,
        buildingsAdded: b.added,
        buildingProgress: b.progress,
        buildingsRemoved: b.removed,
        roadsAdded,
        territoryAdded: territory.territoryAdded,
        fogRevealedAdded: territory.fogRevealedAdded,
      });
    }
    // M47.7: refresh the player panels when their state can have moved — a day boundary
    // (every daily system has run) or any executed PLAYER command (instant feedback after
    // a button press). AI-only ticks between day boundaries change nothing a panel shows.
    if (
      session.panels !== null &&
      (results.some((r) => r.events.some((e) => e.type === 'time.dayStarted')) ||
        results.some((r) => r.executed.some((cmd) => cmd.issuer === 1)))
    ) {
      sendPanels();
    }
    // sampling stream: at most one report per flush, whenever the interval has
    // elapsed since the last report (flushes are per-batch, not per-tick)
    if (telemetryEvery > 0 && session.kernel.currentTick >= lastTelemetryTick + telemetryEvery) {
      lastTelemetryTick = session.kernel.currentTick;
      const t = session.kernel.getTelemetry();
      send({
        kind: 'debugTelemetry',
        tick: session.kernel.currentTick,
        tickMsLast: t.tickMsLast,
        tickMsAvg: t.tickMsAvg,
        systems: t.systems.map((s) => ({ ...s })),
        entityCount: session.world.liveCount,
      });
    }
  };

  port.onMessage((raw) => {
    const message = raw as ToSimMessage;
    try {
      switch (message.kind) {
        case 'init':
          session = createSession(
            message.seed,
            clock,
            resolveModSelection(message.mods?.enabled ?? [], message.mods?.order ?? []),
            message.sandbox,
            message.locale,
            message.campaign,
          );
          // roadmap M44 (doc 11 §4 mitigation list): request durable storage once per session —
          // best-effort, browsers grant/deny silently; storagePersisted just informs the advisory.
          void requestPersistence().then((granted) => {
            storagePersisted = granted;
          });
          sendReady(message.seed);
          // Genesis runs on tick 1; step it so the first full snapshot is populated.
          flushlessFirstTick(session);
          sendFullSnapshot();
          return;
        case 'setMods': {
          // Recompose fresh at the SAME seed — a mod's content change starts a
          // new campaign (doc 09 §5); this is the in-game Mods screen's "Apply".
          // Sandbox status AND campaign settings carry over unchanged (independent knobs).
          const seed = session?.kernel.seed ?? 0;
          const sandbox: SandboxOptions | undefined =
            session !== null && session.sandbox ? { ironman: session.saves.getSandboxFlags().ironman } : undefined;
          const campaign = session?.saves.getCampaignSettings();
          session = createSession(seed, clock, resolveModSelection(message.enabled, message.order), sandbox, undefined, campaign);
          sendReady(seed);
          flushlessFirstTick(session);
          sendFullSnapshot();
          return;
        }
        case 'save':
          saveToSlot(message.slot);
          return;
        case 'load':
          void getSlot(message.slot)
            .then((payload) => {
              if (payload === undefined) {
                send({ kind: 'loadResult', ok: false, tick: session?.kernel.currentTick ?? 0, error: `slot '${message.slot}' is empty` });
                return;
              }
              loadFromPayload(payload);
            })
            .catch((error: unknown) =>
              send({ kind: 'loadResult', ok: false, tick: session?.kernel.currentTick ?? 0, error: error instanceof Error ? error.message : String(error) }),
            );
          return;
        case 'exportSave':
          if (session !== null) send({ kind: 'exportResult', payload: JSON.stringify(session.saves.snapshot()) });
          return;
        case 'importSave':
          loadFromPayload(message.payload);
          return;
        case 'submit':
          for (const draft of message.drafts) session?.kernel.submit(draft);
          return;
        case 'setSpeed':
          session?.driver.setSpeed(message.speed);
          return;
        case 'pump':
          if (session !== null) flush(session.driver.advance(message.dtMs));
          return;
        case 'step': {
          if (session === null) return;
          const results: TickResult[] = [];
          for (let i = 0; i < message.ticks; i++) results.push(session.kernel.step());
          flush(results);
          return;
        }
        case 'debug': {
          if (session === null) return;
          if (message.op === 'telemetry') {
            telemetryEvery = message.enabled ? Math.max(1, message.everyTicks ?? 10) : 0;
            lastTelemetryTick = session.kernel.currentTick;
          } else if (message.op === 'inspect') {
            send({
              kind: 'debugEntity',
              inspection: session.world.inspect(message.entityId as never),
            });
          } else if (message.op === 'commands') {
            // sandbox.* would only reject if offered outside a sandboxed session (GDD §17) —
            // don't even list a doomed-to-reject command in the injector's vocabulary
            const sandboxed = session.sandbox;
            const types = session.kernel.commandTypes().filter((t) => sandboxed || !t.startsWith('sandbox.'));
            send({ kind: 'debugCommands', types });
          }
          return;
        }
        case 'requestPanels':
          sendPanels();
          return;
        case 'previewBuild': {
          if (session === null) return;
          const { ok, w, h } = session.previewPlacement(message.villageId, message.def, message.x, message.y);
          send({ kind: 'buildPreview', seq: message.seq, x: message.x, y: message.y, w, h, ok });
          return;
        }
        case 'previewDefenceBuild': {
          if (session === null) return;
          const { ok } = session.previewDefenceBuild(message.villageId, message.def, message.x, message.y);
          send({ kind: 'defenceBuildPreview', seq: message.seq, ok });
          return;
        }
        case 'requestHash':
          if (session !== null) {
            send({
              kind: 'hash',
              tick: session.kernel.currentTick,
              hash: session.kernel.stateHash(),
            });
          }
          return;
      }
    } catch (error) {
      send({ kind: 'fatal', message: error instanceof Error ? error.message : String(error) });
    }
  });
}

function flushlessFirstTick(session: SimSession): void {
  if (session.kernel.currentTick === 0) session.kernel.step();
}
