import {
  createContext,
  type PropsWithChildren,
  type RefCallback,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";

export type FluidHoverAxis = "x" | "y" | "xy";
export type FluidHoverItemKey = string | number;
export type FluidHoverGapClick = boolean | { maxDistance?: number };

export type FluidHoverOptions = {
  axis?: FluidHoverAxis;
  isItemDisabled?: (element: HTMLElement) => boolean;
  gapClick?: FluidHoverGapClick;
  nearest?: boolean;
};

export type FluidHoverController = {
  containerRef: RefCallback<HTMLElement>;
  highlightRef: RefCallback<HTMLSpanElement>;
  registerItem: (key: FluidHoverItemKey, element: HTMLElement | null) => void;
  remeasure: () => void;
};

type ItemRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
  screenHeight: number;
  radius: string;
};

type RegisteredItem = {
  element: HTMLElement;
  rect?: ItemRect;
};

type FluidHoverState = {
  container: HTMLElement | null;
  highlight: HTMLSpanElement | null;
  items: Map<FluidHoverItemKey, RegisteredItem>;
  activeKey: FluidHoverItemKey | null;
  focusedKey: FluidHoverItemKey | null;
  pointerInside: boolean;
  sessionPending: boolean;
  latestPointer: { x: number; y: number; target: EventTarget | null } | null;
  pointerFrame: number | null;
  measureFrame: number | null;
  snapFrame: number | null;
  focusFrame: number | null;
  resizeObserver: ResizeObserver | null;
  cleanupContainer: (() => void) | null;
};

const FluidHoverContext = createContext<FluidHoverController | null>(null);

function writeRect(element: HTMLSpanElement, rect: ItemRect) {
  element.style.setProperty("--fluid-hover-x", `${rect.left}px`);
  element.style.setProperty("--fluid-hover-y", `${rect.top}px`);
  element.style.setProperty("--fluid-hover-width", `${rect.width}px`);
  element.style.setProperty("--fluid-hover-height", `${rect.height}px`);
  element.style.setProperty("--fluid-hover-radius", rect.radius);
}

function isDisabled(element: HTMLElement, options: FluidHoverOptions) {
  return Boolean(options.isItemDisabled?.(element));
}

export function useFluidHover<T extends HTMLElement>(
  containerElementRef: RefObject<T | null>,
  options: FluidHoverOptions = {},
): FluidHoverController {
  const stateRef = useRef<FluidHoverState>({
    container: null,
    highlight: null,
    items: new Map(),
    activeKey: null,
    focusedKey: null,
    pointerInside: false,
    sessionPending: true,
    latestPointer: null,
    pointerFrame: null,
    measureFrame: null,
    snapFrame: null,
    focusFrame: null,
    resizeObserver: null,
    cleanupContainer: null,
  });
  const optionsRef = useRef(options);
  const schedulePointerUpdateRef = useRef<() => void>(() => {});
  optionsRef.current = options;

  const hideHighlight = useCallback(() => {
    const state = stateRef.current;
    if (state.snapFrame !== null) cancelAnimationFrame(state.snapFrame);
    state.snapFrame = null;
    state.activeKey = null;
    state.sessionPending = true;
    if (state.highlight) state.highlight.style.opacity = "0";
  }, []);

  const showHighlight = useCallback(
    (key: FluidHoverItemKey | null, mode: "spring" | "fresh" | "snap" = "spring") => {
      const state = stateRef.current;
      if (key === null) {
        hideHighlight();
        return;
      }
      const item = state.items.get(key);
      if (!item || isDisabled(item.element, optionsRef.current)) {
        if (state.activeKey === key) hideHighlight();
        return;
      }
      if (state.activeKey === key && mode === "spring") return;
      const rect = item.rect;
      state.activeKey = key;
      if (!rect || !state.highlight) return;

      const highlight = state.highlight;
      if (state.snapFrame !== null) cancelAnimationFrame(state.snapFrame);
      state.snapFrame = null;

      if (mode === "fresh") {
        highlight.dataset.fluidHoverSnap = "true";
        highlight.style.opacity = "0";
        writeRect(highlight, rect);
        state.snapFrame = requestAnimationFrame(() => {
          state.snapFrame = null;
          if (state.activeKey !== key || !state.highlight) return;
          delete state.highlight.dataset.fluidHoverSnap;
          state.highlight.style.opacity = "1";
        });
      } else if (mode === "snap") {
        highlight.dataset.fluidHoverSnap = "true";
        writeRect(highlight, rect);
        highlight.style.opacity = "1";
        state.snapFrame = requestAnimationFrame(() => {
          state.snapFrame = null;
          if (state.highlight) delete state.highlight.dataset.fluidHoverSnap;
        });
      } else {
        delete highlight.dataset.fluidHoverSnap;
        writeRect(highlight, rect);
        highlight.style.opacity = "1";
      }
    },
    [hideHighlight],
  );

  const runMeasurement = useCallback(() => {
    const state = stateRef.current;
    const container = state.container;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const scaleX = container.offsetWidth > 0 ? containerRect.width / container.offsetWidth : 1;
    const scaleY = container.offsetHeight > 0 ? containerRect.height / container.offsetHeight : 1;
    for (const item of state.items.values()) {
      const rect = item.element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        item.rect = undefined;
        continue;
      }
      item.rect = {
        left:
          (rect.left - containerRect.left) / scaleX - container.clientLeft + container.scrollLeft,
        top: (rect.top - containerRect.top) / scaleY - container.clientTop + container.scrollTop,
        width: rect.width / scaleX,
        height: rect.height / scaleY,
        screenLeft: rect.left,
        screenTop: rect.top,
        screenWidth: rect.width,
        screenHeight: rect.height,
        radius: getComputedStyle(item.element).borderRadius,
      };
    }

    if (state.activeKey !== null) showHighlight(state.activeKey, "snap");
    const pointer = state.latestPointer;
    if (state.pointerInside && pointer) schedulePointerUpdateRef.current();
  }, [showHighlight]);

  const scheduleMeasurement = useCallback(() => {
    const state = stateRef.current;
    if (!state.container || state.measureFrame !== null) return;
    state.measureFrame = requestAnimationFrame(() => {
      state.measureFrame = null;
      runMeasurement();
    });
  }, [runMeasurement]);

  const getItemForTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Node)) return null;
    let selected: { key: FluidHoverItemKey; element: HTMLElement } | null = null;
    for (const [key, item] of stateRef.current.items) {
      if (isDisabled(item.element, optionsRef.current) || !item.element.contains(target)) continue;
      if (!selected || selected.element.contains(item.element)) {
        selected = { key, element: item.element };
      }
    }
    return selected;
  }, []);

  const getNearestItem = useCallback((x: number, y: number) => {
    const options = optionsRef.current;
    if (!(options.nearest ?? Boolean(options.gapClick))) return null;
    let best: { key: FluidHoverItemKey; distance: number } | null = null;
    let containing: FluidHoverItemKey | null = null;
    for (const [key, item] of stateRef.current.items) {
      const rect = item.rect;
      if (!rect || isDisabled(item.element, options)) continue;
      const centerX = rect.screenLeft + rect.screenWidth / 2;
      const centerY = rect.screenTop + rect.screenHeight / 2;
      const insideX = x >= rect.screenLeft && x <= rect.screenLeft + rect.screenWidth;
      const insideY = y >= rect.screenTop && y <= rect.screenTop + rect.screenHeight;
      const distance =
        options.axis === "x"
          ? Math.abs(x - centerX)
          : options.axis === "xy"
            ? Math.hypot(x - centerX, y - centerY)
            : Math.abs(y - centerY);
      if (insideX && insideY) containing = key;
      if (!best || distance < best.distance) best = { key, distance };
    }
    return containing ?? best?.key ?? null;
  }, []);

  const schedulePointerUpdate = useCallback(() => {
    const state = stateRef.current;
    if (state.pointerFrame !== null) return;
    state.pointerFrame = requestAnimationFrame(() => {
      state.pointerFrame = null;
      const pointer = state.latestPointer;
      if (!pointer || !state.pointerInside) return;
      const exact = getItemForTarget(pointer.target);
      const nextKey = exact?.key ?? getNearestItem(pointer.x, pointer.y);
      if (nextKey === null) {
        if (state.activeKey !== null) showHighlight(null);
        state.sessionPending = true;
        return;
      }
      const mode = state.sessionPending || state.activeKey === null ? "fresh" : "spring";
      state.sessionPending = false;
      showHighlight(nextKey, mode);
    });
  }, [getItemForTarget, getNearestItem, showHighlight]);
  schedulePointerUpdateRef.current = schedulePointerUpdate;

  const remeasure = useCallback(() => {
    scheduleMeasurement();
  }, [scheduleMeasurement]);

  const registerItem = useCallback(
    (key: FluidHoverItemKey, element: HTMLElement | null) => {
      const state = stateRef.current;
      const previous = state.items.get(key)?.element;
      if (previous === element) return;
      if (previous) {
        state.resizeObserver?.unobserve(previous);
      }
      if (element) {
        state.items.set(key, { element });
        state.resizeObserver?.observe(element);
        if (state.activeKey === key) showHighlight(key, "snap");
      } else {
        state.items.delete(key);
        if (state.activeKey === key) hideHighlight();
        if (state.focusedKey === key) state.focusedKey = null;
      }
      scheduleMeasurement();
    },
    [hideHighlight, scheduleMeasurement, showHighlight],
  );

  const handleFocusIn = useCallback(
    (event: FocusEvent) => {
      const item = getItemForTarget(event.target);
      if (!item) return;
      const state = stateRef.current;
      state.focusedKey = item.key;
      const mode = state.activeKey === null ? "fresh" : "spring";
      showHighlight(item.key, mode);
    },
    [getItemForTarget, showHighlight],
  );

  const handleFocusOut = useCallback(() => {
    const state = stateRef.current;
    if (state.focusFrame !== null) cancelAnimationFrame(state.focusFrame);
    state.focusFrame = requestAnimationFrame(() => {
      state.focusFrame = null;
      const container = state.container;
      const focused = container ? getItemForTarget(document.activeElement) : null;
      state.focusedKey = focused?.key ?? null;
      if (state.pointerInside) {
        if (!focused && state.latestPointer) schedulePointerUpdateRef.current();
        return;
      }
      if (focused) showHighlight(focused.key, state.activeKey === null ? "fresh" : "spring");
      else hideHighlight();
    });
  }, [getItemForTarget, hideHighlight, showHighlight]);

  const handlePointerEnter = useCallback(() => {
    const state = stateRef.current;
    state.pointerInside = true;
    state.sessionPending = true;
    scheduleMeasurement();
  }, [scheduleMeasurement]);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const state = stateRef.current;
      state.latestPointer = { x: event.clientX, y: event.clientY, target: event.target };
      schedulePointerUpdate();
    },
    [schedulePointerUpdate],
  );

  const handlePointerLeave = useCallback(() => {
    const state = stateRef.current;
    state.pointerInside = false;
    state.latestPointer = null;
    if (state.pointerFrame !== null) cancelAnimationFrame(state.pointerFrame);
    state.pointerFrame = null;
    if (state.focusedKey !== null) showHighlight(state.focusedKey);
    else hideHighlight();
  }, [hideHighlight, showHighlight]);

  const handleGapClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const state = stateRef.current;
      for (const item of state.items.values()) {
        if (item.element.contains(target)) return;
      }
      const control = target.closest(
        "input, textarea, select, button, a, summary, [contenteditable], [role='textbox'], [role='searchbox'], [role='button']",
      );
      if (control || !target.isConnected) return;
      const gapClick = optionsRef.current.gapClick;
      if (!gapClick) return;
      const key = getNearestItem(event.clientX, event.clientY) ?? state.activeKey;
      if (key === null) return;
      const item = state.items.get(key);
      if (!item || isDisabled(item.element, optionsRef.current)) return;
      const rect = item.rect;
      const maxDistance =
        typeof gapClick === "object" ? (gapClick.maxDistance ?? Infinity) : Infinity;
      if (rect && maxDistance !== Infinity) {
        const dx = Math.max(
          rect.screenLeft - event.clientX,
          0,
          event.clientX - rect.screenLeft - rect.screenWidth,
        );
        const dy = Math.max(
          rect.screenTop - event.clientY,
          0,
          event.clientY - rect.screenTop - rect.screenHeight,
        );
        if (Math.hypot(dx, dy) > maxDistance) return;
      }
      event.preventDefault();
      event.stopPropagation();
      item.element.click();
    },
    [getNearestItem],
  );

  const attachContainer = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      const state = stateRef.current;
      if (state.container === element) return;
      state.cleanupContainer?.();
      state.cleanupContainer = null;
      state.resizeObserver?.disconnect();
      state.resizeObserver = null;
      if (state.pointerFrame !== null) cancelAnimationFrame(state.pointerFrame);
      if (state.measureFrame !== null) cancelAnimationFrame(state.measureFrame);
      if (state.focusFrame !== null) cancelAnimationFrame(state.focusFrame);
      if (state.snapFrame !== null) cancelAnimationFrame(state.snapFrame);
      state.pointerFrame = null;
      state.measureFrame = null;
      state.focusFrame = null;
      state.snapFrame = null;
      state.pointerInside = false;
      state.latestPointer = null;
      state.container = element;
      containerElementRef.current = element as T | null;
      if (!element) {
        hideHighlight();
        return;
      }

      const onScroll = () => scheduleMeasurement();
      element.addEventListener("pointerenter", handlePointerEnter);
      element.addEventListener("pointermove", handlePointerMove);
      element.addEventListener("pointerleave", handlePointerLeave);
      element.addEventListener("focusin", handleFocusIn);
      element.addEventListener("focusout", handleFocusOut);
      element.addEventListener("click", handleGapClick);
      element.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
      window.addEventListener("scroll", onScroll, true);

      if (typeof ResizeObserver !== "undefined") {
        state.resizeObserver = new ResizeObserver(onScroll);
        state.resizeObserver.observe(element);
        for (const item of state.items.values()) state.resizeObserver.observe(item.element);
      }
      state.cleanupContainer = () => {
        element.removeEventListener("pointerenter", handlePointerEnter);
        element.removeEventListener("pointermove", handlePointerMove);
        element.removeEventListener("pointerleave", handlePointerLeave);
        element.removeEventListener("focusin", handleFocusIn);
        element.removeEventListener("focusout", handleFocusOut);
        element.removeEventListener("click", handleGapClick);
        element.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
        window.removeEventListener("scroll", onScroll, true);
      };
      scheduleMeasurement();
    },
    [
      containerElementRef,
      handleFocusIn,
      handleFocusOut,
      handleGapClick,
      handlePointerEnter,
      handlePointerLeave,
      handlePointerMove,
      hideHighlight,
      scheduleMeasurement,
    ],
  );

  const attachHighlight = useCallback<RefCallback<HTMLSpanElement>>(
    (element) => {
      stateRef.current.highlight = element;
      const activeKey = stateRef.current.activeKey;
      if (element && activeKey !== null) showHighlight(activeKey, "snap");
    },
    [showHighlight],
  );

  const controller = useMemo(
    () => ({
      containerRef: attachContainer,
      highlightRef: attachHighlight,
      registerItem,
      remeasure,
    }),
    [attachContainer, attachHighlight, registerItem, remeasure],
  );

  return controller;
}

export function useRegisterFluidHoverItem(
  key: FluidHoverItemKey,
  explicitController?: FluidHoverController | null,
): RefCallback<HTMLElement> {
  const inheritedController = useContext(FluidHoverContext);
  const controller = explicitController ?? inheritedController;
  return useCallback((element) => controller?.registerItem(key, element), [controller, key]);
}

export function FluidHoverProvider({
  controller,
  children,
}: PropsWithChildren<{ controller: FluidHoverController }>) {
  return <FluidHoverContext.Provider value={controller}>{children}</FluidHoverContext.Provider>;
}

export { FluidHoverHighlight } from "./FluidHoverHighlight.tsx";
