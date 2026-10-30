import path from 'node:path';
import { spawn } from 'node:child_process';
import { attachedRuns, client, runStates, state } from './state';
import { notify } from './notify';
import { updateTray } from './tray';

export async function ensureDaemon() {
  try {
    await client.request({ method: 'ping' });
    return;
  } catch {
    // Daemon ainda não está rodando: inicia um abaixo.
  }
  const child = spawn(
    process.env.EROS_NODE_BINARY || 'node',
    [path.join(__dirname, '../daemon/entry.cjs')],
    { detached: true, stdio: 'ignore' },
  );
  child.on('error', (e) => console.error('Daemon:', e.message));
  child.unref();
  for (let n = 0; n < 40; n++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await client.request({ method: 'ping' });
      return;
    } catch {
      // Ainda subindo: tenta de novo (até 40 × 100 ms).
    }
  }
  throw Error('Daemon indisponível. Verifique Node >=24 e os diretórios privados.');
}

async function refreshHealth() {
  try {
    await client.request({ method: 'ping' });
    const runs = await client.request<{ id: string; state: string; sessionId: string | null }[]>({
      method: 'runs.list',
      value: { limit: 100 },
    });
    for (const run of runs) {
      if (run.state === 'recovery_needed')
        notify(`recovery:${run.id}:${run.sessionId}`, 'Recuperação necessária', run.id);
      if (runStates.get(run.id) === 'recovery_needed' && run.state === 'running')
        notify(`resumed:${run.id}:${run.sessionId}`, 'Execução retomada em nova sessão', run.id);
      if (
        ['running', 'queued'].includes(runStates.get(run.id) ?? '') &&
        ['completed', 'failed'].includes(run.state)
      )
        notify(
          `run:${run.id}:${run.state}`,
          run.state === 'completed' ? 'Execução concluída' : 'Execução com erro',
          run.id,
        );
    }
    runStates.clear();
    for (const run of runs) runStates.set(run.id, run.state);
    if (!state.connected && state.win && !state.win.isDestroyed())
      for (const runId of attachedRuns)
        await client.request({ method: 'terminal.attach', value: { runId } });
    state.connected = true;
    updateTray();
  } catch {
    if (state.connected) notify(`daemon:${Date.now()}`, 'Conexão com daemon interrompida');
    state.connected = false;
    state.lastFailure = 'Conexão com daemon interrompida';
  }
}

let heartbeat: NodeJS.Timeout;

export async function startHeartbeat() {
  await refreshHealth();
  let checking = false;
  heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void refreshHealth().finally(() => {
      checking = false;
    });
  }, 2000);
}

export function stopHeartbeat() {
  clearInterval(heartbeat);
}
