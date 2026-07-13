/**
 * Cue table lookup (roadmap M41; doc 10 §3: "cue table maps GameEvents →
 * cue ids"). Pure — the `AudioCue[]` roster comes from the sim worker's
 * `AudioCatalog` projection (protocol, mirroring M18's `UICatalog`), never
 * from `@crowns/data` directly (presentation speaks only protocol, TDD §3).
 */
import type { AudioCue } from '@crowns/protocol';

/** One event type → one cue, first match wins (v1 simplification — no variant pools yet). */
export function buildCueIndex(cues: readonly AudioCue[]): ReadonlyMap<string, AudioCue> {
  const index = new Map<string, AudioCue>();
  for (const cue of cues) {
    if (!index.has(cue.event)) index.set(cue.event, cue);
  }
  return index;
}

export function resolveCue(index: ReadonlyMap<string, AudioCue>, eventType: string): AudioCue | undefined {
  return index.get(eventType);
}
