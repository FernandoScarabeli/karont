/* O contorno do Véu, escrito a cada quadro.

   O topo é redondo e fica sempre no mesmo lugar: é a cabeça. O que se mexe é
   o pano. As laterais descem curvando com a inclinação e a barra, com as três
   ondinhas, vai para onde o pano o leva. Quem chama (o laço do EyeTracker)
   decide o quanto: aqui só se desenha.

   Tudo no viewBox de 100 unidades. */

/* a cabeça: onde o rosto repousa (o meio dos olhos) */
export const VEIL_FACE_Y = 44;

/* as cinco pontas da barra, da direita para a esquerda: três descem (as
   ondinhas) e duas sobem entre elas */
const HEM_X = [77, 63, 50, 37, 23] as const;
const HEM_Y = [91, 85, 91, 85, 91] as const;
/* o ombro, onde a lateral começa, e a altura onde ela vira a quina da barra */
const SHOULDER_Y = 46;
const CORNER_Y = 80;
const EDGE_L = 14;
const EDGE_R = 86;
/* quanto a barra passa de uma onda para a seguinte: 1,3 rad entre vizinhas faz
   a ondulação correr de um lado ao outro, em vez de a barra subir e descer
   toda de uma vez */
const PHASE_STEP = 1.3;
/* ondulação parada: pouco mais de um por cento da altura, só para não ser estátua */
const RIPPLE_BASE = 1.2;
/* e cada unidade de pano arrastado soma um oitavo: quanto mais ele balança, mais ondula */
const RIPPLE_LEAN = 0.12;
/* a abertura da barra: as pontas de baixo descem um terço do que ela abre e as de cima
   sobem um décimo, para a barra se abrir como uma saia e não só alargar */
const FLARE_DROP = 0.3;
const FLARE_LIFT = 0.1;
/* o quanto a lateral acompanha o pano: pouco no ombro, mais embaixo */
const SIDE_TOP_FOLLOW = 0.1;
const SIDE_LOW_FOLLOW = 0.55;

const n = (v: number) => v.toFixed(2);

/* lean: quanto a barra foi arrastada para o lado, em unidades (positivo = direita)
   wave: a fase da ondulação, em radianos
   flare: quanto a barra se abre, em unidades de cada lado (0 = fechada)
   energy: a força da ondulação (1 normal, perto de 0 dormindo, mais de 1 trabalhando) */
export function veilPath(lean: number, wave: number, flare: number, energy = 1): string {
  const amp = energy * (RIPPLE_BASE + RIPPLE_LEAN * Math.abs(lean));
  const open = 1 + flare / (EDGE_R - 50);
  const pts = HEM_X.map((x, i) => {
    const base = HEM_Y[i] ?? 0;
    const low = i % 2 === 0;
    return {
      x: 50 + (x - 50) * open + lean,
      y: base + amp * Math.sin(wave + i * PHASE_STEP) + flare * (low ? FLARE_DROP : -FLARE_LIFT),
    };
  });
  const [p1, p2, p3, p4, p5] = pts as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  const rx = EDGE_R + flare + lean;
  const lx = EDGE_L - flare + lean;
  /* uma curva em S entre duas pontas, saindo e chegando na horizontal */
  const hem = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const k = (b.x - a.x) * 0.45;
    return `C${n(a.x + k)} ${n(a.y)} ${n(b.x - k)} ${n(b.y)} ${n(b.x)} ${n(b.y)}`;
  };
  return [
    `M${EDGE_L} ${SHOULDER_Y}`,
    `C${EDGE_L} 24 29 8 50 8`,
    `C71 8 ${EDGE_R} 24 ${EDGE_R} ${SHOULDER_Y}`,
    `C${n(EDGE_R + lean * SIDE_TOP_FOLLOW)} 58 ${n(EDGE_R + flare * 0.5 + lean * SIDE_LOW_FOLLOW)} 70 ${n(rx)} ${CORNER_Y}`,
    `C${n(rx)} ${CORNER_Y + 8} ${n(p1.x + 5)} ${n(p1.y + 1)} ${n(p1.x)} ${n(p1.y)}`,
    hem(p1, p2),
    hem(p2, p3),
    hem(p3, p4),
    hem(p4, p5),
    `C${n(p5.x - 5)} ${n(p5.y + 1)} ${n(lx)} ${CORNER_Y + 8} ${n(lx)} ${CORNER_Y}`,
    `C${n(EDGE_L - flare * 0.5 + lean * SIDE_LOW_FOLLOW)} 70 ${n(EDGE_L + lean * SIDE_TOP_FOLLOW)} 58 ${EDGE_L} ${SHOULDER_Y}`,
    "Z",
  ].join(" ");
}
