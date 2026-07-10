/**
 * VictoryType vocabulary (roadmap M37; GDD §16). Pure vocabulary — the
 * tracking/scoring logic lives in game/victory.ts (sim layer, which depends
 * on this package, never the reverse, TDD §3). Exists here so
 * `AIPersonalityDef.preferences.favoredVictory` (M36) can finally be
 * validated against real names instead of freeform tags.
 */
export const VICTORY_TYPES = ['conquest', 'hegemony', 'legacy', 'prosperity', 'chronicle'] as const;
export type VictoryType = (typeof VICTORY_TYPES)[number];
