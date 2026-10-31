import path from "node:path";
import { fileURLToPath } from "node:url";
import { Menu, nativeImage, Tray } from "electron";

const distributionDirectory = path.dirname(fileURLToPath(import.meta.url));

export type TrayController = {
  ensure(): boolean;
  destroy(): void;
};

export function createTrayController({
  openWindow,
  quit,
}: {
  openWindow(): void;
  quit(): void;
}): TrayController {
  let tray: Tray | null = null;
  let attempted = false;

  return {
    ensure(): boolean {
      if (tray) return true;
      if (attempted) return false;
      attempted = true;

      try {
        const iconPath = path.join(distributionDirectory, "assets", "tray.png");
        const icon = nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) throw new Error(`Ícone da bandeja não encontrado: ${iconPath}`);
        tray = new Tray(icon);
        tray.setToolTip("Karont");
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "Abrir Karont", click: openWindow },
            { type: "separator" },
            { label: "Fechar tudo", click: quit },
          ]),
        );
        tray.on("click", openWindow);
        return true;
      } catch (error) {
        process.stderr.write(
          `Não foi possível criar a bandeja do Karont: ${errorMessage(error)}\n`,
        );
        return false;
      }
    },
    destroy(): void {
      tray?.destroy();
      tray = null;
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
