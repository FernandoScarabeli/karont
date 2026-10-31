import { House, Plus, Search } from "lucide-react";
import { Button } from "../components/Button/Button.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { BrandMark } from "./BrandMark.tsx";
import styles from "./TopBar.module.css";

export function TopBar() {
  const { navigate, view } = useNavigation();

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
            className={view.name === "home" ? styles.activeArea : styles.inactiveArea}
            onClick={() => navigate({ name: "home" })}
            type="button"
          >
            <House aria-hidden="true" size={16} strokeWidth={1.75} />
            <span>{t.shell.home}</span>
          </button>
          <IconButton
            aria-description={t.shell.availableSoon}
            disabled
            icon={<Plus aria-hidden="true" size={14} strokeWidth={1.75} />}
            label={t.shell.newWorkspace}
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
    </header>
  );
}
