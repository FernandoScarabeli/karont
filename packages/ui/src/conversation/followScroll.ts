// Rolagem suave até o fim durante o streaming. Uma mola criticamente amortecida
// (bounce 0) puxa scrollTop até o alvo, em vez de pular de uma vez.

import { MOTION_MS } from "../styles/motion.ts";

export type SpringState = { position: number; velocity: number };

const FRAME_MS = 16;
const MAX_STEP_MS = 50;
const SETTLE_PX = 0.5;
const SETTLE_PX_PER_S = 0.5;

// Passo exato da mola criticamente amortecida (sem integração numérica, então o
// resultado não depende do tamanho do quadro). Não ultrapassa o alvo. Em
// durationMs, ~96% do caminho está feito.
export function stepCriticalSpring(
  state: SpringState,
  target: number,
  dtMs: number,
  durationMs: number = MOTION_MS.moderate,
): SpringState {
  const omega = 5000 / durationMs;
  const t = Math.max(0, dtMs) / 1000;
  const offset = state.position - target;
  const b = state.velocity + omega * offset;
  const decay = Math.exp(-omega * t);
  const shifted = offset + b * t;
  return {
    position: target + shifted * decay,
    velocity: (b - omega * shifted) * decay,
  };
}

export function isSpringSettled(state: SpringState, target: number): boolean {
  return (
    Math.abs(state.position - target) < SETTLE_PX && Math.abs(state.velocity) < SETTLE_PX_PER_S
  );
}

// Dirige a rolagem de uma lista até o fim. Roda um rAF só enquanto a mola não
// assentou. Cada quadro lê a altura e a posição antes de escrever scrollTop, então
// há no máximo uma leitura de layout por quadro e nenhum reflow forçado.
export class FollowScroller {
  private readonly list: HTMLElement;
  private readonly isFollowing: () => boolean;
  private readonly reduceMotion: boolean;
  private frame: number | null = null;
  private velocity = 0;
  private lastTime: number | null = null;

  constructor(list: HTMLElement, isFollowing: () => boolean) {
    this.list = list;
    this.isFollowing = isFollowing;
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Chamado a cada crescimento do conteúdo. Não faz nada se não estiver acompanhando
  // ou se a mola já está rodando.
  kick(): void {
    if (this.frame !== null || !this.isFollowing()) return;
    this.lastTime = null;
    this.frame = window.requestAnimationFrame(this.step);
  }

  // Chamado quando o usuário rola para cima: a mola para na hora.
  stop(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.velocity = 0;
    this.lastTime = null;
  }

  dispose(): void {
    this.stop();
  }

  private readonly step = (time: number): void => {
    this.frame = null;
    if (!this.isFollowing()) {
      this.velocity = 0;
      this.lastTime = null;
      return;
    }

    const list = this.list;
    const target = Math.max(0, list.scrollHeight - list.clientHeight);
    const position = list.scrollTop;

    if (this.reduceMotion) {
      list.scrollTop = target;
      this.velocity = 0;
      this.lastTime = null;
      return;
    }

    const dt =
      this.lastTime === null ? FRAME_MS : Math.min(MAX_STEP_MS, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    const next = stepCriticalSpring({ position, velocity: this.velocity }, target, dt);
    if (isSpringSettled(next, target)) {
      list.scrollTop = target;
      this.velocity = 0;
      this.lastTime = null;
      return;
    }

    this.velocity = next.velocity;
    list.scrollTop = next.position;
    this.frame = window.requestAnimationFrame(this.step);
  };
}
