import { Terminal } from 'lucide-react';
import { RunDesk } from '../runs/RunDesk';
import { Attention } from '../attention/Attention';
import type { UiChatDetails, UiRun } from '../../lib/api';

type Props = {
  chat: UiChatDetails['chat'];
  activeRun?: UiRun;
};

export function ChatRunTools(props: Props) {
  return (
    <details className="k-run-context" open={props.activeRun ? true : undefined}>
      <summary>
        <Terminal size={16} />
        Terminal e execuções<small>{props.activeRun ? 'Em execução' : 'Abrir ferramentas'}</small>
      </summary>
      <p className="history-note">
        As respostas e interações do Dot aparecem no terminal real. Salvar uma mensagem não inicia
        uma execução.
      </p>
      <Attention />
      <RunDesk chat={props.chat} />
    </details>
  );
}
