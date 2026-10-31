import styles from "./BrandMark.module.css";

export function BrandMark() {
  return (
    <span aria-hidden="true" className={styles.mark}>
      <span className={styles.moon} />
      <span className={styles.reflections}>
        <span className={styles.reflection} />
        <span className={styles.reflectionShort} />
      </span>
    </span>
  );
}
