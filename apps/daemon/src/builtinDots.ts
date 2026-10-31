import fs from 'node:fs';
import path from 'node:path';
import { dotSchema } from '../../../packages/contracts/src';
import type { DotConfig } from './database';

export const TERMINAL_DOT_ID = 'terminal';

function isExecutable(file: string | undefined): file is string {
  if (!file || !path.isAbsolute(file)) return false;
  try {
    const stat = fs.statSync(file);
    fs.accessSync(file, fs.constants.X_OK);
    return stat.isFile();
  } catch {
    return false;
  }
}

const executable = [process.env.SHELL, '/bin/bash'].find(isExecutable) ?? '/bin/sh';

export const builtinDots: DotConfig[] = [
  {
    ...dotSchema.parse({
      id: TERMINAL_DOT_ID,
      name: 'Terminal',
      role: 'Terminal do sistema, sem IA. Você digita os comandos.',
      executable,
      args: [],
      adapter: 'generic',
      autoResume: false,
      projectIds: [],
    }),
    source: 'builtin',
  },
];
