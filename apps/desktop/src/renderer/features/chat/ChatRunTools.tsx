import type { RefObject } from 'react';
import { ChatRunPanel } from '../runs/ChatRunPanel';
import type { UiChatDetails } from '../../lib/api';

type Props = {
  chat: UiChatDetails['chat'];
  open: boolean;
  onClose(): void;
  panelRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function ChatRunTools(props: Props) {
  return (
    <ChatRunPanel
      chat={props.chat}
      open={props.open}
      onClose={props.onClose}
      panelRef={props.panelRef}
      triggerRef={props.triggerRef}
    />
  );
}
