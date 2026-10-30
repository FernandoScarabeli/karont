import { FormDialog } from '../../components/FormDialog';
import type { UiChatDetails, UiDot, UiMovePreview, UiWorkspaceProject } from '../../lib/api';

type Props = {
  open: boolean;
  chat: UiChatDetails;
  dots: UiDot[];
  moveProjects: UiWorkspaceProject[];
  moveProjectId: string;
  setMoveProjectId(value: string): void;
  moveDotId: string;
  setMoveDotId(value: string): void;
  movePreview?: UiMovePreview;
  moveError: string;
  setMoveOpen(value: boolean): void;
  confirmMove(): void;
};

export function ChatMoveDialog(props: Props) {
  return (
    <FormDialog
      open={props.open}
      title="Vincular conversa a projeto"
      onClose={() => props.setMoveOpen(false)}
    >
      <div className="move-preview-form">
        <dl className="move-facts">
          <div>
            <dt>Conversa</dt>
            <dd>{props.chat.chat.title}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>
              {props.chat.origin.workspaceName ?? 'Global'}
              {props.chat.origin.projectName
                ? ` / ${props.chat.origin.projectName}`
                : ' / Conversa livre'}
            </dd>
          </div>
        </dl>
        <label>
          Projeto de destino
          <select
            value={props.moveProjectId}
            onChange={(event) => props.setMoveProjectId(event.target.value)}
          >
            <option value="">Selecione um projeto</option>
            {props.moveProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {!props.chat.chat.dotId && (
          <label>
            Dot para esta conversa
            <select
              value={props.moveDotId}
              onChange={(event) => props.setMoveDotId(event.target.value)}
            >
              <option value="">Selecione um Dot autorizado</option>
              {props.moveProjects
                .find((project) => project.id === props.moveProjectId)
                ?.dotIds.map((dotId) => (
                  <option key={dotId} value={dotId}>
                    {props.dots.find((dot) => dot.id === dotId)?.name ?? dotId}
                  </option>
                ))}
            </select>
          </label>
        )}
        {props.chat.chat.dotId && (
          <p>
            Dot:{' '}
            {props.dots.find((dot) => dot.id === props.chat.chat.dotId)?.name ??
              props.chat.chat.dotId}
            . A concessão será conferida no destino.
          </p>
        )}
        {props.movePreview && (
          <div className="move-preview-card">
            <p>
              <strong>Destino:</strong> {props.movePreview.destinationWorkspaceName} /{' '}
              {props.movePreview.destinationProjectName}
            </p>
            <p>
              <strong>Dot:</strong> {props.movePreview.dotName ?? 'nenhum'}
            </p>
            <p>
              {props.movePreview.canMove
                ? 'O histórico, o ID e o favorito serão preservados. As mensagens antigas não serão enviadas.'
                : props.movePreview.hasNonterminalRun
                  ? 'A conversa tem uma execução não terminal vinculada e não pode ser movida.'
                  : props.movePreview.authorized
                    ? 'Somente conversas livres podem ser movidas para projeto.'
                    : 'Este Dot não tem concessão para o projeto de destino.'}
            </p>
          </div>
        )}
        {props.moveError && (
          <p role="alert" className="workspace-error">
            {props.moveError}
          </p>
        )}
        <div className="dialog-actions">
          <button className="quiet" onClick={() => props.setMoveOpen(false)}>
            Cancelar
          </button>
          <button
            className="primary"
            disabled={!props.movePreview?.canMove}
            onClick={() => void props.confirmMove()}
          >
            Confirmar movimentação
          </button>
        </div>
      </div>
    </FormDialog>
  );
}
