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

/** Daily village vitals for the HUD (M12): emit when any rounded value changes. */
export class VillageStatsEmitter {
  private readonly last = new Map<number, string>();

  constructor(
    private readonly world: World,
    private readonly game: VillageGameplay,
    private readonly Population: import('@crowns/sim').PopulationComponent,
  ) {}

  delta(): { id: number; name: string; population: number; food: number; happiness: number }[] {
    const out: { id: number; name: string; population: number; food: number; happiness: number }[] = [];
    const pop = this.world.read(this.Population);
    const names = this.world.readObj(this.game.comps.VillageName);
    const stocks = this.world.readObj(this.game.comps.Stockpile);
    const foodCode = this.game.ops.resourceCode('base:resource.food') as number;
    this.world.query([this.Population, this.game.comps.VillageCore]).forEach((vi, entity) => {
      const stat = {
        id: entity as number,
        name: names.tryGet(vi) ?? `village ${vi}`,
        population: Math.floor(
          (pop.children[vi] as number) + (pop.adults[vi] as number) + (pop.elders[vi] as number),
        ),
        food: Math.floor(stocks.tryGet(vi)?.get(foodCode) ?? 0),
        happiness: Math.round(pop.happiness[vi] as number),
      };
      const key = `${stat.population}|${stat.food}|${stat.happiness}`;
      if (this.last.get(stat.id) !== key) {
        this.last.set(stat.id, key);
        out.push(stat);
      }
    });
    return out;
  }
}
