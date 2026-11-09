import { t } from "../i18n/pt-BR.ts";

const SAFE_PREFIXES = [
  "data:image/webp;base64,",
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
] as const;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_AVATAR_BYTES = 60_000;
const AVATAR_PIXELS = 256;
const QUALITIES = [0.85, 0.7, 0.5] as const;

/** Só estes formatos entram em `src`; qualquer outra coisa conta como sem foto. */
export function isSafeAvatar(value: unknown): value is string {
  return typeof value === "string" && SAFE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** Recorte quadrado centralizado da imagem. */
export function coverCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/** Primeira letra em maiúscula (sem cortar emoji ou par substituto), ou "" sem nome. */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  const first = new Intl.Segmenter("pt-BR", { granularity: "grapheme" })
    .segment(trimmed)
    [Symbol.iterator]()
    .next();
  const letter = first.done ? "" : first.value.segment;
  return letter.toLocaleUpperCase("pt-BR");
}

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/** Lê os bytes do arquivo (sem alterá-lo) e devolve uma foto 256×256 como data URL. */
export async function prepareAvatar(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error(t.profile.avatarTypeNotAccepted);
  if (file.size > MAX_FILE_BYTES) throw new Error(t.profile.avatarFileTooLarge);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(t.profile.avatarUnreadable);
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PIXELS;
    canvas.height = AVATAR_PIXELS;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t.profile.avatarUnreadable);
    const { sx, sy, size } = coverCrop(bitmap.width, bitmap.height);
    context.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS);
    for (const quality of QUALITIES) {
      const dataUrl = canvas.toDataURL("image/webp", quality);
      if (isSafeAvatar(dataUrl) && dataUrlBytes(dataUrl) <= MAX_AVATAR_BYTES) return dataUrl;
    }
    throw new Error(t.profile.avatarTooComplex);
  } finally {
    bitmap.close();
  }
}
