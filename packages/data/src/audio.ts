/**
 * AudioCueDef & MusicPlaylistDef (roadmap M41; doc 10 §3, doc 05 §8).
 *
 * Cue table: GameEvent type → a synthesized SFX cue (doc 10 §3: "cue table
 * maps GameEvents → cue ids ... data, hence moddable"). No binary asset
 * exists for ANY content kind in this engine yet — not even sprites; doc 10
 * §1's own placeholder-generator is unbuilt — so cues are placeholders
 * exactly the way doc 10 §3 already describes SFX placeholders: "synthesised
 * blips per cue category (generated bank checked in)". `@crowns/audio`
 * generates them at RUNTIME rather than checking in files, which keeps the
 * doctrine's promise ("replacing a placeholder with final art is a file
 * swap, zero code changes") honest with zero binary assets and zero
 * non-determinism risk — audio never touches sim state or hashes (doc 05
 * §8: event-driven, presentation-only).
 *
 * `gain` is the doc 10 §3 loudness-lint gate: a normalized 0..1 target
 * standing in for the doc's −16 LUFS build target — a v1 simplification,
 * the same "nominal value" precedent M23's `pactValue` and M37's prestige
 * weights already use — validated at content load like every other numeric
 * field here, PLUS a dedicated loudness-lint test in @crowns/audio that
 * checks the whole shipped roster sits inside the safe band (the roadmap's
 * own "loudness lints" T objective).
 */
import { v, type Validator } from './validate.js';

export const AUDIO_BUSES = ['music', 'worldSfx', 'uiSfx'] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];

export const SYNTH_WAVEFORMS = ['sine', 'square', 'triangle', 'sawtooth', 'noise'] as const;
export type SynthWaveform = (typeof SYNTH_WAVEFORMS)[number];

export const TENSION_STATES = ['calm', 'tense', 'combat'] as const;
export type TensionState = (typeof TENSION_STATES)[number];

/** Safe normalized-gain band standing in for doc 10 §3's −16 LUFS build target. */
export const LOUDNESS_MIN_GAIN = 0.05;
export const LOUDNESS_MAX_GAIN = 0.85;

export interface AudioCueDef {
  readonly id: string;
  readonly name: string;
  /** The GameEvent `type` this cue answers (doc 05 §8: "GameEvents map to SFX cues"). Free-form,
   * like `EffectExpr`'s `command.type` (events.ts) — GameEvent types aren't a closed vocabulary. */
  readonly event: string;
  readonly bus: AudioBus;
  /** Normalized 0..1 — the loudness-lint gate (doc 10 §3). */
  readonly gain: number;
  readonly waveform: SynthWaveform;
  readonly frequencyHz: number;
  readonly durationMs: number;
  /** doc 10 §3's `TEMP_` convention as a real field rather than a filename hack: true until real
   * authored audio replaces the synthesized placeholder (the placeholder-purge lint, M41). */
  readonly placeholder: boolean;
  readonly tags: readonly string[];
}

export interface MusicPlaylistDef {
  readonly id: string;
  readonly name: string;
  readonly tension: TensionState;
  /** Omit for "any" era/season (doc 10 §3: "playlist defs per era/season/tension state"). */
  readonly era?: string;
  readonly season?: string;
  /** Normalized 0..1 — the loudness-lint gate, same band as cues. */
  readonly gain: number;
  /** Synthesis pattern ids the placeholder generative player cycles through — doc 10 §3's "4
   * royalty-free temp tracks", generated rather than checked in (see module doc). */
  readonly trackIds: readonly string[];
  readonly placeholder: boolean;
  readonly tags: readonly string[];
}

export const audioCueValidator: Validator<AudioCueDef> = v.object({
  id: v.id(),
  name: v.string({ minLength: 1 }),
  event: v.string({ minLength: 1 }),
  bus: v.literal(...AUDIO_BUSES),
  gain: v.number({ min: LOUDNESS_MIN_GAIN, max: LOUDNESS_MAX_GAIN }),
  waveform: v.literal(...SYNTH_WAVEFORMS),
  frequencyHz: v.number({ min: 20, max: 4000 }),
  durationMs: v.number({ min: 10, max: 3000 }), // doc 10 §3: SFX "mono ≤3 s"
  placeholder: v.boolean(),
  tags: v.array(v.string({ minLength: 1 })),
}) as Validator<AudioCueDef>;

export const musicPlaylistValidator: Validator<MusicPlaylistDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    tension: v.literal(...TENSION_STATES),
    era: v.string({ minLength: 1 }),
    season: v.string({ minLength: 1 }),
    gain: v.number({ min: LOUDNESS_MIN_GAIN, max: LOUDNESS_MAX_GAIN }),
    trackIds: v.array(v.string({ minLength: 1 }), { minItems: 1 }),
    placeholder: v.boolean(),
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['era', 'season'] },
) as Validator<MusicPlaylistDef>;
