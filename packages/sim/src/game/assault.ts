/**
 * Spatial assault resolution (roadmap M51; ADR-4 §2; GDD §7 Phase 8 delta / §8).
 *
 * The siege ASSAULT phase, resolved on the defender's capital defence layer
 * (M49): the attacking army enters from one ORIGIN edge and walks the flow
 * field toward the keep — walls must be broken through (fortification HP
 * math, siege.ts's vocabulary), towers grind the column as it passes (ranged
 * attrition), and posted garrison units meet it head-on (combat.ts's
 * morale-as-HP aggregates). Reaching the keep with surviving strength at or
 * above the keep's hold threshold captures the castle; anything less is a
 * repulse and the siege outside continues. Encirclement, bombardment,
 * starvation, and sorties are UNTOUCHED — GDD §8's phases stand; only the
 * assault's resolution moved onto real ground (ADR-4's amendment).
 *
 * INSTANT + REPLAYABLE (ADR-4 §2): the whole walk resolves inside one command
 * dispatch — a battle the player cannot influence must not hold the kernel's
 * pacing hostage — and emits a compact deterministic TRACE the UI replays as
 * presentation (`siege.assaultResolved`). Same seed + same layouts + same
 * armies ⇒ identical outcome AND identical trace: every draw comes from the
 * command context's forked stream, every iteration is sorted, pathing is
 * integer BFS with lowest-tile-index tie-breaks (OQ-10 discipline).
 *
 * Tuning constants here are M54's balance-matrix material; they are chosen to
 * sit inside GDD §8's bands (storming is bloody, defender advantage ~3:1).
 */
import type { EntityId, Rng } from '@crowns/core';
import { World } from '../ecs.js';
import type { EventBus } from '../eventBus.js';
import { DEFENCE_MAP_SIZE, DEFENCE_TILE } from '../worldgen/defenceMap.js';
import type { VillageGameplay } from './villages.js';
import type { MilitaryGameplay } from './military.js';
import type { CastleGameplay } from './castles.js';
import type { DefenceGameplay } from './defence.js';
import { SIEGE_BOMBARD_BONUS } from './siege.js';
import { BASE_MORALE_DAMAGE, CASUALTY_FRACTION_OF_DAMAGE, ROUT_MORALE_THRESHOLD, ROUT_CHANCE_PER_SUBROUND } from './combat.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

export const ASSAULT_ORIGINS = ['left', 'right', 'top', 'bottom'] as const;
export type AssaultOrigin = (typeof ASSAULT_ORIGINS)[number];

/** Fallback keep hold threshold when the keep def carries no `defense.holdStrength`. */
export const DEFAULT_KEEP_HOLD_STRENGTH = 60;
/** Wall-breaking rate: (attack/armor) × this comes off a structure's HP per round. */
export const ASSAULT_WALL_DAMAGE = 30;
/** Tower fire comes from the def's own `rangedArc` (content, inert since M29 — its
 * payoff); these are only the fallbacks for a tower def that carries none. */
export const TOWER_ATTACK = 12;
export const TOWER_RANGE = 6; // Chebyshev, from the tower's origin tile
/** Garrison fights from prepared ground (GDD §7 defender advantage). */
export const GARRISON_DEFENCE_BONUS = 1.5;
/** Posts this close to a clash join the defending line — mutual support, so a ring
 * masses instead of dying picket-by-picket to a concentrated column. */
export const GARRISON_SUPPORT_RANGE = 2;
/** Storming is bloody (GDD §8) — same lever siege assaults always used. */
export const ASSAULT_CASUALTY_FRACTION = CASUALTY_FRACTION_OF_DAMAGE * 2.5;
/** Hard safety cap; a 100×100 walk with breaches resolves far below this. */
export const MAX_ASSAULT_ROUNDS = 600;

// ---------------------------------------------------------------- trace

export interface AssaultTraceStep {
  readonly r: number; // round
  readonly kind: 'enter' | 'advance' | 'wall' | 'breach' | 'tower' | 'clash' | 'rout' | 'keep' | 'captured' | 'repelled';
  readonly x: number;
  readonly y: number;
}

export interface AssaultResult {
  readonly outcome: 'captured' | 'repelled';
  readonly origin: AssaultOrigin;
  readonly attackerLoss: number;
  readonly defenderLoss: number;
  readonly breaches: number;
  readonly trace: readonly AssaultTraceStep[];
}

export interface AssaultInput {
  readonly world: World;
  readonly rng: Rng;
  readonly game: VillageGameplay;
  readonly militaryGame: MilitaryGameplay;
  readonly castleGame: CastleGameplay;
  readonly defenceGame: DefenceGameplay;
  readonly defenderKingdomIndex: number;
  readonly defenderKingdomId: number;
  readonly attackerArmy: number;
  readonly origin: AssaultOrigin;
}

// ---------------------------------------------------------------- resolver

export function resolveSpatialAssault(input: AssaultInput): AssaultResult {
  const { world, rng, militaryGame, castleGame, defenceGame, game } = input;
  const size = DEFENCE_MAP_SIZE;
  const map = defenceGame.mapOf(input.defenderKingdomIndex);
  if (map === undefined) throw new Error('resolveSpatialAssault: no defence map');
  const { Unit, ops } = militaryGame;
  const Fortification = castleGame.Fortification;
  const DefencePost = defenceGame.DefencePost;
  const DefenceStructure = defenceGame.DefenceStructure;

  // ---- attacker units (live views; casualties are REAL, exactly like combat.ts) ----
  const u = world.write(Unit);
  const attackerUnits = (): number[] => {
    const out: number[] = [];
    world.query([Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) === input.attackerArmy && (u.complete[ui] as number) === 1 && (u.count[ui] as number) > 0) out.push(ui);
    });
    return out;
  };
  const attackerCount = (): number => attackerUnits().reduce((sum, ui) => sum + (u.count[ui] as number), 0);
  const attackerAttack = (): number =>
    attackerUnits().reduce((sum, ui) => {
      const def = ops.unitDef(u.def[ui] as number);
      const moraleFraction = 0.5 + 0.5 * ((u.morale[ui] as number) / Math.max(1, def.stats.moraleBase));
      return sum + (u.count[ui] as number) * def.stats.attack * moraleFraction;
    }, 0);
  const attackerDefense = (): number =>
    Math.max(1, attackerUnits().reduce((sum, ui) => sum + (u.count[ui] as number) * ops.unitDef(u.def[ui] as number).stats.defense, 0));
  const attackerSiegeAttack = (): number =>
    attackerUnits().reduce((sum, ui) => {
      const def = ops.unitDef(u.def[ui] as number);
      return sum + (u.count[ui] as number) * def.stats.attack * (def.class === 'siege' ? SIEGE_BOMBARD_BONUS : 1);
    }, 0);
  /** Morale+casualty damage onto the attacking column (tower fire, clashes). */
  const damageAttacker = (damage: number): void => {
    const total = attackerCount();
    if (total <= 0 || damage <= 0) return;
    for (const ui of attackerUnits()) {
      const share = (u.count[ui] as number) / total;
      const moraleLoss = damage * share;
      u.morale[ui] = Math.max(0, (u.morale[ui] as number) - moraleLoss);
      const casualties = Math.min(u.count[ui] as number, moraleLoss * ASSAULT_CASUALTY_FRACTION);
      u.count[ui] = Math.max(0, (u.count[ui] as number) - casualties);
      if ((u.morale[ui] as number) < ROUT_MORALE_THRESHOLD && rng.nextFloat() < ROUT_CHANCE_PER_SUBROUND) {
        u.armyId[ui] = 0; // routs off the field — survives, leaves the assault
      }
    }
  };

  // ---- defender garrison posts (ascending dense index — deterministic) ----
  const post = world.read(DefencePost);
  const livePosts = (): { pi: number; entity: number }[] => {
    const out: { pi: number; entity: number }[] = [];
    world.query([DefencePost, Unit]).forEach((pi, entity) => {
      if ((u.kingdomId[pi] as number) !== input.defenderKingdomId) return;
      if ((u.complete[pi] as number) !== 1 || (u.armyId[pi] as number) !== 0) return; // drafted units left the walls
      if ((u.count[pi] as number) <= 0) return;
      out.push({ pi, entity: entity as number });
    });
    return out;
  };

  // ---- structures: footprint tiles, keep tiles, towers ----
  const s = world.read(DefenceStructure);
  const fort = world.write(Fortification);
  interface Blocker { entity: number; kind: string; armor: number; tiles: number[]; x: number; y: number; range: number; damage: number }
  const blockers = new Map<number, Blocker>(); // entity → blocker
  const tileToStructure = new Map<number, number>(); // tile → entity
  const keepTiles = new Set<number>();
  const towers: Blocker[] = [];
  world.query([DefenceStructure]).forEach((si, entity) => {
    if ((s.kingdom[si] as number) !== input.defenderKingdomIndex) return;
    const def = game.ops.buildingDef(s.def[si] as number);
    const kind = def.defense?.kind ?? 'wall';
    const tiles: number[] = [];
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) tiles.push(((s.y[si] as number) + dy) * size + (s.x[si] as number) + dx);
    }
    const blocker: Blocker = {
      entity: entity as number, kind, armor: def.defense?.armor ?? 1, tiles,
      x: s.x[si] as number, y: s.y[si] as number,
      range: def.defense?.rangedArc?.range ?? TOWER_RANGE,
      damage: def.defense?.rangedArc?.damage ?? TOWER_ATTACK,
    };
    blockers.set(entity as number, blocker);
    for (const t of tiles) tileToStructure.set(t, entity as number);
    if (kind === 'keep') for (const t of tiles) keepTiles.add(t);
    if (kind === 'tower') towers.push(blocker);
  });
  towers.sort((a, b) => a.entity - b.entity);
  const keepDef = [...blockers.values()].find((b) => b.kind === 'keep');
  const keepThreshold = ((): number => {
    if (keepDef === undefined) return 0; // no keep standing: walking in suffices
    const def = game.ops.buildingDef(s.def[index(keepDef.entity)] as number);
    return (def.defense as { holdStrength?: number } | undefined)?.holdStrength ?? DEFAULT_KEEP_HOLD_STRENGTH;
  })();

  const passable = (t: number): boolean => map.tiles[t] === DEFENCE_TILE.open && !tileToStructure.has(t);

  // ---- flow field: BFS distance to the keep over passable ground ----
  const dist = new Int32Array(size * size);
  const rebuildField = (): void => {
    dist.fill(-1);
    const queue: number[] = [];
    // seed from passable tiles 4-adjacent to the keep footprint (the keep itself blocks)
    const seedNear = (t: number): void => {
      const tx = t % size;
      const ty = Math.floor(t / size);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const n = ny * size + nx;
        if (passable(n) && dist[n] === -1) {
          dist[n] = 0;
          queue.push(n);
        }
      }
    };
    for (const t of [...keepTiles].sort((a, b) => a - b)) seedNear(t);
    let qi = 0;
    while (qi < queue.length) {
      const t = queue[qi] as number;
      qi++;
      const tx = t % size;
      const ty = Math.floor(t / size);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const n = ny * size + nx;
        if (passable(n) && dist[n] === -1) {
          dist[n] = (dist[t] as number) + 1;
          queue.push(n);
        }
      }
    }
  };
  rebuildField();

  // ---- entry: the origin edge's best passable tile (lowest distance, then lowest index) ----
  const edgeTiles = (): number[] => {
    const out: number[] = [];
    for (let i = 0; i < size; i++) {
      const t =
        input.origin === 'left' ? i * size
        : input.origin === 'right' ? i * size + size - 1
        : input.origin === 'top' ? i
        : (size - 1) * size + i;
      if (passable(t)) out.push(t);
    }
    return out;
  };
  const pickEntry = (): number => {
    let best = -1;
    for (const t of edgeTiles()) {
      if (dist[t] === -1) continue;
      if (best === -1 || (dist[t] as number) < (dist[best] as number) || ((dist[t] as number) === (dist[best] as number) && t < best)) best = t;
    }
    if (best !== -1) return best;
    // fully walled off from this edge: enter at the edge anyway (nearest-to-keep by
    // straight-line, lowest index) and let wall-breaking open the field
    const open = edgeTiles();
    if (open.length === 0) return input.origin === 'left' ? Math.floor(size / 2) * size : Math.floor(size / 2) * size + size - 1;
    const keepCentre = Math.floor(size / 2);
    let bestOpen = open[0] as number;
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const t of open) {
      const score = Math.abs((t % size) - keepCentre) + Math.abs(Math.floor(t / size) - keepCentre);
      if (score < bestScore || (score === bestScore && t < bestOpen)) {
        bestScore = score;
        bestOpen = t;
      }
    }
    return bestOpen;
  };

  // ---- attacker-side reachability, for picking which wall to break ----
  const reachableFrom = (start: number): Uint8Array => {
    const seen = new Uint8Array(size * size);
    if (!passable(start)) return seen;
    const queue = [start];
    seen[start] = 1;
    let qi = 0;
    while (qi < queue.length) {
      const t = queue[qi] as number;
      qi++;
      const tx = t % size;
      const ty = Math.floor(t / size);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const n = ny * size + nx;
        if (seen[n] === 0 && passable(n)) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    return seen;
  };
  /** The reachable-frontier structure worth breaking: nearest to the keep, ids tie-break. */
  const pickWallTarget = (from: number): Blocker | null => {
    const seen = reachableFrom(from);
    let best: Blocker | null = null;
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const b of [...blockers.values()].sort((a, z) => a.entity - z.entity)) {
      if (b.kind === 'keep') continue; // the keep is the prize, not a breach target
      let onFrontier = false;
      for (const t of b.tiles) {
        const tx = t % size;
        const ty = Math.floor(t / size);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (seen[ny * size + nx] === 1) onFrontier = true;
        }
      }
      if (!onFrontier) continue;
      const keepCentre = Math.floor(size / 2);
      const score = Math.abs(b.x - keepCentre) + Math.abs(b.y - keepCentre);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  };

  // ---- the walk ----
  const trace: AssaultTraceStep[] = [];
  const defenderCountBefore = livePosts().reduce((sum, g) => sum + (u.count[g.pi] as number), 0);
  const attackerCountBefore = attackerCount();
  let breaches = 0;
  let at = pickEntry();
  let round = 0;
  const step = (kind: AssaultTraceStep['kind'], tile: number): void => {
    trace.push({ r: round, kind, x: tile % size, y: Math.floor(tile / size) });
  };
  step('enter', at);

  const towersInRange = (t: number): Blocker[] =>
    towers.filter((b) => blockers.has(b.entity) && Math.max(Math.abs(b.x - (t % size)), Math.abs(b.y - Math.floor(t / size))) <= b.range);

  const breach = (b: Blocker): void => {
    for (const t of b.tiles) tileToStructure.delete(t);
    blockers.delete(b.entity);
    const ti = towers.findIndex((x) => x.entity === b.entity);
    if (ti >= 0) towers.splice(ti, 1);
    defenceGame.removeStructure(b.entity);
    breaches++;
    rebuildField();
  };

  let outcome: 'captured' | 'repelled' | null = null;
  while (outcome === null && round < MAX_ASSAULT_ROUNDS) {
    round++;
    if (attackerCount() <= 0) {
      outcome = 'repelled';
      break;
    }

    // tower fire on the column, every round it stands in range
    for (const tower of towersInRange(at)) {
      const damage = (tower.damage / attackerDefense()) * BASE_MORALE_DAMAGE * (0.85 + rng.nextFloat() * 0.3);
      damageAttacker(damage);
      step('tower', tower.y * size + tower.x);
    }
    if (attackerCount() <= 0) {
      outcome = 'repelled';
      break;
    }

    // garrison posts adjacent to the column fight NOW — TOGETHER: every post within
    // engagement range joins one defending line (piecemeal single-post duels would let
    // a concentrated column eat a garrison unit-by-unit; massed posts are the whole
    // point of prepared ground, GDD §7's defender advantage)
    const posts = livePosts();
    const chebyshevToColumn = (g: { pi: number }): number =>
      Math.max(Math.abs((post.x[g.pi] as number) - (at % size)), Math.abs((post.y[g.pi] as number) - Math.floor(at / size)));
    const contact = posts.some((g) => chebyshevToColumn(g) <= 1);
    const engaged = contact ? posts.filter((g) => chebyshevToColumn(g) <= GARRISON_SUPPORT_RANGE) : [];
    if (engaged.length > 0) {
      let gAttack = 0;
      let gDefense = 0;
      let gCount = 0;
      for (const g of engaged) {
        const def = ops.unitDef(u.def[g.pi] as number);
        const gMoraleFraction = 0.5 + 0.5 * ((u.morale[g.pi] as number) / Math.max(1, def.stats.moraleBase));
        gAttack += (u.count[g.pi] as number) * def.stats.attack * gMoraleFraction;
        gDefense += (u.count[g.pi] as number) * def.stats.defense * GARRISON_DEFENCE_BONUS;
        gCount += u.count[g.pi] as number;
      }
      gDefense = Math.max(1, gDefense);
      const damageToGarrison = (attackerAttack() / gDefense) * BASE_MORALE_DAMAGE * (0.85 + rng.nextFloat() * 0.3);
      const damageToAttacker = (gAttack / attackerDefense()) * BASE_MORALE_DAMAGE * (0.85 + rng.nextFloat() * 0.3);
      // the defending line takes morale + real casualties spread by count share (combat.ts's shape)
      for (const g of engaged) {
        const share = (u.count[g.pi] as number) / Math.max(1, gCount);
        const moraleLoss = damageToGarrison * share;
        u.morale[g.pi] = Math.max(0, (u.morale[g.pi] as number) - moraleLoss);
        const casualties = Math.min(u.count[g.pi] as number, moraleLoss * ASSAULT_CASUALTY_FRACTION);
        u.count[g.pi] = Math.max(0, (u.count[g.pi] as number) - casualties);
        if ((u.count[g.pi] as number) > 0 && (u.morale[g.pi] as number) < ROUT_MORALE_THRESHOLD && rng.nextFloat() < ROUT_CHANCE_PER_SUBROUND) {
          world.detach(g.entity as EntityId, DefencePost); // flees the walls — survives, unposted
          step('rout', at);
        }
      }
      damageAttacker(damageToAttacker);
      step('clash', at);
      continue; // the clash consumes the round
    }

    // adjacent to the keep? the hold-strength verdict
    const atX = at % size;
    const atY = Math.floor(at / size);
    let adjacentToKeep = false;
    for (const t of [...keepTiles]) {
      if (Math.max(Math.abs((t % size) - atX), Math.abs(Math.floor(t / size) - atY)) <= 1) adjacentToKeep = true;
    }
    if (adjacentToKeep) {
      step('keep', at);
      const strength = attackerUnits().reduce((sum, ui) => sum + (u.count[ui] as number) * ops.unitDef(u.def[ui] as number).stats.attack, 0);
      outcome = strength >= keepThreshold ? 'captured' : 'repelled';
      break;
    }

    // path open? advance one step down the field; otherwise break the frontier wall
    if (dist[at] !== undefined && (dist[at] as number) > 0) {
      let next = at;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = atX + dx;
        const ny = atY + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const n = ny * size + nx;
        if (passable(n) && dist[n] !== -1 && (dist[n] as number) < (dist[next] === -1 ? Number.MAX_SAFE_INTEGER : (dist[next] as number))) next = n;
      }
      if (next !== at) {
        at = next;
        step('advance', at);
        continue;
      }
    }
    const wall = pickWallTarget(at);
    if (wall === null) {
      outcome = 'repelled'; // nothing to break, nowhere to go
      break;
    }
    const damage = (attackerSiegeAttack() / Math.max(1, wall.armor)) * ASSAULT_WALL_DAMAGE * (0.85 + rng.nextFloat() * 0.3);
    const bi = index(wall.entity);
    fort.hp[bi] = Math.max(0, (fort.hp[bi] as number) - damage);
    step('wall', wall.y * size + wall.x);
    if ((fort.hp[bi] as number) <= 0) {
      step('breach', wall.y * size + wall.x);
      breach(wall);
    }
  }
  if (outcome === null) outcome = 'repelled';
  step(outcome, at);

  const defenderLoss = defenderCountBefore - livePosts().reduce((sum, g) => sum + (u.count[g.pi] as number), 0);
  const attackerLoss = attackerCountBefore - attackerCount();
  return { outcome, origin: input.origin, attackerLoss, defenderLoss, breaches, trace };
}

/** Publish helper so siege.ts and tests emit one canonical event shape. */
export function publishAssaultResolved(
  events: Pick<EventBus, 'publish'>,
  tick: number,
  castle: number,
  army: number,
  defender: number,
  result: AssaultResult,
): void {
  events.publish({
    type: 'siege.assaultResolved',
    tick,
    data: {
      castle,
      army,
      defender,
      origin: result.origin,
      outcome: result.outcome,
      attackerLoss: Math.round(result.attackerLoss),
      defenderLoss: Math.round(result.defenderLoss),
      breaches: result.breaches,
      trace: result.trace,
    },
  });
}
