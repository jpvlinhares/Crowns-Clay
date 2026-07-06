// Removes the offline-bootstrap ambient shims once the real packages exist.
// The repo typechecks with zero installed dependencies (constrained/offline
// environments); after `npm install`, genuine types from pixi.js / @types/node
// take over and the shims would conflict — so they self-delete here.
import { existsSync, rmSync } from 'node:fs';

const drop = (condition, paths) => {
  if (!condition) return;
  for (const p of paths) {
    if (existsSync(p)) {
      rmSync(p);
      console.log(`postinstall: removed bootstrap shim ${p}`);
    }
  }
};

drop(existsSync('node_modules/pixi.js'), ['packages/render/src/pixi-shims.d.ts']);
drop(existsSync('node_modules/@types/node'), [
  'packages/core/src/node-shims.d.ts',
  'packages/sim/src/node-shims.d.ts',
  'packages/render/src/node-shims.d.ts',
  'packages/tools/src/node-shims.d.ts',
]);
