import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getBridge } from "../bridge/index.ts";
import { isSafeAvatar } from "./avatar.ts";

const USER_NAME_SETTING = "profile.userNameOverride";
const AVATAR_SETTING = "profile.avatar";

export type ProfileStatus = "loading" | "ready" | "error" | "noBridge";

type ProfileValue = {
  /** Nome exibido: o escolhido pelo usuário ou, sem ele, o do sistema. "" quando não há. */
  name: string;
  /** Data URL já validada, ou null sem foto. */
  avatar: string | null;
  status: ProfileStatus;
  loading: boolean;
  saveName: (name: string) => Promise<void>;
  saveAvatar: (avatar: string | null) => Promise<void>;
};

const noop = async () => {};
const ProfileContext = createContext<ProfileValue>({
  name: "",
  avatar: null,
  status: "noBridge",
  loading: false,
  saveName: noop,
  saveAvatar: noop,
});

export function ProfileProvider({ children }: { children: ReactNode }) {
  const bridge = useMemo(() => getBridge(), []);
  const [status, setStatus] = useState<ProfileStatus>(() => (bridge ? "loading" : "noBridge"));
  const [override, setOverride] = useState("");
  const [systemName, setSystemName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void (async () => {
      const [systemResult, overrideResult, avatarResult] = await Promise.allSettled([
        bridge.request("system.userName", {}),
        bridge.request("settings.get", { key: USER_NAME_SETTING }),
        bridge.request("settings.get", { key: AVATAR_SETTING }),
      ]);
      if (!active) return;
      if (systemResult.status === "rejected" && overrideResult.status === "rejected") {
        setStatus("error");
        return;
      }
      if (systemResult.status === "fulfilled") setSystemName(systemResult.value.name ?? "");
      if (overrideResult.status === "fulfilled") {
        const value = overrideResult.value.value;
        setOverride(typeof value === "string" ? value.trim() : "");
      }
      if (avatarResult.status === "fulfilled") {
        const value = avatarResult.value.value;
        setAvatar(isSafeAvatar(value) ? value : null);
      }
      setStatus("ready");
    })();
    return () => {
      active = false;
    };
  }, [bridge]);

  const saveName = useCallback(
    async (name: string) => {
      if (!bridge) return;
      const trimmed = name.trim();
      await bridge.request("settings.set", { key: USER_NAME_SETTING, value: trimmed || null });
      setOverride(trimmed);
    },
    [bridge],
  );

  const saveAvatar = useCallback(
    async (next: string | null) => {
      if (!bridge) return;
      const value = isSafeAvatar(next) ? next : null;
      await bridge.request("settings.set", { key: AVATAR_SETTING, value });
      setAvatar(value);
    },
    [bridge],
  );

  const value = useMemo<ProfileValue>(
    () => ({
      name: override || systemName,
      avatar,
      status,
      loading: status === "loading",
      saveName,
      saveAvatar,
    }),
    [override, systemName, avatar, status, saveName, saveAvatar],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileValue {
  return useContext(ProfileContext);
}
