/**
 * Content validation console (roadmap M10; doc 09 §3).
 *
 *   node packages/tools/dist/mod-check.js [--with-examples] [--watch]
 *
 * Validates the base content set (optionally layered with every example mod)
 * and prints the merge report: load order, disabled mods with reasons,
 * override winners, and patch attribution. --watch re-runs on any change under
 * content/ — the designer edit loop ("hot reload" for defs; browser HMR of
 * defs arrives with the in-game Mods screen, M39).
 *
 * NOTE: reads content/ from DISK (fresh), not the embedded snapshot — so the
 * console sees your edits before `npm run gen:content` re-embeds them.
 */
import { readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { DefinitionDatabase } from '@crowns/data';
declare const setTimeout: (fn: () => void, ms: number) => number;

const withExamples = process.argv.includes('--with-examples');
const watchMode = process.argv.includes('--watch');

function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = `${dir}/${name}`;
      if (statSync(p).isDirectory()) walk(p);
      else files[p.slice(root.length + 1)] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return files;
}

function run(): void {
  const sources = [{ files: readTree('content/base') }];
  if (withExamples) {
    for (const name of readdirSync('content/examples').sort()) {
      sources.push({ files: readTree(`content/examples/${name}`) });
    }
  }
  try {
    const { db, report } = DefinitionDatabase.loadMods(sources);
    console.log(`OK · layers: ${report.order.join(' → ')}`);
    console.log(`terrain: ${db.terrainByCode.map((t) => t.name).join(', ')}`);
    for (const d of report.disabled) console.log(`DISABLED ${d.id}: ${d.reasons.join('; ')}`);
    for (const o of report.overrides) console.log(`override ${o.defId}: ${o.layers.join(' -> ')} (winner ${o.winner})`);
    for (const p of report.patched) console.log(`patched  ${p.defId} by ${p.by.join(', ')}`);
  } catch (error) {
    console.error(`INVALID CONTENT\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = watchMode ? 0 : 1;
  }
}

run();
if (watchMode) {
  console.log('\nwatching content/ — edit a def to revalidate (ctrl-c to stop)');
  let pending = false;
  watch('content', { recursive: true }, () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      console.log('\n--- change detected ---');
      run();
    }, 120);
  });
}
