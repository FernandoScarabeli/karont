import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FocusEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/pt-BR.ts";
import styles from "./SourceCitationBadge.module.css";
import { type CitationView, calculateCitationPopoverPosition } from "./sourceCitations.ts";

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
  const wrapperRef = useRef<HTMLFieldSetElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const timerRef = useRef<number | null>(null);
  const cardId = useId();
  const currentIndex = citations.length > 0 ? index % citations.length : 0;
  const current = citations[currentIndex] ?? citations[0];

  const hasFocusInside = useCallback(() => {
    const activeElement = document.activeElement;
    return Boolean(
      activeElement &&
        (wrapperRef.current?.contains(activeElement) || cardRef.current?.contains(activeElement)),
    );
  }, []);

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
      if (!hasFocusInside()) setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearTimer, hasFocusInside]);

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useLayoutEffect(() => {
    if (!open || !current) return;
    const badge = badgeRef.current;
    const card = cardRef.current;
    if (!badge || !card) return;

    const positionCard = () => {
      const badgeRect = badge.getBoundingClientRect();
      const computedStyle = getComputedStyle(card);
      const gap = Number.parseFloat(computedStyle.getPropertyValue("--k-space-2")) || 8;
      const margin = Number.parseFloat(computedStyle.getPropertyValue("--k-space-3")) || 12;
      card.style.visibility = "hidden";
      card.style.maxHeight = "none";
      const cardRect = card.getBoundingClientRect();
      const layout = calculateCitationPopoverPosition({
        anchor: {
          top: badgeRect.top,
          bottom: badgeRect.bottom,
          left: badgeRect.left,
          width: badgeRect.width,
        },
        card: { width: cardRect.width, height: Math.max(cardRect.height, card.scrollHeight) },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        gap,
        margin,
      });
      card.style.top = `${layout.top}px`;
      card.style.left = `${layout.left}px`;
      card.style.maxHeight = `${layout.maxHeight}px`;
      card.style.visibility = "visible";
    };

    positionCard();
    window.addEventListener("resize", positionCard);
    window.addEventListener("scroll", positionCard, true);
    return () => {
      window.removeEventListener("resize", positionCard);
      window.removeEventListener("scroll", positionCard, true);
    };
  }, [current, open]);

  if (!current || citations.length === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
  const handleBlurCapture = (event: FocusEvent<HTMLElement>) => {
    const target = event.relatedTarget;
    if (
      target instanceof Node &&
      (wrapperRef.current?.contains(target) || cardRef.current?.contains(target))
    )
      return;
    scheduleClose();
  };

  return (
    <fieldset
      className={styles.sourceCitationWrap}
      onBlurCapture={handleBlurCapture}
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
      {open
        ? createPortal(
            <section
              aria-label={t.chat.sourceCard(current.site)}
              className={styles.sourceCitationCard}
              id={cardId}
              onBlurCapture={handleBlurCapture}
              onFocusCapture={scheduleOpen}
              onKeyDown={onKeyDown}
              onMouseEnter={scheduleOpen}
              onMouseLeave={scheduleClose}
              ref={cardRef}
              style={{ visibility: "hidden" }}
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
              {current.source.title ? (
                <button
                  className={styles.sourceCitationTitle}
                  onClick={openCurrent}
                  onFocus={scheduleOpen}
                  type="button"
                >
                  {current.source.title}
                </button>
              ) : null}
              {current.source.snippet ? (
                <p className={styles.sourceCitationSnippet}>{current.source.snippet}</p>
              ) : null}
              {current.source.date ? (
                <p className={styles.sourceCitationDate}>{current.source.date}</p>
              ) : null}
              <button
                className={styles.sourceCitationUrl}
                onClick={openCurrent}
                onFocus={scheduleOpen}
                type="button"
              >
                {current.source.url}
              </button>
            </section>,
            document.body,
          )
        : null}
    </fieldset>
  );
}
