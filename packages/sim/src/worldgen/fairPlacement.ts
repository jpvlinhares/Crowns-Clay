/**
 * Kingdom placement fairness (roadmap M22; GDD §13 "fairness solver:
 * comparable start-site scores, minimum pairwise distance"). Deterministic
 * angular-sector candidate generation around the map center gives N
 * kingdoms roughly-evenly-spaced starting sites, each scored by the same
 * `scoreSite` (settlers.ts) already used for single-village founding — no
 * new metric. Zero RNG in the geometry: same worldgen (same seed) always
 * yields the same candidate sites and scores.
 *
 * Fairness is measured as the relative range of the N chosen scores:
 * `(max - min) / mean <= 0.30` (a ±15% band expressed as one comparison).
 * If the first attempt misses the band, the search radius widens in fixed,
 * deterministic steps and retries; if still unfair after the last attempt,
 * the best-found placement is returned along with the achieved variance —
 * the caller decides whether to accept it or report it, rather than this
 * function throwing on an unlucky map or silently swallowing the miss.
 */
import type { DefinitionDatabase } from '@crowns/data';
import { scoreSite } from '../game/settlers.js';
import { VILLAGE_MIN_SPACING, type VillageGameplay } from '../game/villages.js';

export interface KingdomSite {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

export interface FairPlacementResult {
  readonly sites: readonly KingdomSite[];
  /** (max(scores) - min(scores)) / mean(scores); 0 if fewer than 2 sites. */
  readonly variance: number;
}

/** ±15% band, expressed as a single relative-range comparison. */
export const FAIRNESS_VARIANCE_BAND = 0.3;

const RING_RADIUS_FRACTION = 0.35; // of min(width, height)
const SECTOR_ARC_FRACTION = 0.8; // of each sector's angular half-width, leaves a buffer between neighbors
const ANGLE_STEP = 0.05; // radians
/** Deterministic, widening (lo, hi) radius bands (× the base ring radius), tried in order. */
const RADIUS_BANDS: readonly (readonly [number, number])[] = [
  [0.7, 1.3],
  [0.5, 1.5],
  [0.3, 1.7],
];

function variance(scores: readonly number[]): number {
  if (scores.length < 2) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (mean === 0) return 0;
  return (Math.max(...scores) - Math.min(...scores)) / mean;
}

/** Best-scoring valid site within one sector's arc and radius band, or null if none is valid. */
function bestInSector(
  game: VillageGameplay,
  db: DefinitionDatabase,
  cx: number,
  cy: number,
  sectorAngle: number,
  halfWidth: number,
  radiusLo: number,
  radiusHi: number,
  taken: readonly KingdomSite[],
): KingdomSite | null {
  const centerDef = db.buildings.get('base:building.village-center');
  if (centerDef === undefined) return null;
  let best: KingdomSite | null = null;
  for (let r = Math.round(radiusLo); r <= Math.round(radiusHi); r++) {
    for (let da = -halfWidth; da <= halfWidth; da += ANGLE_STEP) {
      const angle = sectorAngle + da;
      const x = Math.round(cx + r * Math.cos(angle));
      const y = Math.round(cy + r * Math.sin(angle));
      if (!game.ops.validatePlacement(centerDef, x, y, null).ok) continue;
      // GDD §13's "minimum pairwise distance", enforced at last (M47.9): on crowded small
      // maps, widened radius bands + coastline-squeezed candidates could converge two
      // sectors' picks inside VILLAGE_MIN_SPACING — genesis then threw ("too close to
      // another village center"), killing 11 of 100 real-composition triage campaigns at
      // tick 1. The module doc's old "sectors are naturally far apart" claim was wrong.
      if (taken.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < VILLAGE_MIN_SPACING)) continue;
      const score = scoreSite(game.terrain, x, y);
      if (
        best === null ||
        score > best.score ||
        (score === best.score && (y < best.y || (y === best.y && x < best.x))) // deterministic tie-break
      ) {
        best = { x, y, score };
      }
    }
  }
  return best;
}

function placeAtBand(game: VillageGameplay, db: DefinitionDatabase, n: number, radiusLo: number, radiusHi: number): KingdomSite[] | null {
  const cx = game.terrain.width / 2;
  const cy = game.terrain.height / 2;
  const sites: KingdomSite[] = [];
  const halfWidth = (Math.PI / n) * SECTOR_ARC_FRACTION;
  for (let k = 0; k < n; k++) {
    const sectorAngle = (2 * Math.PI * k) / n;
    const site = bestInSector(game, db, cx, cy, sectorAngle, halfWidth, radiusLo, radiusHi, sites);
    if (site === null) return null;
    sites.push(site);
  }
  return sites;
}

/**
 * Score N deterministic, fairness-checked kingdom start sites. `n` must be
 * at least 1; sectors are spread evenly around the map center AND (M47.9)
 * every candidate must clear `VILLAGE_MIN_SPACING` from already-chosen sites
 * — GDD §13's "minimum pairwise distance", which the original "sectors are
 * naturally far apart" assumption turned out not to guarantee on crowded
 * small maps (11/100 triage campaigns died at genesis before this check).
 */
export function scoreKingdomSites(game: VillageGameplay, db: DefinitionDatabase, n: number): FairPlacementResult {
  const baseRadius = Math.min(game.terrain.width, game.terrain.height) * RING_RADIUS_FRACTION;
  let best: FairPlacementResult | null = null;
  for (const [lo, hi] of RADIUS_BANDS) {
    const sites = placeAtBand(game, db, n, baseRadius * lo, baseRadius * hi);
    if (sites === null) continue;
    const result: FairPlacementResult = { sites, variance: variance(sites.map((s) => s.score)) };
    if (best === null || result.variance < best.variance) best = result;
    if (result.variance <= FAIRNESS_VARIANCE_BAND) return result;
  }
  return best ?? { sites: [], variance: 0 };
}
