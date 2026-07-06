// Dev/build config for the browser client (roadmap M6). Not compiled by tsc -b;
// Vite executes it directly. Aliases point at package SOURCE for instant HMR.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  root: 'packages/app',
  publicDir: false,
  resolve: {
    alias: {
      '@crowns/core': pkg('core'),
      '@crowns/data': pkg('data'),      // ← add this line
      '@crowns/protocol': pkg('protocol'),
      '@crowns/sim': pkg('sim'),
      '@crowns/render': pkg('render'),
      '@crowns/ui': pkg('ui'),
      '@crowns/app': pkg('app'),
    },
  },
  server: { port: 5173 },
  build: { outDir: '../../dist-web', emptyOutDir: true, target: 'es2022' },
});
