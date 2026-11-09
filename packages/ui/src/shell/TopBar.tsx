import { BridgeError, type Workspace } from "@karont/contract";
import { Ellipsis, House, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { getBridge } from "../bridge/index.ts";
import { ActionMenu, type ActionMenuItem } from "../components/ActionMenu/ActionMenu.tsx";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { useConversationIndex } from "../conversation/useConversationIndex.ts";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { getProjectIcon } from "../projects/projectIcons.ts";
import {
  removeWorkspaceFromStore,
  upsertWorkspace,
  useWorkspaces,
} from "../projects/useWorkspaces.ts";
import { WorkspaceDialog } from "../projects/WorkspaceDialog.tsx";
import { removalTarget, type WorkspaceMark, workspaceMarks } from "../projects/workspaceState.ts";
import { BrandMark } from "./BrandMark.tsx";
import styles from "./TopBar.module.css";

const tabActionsIcon = <Ellipsis aria-hidden="true" size={16} strokeWidth={1.8} />;

type TabMenu = { id: string; point?: { x: number; y: number } } | null;

type WorkspaceTabProps = {
  workspace: Workspace;
  active: boolean;
  mark: WorkspaceMark | undefined;
  menuOpen: boolean;
  anchorPoint: { x: number; y: number } | undefined;
  getMenuItems: (workspace: Workspace) => ActionMenuItem[];
  onSelect: (id: string) => void;
  onContextMenu: (id: string, point: { x: number; y: number }) => void;
  onMenuOpenChange: (id: string, open: boolean) => void;
  onRegister: (id: string, element: HTMLButtonElement | null) => void;
};

const WorkspaceTab = memo(function WorkspaceTab({
  workspace,
  active,
  mark,
  menuOpen,
  anchorPoint,
  getMenuItems,
  onSelect,
  onContextMenu,
  onMenuOpenChange,
  onRegister,
}: WorkspaceTabProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const Icon = getProjectIcon(workspace.icon);
  const statusText =
    mark === "waiting"
      ? t.shell.projectStatusWaiting
      : mark === "working"
        ? t.shell.projectStatusWorking
        : "";

  // Com muitas abas, a ativa nunca fica escondida pela rolagem.
  useEffect(() => {
    if (active) buttonRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  const register = useCallback(
    (element: HTMLButtonElement | null) => {
      buttonRef.current = element;
      onRegister(workspace.id, element);
    },
    [onRegister, workspace.id],
  );
  const getItems = useCallback(() => getMenuItems(workspace), [getMenuItems, workspace]);
  const changeMenu = useCallback(
    (open: boolean) => onMenuOpenChange(workspace.id, open),
    [onMenuOpenChange, workspace.id],
  );

  return (
    <div className={`${styles.tabItem} ${active ? styles.tabItemActive : ""}`}>
      <button
        aria-current={active ? "page" : undefined}
        aria-description={statusText || undefined}
        className={`${active ? styles.activeArea : styles.inactiveArea} ${styles.tabButton}`}
        onClick={() => onSelect(workspace.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(workspace.id, { x: event.clientX, y: event.clientY });
        }}
        ref={register}
        title={statusText ? `${workspace.name}, ${statusText}` : workspace.name}
        type="button"
      >
        <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
        <span className={styles.tabLabel}>{workspace.name}</span>
        {mark ? (
          <span
            aria-hidden="true"
            className={`${styles.statusDot} ${
              mark === "waiting" ? styles.statusNeedsYou : styles.statusWorking
            }`}
          />
        ) : null}
      </button>
      <ActionMenu
        anchorPoint={menuOpen ? anchorPoint : undefined}
        items={getItems}
        label={t.workspaces.tabActions(workspace.name)}
        onOpenChange={changeMenu}
        open={menuOpen}
        triggerClassName={styles.tabActions}
        triggerIcon={tabActionsIcon}
        triggerLabel={t.workspaces.tabActions(workspace.name)}
        triggerRef={actionRef}
      />
    </div>
  );
});

export function TopBar() {
  const { navigate, openWorkspace, view, activeWorkspaceId } = useNavigation();
  const bridge = getBridge();
  const { workspaces } = useWorkspaces();
  const { conversations } = useConversationIndex();
  const marks = useMemo(() => workspaceMarks(conversations), [conversations]);
  const [menu, setMenu] = useState<TabMenu>(null);
  const [dialog, setDialog] = useState<{ workspace: Workspace | null } | null>(null);
  const [toRemove, setToRemove] = useState<Workspace | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const plusRef = useRef<HTMLButtonElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement>(null);
  const removeReturnFocusRef = useRef<HTMLElement>(null);
  const removeCancelRef = useRef<HTMLButtonElement>(null);
  const canRemove = workspaces.length > 1;
  const target = toRemove ? removalTarget(workspaces, toRemove.id) : null;

  const registerTab = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) tabRefs.current.set(id, element);
    else tabRefs.current.delete(id);
  }, []);

  const openDialog = useCallback((workspace: Workspace | null) => {
    setMenu(null);
    dialogReturnFocusRef.current = workspace
      ? (tabRefs.current.get(workspace.id) ?? null)
      : plusRef.current;
    setDialog({ workspace });
  }, []);

  const requestRemove = useCallback((workspace: Workspace) => {
    setMenu(null);
    setRemoveError("");
    removeReturnFocusRef.current = tabRefs.current.get(workspace.id) ?? null;
    setToRemove(workspace);
  }, []);

  const getMenuItems = useCallback(
    (workspace: Workspace): ActionMenuItem[] => [
      {
        id: "rename",
        label: t.workspaces.rename,
        icon: <Pencil size={15} />,
        onSelect: () => openDialog(workspace),
      },
      {
        id: "remove",
        label: t.workspaces.remove,
        icon: <Trash2 size={15} />,
        danger: true,
        disabled: !canRemove,
        onSelect: () => requestRemove(workspace),
      },
    ],
    [canRemove, openDialog, requestRemove],
  );

  const openContextMenu = useCallback(
    (id: string, point: { x: number; y: number }) => setMenu({ id, point }),
    [],
  );
  const changeMenu = useCallback((id: string, open: boolean) => {
    setMenu((current) => {
      if (open) return { id };
      return current?.id === id ? null : current;
    });
  }, []);

  function handleSaved(workspace: Workspace, mode: "create" | "edit") {
    upsertWorkspace(workspace);
    setDialog(null);
    if (mode === "create") openWorkspace(workspace.id);
  }

  function cancelRemove() {
    if (removing) return;
    setToRemove(null);
    setRemoveError("");
  }

  async function removeWorkspace() {
    if (!bridge || !toRemove || !target || removing) return;
    const removed = toRemove;
    setRemoveError("");
    setRemoving(true);
    try {
      await bridge.request("workspaces.remove", { id: removed.id });
      // O ativo apagado cai no de destino, e o foco vai para a aba dele.
      removeReturnFocusRef.current = tabRefs.current.get(target.id) ?? plusRef.current;
      removeWorkspaceFromStore(removed.id);
      setToRemove(null);
    } catch (error) {
      setRemoveError(
        error instanceof BridgeError && error.message ? error.message : t.workspaces.removeFailed,
      );
    } finally {
      setRemoving(false);
    }
  }

  // Roda do mouse na vertical vira rolagem horizontal quando as abas passam do espaço.
  function scrollTabs(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    event.currentTarget.scrollLeft += event.deltaY;
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.brandArea}>
        <BrandMark />
        <span className={styles.brandName}>{t.brand.name}</span>
      </div>
      <div className={styles.toolbar}>
        <nav aria-label={t.shell.areasNavigation} className={styles.areas}>
          <button
            aria-current={view.name === "home" ? "page" : undefined}
            className={`${view.name === "home" ? styles.activeArea : styles.inactiveArea} ${styles.homeTab}`}
            onClick={() => navigate({ name: "home" })}
            type="button"
          >
            <House aria-hidden="true" size={16} strokeWidth={1.75} />
            <span>{t.shell.home}</span>
          </button>
          <div className={styles.tabScroller} onWheel={scrollTabs}>
            {workspaces.map((workspace) => {
              const menuOpen = menu?.id === workspace.id;
              return (
                <WorkspaceTab
                  active={view.name === "workspace" && workspace.id === activeWorkspaceId}
                  anchorPoint={menuOpen ? menu?.point : undefined}
                  getMenuItems={getMenuItems}
                  key={workspace.id}
                  mark={marks.get(workspace.id)}
                  menuOpen={menuOpen}
                  onContextMenu={openContextMenu}
                  onMenuOpenChange={changeMenu}
                  onRegister={registerTab}
                  onSelect={openWorkspace}
                  workspace={workspace}
                />
              );
            })}
          </div>
          <IconButton
            className={styles.newWorkspace}
            icon={<Plus aria-hidden="true" size={14} strokeWidth={1.75} />}
            label={t.shell.newWorkspace}
            onClick={() => openDialog(null)}
            ref={plusRef}
            size="sm"
          />
        </nav>
        <Button
          aria-description={t.shell.availableSoon}
          aria-label={t.shell.searchAccessibleName}
          className={styles.searchButton}
          disabled
          iconStart={<Search aria-hidden="true" size={16} strokeWidth={1.75} />}
        >
          <span className={styles.searchLabel}>{t.shell.search}</span>
          <kbd className={styles.shortcut}>{t.shell.searchShortcut}</kbd>
        </Button>
      </div>
      <WorkspaceDialog
        onClose={() => setDialog(null)}
        onSaved={handleSaved}
        open={dialog !== null}
        returnFocusRef={dialogReturnFocusRef}
        workspace={dialog?.workspace ?? null}
      />
      <Dialog
        description={
          toRemove && target
            ? t.workspaces.removeDescription(toRemove.name, target.name)
            : undefined
        }
        footer={
          <>
            <Button
              disabled={removing}
              onClick={cancelRemove}
              ref={removeCancelRef}
              variant="secondary"
            >
              {t.workspaces.cancel}
            </Button>
            <Button
              disabled={removing || !target}
              onClick={() => void removeWorkspace()}
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={15} />
              {removing ? t.workspaces.removing : t.workspaces.removeAction}
            </Button>
          </>
        }
        initialFocusRef={removeCancelRef as RefObject<HTMLElement | null>}
        onClose={cancelRemove}
        open={toRemove !== null}
        returnFocusRef={removeReturnFocusRef}
        title={t.workspaces.removeTitle(toRemove?.name ?? "")}
      >
        {removeError ? (
          <p className={styles.removeError} role="alert">
            {removeError}
          </p>
        ) : null}
      </Dialog>
    </header>
  );
}
