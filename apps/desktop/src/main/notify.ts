import { app, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { TerminalEvent } from '../../../../packages/contracts/src';
import { NotificationCenter } from './notifications';
import { client, pendingResumes, runStates, state } from './state';
import { openWindow } from './window';
import { updateTray } from './tray';

export function preferencesPath() {
  return path.join(app.getPath('userData'), 'attention.json');
}

export const notifications = new NotificationCenter((title, click, fail) => {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title,
    body: 'Abra o Karont para consultar os detalhes.',
    silent: false,
  });
  notification.on('click', click);
  notification.on('failed', fail);
  notification.show();
  return true;
});

try {
  notifications.enabled = JSON.parse(fs.readFileSync(preferencesPath(), 'utf8')).enabled !== false;
} catch {
  // Sem preferência salva (ou arquivo inválido): mantém o padrão do NotificationCenter.
}

export function notify(key: string, title: string, runId?: string) {
  notifications.notify(key, title, () => {
    state.targetRun = runId;
    void openWindow().then(() => {
      if (runId) state.win?.webContents.send('karont:focus-run', runId);
    });
  });
}

client.onEvent((event: TerminalEvent) => {
  if (event.type === 'continuity.notice') {
    const titles = {
      'quota.confirmed': 'Limite temporário confirmado',
      'auto_resume.scheduled': 'Auto Resume agendado',
      'run.resumed': 'Execução retomada',
      'resume.failed': 'Retomada falhou',
    };
    notify(`continuity:${event.eventId}`, titles[event.kind], event.runId);
  }
  if (event.type === 'run.updated') {
    const run = event.run;
    if (runStates.get(run.id) === 'recovery_needed' && run.state === 'queued')
      pendingResumes.add(run.id);
    if (pendingResumes.has(run.id) && run.state === 'running') {
      notify(`resumed:${run.id}:${run.sessionId}`, 'Execução retomada em nova sessão', run.id);
      pendingResumes.delete(run.id);
    }
    if (run.state === 'recovery_needed') {
      notify(`recovery:${run.id}:${run.sessionId}`, 'Recuperação necessária', run.id);
      if (pendingResumes.delete(run.id))
        notify(`resume-failed:${run.id}:${run.sessionId}`, 'Retomada falhou', run.id);
    }
    runStates.set(run.id, run.state);
    updateTray();
    if (['completed', 'failed'].includes(run.state))
      notify(
        `run:${run.id}:${run.state}`,
        run.state === 'completed' ? 'Execução concluída' : 'Execução com erro',
        run.id,
      );
  }
  if (event.type === 'approval.updated' && ['applied', 'failed'].includes(event.approval.status))
    notify(
      `rollback:${event.approval.id}`,
      event.approval.status === 'applied' ? 'Rollback concluído' : 'Rollback falhou',
      event.approval.runId,
    );
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('karont:event', event);
});
