import type { PermissionMode } from '../../../../../../packages/contracts/src';

export const modeLabels: Record<PermissionMode, string> = {
  ask: 'Pedir aprovação',
  auto: 'Aprovar por mim',
  full: 'Acesso total',
  readOnly: 'Somente leitura',
};

export const runStateLabels = {
  queued: 'Na fila',
  running: 'Rodando',
  paused: 'Agendamento pausado',
  waiting_quota: 'Aguardando limite',
  waiting_approval: 'Aguardando aprovação',
  recovery_needed: 'Recuperação necessária',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
} as const;
