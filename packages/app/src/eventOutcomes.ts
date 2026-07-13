/**
 * Outcome projection for event-choice dialogs.
 *
 * An event choice's full trade-off is already described by its `effects`: what
 * the player GAINS (grantResource, a positive stat/treasury nudge, better
 * standing) and what they SPEND or SUFFER (removeResource, a negative nudge). The
 * dialog previously showed only the choice's button label, so a prompt like "Pay
 * for their knowledge" never said it costs 20 gold and grants happiness. This
 * derives a signed, human-readable outcome list straight from the effects, so
 * every option states what it gains or costs — including modded events,
 * automatically, with no new authored def field.
 */
import type { EffectExpr, StatPath } from '@crowns/data';

export type OutcomeKind = 'gain' | 'loss' | 'neutral';

export interface ChoiceOutcome {
  /** Player-facing, already signed — e.g. "+8 Tools", "−20 Gold", "+3 happiness". */
  readonly label: string;
  readonly kind: OutcomeKind;
}

/** Friendly names for the closed `STAT_PATHS` vocabulary a modifier effect can target. */
const STAT_LABELS: Record<StatPath, string> = {
  'kingdom.treasury': 'Gold',
  'village.happiness': 'happiness',
  'village.foodSecurity': 'food security',
  'village.tier': 'tier',
};

/** "+5" / "−5" using a real minus sign, dropping a trailing ".0" for whole numbers. */
function signed(value: number): string {
  const magnitude = Number.isInteger(value) ? String(Math.abs(value)) : String(Math.abs(value));
  return value < 0 ? `−${magnitude}` : `+${magnitude}`;
}

/**
 * Every effect a choice applies, as signed outcome chips in author order. Gains and
 * losses are classified for colouring; the `command` escape-hatch has no reliable
 * human description and is skipped (its own effects, if any, are the mod's to surface).
 * `resourceName` resolves a resource id to its display name.
 */
export function choiceOutcomes(
  effects: readonly EffectExpr[],
  resourceName: (resourceId: string) => string,
): ChoiceOutcome[] {
  const outcomes: ChoiceOutcome[] = [];
  for (const effect of effects) {
    if ('grantResource' in effect) {
      outcomes.push({ label: `+${effect.grantResource.amount} ${resourceName(effect.grantResource.resource)}`, kind: 'gain' });
    } else if ('removeResource' in effect) {
      outcomes.push({ label: `−${effect.removeResource.amount} ${resourceName(effect.removeResource.resource)}`, kind: 'loss' });
    } else if ('modifier' in effect) {
      const { stat, op, value } = effect.modifier;
      const label = STAT_LABELS[stat] ?? stat;
      if (op === 'mul') {
        outcomes.push({ label: `×${value} ${label}`, kind: value > 1 ? 'gain' : value < 1 ? 'loss' : 'neutral' });
      } else {
        outcomes.push({ label: `${signed(value)} ${label}`, kind: value > 0 ? 'gain' : value < 0 ? 'loss' : 'neutral' });
      }
    } else if ('opinionChange' in effect) {
      const { delta } = effect.opinionChange;
      outcomes.push({ label: `${signed(delta)} standing`, kind: delta > 0 ? 'gain' : delta < 0 ? 'loss' : 'neutral' });
    }
  }
  return outcomes;
}
