/**
 * Golden-replay CLI (roadmap M5) — records and verifies determinism fixtures.
 *
 *   node packages/tools/dist/replay.js verify [scenario|all]     (default)
 *   node packages/tools/dist/replay.js record [scenario|all]
 *
 * Fixtures live in fixtures/golden/<scenario>.json and are committed. CI runs
 * `verify all` on every PR (ci.yml). A failure prints the first divergent tick,
 * bracketing the regression to a window of `hashEvery` ticks.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { recordReplay, verifyReplay, type ReplayRecord } from '@crowns/sim';
import { scenarios, scenarioByName } from '@crowns/app';

const FIXTURE_DIR = 'fixtures/golden';
const mode = process.argv[2] ?? 'verify';
const which = process.argv[3] ?? 'all';

const targets =
  which === 'all'
    ? scenarios
    : (() => {
        const s = scenarioByName(which);
        if (s === undefined) {
          console.error(`unknown scenario '${which}' — known: ${scenarios.map((x) => x.name).join(', ')}`);
          process.exitCode = 2;
          return [];
        }
        return [s];
      })();

const path = (name: string): string => `${FIXTURE_DIR}/${name}.json`;
const hex = (v: number): string => `0x${v.toString(16).padStart(8, '0')}`;

if (mode === 'record') {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const scenario of targets) {
    const record = recordReplay(scenario);
    writeFileSync(path(scenario.name), JSON.stringify(record, null, 2) + '\n');
    console.log(
      `recorded ${scenario.name}: ${record.ticks} ticks, ${record.samples.length} samples, final ${hex(record.finalHash)}`,
    );
  }
} else if (mode === 'verify') {
  let failures = 0;
  for (const scenario of targets) {
    if (!existsSync(path(scenario.name))) {
      console.error(`MISSING fixture for '${scenario.name}' — run: replay.js record ${scenario.name}`);
      failures++;
      continue;
    }
    const record = JSON.parse(readFileSync(path(scenario.name), 'utf8')) as ReplayRecord;
    const result = verifyReplay(scenario, record);
    if (result.ok) {
      console.log(`OK   ${scenario.name} · final ${hex(record.finalHash)}`);
    } else {
      failures++;
      console.error(
        `FAIL ${scenario.name} · ${result.reason} at tick ${result.tick} · expected ${hex(result.expected)} got ${hex(result.actual)}`,
      );
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} scenario(s) diverged. If the change is INTENTIONAL, re-record and explain in the PR.`);
    process.exitCode = 1;
  } else {
    console.log('\nall golden replays green — determinism contract holds (TDD §5)');
  }
} else {
  console.error(`unknown mode '${mode}' (use record|verify)`);
  process.exitCode = 2;
}
