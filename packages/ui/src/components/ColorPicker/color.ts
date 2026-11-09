/* Cores do Dot e do seletor: funções puras, sem DOM e sem dependência.
   Os valores hex das amostras e o padrão ficam só aqui. */

export type Rgb = { r: number; g: number; b: number };
/* h em graus (0..360), s e v em 0..1 */
export type Hsv = { h: number; s: number; v: number };

/* O grafite da referência do Dot, e as seis cores da decisão 8 do dono
   (marfim, magenta, turquesa, lima, azul elétrico, coral). */
export const DEFAULT_COLOR = "#232325";
export const SWATCHES = [
  { id: "graphite", hex: DEFAULT_COLOR },
  { id: "ivory", hex: "#f3eee3" },
  { id: "magenta", hex: "#ff4f8b" },
  { id: "turquoise", hex: "#2dd4c4" },
  { id: "lime", hex: "#c6f135" },
  { id: "blue", hex: "#5b8cff" },
  { id: "coral", hex: "#ff7a59" },
] as const;
export type SwatchId = (typeof SWATCHES)[number]["id"];

/* Último recurso dos olhos: preto e branco puros sempre passam de 4,5:1 em
   alguma das duas pontas, qualquer que seja o corpo. */
const FALLBACK_LIGHT = "#ffffff";
const FALLBACK_DARK = "#000000";

/* Contraste mínimo do texto normal (WCAG AA). */
export const MIN_EYE_CONTRAST = 4.5;
/* Abaixo disso o corpo quase some no fundo do app e ganha contorno.
   Um grafite sobre o fundo escuro dá cerca de 1,2:1 e um azul elétrico passa de 5:1;
   2:1 pega os cinzas e azuis-marinho escuros (até uns #4a4a4d) sem marcar corpos médios.
   Pede menos que os 3:1 de um gráfico porque o corpo é grande e tem olhos. */
export const OUTLINE_BELOW_CONTRAST = 2;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const toHexPart = (v: number) =>
  Math.round(clamp(v, 0, 255))
    .toString(16)
    .padStart(2, "0");

/* "#rgb", "rgb", "#rrggbb" ou "rrggbb", sem diferenciar maiúsculas; devolve
   "#rrggbb" em minúsculas, ou null se não for uma cor. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  const raw = m?.[1];
  if (!raw) return null;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return `#${full.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: Number.parseInt(n.slice(1, 3), 16),
    g: Number.parseInt(n.slice(3, 5), 16),
    b: Number.parseInt(n.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const vv = clamp(v, 0, 1);
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  const sector = Math.floor(hh / 60);
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

/* Luminância relativa do WCAG 2: 0 (preto) a 1 (branco). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/* Razão de contraste do WCAG 2: de 1 a 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* A cor dos olhos para um corpo: a das duas candidatas (a clara e a escura do
   app) que mais contrasta. Se nenhuma chegar a 4,5:1, cai para branco ou preto
   puro, que sempre chegam. Devolve também a razão, para quem quiser conferir. */
export function pickEyeColor(
  body: string,
  light: string,
  dark: string,
): { color: string; ratio: number } {
  const options = [light, dark, FALLBACK_LIGHT, FALLBACK_DARK].map((color) => ({
    color,
    ratio: contrastRatio(body, color),
  }));
  const [first, second] = options;
  const best = (first?.ratio ?? 0) >= (second?.ratio ?? 0) ? first : second;
  if (best && best.ratio >= MIN_EYE_CONTRAST) return best;
  const [, , white, black] = options;
  const fallback = (white?.ratio ?? 0) >= (black?.ratio ?? 0) ? white : black;
  return fallback ?? { color: FALLBACK_DARK, ratio: 21 };
}

/* O corpo some no fundo do app? Então ganha um contorno sutil. */
export function needsOutline(body: string, background: string): boolean {
  return contrastRatio(body, background) < OUTLINE_BELOW_CONTRAST;
}
