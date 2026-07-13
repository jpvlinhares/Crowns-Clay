/**
 * Web Audio mixing graph (roadmap M41; doc 05 §8): "Web Audio graph: music /
 * world SFX / UI SFX buses with independent volume." Thin and browser-only —
 * the ONE file in this package that actually touches `AudioContext` (every
 * decision about WHAT to play lives in the pure modules alongside it).
 *
 * Autoplay policy (every major browser): an `AudioContext` starts
 * `'suspended'` until a user gesture resumes it — `resume()` is meant to be
 * called from a click handler, not at module load.
 */
import type { AudioBus } from '@crowns/protocol';

export const AUDIO_BUSES: readonly AudioBus[] = ['music', 'worldSfx', 'uiSfx'];

export class Mixer {
  readonly context: AudioContext;
  private readonly buses: Record<AudioBus, GainNode>;
  private readonly master: GainNode;
  private muted = false;

  constructor(context: AudioContext = new AudioContext()) {
    this.context = context;
    this.master = context.createGain();
    this.master.connect(context.destination);
    this.buses = {
      music: context.createGain(),
      worldSfx: context.createGain(),
      uiSfx: context.createGain(),
    };
    for (const bus of AUDIO_BUSES) this.buses[bus].connect(this.master);
  }

  /** Resume a suspended context — call from a user-gesture handler (browser autoplay policy). */
  async resume(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
  }

  busNode(bus: AudioBus): GainNode {
    return this.buses[bus];
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.buses[bus].gain.value = Math.max(0, Math.min(1, volume));
  }

  getBusVolume(bus: AudioBus): number {
    return this.buses[bus].gain.value;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.master.gain.value = muted ? 0 : 1;
  }

  isMuted(): boolean {
    return this.muted;
  }
}
