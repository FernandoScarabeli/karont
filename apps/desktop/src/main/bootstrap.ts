import { app } from 'electron';
import path from 'node:path';
import { migrateLegacyDirs } from '../../../../packages/local/src/paths';

export const started = performance.now();
let ready = false;

/**
 * Precisa ser a primeira chamada do processo principal: recusa flags que desligam o sandbox,
 * migra as pastas antigas e define o userData antes que o Electron ou outro módulo o use.
 */
export function bootstrap() {
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
  ready = true;
}

/** Pasta userData; falha alto se for pedida antes de bootstrap(), em vez de devolver a errada. */
export function userDataPath() {
  if (!ready) throw Error('userData pedido antes de bootstrap()');
  return app.getPath('userData');
}
