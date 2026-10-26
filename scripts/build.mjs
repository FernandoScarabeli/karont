import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { build as vite } from 'vite';
await build({
  entryPoints: {
    'daemon/entry': 'apps/daemon/src/entry.ts',
    'daemon/server': 'apps/daemon/src/server.ts',
    'desktop/main': 'apps/desktop/src/main.ts',
    'desktop/preload': 'apps/desktop/src/preload.ts',
    'local/client': 'packages/local/src/client.ts',
    'local/paths': 'packages/local/src/paths.ts',
    'local/report': 'packages/local/src/report.ts',
    'daemon/auto-resume': 'apps/daemon/src/auto-resume.ts',
    'daemon/continuity': 'apps/daemon/src/continuity.ts',
    'daemon/database': 'apps/daemon/src/database.ts',
    'daemon/runs': 'apps/daemon/src/runs.ts',
    'daemon/workspaces': 'apps/daemon/src/workspaces.ts',
    'daemon/permissions': 'apps/daemon/src/permissions.ts',
    'daemon/diagnostics': 'apps/daemon/src/diagnostics.ts',
    'desktop/notifications': 'apps/desktop/src/notifications.ts',
    'contracts/index': 'packages/contracts/src/index.ts',
  },
  define: {
    EROS_APP_VERSION: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
  },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'node-pty'],
  sourcemap: true,
});
await vite({
  root: 'apps/desktop',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
