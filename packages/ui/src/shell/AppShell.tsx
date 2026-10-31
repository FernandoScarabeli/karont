import styles from "./AppShell.module.css";
import { Sheet } from "./Sheet.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TopBar } from "./TopBar.tsx";

export function AppShell() {
  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.content}>
        <Sidebar />
        <Sheet />
      </div>
    </div>
  );
}
