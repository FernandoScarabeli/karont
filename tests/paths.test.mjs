import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { migrateLegacyDirs, paths } = require('../dist/local/paths.cjs');

function resetEnvironment(root) {
  for (const name of Object.keys(process.env))
    if (name.startsWith('KARONT_') || name.startsWith('EROS_')) delete process.env[name];
  process.env.HOME = root;
  process.env.XDG_RUNTIME_DIR = path.join(root, 'runtime');
  process.env.XDG_DATA_HOME = path.join(root, 'data-home');
  process.env.XDG_CONFIG_HOME = path.join(root, 'config-home');
  for (const name of ['XDG_RUNTIME_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME'])
    fs.mkdirSync(process.env[name], { recursive: true, mode: 0o700 });
  return {
    runtimeBase: process.env.XDG_RUNTIME_DIR,
    dataBase: process.env.XDG_DATA_HOME,
    configBase: process.env.XDG_CONFIG_HOME,
  };
}

function snapshotFiles(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(root, entry.name);
      if (entry.isDirectory())
        return snapshotFiles(full).map(([relative, value]) => [
          path.join(entry.name, relative),
          value,
        ]);
      if (entry.isSymbolicLink()) return [[entry.name, `symlink:${fs.readlinkSync(full)}`]];
      return [[entry.name, fs.readFileSync(full, 'utf8')]];
    });
}

function mode(dir) {
  return fs.statSync(dir).mode & 0o777;
}

test('paths usa pastas Karont seguras, migra dados antigos e mantém EROS_* compatível', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-paths-'));
  const appNames = Object.keys(process.env).filter(
    (name) => name.startsWith('KARONT_') || name.startsWith('EROS_'),
  );
  const saved = new Map(
    [...appNames, 'HOME', 'XDG_RUNTIME_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME'].map((name) => [
      name,
      process.env[name],
    ]),
  );
  try {
    await t.test('cria os padrões Karont com modo 0700', () => {
      const xdg = resetEnvironment(path.join(root, 'sem-antigas'));
      const result = paths();
      assert.equal(result.runtime, path.join(xdg.runtimeBase, `karont-${process.getuid()}`));
      assert.equal(result.data, path.join(xdg.dataBase, 'karont'));
      assert.equal(result.config, path.join(xdg.configBase, 'karont'));
      assert.equal(result.agents, path.join(xdg.configBase, 'karont', 'agents.json'));
      assert.equal(mode(result.runtime), 0o700);
      assert.equal(mode(result.data), 0o700);
      assert.equal(mode(result.config), 0o700);
    });

    await t.test('copia config e dados sem worktrees e preserva as pastas antigas', () => {
      const xdg = resetEnvironment(path.join(root, 'com-antigas'));
      const oldConfig = path.join(xdg.configBase, 'eros');
      const oldData = path.join(xdg.dataBase, 'eros');
      fs.mkdirSync(oldConfig, { mode: 0o700 });
      fs.mkdirSync(path.join(oldData, 'worktrees', 'x'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(oldConfig, 'dots.json'), '{"versao":1}\n');
      fs.writeFileSync(path.join(oldData, 'phase0.sqlite'), 'fixture sqlite\n');
      fs.writeFileSync(path.join(oldData, 'worktrees', 'x', 'arquivo'), 'não copiar\n');
      const configSnapshot = snapshotFiles(oldConfig);
      const dataSnapshot = snapshotFiles(oldData);

      const result = paths();

      assert.equal(
        fs.readFileSync(path.join(result.config, 'dots.json'), 'utf8'),
        '{"versao":1}\n',
      );
      assert.equal(
        fs.readFileSync(path.join(result.data, 'phase0.sqlite'), 'utf8'),
        'fixture sqlite\n',
      );
      assert.equal(fs.existsSync(path.join(result.data, 'worktrees', 'x')), false);
      assert.deepEqual(snapshotFiles(oldConfig), configSnapshot);
      assert.deepEqual(snapshotFiles(oldData), dataSnapshot);
      assert.equal(mode(result.config), 0o700);
      assert.equal(mode(result.data), 0o700);
    });

    await t.test('migra dots.json antigo sem chamar paths()', () => {
      const xdg = resetEnvironment(path.join(root, 'migra-config-sozinha'));
      const oldConfig = path.join(xdg.configBase, 'eros');
      const newConfig = path.join(xdg.configBase, 'karont');
      fs.mkdirSync(oldConfig, { mode: 0o700 });
      fs.writeFileSync(path.join(oldConfig, 'dots.json'), '{"version":1}\n');

      migrateLegacyDirs();

      assert.equal(fs.readFileSync(path.join(newConfig, 'dots.json'), 'utf8'), '{"version":1}\n');
    });

    await t.test('não substitui uma pasta Karont que já existe', () => {
      const xdg = resetEnvironment(path.join(root, 'karont-existente'));
      const oldData = path.join(xdg.dataBase, 'eros');
      const newData = path.join(xdg.dataBase, 'karont');
      fs.mkdirSync(oldData, { mode: 0o700 });
      fs.writeFileSync(path.join(oldData, 'somente-antiga'), 'antiga');
      fs.mkdirSync(newData, { mode: 0o700 });
      fs.writeFileSync(path.join(newData, 'somente-nova'), 'nova');

      const result = paths();

      assert.equal(result.data, newData);
      assert.equal(fs.existsSync(path.join(result.data, 'somente-antiga')), false);
      assert.equal(fs.readFileSync(path.join(result.data, 'somente-nova'), 'utf8'), 'nova');
    });

    await t.test('não migra pastas eros que sejam symlinks', () => {
      const xdg = resetEnvironment(path.join(root, 'symlink-antigo'));
      const externalConfig = path.join(root, 'config-externa');
      const externalData = path.join(root, 'dados-externos');
      fs.mkdirSync(externalConfig, { mode: 0o700 });
      fs.mkdirSync(externalData, { mode: 0o700 });
      fs.writeFileSync(path.join(externalConfig, 'dots.json'), 'externo');
      fs.writeFileSync(path.join(externalData, 'phase0.sqlite'), 'externo');
      fs.symlinkSync(externalConfig, path.join(xdg.configBase, 'eros'));
      fs.symlinkSync(externalData, path.join(xdg.dataBase, 'eros'));

      const result = paths();

      assert.equal(fs.existsSync(path.join(result.config, 'dots.json')), false);
      assert.equal(fs.existsSync(path.join(result.data, 'phase0.sqlite')), false);
      assert.equal(fs.readFileSync(path.join(externalConfig, 'dots.json'), 'utf8'), 'externo');
      assert.equal(fs.readFileSync(path.join(externalData, 'phase0.sqlite'), 'utf8'), 'externo');
    });

    await t.test('chamadas repetidas não copiam de novo nem dão erro', () => {
      const xdg = resetEnvironment(path.join(root, 'repetido'));
      const oldData = path.join(xdg.dataBase, 'eros');
      fs.mkdirSync(oldData, { mode: 0o700 });
      fs.writeFileSync(path.join(oldData, 'estado'), 'preservado');
      const before = snapshotFiles(oldData);

      const first = paths();
      const second = paths();

      assert.equal(first.data, second.data);
      assert.equal(fs.readFileSync(path.join(second.data, 'estado'), 'utf8'), 'preservado');
      assert.deepEqual(snapshotFiles(oldData), before);
    });

    await t.test('KARONT_DATA_DIR vence EROS_DATA_DIR e EROS_DATA_DIR sozinho funciona', () => {
      const xdg = resetEnvironment(path.join(root, 'precedencia-karont'));
      const oldDir = path.join(xdg.dataBase, 'eros');
      const preferred = path.join(root, 'preferido');
      const fallback = path.join(root, 'alternativo');
      fs.mkdirSync(oldDir, { mode: 0o700 });
      fs.writeFileSync(path.join(oldDir, 'somente-antiga'), 'antiga');
      process.env.KARONT_DATA_DIR = preferred;
      process.env.EROS_DATA_DIR = fallback;

      const preferredResult = paths();

      assert.equal(preferredResult.data, preferred);
      assert.equal(fs.existsSync(path.join(preferred, 'somente-antiga')), false);
      assert.equal(fs.existsSync(path.join(oldDir, 'somente-antiga')), true);

      const secondXdg = resetEnvironment(path.join(root, 'precedencia-eros'));
      const secondOldDir = path.join(secondXdg.dataBase, 'eros');
      const legacyOverride = path.join(root, 'somente-eros');
      fs.mkdirSync(secondOldDir, { mode: 0o700 });
      fs.writeFileSync(path.join(secondOldDir, 'somente-antiga'), 'antiga');
      process.env.EROS_DATA_DIR = legacyOverride;

      const legacyResult = paths();

      assert.equal(legacyResult.data, legacyOverride);
      assert.equal(fs.existsSync(path.join(legacyOverride, 'somente-antiga')), false);
      assert.equal(fs.existsSync(path.join(secondOldDir, 'somente-antiga')), true);
    });
  } finally {
    for (const name of Object.keys(process.env))
      if (name.startsWith('KARONT_') || name.startsWith('EROS_')) delete process.env[name];
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
