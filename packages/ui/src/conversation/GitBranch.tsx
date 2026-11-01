import { GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./GitBranch.module.css";

export type GitInfo = { branch: string | null; detached: boolean };

export function useGitInfo(path: string | undefined, refreshKey: string): GitInfo | null {
  const bridge = getBridge();
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const queryKey = `${refreshKey}\u0000${path ?? ""}`;
  const currentQueryKeyRef = useRef(queryKey);
  currentQueryKeyRef.current = queryKey;

  useEffect(() => {
    if (!bridge || !path) {
      setGitInfo(null);
      return;
    }
    let active = true;
    const requestKey = queryKey;
    const refresh = () => {
      void bridge
        .request("folders.gitInfo", { path })
        .then((result) => {
          if (active && currentQueryKeyRef.current === requestKey) setGitInfo(result);
        })
        .catch(() => {
          if (active && currentQueryKeyRef.current === requestKey) setGitInfo(null);
        });
    };

    setGitInfo(null);
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [bridge, path, queryKey]);

  return gitInfo;
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
