/**
 * Placeholder synthesis (roadmap M41; doc 10 §3): "Placeholder: synthesised
 * blips per cue category (generated bank checked in)." Generated at RUNTIME
 * instead of checked in as files — see `packages/data/src/audio.ts`'s module
 * doc for why that's a strict improvement on the doctrine, not a shortcut.
 * Browser-only (Web Audio nodes); every parameter it reads is pre-validated
 * content-def data (`packages/data/src/audio.ts`'s loudness-lint gate), so
 * this file itself has nothing left to validate.
 */
import type { AudioCue } from '@crowns/protocol';
import type { Mixer } from './mixer.js';

/** One short, enveloped blip — a cue's placeholder "sound". */
export function playCue(mixer: Mixer, cue: AudioCue): void {
  const ctx = mixer.context;
  const now = ctx.currentTime;
  const durationSec = cue.durationMs / 1000;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(cue.gain, now + Math.min(0.02, durationSec / 4));
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  envelope.connect(mixer.busNode(cue.bus));

  const source = cue.waveform === 'noise' ? createNoiseSource(ctx, durationSec) : createOscillatorSource(ctx, cue);
  source.connect(envelope);
  source.start(now);
  source.stop(now + durationSec + 0.05);
}

function createOscillatorSource(ctx: AudioContext, cue: AudioCue): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  osc.type = cue.waveform as OscillatorType; // caller guarantees non-'noise' (see playCue)
  osc.frequency.setValueAtTime(cue.frequencyHz, ctx.currentTime);
  // a gentle downward glide reads as a percussive "hit" rather than a pure tone —
  // the same cheap trick every placeholder-blip generator in the wild uses
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, cue.frequencyHz * 0.6), ctx.currentTime + cue.durationMs / 1000);
  return osc;
}

/** White noise burst (percussive/impact cues — e.g. a breach) via a short pre-filled buffer. */
function createNoiseSource(ctx: AudioContext, durationSec: number): AudioScheduledSourceNode {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

/**
 * A generative music "track" — stands in for doc 10 §3's "4 royalty-free temp
 * tracks" without any binary asset, but is an actual THEME rather than the old
 * single-drone placeholder: a look-ahead-scheduled loop of bass, a slow chord
 * pad, an arpeggiated melody, and (for tenser states) drums. `trackId`'s prefix
 * picks the mood — `pastoral-*` (calm keep at peace), `unease-*` (tense minor),
 * `war-drums-*` (driving combat) — so each tension playlist sounds distinct.
 * The `trackIds` in content/base/defs/playlists/core.json5 are named for these.
 */
export interface PlaceholderTrackHandle {
  stop(): void;
}

/** One musical mood: a chord loop + a scale for the melody over it. */
interface Mood {
  readonly rootHz: number; // pitch of scale degree 0 / chord root 0
  readonly bpm: number;
  readonly wave: OscillatorType; // pad + melody timbre
  /** Chords, one per bar, looping. `root` is semitones from `rootHz`; `triad`
   * is semitone offsets stacked on that root (the pad voices + the bass note). */
  readonly progression: readonly { readonly root: number; readonly triad: readonly number[] }[];
  readonly scale: readonly number[]; // melody note pool, semitones from root
  readonly melody: readonly number[]; // 8 steps; index into `scale` (+octaves), or -1 rest
  readonly melodyOctave: number; // semitones added to every melody note
  readonly drums: 'none' | 'soft' | 'war';
}

const STEPS_PER_BAR = 8; // eighth-note grid

const MOODS: Record<string, Mood> = {
  // I–V–vi–IV in D major: the warm, settled sound of a keep at peace.
  pastoral: {
    rootHz: 146.83, // D3
    bpm: 66,
    wave: 'triangle',
    progression: [
      { root: 0, triad: [0, 4, 7] }, // D
      { root: 7, triad: [0, 4, 7] }, // A
      { root: 9, triad: [0, 3, 7] }, // Bm
      { root: 5, triad: [0, 4, 7] }, // G
    ],
    scale: [0, 2, 4, 7, 9], // D major pentatonic
    melody: [0, 2, 4, -1, 3, 2, 0, -1],
    melodyOctave: 12,
    drums: 'none',
  },
  // i–VI–III–VII in A minor: unresolved, watchful — the tense playlist.
  unease: {
    rootHz: 110, // A2
    bpm: 82,
    wave: 'triangle',
    progression: [
      { root: 0, triad: [0, 3, 7] }, // Am
      { root: -4, triad: [0, 4, 7] }, // F
      { root: 3, triad: [0, 4, 7] }, // C
      { root: -2, triad: [0, 4, 7] }, // G
    ],
    scale: [0, 2, 3, 5, 7, 8, 10], // A natural minor
    melody: [0, -1, 4, -1, 2, -1, 5, 3],
    melodyOctave: 12,
    drums: 'soft',
  },
  // i–VII–VI–VII in A minor, fast, with a kit under it: the combat playlist.
  'war-drums': {
    rootHz: 110, // A2
    bpm: 124,
    wave: 'sawtooth',
    progression: [
      { root: 0, triad: [0, 3, 7] }, // Am
      { root: -2, triad: [0, 4, 7] }, // G
      { root: -4, triad: [0, 4, 7] }, // F
      { root: -2, triad: [0, 4, 7] }, // G
    ],
    scale: [0, 2, 3, 5, 7, 8, 10], // A natural minor
    melody: [0, 3, 4, 7, 4, 3, 5, 2],
    melodyOctave: 12,
    drums: 'war',
  },
};

function moodFor(trackId: string): Mood {
  const key = trackId.startsWith('pastoral') ? 'pastoral' : trackId.startsWith('war') ? 'war-drums' : 'unease';
  return MOODS[key] as Mood;
}

function semiToHz(rootHz: number, semitones: number): number {
  return rootHz * Math.pow(2, semitones / 12);
}

export function playPlaceholderTrack(mixer: Mixer, bus: 'music', trackId: string, gain: number): PlaceholderTrackHandle {
  const ctx = mixer.context;
  const mood = moodFor(trackId);

  // master → gentle low-pass for warmth → music bus. All voices route through
  // `master`, so `stop()` only has to fade this one node.
  const master = ctx.createGain();
  master.gain.value = 0;
  const warmth = ctx.createBiquadFilter();
  warmth.type = 'lowpass';
  warmth.frequency.value = mood.drums === 'war' ? 5200 : 3400;
  master.connect(warmth);
  warmth.connect(mixer.busNode(bus));
  master.gain.linearRampToValueAtTime(gain, ctx.currentTime + 1.5); // fade in

  const stepDur = 60 / mood.bpm / 2; // one eighth note
  const barDur = stepDur * STEPS_PER_BAR;

  const tone = (freq: number, start: number, dur: number, peak: number, wave: OscillatorType, attack = 0.01): void => {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  };

  const kick = (start: number): void => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, start);
    osc.frequency.exponentialRampToValueAtTime(46, start + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + 0.24);
  };

  const drum = (start: number, dur: number, peak: number, highpassHz: number): void => {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpassHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start(start);
    src.stop(start + dur + 0.02);
  };

  const scheduleStep = (globalStep: number, time: number): void => {
    const inBar = globalStep % STEPS_PER_BAR;
    const chord = mood.progression[Math.floor(globalStep / STEPS_PER_BAR) % mood.progression.length] as Mood['progression'][number];

    if (inBar === 0) {
      // chord pad for the whole bar + a bass note on the downbeat
      for (const semi of chord.triad) {
        tone(semiToHz(mood.rootHz, chord.root + semi), time, barDur * 0.96, 0.05, mood.wave, barDur * 0.15);
      }
      tone(semiToHz(mood.rootHz, chord.root - 12), time, stepDur * 3.5, 0.26, 'triangle', 0.01);
    }
    if (inBar === 4) {
      tone(semiToHz(mood.rootHz, chord.root - 12), time, stepDur * 3.5, 0.22, 'triangle', 0.01);
    }

    const m = mood.melody[inBar] as number;
    if (m >= 0) {
      const degree = mood.scale[m % mood.scale.length] as number;
      const octave = 12 * Math.floor(m / mood.scale.length);
      tone(semiToHz(mood.rootHz, degree + octave + mood.melodyOctave), time, stepDur * 1.4, 0.15, mood.wave, 0.006);
    }

    if (mood.drums === 'soft') {
      if (inBar === 0 || inBar === 4) kick(time);
      if (inBar === 2 || inBar === 6) drum(time, 0.14, 0.28, 1400);
    } else if (mood.drums === 'war') {
      if (inBar === 0 || inBar === 3 || inBar === 4 || inBar === 6) kick(time);
      if (inBar === 2 || inBar === 6) drum(time, 0.16, 0.42, 1200);
      if (inBar % 2 === 1) drum(time, 0.05, 0.12, 6000); // hats
    }
  };

  // Look-ahead scheduler (the standard Web Audio pattern): a coarse timer keeps
  // the note queue ~200ms ahead of the clock, so timing never depends on the
  // JS timer's jitter. Deterministic step content — no per-frame randomness
  // except the drum noise buffers, which are flavour only.
  let step = 0;
  let nextTime = ctx.currentTime + 0.12;
  const pump = (): void => {
    while (nextTime < ctx.currentTime + 0.25) {
      scheduleStep(step, nextTime);
      step++;
      nextTime += stepDur;
    }
  };
  pump();
  const timer = setInterval(pump, 60) as unknown as number;

  return {
    stop(): void {
      clearInterval(timer);
      const releaseEnd = ctx.currentTime + 1.2;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, releaseEnd); // fade out; scheduled voices die silently under it
    },
  };
}
