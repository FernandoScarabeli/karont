import os from 'node:os';
import { APP_VERSION, type DiagnosticItem } from '../../contracts/src';
// Defense in depth. Reports never ingest chats, terminal output, project/config data,
// environment dumps, arbitrary exceptions or user-supplied reproduction text.
export function sanitize(text: string) {
  let safe = text;
  for (const privateValue of [os.homedir(), os.userInfo().username, os.hostname()]
    .filter((v) => v.length > 1)
    .sort((a, b) => b.length - a.length))
    safe = safe.split(privateValue).join('[privado]');
  return safe
    .replace(
      /(?:Bearer\s+|(?:token|password|secret|api[_-]?key)\s*[:=]\s*)\S+/gi,
      '[credencial removida]',
    )
    .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[\w-]+/g, '[credencial removida]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[credencial removida]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email removido]')
    .replace(/(?:https?:\/\/|file:\/\/)[^\s<>]+/gi, '[endereço removido]')
    .replace(/(?<![\w])(?:[A-Z]:\\|\/)[^\s|<>]+/g, '[caminho removido]')
    .replace(/[\r\n|`<>]/g, ' ')
    .slice(0, 500);
}
export function issueReport(items: DiagnosticItem[]) {
  // Fixed labels are the only entry points. No arbitrary diagnostic extension is exported.
  const allowed = new Set([
    'Runtime',
    'IPC',
    'Kernel',
    'Distribuição',
    'RAM / CPU',
    'Git',
    'CLIs configuradas',
    'Keyring',
    'Último erro do daemon',
    'Aplicativo',
    'Sessão gráfica',
    'GPU',
    'Sandbox renderer',
    'Tray',
    'Notificações',
    'Conexão',
    'Última falha',
  ]);
  return (
    `# eros — relatório local\n\nVersão: ${APP_VERSION}\n\nNenhum envio automático. Conteúdo de chats, terminais, projetos e ambiente não incluído.\n\n| Componente | Estado | Diagnóstico |\n|---|---|---|\n` +
    items
      .filter((item) => allowed.has(item.label))
      .map((item) => `| ${sanitize(item.label)} | ${item.status} | ${sanitize(item.value)} |`)
      .join('\n') +
    '\n\n## Reprodução\n\n1. Descreva os passos sem dados privados.\n2. Resultado esperado:\n3. Resultado observado:\n'
  );
}
