// Dev/build config for the browser client (roadmap M6). Not compiled by tsc -b;
// Vite executes it directly. Aliases point at package SOURCE for instant HMR.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  root: 'packages/app',
  // roadmap M44: manifest.webmanifest, icon.svg, sw.js (packages/app/public/) — served as-is,
  // copied verbatim into dist-web on build (Vite's own publicDir passthrough, TDD §11).
  publicDir: 'public',
  resolve: {
    alias: {
      '@crowns/core': pkg('core'),
      '@crowns/data': pkg('data'),      // ← add this line
      '@crowns/protocol': pkg('protocol'),
      '@crowns/sim': pkg('sim'),
      '@crowns/render': pkg('render'),
      '@crowns/ui': pkg('ui'),
      '@crowns/audio': pkg('audio'),
      '@crowns/app': pkg('app'),
    },
  },
  // PORT env (when a harness assigns one) wins over the 5173 default, so dev tooling
  // that expects its assigned port to be honored (preview panels, CI) actually finds us.
  server: { port: process.env['PORT'] !== undefined ? Number(process.env['PORT']) : 5173 },
  build: { outDir: '../../dist-web', emptyOutDir: true, target: 'es2022' },
});
