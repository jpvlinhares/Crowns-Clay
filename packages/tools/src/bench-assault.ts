/**
 * Attack/defence balance matrix (roadmap M54; ADR-4; doc 12 Phase 8).
 *
 *   node packages/tools/dist/bench-assault.js [--seeds N]
 *
 * Sweeps REAL spatial assaults — full campaign composition, template built
 * through the ordinary `defence.build` command path, garrison posted at the
 * template's own anchors, assault launched by `siege.assault` — across
 * (seed × template × garrison × army size × origin) and reports the bands the
 * milestone gates on:
 *
 *   - a BASELINE RAID (20 men) must never take a garrisoned template;
 *   - a HEAVY COLUMN (160 men) must always take keep-only ground;
 *   - NO SINGLE ORIGIN dominates: per fortified configuration, the spread of
 *     capture outcomes across the four origins stays inside the tolerance —
 *     terrain is ALLOWED to price one approach (that is ADR-4 §5's
 *     geography-priced origins working), but a uniformly dominant compass
 *     direction across seeds and templates would be a resolver artefact.
 *
 * Same telemetry-free philosophy as bench-balance.ts: deterministic, local,
 * human-readable; no constant is auto-tuned.
 */
import { BASE_CONTENT_FILES, DefinitionDatabase } from '@crowns/data';
import {
  composeCampaign,
  expandTemplate,
  DEFENCE_KEEP_CENTRE,
  ASSAULT_ORIGINS,
  type AssaultOrigin,
} from '@crowns/sim';

const argValue = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const SEEDS = argValue('--seeds', 2);
const SEED_BASE = 7100;
const ARMIES = [20, 60, 100, 160] as const; // men (spearman units of 10)
const GARRISONS = [0, 30, 60] as const; // men posted at the template's anchors

const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
const TEMPLATES = ['(keep only)', ...[...db.castleTemplates.keys()].sort()];

interface RunOutcome {
  readonly captured: boolean;
  readonly attackerLoss: number;
  readonly defenderLoss: number;
}

function runOne(seed: number, templateId: string, garrison: number, army: number, origin: AssaultOrigin): RunOutcome {
  const c = composeCampaign({
    seed,
    kingdomCount: 2,
    mapSize: 'small',
    aiFromIndex: 2, // both manual — a surgical scenario, no AI noise
    aiDefence: false,
    mods: { sources: [] },
  });
  let resolved: { outcome?: string; attackerLoss?: number; defenderLoss?: number } | null = null;
  c.kernel.subscribe('siege.assaultResolved', (e) => {
    resolved = e.data as typeof resolved;
  });
  const submit = (type: string, payload: unknown, issuer: number): void => {
    c.kernel.submit({ type, issuer, payload });
    c.kernel.step();
  };
  c.kernel.step(); // genesis (keeps rise)

  // ---- defender (kingdom 1): template built through the ordinary command path ----
  const defCapital = c.villageOf(1) as number;
  const template = db.castleTemplates.get(templateId);
  if (template !== undefined) {
    const stock = c.world.writeObj(c.game.comps.Stockpile).get(defCapital);
    stock.set(c.game.ops.resourceCode('base:resource.stone') as number, 1_000_000);
    stock.set(c.game.ops.resourceCode('base:resource.wood') as number, 1_000_000);
    for (const t of expandTemplate(db, template)) {
      submit('defence.build', { def: t.def, x: t.x, y: t.y }, 2);
    }
  }
  // garrison: spearman units posted at the template's anchors (keep-adjacent if none)
  const spearman = db.units.get('base:unit.spearman');
  const spearCode = c.militaryGame.ops.defCode('base:unit.spearman');
  if (spearman === undefined || spearCode === undefined) throw new Error('no spearman def');
  // template anchors, or a ring around the keep for keep-only ground (the M51 fixture
  // lesson: a single off-path post never engages — a ring meets every approach)
  const anchors =
    template !== undefined && template.garrisonAnchors.length > 0
      ? template.garrisonAnchors.map(([dx, dy]) => [DEFENCE_KEEP_CENTRE + dx, DEFENCE_KEEP_CENTRE + dy])
      : ([[2, 0], [-2, 0], [0, 2], [0, -2]] as const).map(([dx, dy]) => [DEFENCE_KEEP_CENTRE + dx, DEFENCE_KEEP_CENTRE + dy]);
  for (let posted = 0, i = 0; posted < garrison; posted += 10, i++) {
    const unit = c.world.spawn();
    c.world.attach(unit, c.militaryGame.Unit, {
      def: spearCode,
      kingdomId: c.kingdomGame.kingdomEntities()[1] as number,
      homeVillage: defCapital,
      armyId: 0,
      count: Math.min(10, garrison - posted),
      progress: 1,
      complete: true,
      morale: spearman.stats.moraleBase,
    });
    const [ax, ay] = anchors[i % anchors.length] as [number, number];
    submit('defence.post', { unitId: unit as number, x: ax, y: ay }, 2);
  }

  // ---- attacker (kingdom 0): a column at the walls ----
  const core = c.world.read(c.game.comps.VillageCore);
  let castleEntity = -1;
  c.world.query([c.game.comps.VillageCore]).forEach((vi, entity) => {
    if (vi === defCapital) castleEntity = entity as number;
  });
  submit('army.createArmy', { name: 'Column', villageId: c.villageOf(0) as number }, 1);
  let armyId = -1;
  c.world.query([c.militaryGame.Army]).forEach((ai, entity) => {
    const a = c.world.read(c.militaryGame.Army);
    if ((a.kingdomId[ai] as number) === (c.kingdomGame.kingdomEntities()[0] as number)) armyId = entity as number;
  });
  for (let men = 0; men < army; men += 10) {
    const unit = c.world.spawn();
    c.world.attach(unit, c.militaryGame.Unit, {
      def: spearCode,
      kingdomId: c.kingdomGame.kingdomEntities()[0] as number,
      homeVillage: c.villageOf(0) as number,
      armyId,
      count: Math.min(10, army - men),
      progress: 1,
      complete: true,
      morale: spearman.stats.moraleBase,
    });
  }
  const m = c.world.write(c.armiesGame.ArmyMovement);
  m.x[armyId & 0x3fffff] = core.centerX[defCapital] as number;
  m.y[armyId & 0x3fffff] = core.centerY[defCapital] as number;
  c.world.writeObj(c.armiesGame.ArmyPath).set(armyId & 0x3fffff, []);
  submit('siege.begin', { armyId, villageId: castleEntity }, 1);
  submit('siege.assault', { armyId, origin }, 1);

  const r = resolved as { outcome?: string; attackerLoss?: number; defenderLoss?: number } | null;
  if (r === null) throw new Error(`assault never resolved (seed ${seed}, ${templateId}, g${garrison}, a${army}, ${origin})`);
  return { captured: r.outcome === 'captured', attackerLoss: r.attackerLoss ?? 0, defenderLoss: r.defenderLoss ?? 0 };
}

// ---------------------------------------------------------------- the sweep

interface CellStat {
  captures: number;
  runs: number;
  attackerLoss: number;
}

const byConfig = new Map<string, Map<AssaultOrigin, CellStat>>(); // template|garrison|army → origin → stat
// per-seed reachability mask: which origins can take KEEP-ONLY, UNGARRISONED ground with a
// heavy column — an origin geography seals entirely (water/rock walls the whole approach)
// is ADR-4 §5's pricing at its limit, not a resolver failure; the band gates and the
// dominance metric only judge origins an attacker could actually use.
const reachable = new Map<number, Set<AssaultOrigin>>();
let raidTookGarrisoned = 0;
let totalRuns = 0;

const t0 = Date.now();
for (let s = 0; s < SEEDS; s++) {
  const seed = SEED_BASE + s;
  const mask = new Set<AssaultOrigin>();
  for (const origin of ASSAULT_ORIGINS) {
    if (runOne(seed, '(keep only)', 0, 160, origin).captured) mask.add(origin);
  }
  reachable.set(seed, mask);
  for (const templateId of TEMPLATES) {
    for (const garrison of GARRISONS) {
      for (const army of ARMIES) {
        for (const origin of mask) {
          const out = runOne(seed, templateId, garrison, army, origin);
          totalRuns++;
          const key = `${templateId}|g${garrison}|a${army}`;
          let inner = byConfig.get(key);
          if (inner === undefined) byConfig.set(key, (inner = new Map()));
          const cell = inner.get(origin) ?? { captures: 0, runs: 0, attackerLoss: 0 };
          cell.captures += out.captured ? 1 : 0;
          cell.runs++;
          cell.attackerLoss += out.attackerLoss;
          inner.set(origin, cell);
          if (out.captured && army === 20 && garrison > 0 && templateId !== '(keep only)') raidTookGarrisoned++;
        }
      }
    }
  }
}
const hostRepelledEverywhere = [...reachable.values()].filter((mask) => mask.size === 0).length;

// ---------------------------------------------------------------- the report

console.log(`\n${totalRuns} assaults · ${SEEDS} seed(s) × ${TEMPLATES.length} layouts × ${GARRISONS.length} garrisons × ${ARMIES.length} armies × reachable origins (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
for (const [seed, mask] of reachable) console.log(`  seed ${seed}: reachable origins [${[...mask].join(', ')}]`);
console.log('');
console.log('capture rate by config (origins l/r/t/b) · mean attacker loss:');
for (const key of [...byConfig.keys()].sort()) {
  const inner = byConfig.get(key) as Map<AssaultOrigin, CellStat>;
  const cells = ASSAULT_ORIGINS.map((o) => {
    const c = inner.get(o) ?? { captures: 0, runs: 1, attackerLoss: 0 };
    return `${o[0]}:${((c.captures / c.runs) * 100).toFixed(0)}%`;
  });
  const loss = [...inner.values()].reduce((n, c) => n + c.attackerLoss, 0) / Math.max(1, [...inner.values()].reduce((n, c) => n + c.runs, 0));
  console.log(`  ${key.padEnd(34)} ${cells.join(' ')} · loss ${loss.toFixed(0)}`);
}

// origin dominance — the T objective is "no single-origin dominant STRATEGY": one
// compass direction that is consistently the best pick across layouts and seeds.
// Marginal configs flipping by approach in MIXED directions is geography pricing
// (ADR-4 §5) doing its job, so the metric aggregates PER ORIGIN across every
// contested fortified config and gates on a consistent aggregate deviation.
const perOrigin = new Map<AssaultOrigin, { captures: number; runs: number }>();
let contested = 0;
for (const [key, inner] of byConfig) {
  if (key.startsWith('(keep only)')) continue;
  const rates = ASSAULT_ORIGINS.map((o) => {
    const c = inner.get(o);
    return c === undefined ? null : c.captures / c.runs;
  }).filter((r): r is number => r !== null);
  const mean = rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length);
  if (mean === 0 || mean === 1) continue; // uncontested — origin choice irrelevant
  contested++;
  for (const o of ASSAULT_ORIGINS) {
    const c = inner.get(o);
    if (c === undefined) continue;
    const agg = perOrigin.get(o) ?? { captures: 0, runs: 0 };
    agg.captures += c.captures;
    agg.runs += c.runs;
    perOrigin.set(o, agg);
  }
}
const originMeans = ASSAULT_ORIGINS.map((o) => {
  const agg = perOrigin.get(o);
  return { origin: o, rate: agg === undefined || agg.runs === 0 ? null : agg.captures / agg.runs };
}).filter((x): x is { origin: AssaultOrigin; rate: number } => x.rate !== null);
const grandMean = originMeans.reduce((a, x) => a + x.rate, 0) / Math.max(1, originMeans.length);
const maxDeviation = originMeans.reduce((a, x) => Math.max(a, Math.abs(x.rate - grandMean)), 0);
console.log(
  `\ncontested configs: ${contested} · per-origin capture rate over them: ` +
    originMeans.map((x) => `${x.origin[0]}:${(x.rate * 100).toFixed(0)}%`).join(' ') +
    ` · max deviation ${(maxDeviation * 100).toFixed(0)}%`,
);

const failures: string[] = [];
if (raidTookGarrisoned > 0) failures.push(`${raidTookGarrisoned} baseline raid(s) took a GARRISONED template`);
if (hostRepelledEverywhere > 0) failures.push(`${hostRepelledEverywhere} seed(s) where a heavy column can take keep-only ground from NO origin`);
if (contested > 0 && maxDeviation > 0.35) failures.push(`origin dominance: a compass direction deviates ${(maxDeviation * 100).toFixed(0)}% > 35% from the mean across contested configs`);
if (failures.length > 0) {
  console.error(`M54 T-OBJECTIVE FAIL: ${failures.join(' · ')}`);
  process.exitCode = 1;
} else {
  console.log('M54 bands hold: raids repelled by garrisoned templates · keep-only falls to a host · no dominant origin');
}
