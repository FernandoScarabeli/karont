import { app } from 'electron';
import path from 'node:path';
import { migrateLegacyDirs } from '../../../../packages/local/src/paths';

export const started = performance.now();

for (const flag of [
  'no-sandbox',
  'disable-seccomp-filter-sandbox',
  'disable-namespace-sandbox',
  'disable-setuid-sandbox',
  'disable-gpu-sandbox',
  'single-process',
]) {
  if (app.commandLine.hasSwitch(flag))
    throw Error(`Karont exige sandbox Chromium ativo; flag recusada: ${flag}`);
}

app.setName('karont');
migrateLegacyDirs();
app.setPath(
  'userData',
  process.env.KARONT_DESKTOP_DATA ||
    process.env.EROS_DESKTOP_DATA ||
    path.join(app.getPath('appData'), 'karont'),
);
