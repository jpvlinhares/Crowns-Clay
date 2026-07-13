/**
 * Payment/cost projection for event-choice dialogs.
 *
 * An event choice's PRICE is already fully described by its `effects` — a
 * `removeResource` (spends a stockpiled good) or a negative `kingdom.treasury`
 * modifier (spends gold). The dialog previously showed only the choice's button
 * label, so a prompt like "Fund public works" never told the player it costs 50
 * gold. This derives the human-readable cost list straight from the effects, so
 * every payment prompt — including modded events — states what is being paid with
 * no extra authoring and no new def field.
 */
import type { EffectExpr } from '@crowns/data';

/** Player-facing label for the kingdom treasury (there is no resource def for it); capitalised
 * to sit consistently beside resource display names like "Wood"/"Tools". */
const GOLD_LABEL = 'Gold';

/**
 * The resources/gold a choice SPENDS, as `[displayName, amount]` pairs (amount
 * always positive). Non-payment effects — grants, happiness/opinion changes,
 * command escape-hatches — are ignored: this answers "what does this cost", not
 * "what does it do". `resourceName` resolves a resource id to its display name.
 */
export function choicePaymentCost(
  effects: readonly EffectExpr[],
  resourceName: (resourceId: string) => string,
): [string, number][] {
  const cost: [string, number][] = [];
  for (const effect of effects) {
    if ('removeResource' in effect) {
      cost.push([resourceName(effect.removeResource.resource), effect.removeResource.amount]);
    } else if (
      'modifier' in effect &&
      effect.modifier.stat === 'kingdom.treasury' &&
      effect.modifier.op === 'add' &&
      effect.modifier.value < 0
    ) {
      cost.push([GOLD_LABEL, -effect.modifier.value]);
    }
  }
  return cost;
}
