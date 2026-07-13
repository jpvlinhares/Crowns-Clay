import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MusicPlaylist } from '@crowns/protocol';
import { selectPlaylist } from './musicDirector.js';

const playlist = (id: string, tension: MusicPlaylist['tension'], era?: string, season?: string): MusicPlaylist => ({
  id,
  tension,
  ...(era !== undefined ? { era } : {}),
  ...(season !== undefined ? { season } : {}),
  gain: 0.4,
  trackIds: ['a'],
  placeholder: true,
});

test('musicDirector: universal (no era/season) playlist matches any context at that tension', () => {
  const playlists = [playlist('base:playlist.calm', 'calm'), playlist('base:playlist.combat', 'combat')];
  assert.equal(selectPlaylist(playlists, { tension: 'calm' })?.id, 'base:playlist.calm');
  assert.equal(selectPlaylist(playlists, { tension: 'calm', era: 'early', season: 'winter' })?.id, 'base:playlist.calm');
  assert.equal(selectPlaylist(playlists, { tension: 'tense' }), undefined, 'no playlist for this tension at all');
});

test('musicDirector: a more specific (era+season) playlist wins over the universal fallback', () => {
  const playlists = [
    playlist('base:playlist.calm-universal', 'calm'),
    playlist('base:playlist.calm-winter', 'calm', undefined, 'winter'),
    playlist('base:playlist.calm-early-winter', 'calm', 'early', 'winter'),
  ];
  assert.equal(selectPlaylist(playlists, { tension: 'calm' })?.id, 'base:playlist.calm-universal');
  assert.equal(selectPlaylist(playlists, { tension: 'calm', season: 'winter' })?.id, 'base:playlist.calm-winter');
  assert.equal(
    selectPlaylist(playlists, { tension: 'calm', era: 'early', season: 'winter' })?.id,
    'base:playlist.calm-early-winter',
  );
  // era matches but season doesn't → falls back to the universal, not the season-only one
  assert.equal(selectPlaylist(playlists, { tension: 'calm', era: 'early', season: 'summer' })?.id, 'base:playlist.calm-universal');
});

test('musicDirector: ties keep the first-declared playlist', () => {
  const playlists = [playlist('base:playlist.first', 'tense'), playlist('base:playlist.second', 'tense')];
  assert.equal(selectPlaylist(playlists, { tension: 'tense' })?.id, 'base:playlist.first');
});
