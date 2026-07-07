/** Building snapshot diffing (M11): rare adds/removes + progress for the few under construction. */
import type { BuildingRec } from '@crowns/protocol';
import type { VillageGameplay } from '@crowns/sim';
import type { World } from '@crowns/sim';

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
    this.world.query([this.Population, this.game.comps.VillageCore]).forEach((vi, entity) => {
      const stock = stocks.tryGet(vi);
      const goods: Record<string, number> = {};
      // stable order: interned codes ascend with sorted resource ids
      for (const code of [...this.goodsNames.keys()].sort((a, b) => a - b)) {
        const amount = Math.floor(stock?.get(code) ?? 0);
        if (amount > 0) goods[this.goodsNames.get(code) as string] = amount;
      }
      const stat = {
        id: entity as number,
        name: names.tryGet(vi) ?? `village ${vi}`,
        population: Math.floor(
          (pop.children[vi] as number) + (pop.adults[vi] as number) + (pop.elders[vi] as number),
        ),
        food: Math.floor(stock?.get(foodCode) ?? 0),
        happiness: Math.round(pop.happiness[vi] as number),
        goods,
        tier: core.tier[vi] as number,
        taxRate: core.taxRate[vi] as number,
        cx: core.centerX[vi] as number,
        cy: core.centerY[vi] as number,
      };
      const key = `${stat.population}|${stat.food}|${stat.happiness}|${stat.tier}|${stat.taxRate}|${Object.entries(goods).flat().join(',')}`;
      if (this.last.get(stat.id) !== key) {
        this.last.set(stat.id, key);
        out.push(stat);
      }
    });
    return out;
  }
}
