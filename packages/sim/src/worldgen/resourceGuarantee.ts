/**
 * Start-resource guarantee (GDD §13 gap fix). `scoreSite` (game/settlers.ts) softly PULLS
 * founding toward woodland but never scores `mineable` at all — whether a capital's stone was
 * reachable was pure chance, and an empirical check across real seeds found the DEFAULT campaign
 * flow (fairPlacement's wide search bands) left most players with no quarry-buildable ground
 * anywhere near their capital. This patches the ALREADY-CHOSEN site's surrounding terrain,
 * deterministically, so both a Lumber Camp and a Quarry always have somewhere valid to go within
 * the village's TIER-1 build radius — stone is guaranteed on the same footing as wood, not gated
 * to a later tier.
 *
 * MUST be a pure function of (layers, site, requirement) with no RNG: it runs identically at a
 * fresh session (site freshly chosen) and at every reload (terrain regenerates from seed; the
 * site is re-derived or restored to the exact same coordinates) — anything seed-dependent here
 * would desync a reloaded save from the session that produced it.
 */
import type { DefinitionDatabase } from '@crowns/data';
import { Biome, type BiomeId, type WorldLayers } from './types.js';

export interface HarvesterRequirement {
  /** True if this biome already carries the tag the harvester needs (e.g. 'woodland'). */
  readonly hasTag: (biome: BiomeId) => boolean;
  /** The biome painted onto a tile that has to be converted to satisfy the guarantee. */
  readonly fillBiome: BiomeId;
  readonly footprintW: number;
  readonly footprintH: number;
}

/** Tiles this close (Chebyshev) to the site are the village-centre's own footprint (2×2) plus a
 * one-tile buffer — never touched, so the guarantee can never clobber the founding placement. */
const SITE_GUARD = 2;

function isWater(biome: BiomeId): boolean {
  return biome === Biome.Ocean || biome === Biome.Coast;
}

interface Block {
  readonly x: number;
  readonly y: number;
  readonly far: number; // Chebyshev distance from the site to the block's farthest corner
}

/** Every footprint-sized block whose far corner is within `radius` of the site and that doesn't
 * overlap the site's own footprint — closest-far-corner-first, then row-major (determinism),
 * matching how `validatePlacement`'s tier radius check measures reachability. */
function candidateBlocks(width: number, height: number, siteX: number, siteY: number, radius: number, w: number, h: number): Block[] {
  const out: Block[] = [];
  for (let oy = Math.max(0, siteY - radius); oy <= Math.min(height - h, siteY + radius); oy++) {
    for (let ox = Math.max(0, siteX - radius); ox <= Math.min(width - w, siteX + radius); ox++) {
      let far = 0;
      let touchesSite = false;
      for (let fy = 0; fy < h; fy++) {
        for (let fx = 0; fx < w; fx++) {
          const d = Math.max(Math.abs(ox + fx - siteX), Math.abs(oy + fy - siteY));
          if (d > far) far = d;
          if (d < SITE_GUARD) touchesSite = true;
        }
      }
      if (touchesSite || far > radius) continue;
      out.push({ x: ox, y: oy, far });
    }
  }
  out.sort((a, b) => a.far - b.far || a.y - b.y || a.x - b.x);
  return out;
}

function blockCells(x: number, y: number, w: number, h: number): { fx: number; fy: number }[] {
  const cells: { fx: number; fy: number }[] = [];
  for (let fy = 0; fy < h; fy++) for (let fx = 0; fx < w; fx++) cells.push({ fx, fy });
  return cells;
}

/** Ensure at least one footprint-sized block satisfying `req` exists within `radius` of the site.
 * If one already does, nothing is touched. Otherwise the CLOSEST fully-eligible block (land, no
 * river, outside the village's own footprint) is converted — and only the cells that don't
 * already carry the tag are written, so a block that's already half-right stays half-untouched.
 * A search area genuinely boxed in by water/river (no eligible block at all) is left as a
 * shortfall rather than forcing an invalid write — same "report, don't force" spirit as
 * fairPlacement's unmet-fairness fallback. */
function ensureHarvestable(layers: WorldLayers, width: number, height: number, siteX: number, siteY: number, radius: number, req: HarvesterRequirement): void {
  const blocks = candidateBlocks(width, height, siteX, siteY, radius, req.footprintW, req.footprintH);

  const cellEligible = (x: number, y: number): boolean => {
    const i = y * width + x;
    return !isWater(layers.biome[i] as BiomeId) && (layers.river[i] as number) === 0;
  };

  // pass 1: a block that's ALREADY fully the right tag — nothing to do.
  for (const b of blocks) {
    if (blockCells(b.x, b.y, req.footprintW, req.footprintH).every(({ fx, fy }) => req.hasTag(layers.biome[(b.y + fy) * width + (b.x + fx)] as BiomeId))) {
      return;
    }
  }

  // pass 2: the closest block where every cell is at least eligible for conversion.
  for (const b of blocks) {
    const cells = blockCells(b.x, b.y, req.footprintW, req.footprintH);
    if (!cells.every(({ fx, fy }) => cellEligible(b.x + fx, b.y + fy))) continue;
    for (const { fx, fy } of cells) {
      const i = (b.y + fy) * width + (b.x + fx);
      if (!req.hasTag(layers.biome[i] as BiomeId)) layers.biome[i] = req.fillBiome;
    }
    return;
  }
}

/** Ensure every requirement (wood, stone, ...) is reachable within `radius` of the site — the
 * SAME radius for all of them (stone is not tier-2-gated; it stands on the same footing as wood). */
export function guaranteeStartResources(
  layers: WorldLayers,
  width: number,
  height: number,
  siteX: number,
  siteY: number,
  radius: number,
  requirements: readonly HarvesterRequirement[],
): void {
  for (const req of requirements) ensureHarvestable(layers, width, height, siteX, siteY, radius, req);
}

/** The two harvester buildings a founding site must always have room for — Lumber Camp (wood)
 * and Quarry (stone) — built from the LOADED content, so footprint and required tag stay
 * content-driven instead of duplicating base:building.* numbers here (a mod that resizes the
 * Quarry or renames its tag is honoured automatically). Missing defs (a mod that removes one
 * entirely) drop that requirement rather than throwing — the guarantee degrades, it doesn't crash
 * composition. */
export function startHarvesterRequirements(db: DefinitionDatabase): HarvesterRequirement[] {
  const requirement = (defId: string, tag: string, fillBiome: BiomeId): HarvesterRequirement | null => {
    const def = db.buildings.get(defId);
    if (def === undefined) return null;
    return {
      hasTag: (biome) => db.terrainByCode[biome]?.buildableTags.includes(tag) ?? false,
      fillBiome,
      footprintW: def.footprint.w,
      footprintH: def.footprint.h,
    };
  };
  const out: HarvesterRequirement[] = [];
  const wood = requirement('base:building.lumber-camp', 'woodland', Biome.Forest);
  if (wood !== null) out.push(wood);
  const stone = requirement('base:building.quarry', 'mineable', Biome.Hills);
  if (stone !== null) out.push(stone);
  return out;
}
