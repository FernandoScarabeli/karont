import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGecosName } from '../dist/desktop/systemUser.cjs';

test('parse o primeiro item do campo GECOS para o uid correspondente', () => {
  assert.equal(
    parseGecosName('fulano:x:1000:1000:Fulano de Tal,,,:/home/f:/bin/bash', 1000),
    'Fulano de Tal',
  );
});

test('retorna null quando o campo GECOS está vazio', () => {
  assert.equal(parseGecosName('fulano:x:1000:1000:,,,:/home/f:/bin/bash', 1000), null);
});

test('remove espaços sobrando do primeiro item do campo GECOS', () => {
  assert.equal(parseGecosName('fulano:x:1000:1000:  Fulano de Tal  ,,,', 1000), 'Fulano de Tal');
});

test('retorna null quando o uid não aparece', () => {
  assert.equal(parseGecosName('fulano:x:1000:1000:Fulano,,,:/home/f:/bin/bash', 1001), null);
});

test('procura o uid entre várias linhas', () => {
  const passwd = [
    'root:x:0:0:root,,,:/root:/bin/bash',
    'outro:x:1001:1001:Outro Nome,,,:/home/outro:/bin/bash',
    'fulano:x:1000:1000:Fulano de Tal,,,:/home/f:/bin/bash',
  ].join('\n');

  assert.equal(parseGecosName(passwd, 1000), 'Fulano de Tal');
});
