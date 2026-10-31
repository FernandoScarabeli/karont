import type { BrowserWindow, Tray } from 'electron';
import { Client } from '../../../../packages/local/src/client';

export const client = new Client();

export const state = {
  win: null as BrowserWindow | null,
  headless: false,
  connected: true,
  lastFailure: 'Não verificado',
  trayAvailable: false,
  targetRun: undefined as string | undefined,
  tray: null as Tray | null,
};

export const attachedRuns = new Set<string>();
export const runStates = new Map<string, string>();
export const pendingResumes = new Set<string>();

export const rendererSinks = new Set<(channel: string, value: unknown) => void>();

export function sendToRenderer(channel: string, value: unknown) {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send(channel, value);
  for (const sink of rendererSinks) sink(channel, value);
}
