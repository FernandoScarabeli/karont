import { User } from "lucide-react";
import styles from "./Avatar.module.css";
import { avatarInitial, isSafeAvatar } from "./avatar.ts";

type AvatarProps = {
  name: string;
  avatar: string | null;
  size: "sm" | "lg";
};

/** Decorativo: o nome acessível vem de quem usa (botão ou texto ao lado). */
export function Avatar({ name, avatar, size }: AvatarProps) {
  const initial = avatarInitial(name);
  return (
    <span aria-hidden="true" className={`${styles.avatar} ${styles[size]}`}>
      {isSafeAvatar(avatar) ? (
        <img alt="" className={styles.image} src={avatar} />
      ) : initial ? (
        <span className={styles.initial}>{initial}</span>
      ) : (
        <User aria-hidden="true" className={styles.icon} strokeWidth={1.75} />
      )}
    </span>
  );
}
