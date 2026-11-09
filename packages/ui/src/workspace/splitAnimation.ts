import { MOTION_MS } from "../styles/motion.ts";

/** Fração do tempo que o painel novo espera, e que dura o fade do conteúdo dele. */
const FADE_DELAY_RATIO = 0.35;
const FADE_DURATION_RATIO = 0.5;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easing(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--k-ease").trim();
  return value || "ease-out";
}

let activeFinish: (() => void) | null = null;

/**
 * Anima o painel recém-criado por "Dividir": ele cresce de zero até o tamanho final e o painel
 * à esquerda encolhe até o dele (transição de `flex-grow`, sem re-render do React).
 * O conteúdo dos dois fica com largura fixa durante o movimento, então o campo de mensagem e o
 * terminal só refazem o layout no fim. O layout final já está no estado; isto só cobre o caminho.
 * Devolve `null` quando não anima (movimento reduzido ou painéis fora do esperado).
 */
export function animateSplit(surface: HTMLElement): (() => void) | null {
  if (prefersReducedMotion()) return null;
  const newPanel = surface.closest<HTMLElement>("[data-panel]");
  const group = newPanel?.parentElement;
  const separator = newPanel?.previousElementSibling;
  const oldPanel = separator?.previousElementSibling;
  if (
    !newPanel ||
    !group ||
    !(separator instanceof HTMLElement) ||
    !(oldPanel instanceof HTMLElement) ||
    !oldPanel.hasAttribute("data-panel")
  ) {
    return null;
  }
  const newInner = newPanel.firstElementChild;
  const oldInner = oldPanel.firstElementChild;
  if (!(newInner instanceof HTMLElement) || !(oldInner instanceof HTMLElement)) return null;

  const newGrow = Number.parseFloat(newPanel.style.flexGrow);
  const oldGrow = Number.parseFloat(oldPanel.style.flexGrow);
  if (!Number.isFinite(newGrow) || !Number.isFinite(oldGrow) || newGrow <= 0) return null;

  activeFinish?.();

  const newWidth = newPanel.getBoundingClientRect().width;
  const oldWidth = oldPanel.getBoundingClientRect().width;
  const separatorWidth = separator.getBoundingClientRect().width;
  const duration = MOTION_MS.slow;
  const curve = easing();

  group.dataset.splitting = "true";
  const fixWidth = (element: HTMLElement, width: number) => {
    element.style.width = `${width}px`;
    element.style.minWidth = `${width}px`;
  };
  fixWidth(newInner, newWidth);
  fixWidth(oldInner, oldWidth + newWidth + separatorWidth);

  const animations = [
    newPanel.animate([{ flexGrow: 0 }, { flexGrow: newGrow }], {
      duration,
      easing: curve,
      fill: "both",
    }),
    oldPanel.animate([{ flexGrow: oldGrow + newGrow }, { flexGrow: oldGrow }], {
      duration,
      easing: curve,
      fill: "both",
    }),
    newInner.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: duration * FADE_DURATION_RATIO,
      delay: duration * FADE_DELAY_RATIO,
      easing: curve,
      fill: "both",
    }),
  ];

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    for (const animation of animations) animation.cancel();
    for (const element of [newInner, oldInner]) {
      element.style.removeProperty("width");
      element.style.removeProperty("min-width");
    }
    delete group.dataset.splitting;
    window.removeEventListener("pointerdown", finish, true);
    window.removeEventListener("keydown", finish, true);
    if (activeFinish === finish) activeFinish = null;
  };
  // Pegar a divisória, clicar ou digitar durante o movimento termina na hora, no layout final.
  const finish = () => {
    if (done) return;
    for (const animation of animations) animation.finish();
    cleanup();
  };
  activeFinish = finish;
  window.addEventListener("pointerdown", finish, true);
  window.addEventListener("keydown", finish, true);
  Promise.all(animations.map((animation) => animation.finished)).then(cleanup, cleanup);
  return finish;
}
