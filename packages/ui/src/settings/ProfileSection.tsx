import { CircleAlert } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Button } from "../components/Button/Button.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import { Avatar } from "../profile/Avatar.tsx";
import { prepareAvatar } from "../profile/avatar.ts";
import { useProfile } from "../profile/ProfileContext.tsx";
import styles from "./ProfileSection.module.css";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ProfileSection() {
  const profile = useProfile();
  const { name: savedName, avatar, status } = profile;
  const [draftName, setDraftName] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");
  const [nameAnnouncement, setNameAnnouncement] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarAnnouncement, setAvatarAnnouncement] = useState("");
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!nameAnnouncement) return;
    const timeout = window.setTimeout(() => setNameAnnouncement(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [nameAnnouncement]);

  useEffect(() => {
    if (!avatarAnnouncement) return;
    const timeout = window.setTimeout(() => setAvatarAnnouncement(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [avatarAnnouncement]);

  const nameValue = draftName ?? savedName;
  const ready = status === "ready";
  const nameUnchanged = nameValue.trim() === savedName;

  async function saveName() {
    if (!ready || isSavingName || nameUnchanged) return;
    setNameError("");
    setNameAnnouncement("");
    setIsSavingName(true);
    try {
      await profile.saveName(nameValue);
      if (!mountedRef.current) return;
      setDraftName(null);
      setNameAnnouncement(t.settings.userNameSaved);
    } catch (error) {
      if (mountedRef.current) setNameError(errorMessage(error, t.settings.userNameSaveFailed));
    } finally {
      if (mountedRef.current) setIsSavingName(false);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Limpa para a mesma foto poder ser escolhida de novo.
    input.value = "";
    if (!file || !ready || isSavingAvatar) return;
    setAvatarError("");
    setAvatarAnnouncement("");
    setIsSavingAvatar(true);
    try {
      const dataUrl = await prepareAvatar(file);
      await profile.saveAvatar(dataUrl);
      if (mountedRef.current) setAvatarAnnouncement(t.profile.avatarSaved);
    } catch (error) {
      if (mountedRef.current) setAvatarError(errorMessage(error, t.profile.avatarSaveFailed));
    } finally {
      if (mountedRef.current) setIsSavingAvatar(false);
    }
  }

  async function removeAvatar() {
    if (!ready || isSavingAvatar || !avatar) return;
    setAvatarError("");
    setAvatarAnnouncement("");
    setIsSavingAvatar(true);
    try {
      await profile.saveAvatar(null);
      if (mountedRef.current) setAvatarAnnouncement(t.profile.avatarRemoved);
    } catch (error) {
      if (mountedRef.current) setAvatarError(errorMessage(error, t.profile.avatarSaveFailed));
    } finally {
      if (mountedRef.current) setIsSavingAvatar(false);
    }
  }

  return (
    <section aria-labelledby="settings-profile-title" className={styles.section}>
      <h2 className={styles.heading} id="settings-profile-title">
        {t.settings.profile}
      </h2>

      <div className={styles.photoRow}>
        <Avatar avatar={avatar} name={savedName} size="lg" />
        <div className={styles.photoActions}>
          <div className={styles.buttons}>
            <Button
              disabled={!ready || isSavingAvatar}
              onClick={() => fileInputRef.current?.click()}
              size="sm"
              variant="secondary"
            >
              {isSavingAvatar
                ? t.profile.avatarSaving
                : avatar
                  ? t.profile.avatarChange
                  : t.profile.avatarChoose}
            </Button>
            {avatar ? (
              <Button
                disabled={!ready || isSavingAvatar}
                onClick={() => void removeAvatar()}
                size="sm"
                variant="ghost"
              >
                {t.profile.avatarRemove}
              </Button>
            ) : null}
          </div>
          <span className={styles.announcement} role="status">
            {avatarAnnouncement}
          </span>
        </div>
        <input
          accept="image/png,image/jpeg,image/webp"
          aria-label={t.profile.avatarInputLabel}
          className={styles.fileInput}
          onChange={(event) => void chooseFile(event)}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>
      {avatarError ? (
        <p className={styles.errorMessage} role="alert">
          <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{avatarError}</span>
        </p>
      ) : null}

      <fieldset className={styles.nameGroup} disabled={!ready || isSavingName}>
        <TextField
          label={t.settings.userNameLabel}
          maxLength={80}
          onChange={(event) => setDraftName(event.currentTarget.value)}
          placeholder={t.settings.userNamePlaceholder}
          value={nameValue}
        />
        <div className={styles.nameActions}>
          <span className={styles.announcement} role="status">
            {nameAnnouncement}
          </span>
          <Button
            disabled={!ready || isSavingName || nameUnchanged}
            onClick={() => void saveName()}
            size="sm"
            variant="secondary"
          >
            {isSavingName ? t.settings.userNameSaving : t.settings.userNameSave}
          </Button>
        </div>
        {status === "loading" ? (
          <p className={styles.statusMessage} role="status">
            {t.settings.loadingPreference}
          </p>
        ) : null}
        {status === "noBridge" ? (
          <p className={styles.statusMessage} role="status">
            {t.settings.noBridge}
          </p>
        ) : null}
        {status === "error" ? (
          <p className={styles.errorMessage} role="alert">
            <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{t.settings.userNameLoadFailed}</span>
          </p>
        ) : null}
        {nameError ? (
          <p className={styles.errorMessage} role="alert">
            <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{nameError}</span>
          </p>
        ) : null}
      </fieldset>
    </section>
  );
}
