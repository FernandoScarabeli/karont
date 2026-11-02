import { GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import {
  type CachedGitInfo,
  cacheGitInfo,
  getCachedGitInfo,
  invalidateCachedGitInfo,
} from "./conversationCache.ts";
import styles from "./GitBranch.module.css";

export type GitInfo = CachedGitInfo;

type GitInfoSnapshot = { path: string; info: GitInfo | null; loading: boolean };

export function useGitInfo(
  path: string | undefined,
  refreshKey: string,
): { info: GitInfo | null; loading: boolean } {
  const bridge = getBridge();
  const [snapshot, setSnapshot] = useState<GitInfoSnapshot | null>(() => {
    if (!path) return null;
    const cached = getCachedGitInfo(path);
    return { path, info: cached ?? null, loading: Boolean(bridge && !cached) };
  });
  const queryKey = `${refreshKey}\u0000${path ?? ""}`;
  const currentQueryKeyRef = useRef(queryKey);
  currentQueryKeyRef.current = queryKey;

  const cachedInfo = path ? getCachedGitInfo(path) : undefined;
  const info =
    snapshot && snapshot.path === path ? snapshot.info : path ? (cachedInfo ?? null) : null;
  const loading = path
    ? snapshot && snapshot.path === path
      ? snapshot.loading
      : Boolean(bridge && !cachedInfo)
    : false;

  useEffect(() => {
    if (!bridge || !path) {
      setSnapshot(path ? { path, info: getCachedGitInfo(path) ?? null, loading: false } : null);
      return;
    }
    let active = true;
    const requestKey = queryKey;
    const cached = getCachedGitInfo(path);
    setSnapshot({ path, info: cached ?? null, loading: !cached });
    const refresh = () => {
      void bridge
        .request("folders.gitInfo", { path })
        .then((result) => {
          if (!active || currentQueryKeyRef.current !== requestKey) return;
          cacheGitInfo(path, result);
          setSnapshot({ path, info: result, loading: false });
        })
        .catch(() => {
          if (!active || currentQueryKeyRef.current !== requestKey) return;
          invalidateCachedGitInfo(path);
          setSnapshot({ path, info: null, loading: false });
        });
    };

    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [bridge, path, queryKey]);

  return { info, loading };
}

export function GitBranchLabel({ info }: { info: GitInfo | null }) {
  if (!info || (!info.detached && !info.branch)) return null;
  const label = info.detached ? t.chat.detachedHead : info.branch;
  return (
    <span className={styles.branch} title={label ?? undefined}>
      <GitBranch aria-hidden="true" size={14} />
      <span>{label}</span>
    </span>
  );
}
