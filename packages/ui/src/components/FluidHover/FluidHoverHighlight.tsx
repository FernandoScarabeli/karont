import styles from "./FluidHover.module.css";
import type { FluidHoverController } from "./FluidHover.tsx";

export function FluidHoverHighlight({
  controller,
  className,
}: {
  controller: FluidHoverController;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={[styles.highlight, className].filter(Boolean).join(" ")}
      data-fluid-hover-highlight
      ref={controller.highlightRef}
    />
  );
}
