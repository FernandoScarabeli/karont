import type { PermissionMode } from '../../../../../../packages/contracts/src';

export const modeLabels: Record<PermissionMode, string> = {
  ask: 'Pedir aprovação',
  auto: 'Aprovar por mim',
  full: 'Acesso total',
  readOnly: 'Somente leitura',
};
