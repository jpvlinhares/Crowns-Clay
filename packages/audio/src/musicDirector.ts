/**
 * Music director (roadmap M41; doc 05 §8, doc 10 §3): "music director
 * selects era/season/tension-state playlists". Pure selection logic —
 * playback is `synth.ts`'s job. Picking the same playlist id twice in a row
 * is a no-op for the caller (`AudioDirector`), so tension's own hysteresis
 * (`tension.ts`) is what actually prevents rapid playlist thrashing here —
 * no second hysteresis layer needed on top of it.
 */
import type { MusicPlaylist } from '@crowns/protocol';
import type { TensionState } from './tension.js';

export interface MusicContext {
  readonly tension: TensionState;
  readonly era?: string;
  readonly season?: string;
}

/**
 * Best match wins by specificity: era+season > era > season > tension-only
 * (a playlist with no era/season is the universal fallback for that tension).
 * Ties (equal specificity) keep the first-declared playlist — deterministic,
 * load-order-stable, same "first match wins" simplicity as `cueTable.ts`.
 */
export function selectPlaylist(playlists: readonly MusicPlaylist[], ctx: MusicContext): MusicPlaylist | undefined {
  let best: MusicPlaylist | undefined;
  let bestScore = -1;
  for (const p of playlists) {
    if (p.tension !== ctx.tension) continue;
    if (p.era !== undefined && p.era !== ctx.era) continue;
    if (p.season !== undefined && p.season !== ctx.season) continue;
    const score = (p.era !== undefined ? 2 : 0) + (p.season !== undefined ? 1 : 0);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
