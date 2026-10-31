import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DotConfig } from './database';
import { builtinDots } from './builtinDots';
import { APP_VERSION, type DiagnosticItem } from '../../../packages/contracts/src';
export function daemonDiagnostics(allDots: DotConfig[]): DiagnosticItem[] {
  // O Terminal embutido é o shell do sistema, não uma CLI configurada: fica fora da contagem
  // para o diagnóstico não dizer que há ferramentas quando o dots.json está vazio.
  const builtinIds = new Set(builtinDots.map((dot) => dot.id + '\0' + dot.executable));
  const dots = allDots.filter((dot) => !builtinIds.has(dot.id + '\0' + dot.executable));
  const items: DiagnosticItem[] = [];
  const add = (category: string, label: string, status: DiagnosticItem['status'], value: string) =>
    items.push({ category, label, status, value: value.slice(0, 500) });
  add(
    'Daemon',
    'Runtime',
    'available',
    `${APP_VERSION} · Node ${process.versions.node} · PID ${process.pid} · uptime ${Math.floor(process.uptime())}s`,
  );
  add(
    'Segurança',
    'IPC',
    'available',
    'Socket local autenticado; limite de confiança: mesmo UID. Revisão formal pendente.',
  );
  add('Sistema', 'Kernel', 'available', `${os.platform()} ${os.release()} ${os.arch()}`);
  try {
    const release = fs.readFileSync('/etc/os-release', 'utf8');
    const name = release.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1];
    add('Sistema', 'Distribuição', name ? 'available' : 'unavailable', name ?? 'Não detectada');
  } catch {
    add('Sistema', 'Distribuição', 'unavailable', 'os-release ausente');
  }
  add(
    'Recursos',
    'RAM / CPU',
    'available',
    `${(os.totalmem() / 1073741824).toFixed(2)} GiB · ${os.availableParallelism()} CPUs lógicas`,
  );
  try {
    const version = execFileSync('git', ['--version'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    add(
      'Ferramentas',
      'Git',
      'available',
      /^git version [\w. -]+$/.test(version) ? version : 'Encontrado',
    );
  } catch {
    add('Ferramentas', 'Git', 'unavailable', 'Git ausente ou não responde');
  }
  let found = 0;
  for (const dot of dots) {
    try {
      fs.accessSync(dot.executable, fs.constants.X_OK);
      found++;
    } catch {
      // Executável ausente ou sem permissão: só não entra na contagem de acessíveis.
    }
  }
  add(
    'Ferramentas',
    'CLIs configuradas',
    found ? 'available' : 'unavailable',
    `${found}/${dots.length} executáveis acessíveis; identidade e autenticação não verificadas`,
  );
  add(
    'Segurança',
    'Keyring',
    'unverified',
    'Karont não armazena credenciais de agentes; serviço não sondado.',
  );
  add(
    'Falhas',
    'Último erro do daemon',
    'unverified',
    'Sem coletor de crash durável nesta fase; consulte o estado das execuções.',
  );
  return items;
}
