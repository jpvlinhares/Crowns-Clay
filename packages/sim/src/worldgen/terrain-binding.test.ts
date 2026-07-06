import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN_BIOME_CODES } from '@crowns/data';
import { BIOME_COUNT } from '../worldgen/types.js';

test('biome-code count: @crowns/data mirror matches worldgen (TDD §3 direction kept)', () => {
  assert.equal(TERRAIN_BIOME_CODES, BIOME_COUNT);
});
