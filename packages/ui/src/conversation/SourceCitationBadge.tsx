import { ChevronLeft, ChevronRight } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n/pt-BR.ts";
import styles from "./SourceCitationBadge.module.css";
import type { CitationView } from "./sourceCitations.ts";

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 160;

export function SourceCitationBadge({
  citations,
  onOpen,
}: {
  citations: readonly CitationView[];
  onOpen: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [side, setSide] = useState<"above" | "below">("below");
  const [align, setAlign] = useState<"start" | "center" | "end">("center");
  const wrapperRef = useRef<HTMLFieldSetElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const timerRef = useRef<number | null>(null);
  const cardId = useId();
  const currentIndex = citations.length > 0 ? index % citations.length : 0;
  const current = citations[currentIndex] ?? citations[0];

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleOpen = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }, [clearTimer]);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      if (!wrapperRef.current?.contains(document.activeElement)) setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearTimer]);

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useLayoutEffect(() => {
    if (!open || !current) return;
    const badge = badgeRef.current;
    const card = cardRef.current;
    const wrapper = wrapperRef.current;
    if (!badge || !card || !wrapper) return;

    const badgeRect = badge.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const markdown = wrapper.closest<HTMLElement>("[data-k-markdown]") ?? wrapper.parentElement;
    const messageViewport = wrapper.closest<HTMLElement>("[data-k-chat-scroll]");
    const columnRect = markdown?.getBoundingClientRect();
    const viewportRect = messageViewport?.getBoundingClientRect();
    const top = Math.max(0, viewportRect?.top ?? 0);
    const bottom = Math.min(window.innerHeight, viewportRect?.bottom ?? window.innerHeight);
    const spaceAbove = badgeRect.top - top;
    const spaceBelow = bottom - badgeRect.bottom;
    const gap = Number.parseFloat(getComputedStyle(card).getPropertyValue("--k-space-2")) || 0;
    const placeAbove = spaceBelow < cardRect.height + gap && spaceAbove > spaceBelow;
    const availableVerticalSpace = placeAbove ? spaceAbove : spaceBelow;
    card.style.maxHeight = `${Math.max(0, availableVerticalSpace - gap)}px`;
    card.style.overflowY = "auto";
    setSide(placeAbove ? "above" : "below");

    if (columnRect) {
      const cardWidth = cardRect.width;
      const spaceFromStart = columnRect.right - wrapperRect.left;
      const spaceFromEnd = wrapperRect.right - columnRect.left;
      const startFits = spaceFromStart >= cardWidth;
      const endFits = spaceFromEnd >= cardWidth;
      if (startFits && !endFits) setAlign("start");
      else if (endFits && !startFits) setAlign("end");
      else setAlign("center");
    }
  }, [current, open]);

  if (!current || citations.length === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
      badgeRef.current?.focus();
    } else if (citations.length > 1 && event.key === "ArrowLeft") {
      event.preventDefault();
      setIndex((value) => (value + citations.length - 1) % citations.length);
    } else if (citations.length > 1 && event.key === "ArrowRight") {
      event.preventDefault();
      setIndex((value) => (value + 1) % citations.length);
    }
  };

  const openCurrent = () => onOpen(current.source.url);

  return (
    <fieldset
      className={styles.sourceCitationWrap}
      data-align={align}
      data-side={side}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose();
      }}
      onFocusCapture={scheduleOpen}
      onKeyDown={onKeyDown}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      ref={wrapperRef}
    >
      <legend className={styles.sourceCitationLegend}>
        {t.chat.sourceBadge(current.site, citations.length - 1)}
      </legend>
      <button
        aria-controls={open ? cardId : undefined}
        aria-expanded={open}
        aria-label={t.chat.sourceBadge(current.site, citations.length - 1)}
        className={styles.sourceCitationBadge}
        onClick={openCurrent}
        onFocus={scheduleOpen}
        onMouseEnter={scheduleOpen}
        ref={badgeRef}
        type="button"
      >
        <span aria-hidden="true" className={styles.sourceCitationInitial}>
          {Array.from(current.site)[0] ?? "S"}
        </span>
        <span className={styles.sourceCitationLabel}>{current.site}</span>
        {citations.length > 1 ? (
          <span aria-hidden="true" className={styles.sourceCitationCount}>
            +{citations.length - 1}
          </span>
        ) : null}
      </button>
      {open ? (
        <section
          aria-label={t.chat.sourceCard(current.site)}
          className={styles.sourceCitationCard}
          id={cardId}
          ref={cardRef}
        >
          <div className={styles.sourceCitationCardHeader}>
            <span aria-hidden="true" className={styles.sourceCitationInitial}>
              {Array.from(current.site)[0] ?? "S"}
            </span>
            <span className={styles.sourceCitationCardSite}>{current.site}</span>
            {citations.length > 1 ? (
              <span className={styles.sourceCitationNavigation}>
                <button
                  aria-label={t.chat.sourcePrevious}
                  className={styles.sourceCitationNavButton}
                  onClick={() =>
                    setIndex((value) => (value + citations.length - 1) % citations.length)
                  }
                  onFocus={scheduleOpen}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={14} />
                </button>
                <span aria-live="polite" className={styles.sourceCitationPosition}>
                  {t.chat.sourcePosition(currentIndex + 1, citations.length)}
                </span>
                <button
                  aria-label={t.chat.sourceNext}
                  className={styles.sourceCitationNavButton}
                  onClick={() => setIndex((value) => (value + 1) % citations.length)}
                  onFocus={scheduleOpen}
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
              </span>
            ) : null}
          </div>
          <button
            className={styles.sourceCitationTitle}
            onClick={openCurrent}
            onFocus={scheduleOpen}
            type="button"
          >
            {current.source.title || current.source.url}
          </button>
          {current.source.snippet ? (
            <p className={styles.sourceCitationSnippet}>{current.source.snippet}</p>
          ) : null}
          {current.source.date ? (
            <p className={styles.sourceCitationDate}>{current.source.date}</p>
          ) : null}
        </section>
      ) : null}
    </fieldset>
  );
}
