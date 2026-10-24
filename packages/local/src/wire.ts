import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
export const LIMIT = 65536;
export function proof(secret: string, role: string, nonce: string) {
  return createHmac('sha256', secret).update(`eros:1:${role}:${nonce}`).digest('hex');
}
export function equal(a: unknown, b: string) {
  return (
    typeof a === 'string' &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function send(s: Socket, value: unknown) {
  const line = JSON.stringify(value) + '\n';
  if (s.writableLength + Buffer.byteLength(line) > LIMIT) {
    s.destroy();
    return;
  }
  s.write(line);
}
export function frames(s: Socket, receive: (v: any) => void) {
  let buffer = Buffer.alloc(0);
  s.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > LIMIT) {
      s.destroy();
      return;
    }
    let n;
    while ((n = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, n);
      buffer = buffer.subarray(n + 1);
      try {
        receive(JSON.parse(line.toString('utf8')));
      } catch {
        s.destroy();
        return;
      }
    }
  });
}
