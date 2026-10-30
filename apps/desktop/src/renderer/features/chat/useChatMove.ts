import { useEffect, useState } from 'react';
import type { UiChatDetails, UiMovePreview, UiWorkspaceProject } from '../../lib/api';
import type { useChatDraft } from './useChatDraft';

export function useChatMove(props: {
  chat: UiChatDetails;
  projects: UiWorkspaceProject[];
  draft: ReturnType<typeof useChatDraft>;
  onMoveComplete(chat: UiChatDetails): Promise<void>;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveProjects, setMoveProjects] = useState<UiWorkspaceProject[]>(props.projects);
  const [moveProjectId, setMoveProjectId] = useState('');
  const [moveDotId, setMoveDotId] = useState('');
  const [movePreview, setMovePreview] = useState<UiMovePreview>();
  const [moveError, setMoveError] = useState('');

  async function openMove() {
    setMoveError('');
    try {
      const page = await window.karont.projectIndex();
      const destinations = page.items.filter((project) => project.id !== props.chat.chat.projectId);
      setMoveProjects(destinations);
      setMoveProjectId(destinations[0]?.id ?? '');
      setMoveDotId(props.chat.chat.dotId ?? '');
      setMovePreview(undefined);
      setMoveOpen(true);
    } catch {
      setMoveError('Não foi possível carregar os projetos de destino.');
    }
  }

  useEffect(() => {
    if (!moveOpen || !moveProjectId) return;
    const dotId = props.chat.chat.dotId ?? moveDotId;
    if (!dotId) {
      setMovePreview(undefined);
      return;
    }
    let mounted = true;
    void window.karont
      .previewMoveChat(props.chat.chat.id, moveProjectId, dotId)
      .then((preview) => {
        if (mounted) setMovePreview(preview);
      })
      .catch(() => {
        if (mounted) setMovePreview(undefined);
      });
    return () => {
      mounted = false;
    };
  }, [moveOpen, moveProjectId, moveDotId, props.chat.chat.id, props.chat.chat.dotId]);

  async function confirmMove() {
    if (!movePreview?.canMove || !movePreview.dotId) return;
    setMoveError('');
    try {
      await props.draft.persistDraft(props.draft.draftRef.current);
      const moved = await window.karont.moveChat(
        props.chat.chat.id,
        movePreview.destinationProjectId,
        movePreview.dotId,
        props.draft.revisionRef.current,
      );
      props.draft.acceptChat(moved);
      setMoveOpen(false);
      await props.onMoveComplete(moved);
    } catch {
      setMoveError(
        'A movimentação foi recusada. Atualize a prévia e confira a revisão da conversa.',
      );
    }
  }

  return {
    moveOpen,
    setMoveOpen,
    moveProjects,
    moveProjectId,
    setMoveProjectId,
    moveDotId,
    setMoveDotId,
    movePreview,
    moveError,
    openMove,
    confirmMove,
  };
}
