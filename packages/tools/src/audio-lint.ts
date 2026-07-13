/**
 * Placeholder purge lint (roadmap M41; doc 10 §3, doc 12 M45 gate).
 *
 *   node packages/tools/dist/audio-lint.js [--with-examples] [--release]
 *
 * Doc 10 §3: "build warns if TEMP_ assets remain at release profile." This
 * is that build lint: every `AudioCueDef`/`MusicPlaylistDef` with
 * `placeholder: true` is real synthesized audio (packages/audio), never a
 * missing/broken asset — so this never blocks a dev build. In `--release`
 * mode it becomes the M45 exit gate ("zero TEMP_/placeholder in release
 * profile", doc 12): any placeholder surviving to a release build fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { DefinitionDatabase } from '@crowns/data';

const withExamples = process.argv.includes('--with-examples');
const release = process.argv.includes('--release');

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

const sources = [{ files: readTree('content/base') }];
if (withExamples) {
  for (const name of readdirSync('content/examples').sort()) {
    sources.push({ files: readTree(`content/examples/${name}`) });
  }
}

const { db } = DefinitionDatabase.loadMods(sources);
const placeholderCues = [...db.audioCues.values()].filter((c) => c.placeholder);
const placeholderPlaylists = [...db.musicPlaylists.values()].filter((p) => p.placeholder);
const total = placeholderCues.length + placeholderPlaylists.length;

for (const c of placeholderCues) console.log(`PLACEHOLDER cue      ${c.id} (${c.event})`);
for (const p of placeholderPlaylists) console.log(`PLACEHOLDER playlist ${p.id} (${p.tension})`);
console.log(`${total} placeholder audio asset(s) — ${db.audioCues.size} cues, ${db.musicPlaylists.size} playlists total`);

if (total > 0) {
  if (release) {
    console.error(`FAIL: ${total} placeholder audio asset(s) in a release build (doc 12 M45 gate)`);
    process.exitCode = 1;
  } else {
    console.warn(`warning: ${total} placeholder audio asset(s) — expected in dev, must be zero before release (doc 10 §3)`);
  }
}
