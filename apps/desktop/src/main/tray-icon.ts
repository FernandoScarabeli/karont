import { nativeImage } from 'electron';

// A native BGRA bitmap avoids platform-dependent SVG decoding in NativeImage.
export function trayIcon() {
  const size = 24;
  const pixels = Buffer.alloc(size * size * 4);
  const glyph = ['00000', '01110', '10001', '11111', '10000', '01111', '00000'];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const gx = Math.floor((x - 7) / 2);
      const gy = Math.floor((y - 5) / 2);
      const ink = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && glyph[gy][gx] === '1';
      const offset = (y * size + x) * 4;
      pixels[offset] = ink ? 27 : 133;
      pixels[offset + 1] = ink ? 34 : 223;
      pixels[offset + 2] = ink ? 25 : 193;
      pixels[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 1 });
}
