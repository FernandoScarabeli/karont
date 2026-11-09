import { BridgeError, describeAgentError, type InboxItem } from "@karont/contract";
import { AlertTriangle } from "lucide-react";
import { lazy, type RefObject, Suspense, useEffect, useRef, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import type { ResponseInput } from "../conversation/ConversationParts.tsx";
import { formatMessageDateTime } from "../conversation/messageDate.ts";
import { t } from "../i18n/pt-BR.ts";
import { useNavigationActions } from "../navigation/NavigationContext.tsx";
import { focusAfterRemoval, inboxRemainder } from "../projects/inboxState.ts";
import { useProjects } from "../projects/useProjects.ts";
import { useWorkspaces } from "../projects/useWorkspaces.ts";
import styles from "./InboxList.module.css";

const InboxItemBody = lazy(async () => {
  const module = await import("./InboxItemBody.tsx");
  return { default: module.InboxItemBody };
});

/**
 * Quando o item com foco sai da lista, o foco vai para o próximo item ou, se a lista esvaziou,
 * para o primeiro destino disponível de `fallbacks` (o título). `rootRef` precisa estar sempre montado.
 */
export function useInboxFocus(
  items: readonly InboxItem[],
  rootRef: RefObject<HTMLElement | null>,
  fallbacks: ReadonlyArray<RefObject<HTMLElement | null>>,
) {
  const focusedId = useRef<string | null>(null);
  const previousIds = useRef<string[]>([]);
  const fallbacksRef = useRef(fallbacks);
  fallbacksRef.current = fallbacks;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (event: FocusEvent) => {
      const owner =
        event.target instanceof Element ? event.target.closest("[data-inbox-key]") : null;
      focusedId.current = owner?.getAttribute("data-inbox-key") ?? null;
    };
    const onFocusOut = (event: FocusEvent) => {
      const target = event.target;
      // Se o elemento continua na página, o usuário tirou o foco; se foi removido, o foco se perdeu.
      queueMicrotask(() => {
        if (target instanceof Node && target.isConnected && document.activeElement !== target) {
          if (!root.contains(document.activeElement)) focusedId.current = null;
        }
      });
    };
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [rootRef]);

  useEffect(() => {
    const ids = items.map((item) => item.id);
    const focused = focusedId.current;
    if (focused && !ids.includes(focused)) {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) {
        const target = focusAfterRemoval(previousIds.current, ids, focused);
        const element = target
          ? rootRef.current?.querySelector<HTMLElement>(`[data-inbox-item="${CSS.escape(target)}"]`)
          : null;
        const fallback = fallbacksRef.current.map((ref) => ref.current).find(Boolean);
        (element ?? fallback)?.focus({ preventScroll: false });
      }
      focusedId.current = null;
    }
    previousIds.current = ids;
  }, [items, rootRef]);
}

export function InboxList({
  items,
  total,
  label,
}: {
  items: readonly InboxItem[];
  total: number;
  label: string;
}) {
  const remainder = inboxRemainder(total, items.length);
  return (
    <>
      <ul aria-label={label} className={styles.list}>
        {items.map((item) => (
          <InboxEntry item={item} key={item.id} />
        ))}
      </ul>
      {remainder > 0 ? <p className={styles.remainder}>{t.inbox.remainder(remainder)}</p> : null}
    </>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof BridgeError && error.message ? error.message : fallback;
}

function InboxEntry({ item }: { item: InboxItem }) {
  const { navigate } = useNavigationActions();
  const { workspaces } = useWorkspaces();
  const { projects } = useProjects();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workspace = workspaces.find((entry) => entry.id === item.workspaceId);
  const project = item.projectId
    ? projects.find((entry) => entry.id === item.projectId)
    : undefined;
  const meta = [workspace?.name, project?.name].filter(Boolean).join(" · ");

  /** Roda a ação uma vez por vez; em falha, reabilita e mostra o erro no próprio item. */
  async function run(action: () => Promise<unknown>, fallback: string) {
    if (busy) return;
    const bridge = getBridge();
    if (!bridge) return;
    setBusy(true);
    setError("");
    try {
      await action();
      // Em sucesso o item sai quando `inbox.changed` chegar; até lá segue desabilitado.
    } catch (failure) {
      setError(errorMessage(failure, fallback));
      setBusy(false);
    }
  }

  const respond = (response: ResponseInput) =>
    run(async () => {
      await getBridge()?.request("conversation.respond", { id: item.conversationId, ...response });
    }, t.chat.responseFailed);

  const openConversation = () => navigate({ name: "conversation", id: item.conversationId });

  return (
    <li className={styles.item} data-inbox-key={item.id}>
      <div className={styles.head}>
        <AgentIcon agentId={item.agent} className={styles.agentIcon} />
        <button
          aria-label={t.inbox.openConversation(item.conversationTitle)}
          className={styles.title}
          data-inbox-item={item.id}
          onClick={openConversation}
          type="button"
        >
          {item.conversationTitle}
        </button>
        <time className={styles.time} dateTime={item.createdAt}>
          {formatMessageDateTime(item.createdAt)}
        </time>
      </div>
      {meta ? <p className={styles.meta}>{meta}</p> : null}
      <fieldset className={styles.body} disabled={busy}>
        {item.kind === "error" ? (
          <ErrorBody
            busy={busy}
            item={item}
            onDismiss={() =>
              run(
                () =>
                  getBridge()?.request("inbox.dismiss", { conversationId: item.conversationId }) ??
                  Promise.resolve(),
                t.inbox.dismissFailed,
              )
            }
            onRetry={() =>
              run(
                () =>
                  getBridge()?.request("conversation.retry", {
                    id: item.conversationId,
                    messageId: item.messageId,
                  }) ?? Promise.resolve(),
                t.inbox.retryFailed,
              )
            }
          />
        ) : (
          <Suspense fallback={null}>
            <InboxItemBody item={item} onAdjust={openConversation} onRespond={respond} />
          </Suspense>
        )}
      </fieldset>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ErrorBody({
  item,
  busy,
  onRetry,
  onDismiss,
}: {
  item: Extract<InboxItem, { kind: "error" }>;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const description = describeAgentError(item.part.text, item.agent);
  return (
    <div className={styles.errorBody}>
      <p className={styles.errorText}>
        <AlertTriangle aria-hidden="true" className={styles.errorIcon} size={16} />
        <span>{description.message}</span>
      </p>
      <div className={styles.actions}>
        {item.part.retryable ? (
          <Button disabled={busy} onClick={onRetry} variant="primary">
            {t.inbox.retry}
          </Button>
        ) : null}
        <Button disabled={busy} onClick={onDismiss} variant="secondary">
          {t.inbox.dismiss}
        </Button>
      </div>
    </div>
  );
}
