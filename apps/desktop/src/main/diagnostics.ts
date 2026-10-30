import { Notification } from 'electron';
import { APP_VERSION, type DiagnosticItem } from '../../../../packages/contracts/src';
import { client, state } from './state';
import { notifications } from './notify';

export async function diagnostics(): Promise<DiagnosticItem[]> {
  let daemon: DiagnosticItem[];
  try {
    daemon = await client.request({ method: 'diagnostics' });
  } catch {
    daemon = [
      {
        category: 'Daemon',
        label: 'Conexão',
        status: 'error',
        value: 'Daemon indisponível; tente reconectar.',
      },
    ];
  }
  const prefs = state.win && !state.win.isDestroyed() ? { sandbox: true } : undefined;
  return [
    ...daemon,
    {
      category: 'Aplicativo',
      label: 'Aplicativo',
      status: 'available',
      value: `${APP_VERSION} · Electron ${process.versions.electron} · Node ${process.versions.node}`,
    },
    {
      category: 'Sistema',
      label: 'Sessão gráfica',
      status: process.env.WAYLAND_DISPLAY || process.env.DISPLAY ? 'available' : 'unverified',
      value: process.env.WAYLAND_DISPLAY
        ? 'Wayland (variável presente)'
        : process.env.DISPLAY
          ? 'X11 (variável presente)'
          : 'Não detectada',
    },
    {
      category: 'Recursos',
      label: 'GPU',
      status: 'unverified',
      value: 'Não sondada; diagnóstico leve',
    },
    {
      category: 'Segurança',
      label: 'Sandbox renderer',
      status: prefs?.sandbox === true ? 'available' : 'unverified',
      value:
        prefs?.sandbox === true
          ? 'Sandbox obrigatório e isolamento configurados; prova efetiva no E2E'
          : 'Sem renderer para inspecionar',
    },
    {
      category: 'Integração',
      label: 'Tray',
      status: state.trayAvailable ? 'available' : 'unavailable',
      value: state.trayAvailable
        ? 'Objeto Tray criado; visibilidade no compositor não verificada'
        : 'Tray indisponível',
    },
    {
      category: 'Integração',
      label: 'Notificações',
      status: Notification.isSupported() ? 'available' : 'unavailable',
      value: `Suporte declarado: ${Notification.isSupported()}; preferência: ${notifications.enabled ? 'ativa' : 'desativada'}; último envio: ${notifications.history.at(-1)?.status ?? 'não verificado'}. Não comprova visualização.`,
    },
    {
      category: 'Falhas',
      label: 'Última falha',
      status: state.lastFailure === 'Não verificado' ? 'unverified' : 'error',
      value: state.lastFailure,
    },
  ];
}
