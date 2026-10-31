import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createServer } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = resolve(projectRoot, 'apps/desktop');
const bridgePort = 5181;
const previewOrigin = 'http://127.0.0.1:5180';
const previewHtmlPath = resolve(rendererRoot, 'preview.html');
let token;
let bridge;
let viteServer;
let stopping = false;
let stopPromise;

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runBuild() {
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, ['scripts/build.mjs'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    child.once('error', rejectBuild);
    child.once('close', (code) => {
      if (code === 0) resolveBuild();
      else
        rejectBuild(new Error(`scripts/build.mjs encerrou com código ${code ?? 'desconhecido'}.`));
    });
  });
}

async function bridgeEnvironment() {
  const environment = {
    ...process.env,
    KARONT_PREVIEW_TOKEN: token,
    KARONT_PREVIEW_PORT: String(bridgePort),
    KARONT_PREVIEW_ORIGIN: previewOrigin,
    KARONT_DESKTOP_DATA: resolve(
      process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
      'karont-preview',
    ),
  };
  const sandboxPath = '/usr/local/lib/karont-dev/chrome-sandbox';
  if (!environment.CHROME_DEVEL_SANDBOX && (await fileExists(sandboxPath)))
    environment.CHROME_DEVEL_SANDBOX = sandboxPath;
  return environment;
}

function startBridge(environment) {
  bridge = spawn(electron, ['dist/desktop/preview-bridge.cjs'], {
    cwd: projectRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolveReady, rejectReady) => {
    let ready = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const timeout = setTimeout(() => {
      rejectReady(new Error('A ponte não ficou pronta em até 30 segundos.'));
    }, 30_000);

    const handleStdoutLine = (line) => {
      if (line) console.log(`[ponte] ${line}`);
      try {
        const event = JSON.parse(line);
        if (event.event === 'preview-bridge-ready' && event.port === bridgePort && !ready) {
          ready = true;
          clearTimeout(timeout);
          resolveReady();
        }
      } catch {
        // Linhas que não são JSON são apenas saída da ponte.
      }
    };
    const handleStderrLine = (line) => {
      if (line) console.error(`[ponte] ${line}`);
    };

    bridge.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) handleStdoutLine(line.trimEnd());
    });
    bridge.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) handleStderrLine(line.trimEnd());
    });
    bridge.once('error', (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    bridge.once('close', (code, signal) => {
      if (stdoutBuffer) handleStdoutLine(stdoutBuffer.trimEnd());
      if (stderrBuffer) handleStderrLine(stderrBuffer.trimEnd());
      if (!ready) {
        clearTimeout(timeout);
        rejectReady(
          new Error(
            `A ponte encerrou antes de ficar pronta (código ${code ?? 'desconhecido'}${signal ? `, sinal ${signal}` : ''}). Verifique se a porta ${bridgePort} está livre.`,
          ),
        );
      } else if (!stopping) {
        console.error(`A ponte encerrou inesperadamente (código ${code ?? 'desconhecido'}).`);
        void shutdown(1);
      }
    });
  });
}

async function stopBridge() {
  if (!bridge || bridge.exitCode !== null || bridge.signalCode !== null) return;
  const closed = new Promise((resolveClosed) => bridge.once('close', resolveClosed));
  bridge.kill('SIGTERM');
  const forceStop = setTimeout(() => bridge?.kill('SIGKILL'), 3000);
  let timeout;
  await Promise.race([
    closed,
    new Promise((resolveTimeout) => {
      timeout = setTimeout(resolveTimeout, 5000);
    }),
  ]);
  clearTimeout(forceStop);
  if (timeout) clearTimeout(timeout);
}

function shutdown(exitCode) {
  if (exitCode !== 0) process.exitCode = exitCode;
  if (stopping) return stopPromise;
  stopping = true;
  process.exitCode = exitCode;
  stopPromise = (async () => {
    if (viteServer) await viteServer.close().catch((error) => console.error(error));
    await stopBridge();
  })();
  return stopPromise;
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

async function launch() {
  await runBuild();
  if (stopping) return;
  token = randomBytes(32).toString('hex');
  const environment = await bridgeEnvironment();
  await startBridge(environment);
  if (stopping) return;

  viteServer = await createServer({
    root: rendererRoot,
    plugins: [
      {
        name: 'karont-preview-token',
        transformIndexHtml(html, context) {
          if (resolve(context.filename) !== previewHtmlPath) return html;
          return html.replace('%KARONT_PREVIEW_TOKEN%', token);
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5180,
      strictPort: true,
      open: false,
      proxy: {
        '/__karont': {
          target: `http://127.0.0.1:${bridgePort}`,
          changeOrigin: true,
        },
      },
    },
  });
  if (stopping) {
    await viteServer.close();
    return;
  }
  await viteServer.listen();
  console.log('Preview pronto: http://127.0.0.1:5180/preview.html');
  console.log('Este preview é apenas para desenvolvimento.');
}

try {
  await launch();
} catch (error) {
  if (!stopping) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('5180') || message.includes('EADDRINUSE'))
      console.error('Não foi possível iniciar o Vite: a porta 5180 ou 5181 está ocupada.');
    else console.error(message);
    await shutdown(1);
  }
}
