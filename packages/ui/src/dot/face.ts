/* O rosto do Dot: onde cada olho fica e como a pálpebra o cobre.

   Só contas, sem DOM e sem alocar: quem chama (o laço do EyeTracker) passa um
   objeto para ser preenchido a cada quadro. Fica separado para poder ser
   testado — a garantia de que os olhos (e as pálpebras, que são da cor do
   corpo) nunca saem do contorno vem daqui, já que o corpo não usa clipPath.

   Tudo no viewBox de 100 unidades. */

/* os olhos: dois retângulos arredondados do mesmo tamanho */
export const EYE = { w: 8, h: 14, r: 4 };
/* metade do vão entre os olhos */
export const HALF_GAP = 9;
/* quanto o rosto anda do ponto de repouso, nas mesmas unidades: a cara de uma
   alminha ocupa uma parte pequena do corpo, então os olhos ficam dentro do
   contorno mesmo olhando longe para um lado */
export const REACH_X = 16;
export const REACH_Y = 10;
/* a esfera em que os olhos são calculados, como fração de HALF_GAP */
export const GAP = 0.19;
/* quanto o olhar para um canto inclina o par, em graus na borda */
export const TILT = 24;
/* o olho menor do par, quando um é maior que o outro: a fatia que o maior leva */
const ASYMMETRY_SMALL = 0.35;
/* o menor tamanho de um olho que ainda se vê (a linha de quem dorme) */
const MIN_EYE_H = 0.6;
const MIN_EYE_W = 0.01;

/* A pálpebra é um retângulo arredondado na cor do corpo por cima do olho.
   `pad` é quanto ela passa do olho para o lado de fora, para cortar limpo
   mesmo inclinada; `over` quanto passa dos lados. */
export const LID_PAD = 3;
const LID_OVER = 3;
/* a pálpebra de baixo (olho de meia-lua) quase não passa dos lados: sua ponta
   redonda é que desenha o arco */
const LID_OVER_ARCH = 0.6;
/* a quina da pálpebra de cima, que corta reto */
const LID_EDGE_R = 1.5;
/* abaixo disto a pálpebra some */
const LID_MIN = 0.02;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const turn = (v: number) => Math.asin(clamp(v, -0.92, 0.92));

export type EyeGeom = {
  /* o centro, no desenho */
  px: number;
  py: number;
  /* a inclinação do par, em graus */
  tilt: number;
  w: number;
  h: number;
  rx: number;
};

export type LidGeom = {
  /* relativos ao centro do olho, antes de girar */
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  /* graus, já com o sinal do lado (positivo = ponta de dentro para baixo) */
  rot: number;
  show: boolean;
};

export const newEye = (): EyeGeom => ({ px: 0, py: 0, tilt: 0, w: 0, h: 0, rx: 0 });
export const newLid = (): LidGeom => ({ x: 0, y: 0, w: 0, h: 0, rx: 0, rot: 0, show: false });

/* O olho `i` (0 esquerdo, 1 direito) como um ponto numa esfera sob a superfície
   do corpo, virada pelo olhar (lookX, lookY de -1 a 1). O que vai para a borda
   anda menos e estreita; o outro dá a volta. É isso que faz uma forma chata
   parecer redonda.
   `ey` desce o par, `ew` e `eh` escalam, `ea` faz o direito maior que o
   esquerdo, `blink` (1 aberto) achata. */
export function placeEye(
  out: EyeGeom,
  i: 0 | 1,
  lookX: number,
  lookY: number,
  faceY: number,
  ey: number,
  ew: number,
  eh: number,
  ea: number,
  blink: number,
): EyeGeom {
  const x0 = i === 0 ? -GAP : GAP;
  const yaw = turn(lookX);
  const pitch = -turn(lookY);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const z0 = Math.sqrt(1 - x0 * x0);
  const z1 = -x0 * sy + z0 * cy;
  const y2 = -z1 * sp;
  const z2 = z1 * cp;
  /* profundidade: o olho perto da borda está mais longe, menor e mais estreito */
  const near = clamp(z2, 0, 1);
  const k = 0.45 + 0.55 * near;
  const sx = k * (0.7 + 0.3 * near);
  const side = i === 1 ? 1 + ea : 1 - ea * ASYMMETRY_SMALL;
  /* o tamanho vai como tamanho, nunca como escala: a escala estica a quina
     junto e o canto fica elíptico */
  out.w = Math.max(MIN_EYE_W, EYE.w * ew * sx * side);
  out.h = Math.max(MIN_EYE_H, EYE.h * eh * k * blink * side);
  out.rx = Math.min(EYE.r * ew, out.w / 2, out.h / 2);
  out.px = 50 + (x0 / GAP) * HALF_GAP * cy + z0 * sy * REACH_X;
  out.py = faceY + ey + y2 * REACH_Y;
  out.tilt = TILT * lookX * lookY;
  return out;
}

/* A pálpebra do olho `eye`. `lc` é o quanto ela cobre, em fração da altura do
   olho: positivo vem de baixo (olho de meia-lua), negativo vem de cima (olho
   bravo ou caído). Passando por zero ela some por um lado e entra pelo outro.
   `lr` inclina: positivo leva a ponta de dentro para baixo (bravo), negativo a
   de fora (triste); o sinal troca de um olho para o outro. */
export function placeLid(out: LidGeom, eye: EyeGeom, i: 0 | 1, lc: number, lr: number): LidGeom {
  const hh = eye.h / 2;
  let top: number;
  let bottom: number;
  if (lc >= 0) {
    top = hh - lc * eye.h;
    bottom = hh + LID_PAD;
  } else {
    top = -hh - LID_PAD;
    bottom = -hh - lc * eye.h;
  }
  const over = lc >= 0 ? LID_OVER_ARCH : LID_OVER;
  out.show = Math.abs(lc) > LID_MIN;
  out.w = eye.w + 2 * over;
  out.x = -out.w / 2;
  out.y = top;
  out.h = bottom - top;
  out.rx = lc >= 0 ? Math.min(out.w / 2, out.h / 2) : Math.min(LID_EDGE_R, out.h / 2);
  out.rot = i === 0 ? lr : -lr;
  return out;
}
