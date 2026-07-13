/**
 * AudioDirector (roadmap M41) — composition root for the whole subsystem,
 * the audio-side mirror of `packages/ui/src/notifications.ts`'s
 * `NotificationQueue`: `push(event)` is the same one entry point the app's
 * `ticked` event loop already calls `notifications.push` from
 * (`packages/app/src/main.ts`), so wiring this in is a one-line addition
 * beside it, not a new event-plumbing path.
 */
import type { AudioCatalog, AudioCue, GameEvent } from '@crowns/protocol';
import { buildCueIndex, resolveCue } from './cueTable.js';
import { selectPlaylist } from './musicDirector.js';
import { TensionTracker, type TensionState } from './tension.js';
import { Mixer } from './mixer.js';
import { playCue, playPlaceholderTrack, type PlaceholderTrackHandle } from './synth.js';

export class AudioDirector {
  private readonly mixer: Mixer;
  private readonly tension = new TensionTracker();
  private cueIndex: ReadonlyMap<string, AudioCue> = new Map();
  private playlists: AudioCatalog['playlists'] = [];
  private season: string | undefined;
  private era: string | undefined;
  private currentPlaylistId: string | null = null;
  private currentTrack: PlaceholderTrackHandle | null = null;
  private enabled = false;

  constructor(mixer: Mixer = new Mixer()) {
    this.mixer = mixer;
  }

  setCatalog(catalog: AudioCatalog): void {
    this.cueIndex = buildCueIndex(catalog.cues);
    this.playlists = catalog.playlists;
    this.reconsiderMusic();
  }

  /** Unlock playback from a user-gesture handler (browser autoplay policy). */
  async enable(): Promise<void> {
    await this.mixer.resume();
    this.enabled = true;
    this.reconsiderMusic();
  }

  setMuted(muted: boolean): void {
    this.mixer.setMuted(muted);
  }

  setBusVolume(bus: Parameters<Mixer['setBusVolume']>[0], volume: number): void {
    this.mixer.setBusVolume(bus, volume);
  }

  tensionState(): TensionState {
    return this.tension.current();
  }

  /** Feed one GameEvent through: tension update, cue trigger, season tracking. */
  push(event: GameEvent): void {
    this.tension.push(event);
    if (event.type === 'time.seasonStarted') {
      const data = event.data as { seasonName?: string } | undefined;
      if (typeof data?.seasonName === 'string') this.season = data.seasonName;
    }
    const cue = resolveCue(this.cueIndex, event.type);
    if (cue !== undefined && this.enabled) playCue(this.mixer, cue);
    this.reconsiderMusic();
  }

  /** Let tension decay for elapsed ticks even between events (call once per pump/tick batch). */
  advance(tick: number): void {
    this.tension.advance(tick);
    this.reconsiderMusic();
  }

  private reconsiderMusic(): void {
    if (!this.enabled) return;
    const playlist = selectPlaylist(this.playlists, {
      tension: this.tension.current(),
      ...(this.era !== undefined ? { era: this.era } : {}),
      ...(this.season !== undefined ? { season: this.season } : {}),
    });
    const nextId = playlist?.id ?? null;
    if (nextId === this.currentPlaylistId) return;
    this.currentTrack?.stop();
    this.currentTrack = null;
    this.currentPlaylistId = nextId;
    if (playlist === undefined) return;
    const trackId = playlist.trackIds[0];
    if (trackId !== undefined) this.currentTrack = playPlaceholderTrack(this.mixer, 'music', trackId, playlist.gain);
  }
}
