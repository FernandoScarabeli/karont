import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { DotConfig } from './database';
import type { PermissionMode } from '../../../packages/contracts/src';

const probes = new Map<string, { native: boolean; auto: boolean }>();

// Never infer an adapter from an executable basename or from terminal output.
export function capabilities(dot: DotConfig) {
  let native = false,
    auto = false;
  if (dot.adapter === 'codex' && dot.args.length === 0) {
    try {
      const stat = fs.statSync(dot.executable);
      const key = JSON.stringify([
        dot.executable,
        stat.dev,
        stat.ino,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
      ]);
      const cached = probes.get(key);
      if (cached) {
        native = cached.native;
        auto = cached.auto;
      } else {
        const help = execFileSync(dot.executable, ['--help'], {
          encoding: 'utf8',
          timeout: 250,
          killSignal: 'SIGKILL',
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
          maxBuffer: 128 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        native = [
          '--sandbox',
          '--ask-for-approval',
          'read-only',
          'workspace-write',
          'danger-full-access',
          'on-request',
          'never',
        ].every((flag) => help.includes(flag));
        auto = native && help.includes('--approve-for-me');
        if (probes.size >= 16) probes.delete(probes.keys().next().value!);
        probes.set(key, { native, auto });
      }
    } catch {
      // CLI ausente, lenta ou sem --help: nenhuma capacidade é marcada como validada.
    }
  }
  return (['ask', 'auto', 'full', 'readOnly'] as PermissionMode[]).map((mode) => ({
    mode,
    status:
      mode === 'auto' && !auto
        ? ('unavailable' as const)
        : native
          ? ('available' as const)
          : mode === 'ask' && dot.adapter === 'generic'
            ? ('partial' as const)
            : ('unavailable' as const),
    detail:
      mode === 'auto' && !auto
        ? 'Automação nativa de aprovações não validada neste perfil.'
        : native
          ? mode === 'readOnly'
            ? 'Sandbox nativo read-only, sem escalonamento. Restringe comandos gerados; MCP, hooks e ferramentas externas exigem revisão própria. Não isola todo o processo.'
            : mode === 'auto'
              ? 'Revisão automática nativa do Codex em workspace-write. Sem botões de aprovação no Karont.'
              : mode === 'full'
                ? 'Sandbox de comandos desativado. Acesso aos arquivos da conta e à rede; exige confirmação por execução.'
                : 'Sandbox nativo workspace-write e aprovação on-request na CLI; ela decide quando perguntar. Worktree não é sandbox.'
          : mode === 'ask' && dot.adapter === 'generic'
            ? 'Sem garantia do Karont: usa a política já configurada na CLI. Aprovações ficam no terminal; worktree não é sandbox.'
            : 'Sem mecanismo efetivo validado. Codex exige perfil explícito, args vazio e opções compatíveis.',
  }));
}
export function permissionArgs(
  dot: DotConfig,
  mode: PermissionMode,
  confirmed: boolean,
  caps = capabilities(dot),
) {
  if (!caps.some((cap) => cap.mode === mode && cap.status !== 'unavailable'))
    throw Error('Modo de permissão indisponível');
  if (mode === 'full' && !confirmed) throw Error('Acesso total exige confirmação consciente');
  if (dot.adapter === 'generic') return [...dot.args];
  // No user arguments/config overrides can follow or replace these policy flags.
  if (dot.args.length) throw Error('Argumentos incompatíveis com perfil de permissão');
  return mode === 'auto'
    ? ['--approve-for-me']
    : mode === 'readOnly'
      ? ['--sandbox', 'read-only', '--ask-for-approval', 'never']
      : mode === 'full'
        ? ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never']
        : ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'];
}
