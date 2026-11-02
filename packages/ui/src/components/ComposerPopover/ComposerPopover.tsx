import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type FluidHoverAxis,
  type FluidHoverGapClick,
  FluidHoverHighlight,
  FluidHoverProvider,
  useFluidHover,
} from "../FluidHover/FluidHover.tsx";
import styles from "./ComposerPopover.module.css";

type Placement = { left: number; top: number; maxHeight: number };

export function ComposerPopover({
  open,
  anchorRef,
  anchorPoint,
  initialFocus,
  onClose,
  children,
  className,
  id,
  role = "group",
  label,
  fluidHoverAxis = "y",
  fluidHoverGapClick = false,
  fluidHoverNearest,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  anchorPoint?: { x: number; y: number };
  initialFocus?: () => HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: "group" | "dialog" | "menu";
  label?: string;
  fluidHoverAxis?: FluidHoverAxis;
  fluidHoverGapClick?: FluidHoverGapClick;
  fluidHoverNearest?: boolean;
}) {
  const popoverRef = useRef<HTMLElement>(null);
  const fluidHover = useFluidHover(popoverRef, {
    axis: fluidHoverAxis,
    gapClick: fluidHoverGapClick,
    nearest: fluidHoverNearest,
    isItemDisabled: (element) =>
      element.matches(":disabled, [aria-disabled='true'], [data-fluid-hover-disabled='true']"),
  });
  const initialFocusRef = useRef(initialFocus);
  const [placement, setPlacement] = useState<Placement>();

  useLayoutEffect(() => {
    initialFocusRef.current = initialFocus;
  }, [initialFocus]);

  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const anchor = anchorRef.current;
      if (anchor?.isConnected && !document.querySelector("dialog[open]")) anchor.focus();
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const rect = anchorPoint
        ? {
            left: anchorPoint.x,
            right: anchorPoint.x,
            top: anchorPoint.y,
            bottom: anchorPoint.y,
          }
        : anchor?.getBoundingClientRect();
      const bounds = popover.getBoundingClientRect();
      if (!rect) return;
      const tokenSpace = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--k-space-2"),
      );
      const edge = Number.isFinite(tokenSpace) ? tokenSpace : 0;
      const gap = edge;
      const maxHeight = Math.max(0, window.innerHeight - edge * 2);
      const height = Math.min(bounds.height, maxHeight);
      const roomBelow = window.innerHeight - rect.bottom - edge;
      const openAbove = roomBelow < height + gap && rect.top - edge >= height + gap;
      const top = openAbove
        ? Math.max(edge, rect.top - height - gap)
        : Math.min(window.innerHeight - height - edge, rect.bottom + gap);
      const left = Math.max(edge, Math.min(rect.left, window.innerWidth - bounds.width - edge));
      setPlacement({ left, top, maxHeight });
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchorPoint, anchorRef, open]);

  useLayoutEffect(() => {
    if (open && placement) fluidHover.remeasure();
  }, [fluidHover, open, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    (initialFocusRef.current?.() ?? popoverRef.current)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      const focusWasInside = Boolean(popoverRef.current?.contains(document.activeElement));
      const clickedAnotherTrigger = Boolean(target.closest("[data-composer-menu-trigger]"));
      onClose();
      if (focusWasInside && !clickedAnotherTrigger) restoreFocus();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [anchorRef, onClose, open, restoreFocus]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      restoreFocus();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open, restoreFocus]);

  if (!open || typeof document === "undefined") return null;
  const style = placement
    ? ({
        left: placement.left,
        top: placement.top,
        maxHeight: placement.maxHeight,
      } as CSSProperties)
    : undefined;

  const classNames = [styles.popover, className].filter(Boolean).join(" ");
  const popover =
    role === "dialog" ? (
      <div
        aria-label={label}
        className={classNames}
        id={id}
        ref={fluidHover.containerRef}
        role="dialog"
        style={style}
        tabIndex={-1}
      >
        <FluidHoverProvider controller={fluidHover}>
          <FluidHoverHighlight controller={fluidHover} />
          {children}
        </FluidHoverProvider>
      </div>
    ) : role === "menu" ? (
      <div
        aria-label={label}
        className={classNames}
        id={id}
        ref={fluidHover.containerRef}
        role="menu"
        style={style}
        tabIndex={-1}
      >
        <FluidHoverProvider controller={fluidHover}>
          <FluidHoverHighlight controller={fluidHover} />
          {children}
        </FluidHoverProvider>
      </div>
    ) : (
      <fieldset
        aria-label={label}
        className={classNames}
        ref={fluidHover.containerRef}
        style={style}
        tabIndex={-1}
      >
        {label ? <legend className={styles.srOnly}>{label}</legend> : null}
        <FluidHoverProvider controller={fluidHover}>
          <FluidHoverHighlight controller={fluidHover} />
          {children}
        </FluidHoverProvider>
      </fieldset>
    );

  return createPortal(popover, document.body);
}

export function ComposerPopoverHeading({ children }: { children: ReactNode }) {
  return <div className={styles.heading}>{children}</div>;
}
