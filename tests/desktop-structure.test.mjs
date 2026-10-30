import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const desktop = 'apps/desktop/src';

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

test('estrutura: só renderer/main.tsx importa CSS, para a ordem da cascata ficar num lugar', () => {
  const importers = sources(path.join(desktop, 'renderer')).filter((file) =>
    /^import\s+['"][^'"]+\.css['"]/m.test(fs.readFileSync(file, 'utf8')),
  );
  assert.deepEqual(importers, [path.join(desktop, 'renderer', 'main.tsx')]);
});

test('estrutura: o processo principal chama bootstrap() antes de qualquer outra instrução', () => {
  const body = fs
    .readFileSync(path.join(desktop, 'main', 'index.ts'), 'utf8')
    .replace(/^import\b[\s\S]*?;$/gm, '')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('//'));
  assert.equal(body[0].trim(), 'bootstrap();');
});
