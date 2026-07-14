/** Building snapshot diffing (M11): rare adds/removes + progress for the few under construction. */
import type { BuildingRec } from '@crowns/protocol';
import type { FogRegistry, KingdomGameplay, StatModifierView, VillageGameplay } from '@crowns/sim';
import {
  BASE_STORAGE, KEEP_FOOD_BUFFER, FORAGE_FLOOR, JOY_NEUTRAL, SERVICE_JOY_CAP, HAPPINESS_DRIFT_TARGET,
  joyContributions, joyTarget, joyFertility, joyMigration, type World,
} from '@crowns/sim';

const round = (n: number, dp: number): number => { const f = 10 ** dp; return Math.round(n * f) / f; };

/** entity id → dense component index (low 22 bits), matching the sim's convention. */
const vindex = (id: number): number => id & 0x3fffff;

/** Tiles within this Chebyshev radius of an owned village belong to its kingdom (M22). */
const TERRITORY_RADIUS = 32;

export class BuildingEmitter {
  private readonly known = new Map<number, number>(); // id → last progress sent

  constructor(
    private readonly world: World,
    private readonly game: VillageGameplay,
  ) {}

  private scan(cb: (rec: BuildingRec) => void): void {
    const b = this.world.read(this.game.comps.BuildingCore);
    this.world.query([this.game.comps.BuildingCore]).forEach((i, entity) => {
      const def = this.game.ops.buildingDef(b.def[i] as number);
      cb({
        id: entity as number,
        name: def.name,
        category: def.category,
        x: b.x[i] as number,
        y: b.y[i] as number,
        w: b.w[i] as number,
        h: b.h[i] as number,
        progress: b.progress[i] as number,
        village: b.village[i] as number,
        // capacity straight from the def — generic, so modded buildings surface it too
        storageCapacity: def.storage?.capacity ?? 0,
        housingCapacity: def.housing?.capacity ?? 0,
      });
    });
  }

  full(): BuildingRec[] {
    this.known.clear();
    const out: BuildingRec[] = [];
    this.scan((rec) => {
      this.known.set(rec.id, rec.progress);
      out.push(rec);
    });
    return out;
  }

  delta(): { added: BuildingRec[]; progress: number[]; removed: number[] } {
    const added: BuildingRec[] = [];
    const progress: number[] = [];
    const seen = new Set<number>();
    this.scan((rec) => {
      seen.add(rec.id);
      const last = this.known.get(rec.id);
      if (last === undefined) {
        this.known.set(rec.id, rec.progress);
        added.push(rec);
      } else if (last !== rec.progress) {
        this.known.set(rec.id, rec.progress);
        progress.push(rec.id, rec.progress);
      }
    });
    const removed: number[] = [];
    for (const id of this.known.keys()) if (!seen.has(id)) removed.push(id);
    for (const id of removed) this.known.delete(id);
    return { added, progress, removed };
  }
}

/** Road tile diffing (M14): roads only ever appear, keyed by the grid version. */
export class RoadEmitter {
  private readonly sent = new Set<number>();
  private lastVersion = -1;

  constructor(private readonly roads: import('@crowns/sim').RoadGrid) {}

  full(): number[] {
    this.sent.clear();
    this.lastVersion = this.roads.version;
    const triples = this.roads.list();
    for (let i = 0; i < triples.length; i += 3) {
      this.sent.add((triples[i + 1] as number) * this.roads.width + (triples[i] as number));
    }
    return triples;
  }

  delta(): number[] {
    if (this.roads.version === this.lastVersion) return [];
    this.lastVersion = this.roads.version;
    const out: number[] = [];
    const triples = this.roads.list();
    for (let i = 0; i < triples.length; i += 3) {
      const tile = (triples[i + 1] as number) * this.roads.width + (triples[i] as number);
      if (!this.sent.has(tile)) {
        this.sent.add(tile);
        out.push(triples[i] as number, triples[i + 1] as number, triples[i + 2] as number);
      }
    }
    return out;
  }
}

/** Daily village vitals for the HUD (M12/M13): emit when any rounded value changes. */
export class VillageStatsEmitter {
  private readonly last = new Map<number, string>();
  /** interned resource code → display name, food excluded (it has its own slot). */
  private readonly goodsNames = new Map<number, string>();

  constructor(
    private readonly world: World,
    private readonly game: VillageGameplay,
    private readonly Population: import('@crowns/sim').PopulationComponent,
    db: import('@crowns/data').DefinitionDatabase,
    private readonly mods: StatModifierView,
  ) {
    for (const [id, def] of db.resources) {
      if (id === 'base:resource.food') continue;
      this.goodsNames.set(this.game.ops.resourceCode(id) as number, def.name.toLowerCase());
    }
  }

  delta(): NonNullable<Extract<import('@crowns/protocol').FromSimMessage, { kind: 'snapshotDelta' }>['villageStats']> {
    const out: ReturnType<VillageStatsEmitter['delta']> = [];
    const pop = this.world.read(this.Population);
    const names = this.world.readObj(this.game.comps.VillageName);
    const stocks = this.world.readObj(this.game.comps.Stockpile);
    const core = this.world.read(this.game.comps.VillageCore);
    const foodCode = this.game.ops.resourceCode('base:resource.food') as number;
    // village capacity totals (completed buildings only) — mirrors economy.ts storageCaps
    // and population.ts housing: occupant slots and per-resource stockpile headroom.
    const bc = this.world.read(this.game.comps.BuildingCore);
    const housingByV = new Map<number, number>();
    const storageByV = new Map<number, number>();
    const serviceJoyByV = new Map<number, number>(); // Σ joy service auras, capped (needs system)
    this.world.query([this.game.comps.BuildingCore]).forEach((i) => {
      if ((bc.complete[i] as number) !== 1) return;
      const vi = vindex(bc.village[i] as number);
      const def = this.game.ops.buildingDef(bc.def[i] as number);
      housingByV.set(vi, (housingByV.get(vi) ?? 0) + (def.housing?.capacity ?? 0));
      storageByV.set(vi, (storageByV.get(vi) ?? 0) + (def.storage?.capacity ?? 0));
      if (def.serviceAura?.need === 'joy') {
        serviceJoyByV.set(vi, Math.min(SERVICE_JOY_CAP, (serviceJoyByV.get(vi) ?? 0) + def.serviceAura.strength));
      }
    });
    const drift = this.mods.add(HAPPINESS_DRIFT_TARGET); // edict/office joy modifier (global board)
    this.world.query([this.Population, this.game.comps.VillageCore]).forEach((vi, entity) => {
      const stock = stocks.tryGet(vi);
      const goods: Record<string, number> = {};
      // stable order: interned codes ascend with sorted resource ids
      for (const code of [...this.goodsNames.keys()].sort((a, b) => a - b)) {
        const amount = Math.floor(stock?.get(code) ?? 0);
        if (amount > 0) goods[this.goodsNames.get(code) as string] = amount;
      }
      // joy breakdown (M-era): the SAME numbers the sim uses (shared helpers), so the
      // Joy panel stays exactly accurate. Contributions are for display; the target and
      // migration/fertility come straight from the sim's own functions.
      const total = (pop.children[vi] as number) + (pop.adults[vi] as number) + (pop.elders[vi] as number);
      const housingCap = housingByV.get(vi) ?? 0;
      const shelter = total > 0 ? Math.min(1, housingCap / total) : 1;
      const nutrition = pop.foodSecurity[vi] as number;
      const serviceJoy = serviceJoyByV.get(vi) ?? 0;
      const happiness = pop.happiness[vi] as number;
      const contrib = joyContributions(nutrition, shelter, serviceJoy, drift);
      const factors: { label: string; value: number }[] = [
        { label: 'Food', value: round(contrib.food, 1) },
        { label: 'Shelter', value: round(contrib.shelter, 1) },
      ];
      if (serviceJoy !== 0) factors.push({ label: 'Services', value: round(contrib.service, 1) });
      if (drift !== 0) factors.push({ label: 'Edicts', value: round(contrib.edicts, 1) });
      const joy = {
        level: Math.round(happiness),
        target: Math.round(joyTarget(Math.max(FORAGE_FLOOR, nutrition), shelter, serviceJoy, drift)),
        neutral: JOY_NEUTRAL,
        factors,
        migrationPerDay: round(joyMigration(happiness, total, housingCap), 2),
        fertility: round(joyFertility(happiness), 2),
      };
      const stat = {
        id: entity as number,
        name: names.tryGet(vi) ?? `village ${vi}`,
        population: Math.floor(total),
        food: Math.floor(stock?.get(foodCode) ?? 0),
        happiness: Math.round(happiness),
        goods,
        housing: housingCap,
        stockCap: BASE_STORAGE + (storageByV.get(vi) ?? 0),
        foodCap: KEEP_FOOD_BUFFER + (storageByV.get(vi) ?? 0),
        joy,
        tier: core.tier[vi] as number,
        taxRate: core.taxRate[vi] as number,
        cx: core.centerX[vi] as number,
        cy: core.centerY[vi] as number,
      };
      const key = `${stat.population}|${stat.food}|${stat.happiness}|${stat.tier}|${stat.taxRate}|${stat.housing}|${stat.stockCap}|${Object.entries(goods).flat().join(',')}|${joy.target}|${joy.migrationPerDay}|${joy.fertility}|${factors.map((f) => f.value).join(',')}`;
      if (this.last.get(stat.id) !== key) {
        this.last.set(stat.id, key);
        out.push(stat);
      }
    });
    return out;
  }
}

/**
 * Territory tint + fog-revealed tiles for the map overlay (M22). Add-only,
 * mirroring `RoadEmitter`: territory (once a tile is claimed, it stays
 * claimed) and fog reveal (once seen, stays seen — M22 v1's simple model)
 * only ever grow. Gracefully emits nothing when the composition isn't
 * multi-kingdom (`kingdomGame.VillageOwner` undefined) or has no fog
 * registry — today's single-kingdom `terra-demo` session, for instance.
 */
export class TerritoryEmitter {
  private readonly sentTerritory = new Set<number>(); // tile index -> already emitted
  private readonly sentFog = new Set<number>();

  constructor(
    private readonly world: World,
    private readonly game: VillageGameplay,
    private readonly kingdomGame: KingdomGameplay,
    private readonly fog: FogRegistry | null,
  ) {}

  private tileIndex(x: number, y: number): number {
    return y * this.game.terrain.width + x;
  }

  /** Flat [x, y, kingdomIndex] triples for tiles within TERRITORY_RADIUS of an owned village. */
  private computeTerritory(): number[] {
    const VillageOwner = this.kingdomGame.VillageOwner;
    if (VillageOwner === undefined) return [];
    const kingdomIndexOf = new Map(this.kingdomGame.kingdomEntities().map((id, i) => [id as number, i]));
    const core = this.world.read(this.game.comps.VillageCore);
    const owner = this.world.read(VillageOwner);
    const claimed = new Map<number, number>(); // tile index -> kingdomIndex (first village to claim it wins)
    this.world.query([this.game.comps.VillageCore, VillageOwner]).forEach((vi) => {
      const kingdomIndex = kingdomIndexOf.get(owner.kingdom[vi] as number);
      if (kingdomIndex === undefined) return;
      const cx = core.centerX[vi] as number;
      const cy = core.centerY[vi] as number;
      for (let dy = -TERRITORY_RADIUS; dy <= TERRITORY_RADIUS; dy++) {
        for (let dx = -TERRITORY_RADIUS; dx <= TERRITORY_RADIUS; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) > TERRITORY_RADIUS) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= this.game.terrain.width || y >= this.game.terrain.height) continue;
          const tile = this.tileIndex(x, y);
          if (!claimed.has(tile)) claimed.set(tile, kingdomIndex);
        }
      }
    });
    const out: number[] = [];
    for (const [tile, kingdomIndex] of claimed) {
      out.push(tile % this.game.terrain.width, Math.floor(tile / this.game.terrain.width), kingdomIndex);
    }
    return out;
  }

  /** Flat [x, y] pairs: the player's own villages (always visible) + any foreign village
   * revealed to the player's kingdom (fog index 0) via scouting. */
  private computeFogRevealed(): number[] {
    const VillageOwner = this.kingdomGame.VillageOwner;
    const playerKingdom = this.kingdomGame.kingdomEntities()[0];
    const core = this.world.read(this.game.comps.VillageCore);
    const out: number[] = [];
    this.world.query([this.game.comps.VillageCore]).forEach((vi) => {
      const ownedByPlayer =
        VillageOwner === undefined ||
        (this.world.read(VillageOwner).kingdom[vi] as number) === (playerKingdom as number | undefined);
      const revealedByFog = this.fog !== null && this.fog.isKnown(0, vi);
      if (ownedByPlayer || revealedByFog) out.push(core.centerX[vi] as number, core.centerY[vi] as number);
    });
    return out;
  }

  full(): { territory: number[]; fogRevealed: number[] } {
    const territory = this.computeTerritory();
    const fogRevealed = this.computeFogRevealed();
    this.sentTerritory.clear();
    for (let i = 0; i + 2 < territory.length; i += 3) {
      this.sentTerritory.add(this.tileIndex(territory[i] as number, territory[i + 1] as number));
    }
    this.sentFog.clear();
    for (let i = 0; i + 1 < fogRevealed.length; i += 2) {
      this.sentFog.add(this.tileIndex(fogRevealed[i] as number, fogRevealed[i + 1] as number));
    }
    return { territory, fogRevealed };
  }

  delta(): { territoryAdded: number[]; fogRevealedAdded: number[] } {
    const territoryAdded: number[] = [];
    for (const triple of chunk3(this.computeTerritory())) {
      const tile = this.tileIndex(triple[0], triple[1]);
      if (this.sentTerritory.has(tile)) continue;
      this.sentTerritory.add(tile);
      territoryAdded.push(...triple);
    }
    const fogRevealedAdded: number[] = [];
    for (const pair of chunk2(this.computeFogRevealed())) {
      const tile = this.tileIndex(pair[0], pair[1]);
      if (this.sentFog.has(tile)) continue;
      this.sentFog.add(tile);
      fogRevealedAdded.push(...pair);
    }
    return { territoryAdded, fogRevealedAdded };
  }
}

function* chunk3(flat: readonly number[]): Generator<[number, number, number]> {
  for (let i = 0; i + 2 < flat.length; i += 3) yield [flat[i] as number, flat[i + 1] as number, flat[i + 2] as number];
}
function* chunk2(flat: readonly number[]): Generator<[number, number]> {
  for (let i = 0; i + 1 < flat.length; i += 2) yield [flat[i] as number, flat[i + 1] as number];
}
