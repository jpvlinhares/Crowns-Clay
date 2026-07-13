import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatMessage } from '@crowns/core';
import { accentize, buildEnXaTable, pseudoLocalizeTemplate } from './locale-pseudo.js';
import { buildTranslatorPack } from './locale-extract.js';

test('accentize: maps vowels only, leaves everything else untouched', () => {
  assert.equal(accentize('Traveling Merchant'), 'Trävëlïng Mërchänt');
  assert.equal(accentize('123 — !@#'), '123 — !@#');
});

test('pseudoLocalizeTemplate: expands ~30%, wraps in markers, and stays formattable', () => {
  const out = pseudoLocalizeTemplate('Hello, {name}!');
  assert.ok(out.startsWith('⟦') && out.endsWith('⟧'), 'wrapped in pseudo-locale markers');
  assert.ok(out.includes('{name}'), 'placeholder token survives untouched');
  assert.ok(out.length > 'Hello, {name}!'.length * 1.3, 'visibly expanded past the ~30% target');
  // resolved through the SAME formatMessage the real Locale class uses — proves the token wasn't
  // mangled by accenting/expansion, just the literal text around it
  assert.equal(formatMessage(out, { name: 'X' }).includes('X'), true);
});

test('pseudoLocalizeTemplate: a plural selector keeps its branches intact and still selects correctly', () => {
  const template = '{n, plural, one{# villager} other{# villagers}}';
  const out = pseudoLocalizeTemplate(template);
  assert.ok(formatMessage(out, { n: 1 }).includes('1 villager') && !formatMessage(out, { n: 1 }).includes('villagers'));
  assert.ok(formatMessage(out, { n: 5 }).includes('5 villagers'));
});

test('buildEnXaTable: transforms every value, keeps every key', () => {
  const table = { 'a.b': 'Hello', 'c.d': 'World' };
  const xa = buildEnXaTable(table);
  assert.deepEqual(Object.keys(xa).sort(), ['a.b', 'c.d']);
  assert.notEqual(xa['a.b'], table['a.b']);
});

test('buildTranslatorPack: merges sources, tags context, sorts by key', () => {
  const pack = buildTranslatorPack([
    { context: 'content:event', table: { 'z.last': 'Z', 'a.first': 'A' } },
    { context: 'app:ui-chrome', table: { 'm.mid': 'M' } },
  ]);
  assert.deepEqual(
    pack.map((e) => e.key),
    ['a.first', 'm.mid', 'z.last'],
  );
  assert.deepEqual(pack[0], { key: 'a.first', english: 'A', context: 'content:event' });
  assert.deepEqual(pack[1], { key: 'm.mid', english: 'M', context: 'app:ui-chrome' });
});
