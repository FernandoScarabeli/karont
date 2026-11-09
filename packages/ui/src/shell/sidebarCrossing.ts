import { MOTION_MS } from "../styles/motion.ts";

const WIDTH_VARIABLE = "--k-sidebar-current-width";

type Values = { sidebarGrow: number; mainGrow: number; width: number };

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easing(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--k-ease").trim();
  return value || "ease-out";
}

/**
 * Anima só a passagem aberta↔recolhida durante o arrasto da alça. A biblioteca faz o pulo de uma
 * vez; aqui a largura (dos dois painéis e do topo) vai do valor visto na tela até o novo, com a
 * duração e a curva do botão. Depois disso o arrasto volta a seguir o ponteiro sem atraso: a
 * animação só existe enquanto roda, e o fim dela acompanha o último valor da biblioteca.
 * Tudo por Web Animations, sem re-render do React por quadro.
 */
export class SidebarCrossing {
  #animations: Animation[] = [];
  #from: Values | null = null;

  get running(): boolean {
    return this.#animations.some((animation) => animation.playState === "running");
  }

  /** Valores que o usuário está vendo agora (incluem a animação em curso). */
  #visible(shell: HTMLElement, sidebar: HTMLElement, main: HTMLElement): Values {
    return {
      sidebarGrow: Number.parseFloat(getComputedStyle(sidebar).flexGrow),
      mainGrow: Number.parseFloat(getComputedStyle(main).flexGrow),
      width: Number.parseFloat(getComputedStyle(shell).getPropertyValue(WIDTH_VARIABLE)),
    };
  }

  /**
   * `previous`: valores de antes do pulo, usados quando não há animação em curso.
   * `next`: valores novos já aplicados pela biblioteca.
   */
  start(
    elements: { shell: HTMLElement; sidebar: HTMLElement; main: HTMLElement },
    previous: Values,
    next: Values,
  ): void {
    if (prefersReducedMotion()) return;
    const { shell, sidebar, main } = elements;
    const from = this.running ? this.#visible(shell, sidebar, main) : previous;
    this.cancel();
    if ([...Object.values(from), ...Object.values(next)].some((value) => !Number.isFinite(value))) {
      return;
    }
    this.#from = from;
    const options: KeyframeAnimationOptions = {
      duration: MOTION_MS.slow,
      easing: easing(),
    };
    this.#animations = [
      sidebar.animate([{ flexGrow: from.sidebarGrow }, { flexGrow: next.sidebarGrow }], options),
      main.animate([{ flexGrow: from.mainGrow }, { flexGrow: next.mainGrow }], options),
      shell.animate(
        [{ [WIDTH_VARIABLE]: `${from.width}px` }, { [WIDTH_VARIABLE]: `${next.width}px` }],
        options,
      ),
    ];
  }

  /** O ponteiro continua andando durante a animação: o destino acompanha o valor novo. */
  retarget(next: Values): void {
    const from = this.#from;
    if (!from || !this.running) return;
    const ends = [next.sidebarGrow, next.mainGrow, next.width];
    const starts = [from.sidebarGrow, from.mainGrow, from.width];
    const names = ["flexGrow", "flexGrow", WIDTH_VARIABLE];
    this.#animations.forEach((animation, index) => {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect)) return;
      const unit = index === 2 ? "px" : "";
      const name = names[index] as string;
      effect.setKeyframes([
        { [name]: `${starts[index]}${unit}` },
        { [name]: `${ends[index]}${unit}` },
      ]);
    });
  }

  cancel(): void {
    for (const animation of this.#animations) animation.cancel();
    this.#animations = [];
    this.#from = null;
  }
}
