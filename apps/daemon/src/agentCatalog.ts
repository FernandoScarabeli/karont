import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  agentAddSchema,
  agentSchema,
  dotSchema,
  type Agent,
} from '../../../packages/contracts/src';
import { paths, privateDir, privateFile } from '../../../packages/local/src/paths';
import type { DotConfig } from './database';
import { builtinDots } from './builtinDots';

export const knownAgents = [
  { id: 'cli-claude', name: 'Claude Code', executable: 'claude', adapter: 'generic' },
  { id: 'cli-codex', name: 'Codex', executable: 'codex', adapter: 'codex' },
  { id: 'cli-gemini', name: 'Gemini CLI', executable: 'gemini', adapter: 'generic' },
  { id: 'cli-opencode', name: 'OpenCode', executable: 'opencode', adapter: 'generic' },
  { id: 'cli-aider', name: 'Aider', executable: 'aider', adapter: 'generic' },
  { id: 'cli-cursor-agent', name: 'Cursor Agent', executable: 'cursor-agent', adapter: 'generic' },
  { id: 'cli-qwen', name: 'Qwen Code', executable: 'qwen', adapter: 'generic' },
  { id: 'cli-goose', name: 'Goose', executable: 'goose', adapter: 'generic' },
  { id: 'cli-amp', name: 'Amp', executable: 'amp', adapter: 'generic' },
  { id: 'cli-crush', name: 'Crush', executable: 'crush', adapter: 'generic' },
] as const;

type SearchOptions = {
  home?: string;
  pathValue?: string;
  systemDirs?: string[];
};

type CustomAgent = {
  id: string;
  name: string;
  executable: string;
  args: string[];
};

const agentsFileSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._-]+$/),
    name: z.string().min(1).max(80),
    executable: z.string().min(1).max(4096).refine(path.isAbsolute),
    args: z
      .array(
        z
          .string()
          .max(2048)
          .refine((arg) => !arg.includes('\0')),
      )
      .max(32),
  })
  .strict();
const agentsConfigSchema = z
  .object({ version: z.literal(1), agents: z.array(agentsFileSchema).max(32) })
  .strict();

export function executablePath(file: string | undefined): string | undefined {
  if (!file || !path.isAbsolute(file)) return undefined;
  try {
    const target = fs.realpathSync(file);
    if (!fs.statSync(target).isFile()) return undefined;
    fs.accessSync(target, fs.constants.X_OK);
    return target;
  } catch {
    return undefined;
  }
}

function nodeVersionCompare(a: string, b: string) {
  const parse = (value: string) =>
    value
      .match(/^v?(\d+)\.(\d+)\.(\d+)/)
      ?.slice(1)
      .map(Number);
  const left = parse(a);
  const right = parse(b);
  if (left && right) {
    for (let index = 0; index < 3; index++) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
  }
  return b.localeCompare(a, undefined, { numeric: true });
}

function nodeBinDirectories(home: string) {
  try {
    return fs
      .readdirSync(path.join(home, '.nvm', 'versions', 'node'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(nodeVersionCompare)
      .map((version) => path.join(home, '.nvm', 'versions', 'node', version, 'bin'));
  } catch {
    return [];
  }
}

export function resolveExecutable(command: string, options: SearchOptions = {}) {
  if (path.isAbsolute(command)) return executablePath(command);
  if (!command || command.includes('/') || command.includes('\0')) return undefined;

  const home = options.home ?? os.homedir();
  const homeDirectories = [
    '.local/bin',
    'bin',
    '.npm-global/bin',
    '.bun/bin',
    '.cargo/bin',
    '.claude/local',
  ].map((entry) => path.join(home, entry));
  const pathDirectories = (options.pathValue ?? process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => path.isAbsolute(entry));
  const directories = [
    ...pathDirectories,
    ...homeDirectories,
    ...(options.systemDirs ?? ['/usr/local/bin', '/usr/bin']),
    ...nodeBinDirectories(home),
  ];
  for (const directory of new Set(directories)) {
    const found = executablePath(path.join(directory, command));
    if (found) return found;
  }
  return undefined;
}

export function createDetectedAgents(options: SearchOptions = {}) {
  return knownAgents.map((entry) => {
    const executable = resolveExecutable(entry.executable, options);
    return agentSchema.parse({
      id: entry.id,
      name: entry.name,
      executable: executable ?? entry.executable,
      source: 'detected',
      available: Boolean(executable),
    });
  });
}

function safeNameKey(name: string) {
  return name.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function customId(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `custom-${(slug || 'agent').slice(0, 73).replace(/-+$/g, '') || 'agent'}`;
}

function summary(dot: DotConfig, source: Agent['source'], available: boolean): Agent {
  return agentSchema.parse({
    id: dot.id,
    name: dot.name,
    executable: dot.executable,
    source,
    available,
  });
}

function dedupe<T extends { id: string }>(items: T[]) {
  const ids = new Set<string>();
  return items.filter((item) => {
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
}

export class AgentCatalog {
  private detectedCache?: { at: number; agents: Agent[] };

  constructor(
    private file = paths().agents,
    private searchOptions: SearchOptions = {},
    private now = Date.now,
  ) {}

  detected(force = false) {
    if (!force && this.detectedCache && this.now() - this.detectedCache.at < 30_000)
      return this.detectedCache.agents;
    // KARONT_DETECT_AGENTS=0 desliga a detecção: os testes não podem depender das CLIs da máquina.
    const agents =
      process.env.KARONT_DETECT_AGENTS === '0' ? [] : createDetectedAgents(this.searchOptions);
    this.detectedCache = { at: this.now(), agents };
    return agents;
  }

  private custom() {
    if (!fs.existsSync(this.file)) return [] as CustomAgent[];
    try {
      privateFile(this.file);
      const value = agentsConfigSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      return value.agents;
    } catch (error) {
      throw Error('Agente: arquivo agents.json inválido ou sem permissão privada', {
        cause: error,
      });
    }
  }

  private saveCustom(agents: CustomAgent[]) {
    const temporary = `${this.file}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
    let fd: number | undefined;
    try {
      privateDir(path.dirname(this.file));
      fd = fs.openSync(
        temporary,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600,
      );
      fs.writeFileSync(fd, `${JSON.stringify({ version: 1, agents }, null, 2)}\n`, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.file);
      fs.chmodSync(this.file, 0o600);
      privateFile(this.file);
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      fs.rmSync(temporary, { force: true });
      throw Error('Agente: não foi possível salvar agents.json', { cause: error });
    }
  }

  list(configuredDots: DotConfig[]) {
    const configAgents = configuredDots.map((dot) =>
      summary(dot, 'config', Boolean(executablePath(dot.executable))),
    );
    const customAgents = this.custom().map((agent) =>
      agentSchema.parse({
        id: agent.id,
        name: agent.name,
        executable: agent.executable,
        source: 'custom',
        available: Boolean(executablePath(agent.executable)),
      }),
    );
    const terminal = builtinDots.map((dot) =>
      summary(dot, 'builtin', Boolean(executablePath(dot.executable))),
    );
    const agents = dedupe([...configAgents, ...this.detected(), ...customAgents, ...terminal]);
    if (agents.length > 32) throw Error('Agente: limite de 32 agentes atingido');
    return { agents };
  }

  dots(configuredDots: DotConfig[], forceDetection = false) {
    const detected = forceDetection ? this.detected(true) : this.detected();
    const custom = this.custom();
    const candidates: DotConfig[] = [
      ...configuredDots,
      ...detected
        .filter((agent) => agent.available)
        .map((agent) => {
          const known = knownAgents.find((entry) => entry.id === agent.id);
          if (!known) throw Error(`Agente: CLI detectada sem entrada no catálogo (${agent.id})`);
          return {
            ...dotSchema.parse({
              id: agent.id,
              name: agent.name,
              role: `Agente ${agent.name} de linha de comando.`,
              executable: agent.executable,
              args: [],
              adapter: known.adapter,
              autoResume: false,
              projectIds: [],
            }),
            source: 'detected' as const,
          };
        }),
      ...custom.map((agent) => ({
        ...dotSchema.parse({
          id: agent.id,
          name: agent.name,
          role: `Agente ${agent.name} de linha de comando.`,
          executable: agent.executable,
          args: agent.args,
          adapter: 'generic',
          autoResume: false,
          projectIds: [],
        }),
        source: 'custom' as const,
      })),
      ...builtinDots,
    ];
    const dots = dedupe(candidates);
    if (dots.length > 32) throw Error('Agente: limite de 32 Dots atingido');
    return dots;
  }

  add(input: unknown, configuredDots: DotConfig[]) {
    let parsed: ReturnType<typeof agentAddSchema.parse>;
    try {
      parsed = agentAddSchema.parse(input);
    } catch {
      throw Error('Agente: nome, comando ou argumentos inválidos');
    }
    const name = parsed.name.trim();
    if (parsed.args?.some((arg) => arg.includes('\0')))
      throw Error('Agente: argumentos não podem conter caracteres nulos');
    const executable = resolveExecutable(parsed.command, this.searchOptions);
    if (!executable) throw Error(`Agente: executável ausente ou sem permissão: ${parsed.command}`);
    const id = customId(name);
    const current = this.list(configuredDots).agents;
    const saved = this.custom();
    if (
      current.some((agent) => safeNameKey(agent.name) === safeNameKey(name)) ||
      saved.some((agent) => safeNameKey(agent.name) === safeNameKey(name))
    )
      throw Error(`Agente: o nome "${name}" já está cadastrado`);
    if (current.some((agent) => agent.id === id) || saved.some((agent) => agent.id === id))
      throw Error(`Agente: o ID "${id}" já está em uso`);
    if (current.length >= 32) throw Error('Agente: limite de 32 agentes atingido');
    const agent = { id, name, executable, args: parsed.args ?? [] };
    const nextDots = this.dots(configuredDots);
    if (nextDots.length >= 32) throw Error('Agente: limite de 32 Dots atingido');
    this.saveCustom([...saved, agent]);
    const added = this.list(configuredDots).agents.find((entry) => entry.id === id);
    if (!added) throw Error(`Agente: não foi possível confirmar o cadastro de ${name}`);
    return added;
  }

  remove(id: string, configuredDots: DotConfig[]) {
    const agents = this.custom();
    if (
      !agents.some((agent) => agent.id === id) ||
      this.list(configuredDots).agents.find((agent) => agent.id === id)?.source !== 'custom'
    )
      throw Error(`Agente: somente agentes personalizados podem ser removidos (${id})`);
    this.saveCustom(agents.filter((agent) => agent.id !== id));
    return { ok: true as const };
  }
}
