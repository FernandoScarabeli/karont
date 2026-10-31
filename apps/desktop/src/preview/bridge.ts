import { app, session } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { equal } from '../../../../packages/local/src/wire';
import { bootstrap } from '../main/bootstrap';
import { ensureDaemon, startHeartbeat, stopHeartbeat } from '../main/daemon';
import { channelHandlers } from '../main/ipc';
import { loadNotificationPreference, notify } from '../main/notify';
import { attachedRuns, client, rendererSinks, state } from '../main/state';

const maxBodyBytes = 256 * 1024;
const handlers = channelHandlers();
const eventClients = new Set<ServerResponse>();

type PreviewConfig = {
  token: string;
  port: number;
  origin: string;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readConfig(): PreviewConfig {
  const token = process.env.KARONT_PREVIEW_TOKEN;
  if (!token || !/^[\da-fA-F]{64,}$/.test(token))
    throw Error('KARONT_PREVIEW_TOKEN deve conter ao menos 64 caracteres hexadecimais.');

  const portValue = process.env.KARONT_PREVIEW_PORT ?? '5181';
  if (!/^\d+$/.test(portValue))
    throw Error('KARONT_PREVIEW_PORT deve ser um inteiro entre 1024 e 65535.');
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('KARONT_PREVIEW_PORT deve ser um inteiro entre 1024 e 65535.');

  const origin = process.env.KARONT_PREVIEW_ORIGIN;
  if (!origin) throw Error('KARONT_PREVIEW_ORIGIN é obrigatório.');
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw Error();
  } catch {
    throw Error('KARONT_PREVIEW_ORIGIN deve ser uma origem HTTP ou HTTPS válida, sem caminho.');
  }

  return { token, port, origin };
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      request.resume();
      reject(new HttpError(413, 'Corpo excede 256 KiB.'));
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBodyBytes) {
        settled = true;
        request.resume();
        reject(new HttpError(413, 'Corpo excede 256 KiB.'));
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function authorized(request: IncomingMessage, url: URL, config: PreviewConfig, isEvents: boolean) {
  const headerToken = request.headers['x-karont-preview-token'];
  const candidate =
    headerToken !== undefined ? headerToken : isEvents ? url.searchParams.get('token') : undefined;
  return typeof candidate === 'string' && /^[\da-fA-F]+$/.test(candidate)
    ? equal(candidate, config.token)
      ? 0
      : 401
    : 401;
}

function eventSink(channel: string, value: unknown) {
  const data = JSON.stringify(value) ?? 'null';
  for (const response of eventClients) {
    if (response.destroyed) {
      eventClients.delete(response);
      continue;
    }
    try {
      response.write(`event: ${channel}\ndata: ${data}\n\n`);
    } catch {
      response.destroy();
    }
  }
}

let server: Server | undefined;
let pingTimer: NodeJS.Timeout | undefined;
let shutdownPromise: Promise<void> | undefined;
let shuttingDown = false;

function detachWhenLastClientLeaves() {
  if (eventClients.size !== 0 || shuttingDown) return;
  void client.request({ method: 'terminal.detachAll' }).catch(() => {});
  attachedRuns.clear();
}

function handleEvents(response: ServerResponse) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();
  eventClients.add(response);
  response.on('close', () => {
    if (eventClients.delete(response)) detachWhenLastClientLeaves();
  });
}

async function handleRpc(request: IncomingMessage, response: ServerResponse) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    sendJson(response, 415, { error: 'Content-Type deve ser application/json.' });
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    sendJson(response, status, { error: errorMessage(error) });
    return;
  }

  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    sendJson(response, 400, { error: 'JSON inválido.' });
    return;
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof (input as Record<string, unknown>).channel !== 'string' ||
    Object.keys(input).some((key) => key !== 'channel' && key !== 'value')
  ) {
    sendJson(response, 400, { error: 'Corpo RPC inválido.' });
    return;
  }

  const rpc = input as { channel: string; value?: unknown };
  const handler = handlers.get(rpc.channel);
  if (!handler) {
    sendJson(response, 404, { error: 'Canal não encontrado.' });
    return;
  }

  try {
    const value = await handler(rpc.value, () => {});
    sendJson(response, 200, value === undefined ? { ok: true } : { ok: true, value });
  } catch (error) {
    sendJson(response, 200, { ok: false, error: errorMessage(error) });
  }
}

function handleRequest(request: IncomingMessage, response: ServerResponse, config: PreviewConfig) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  const host = request.headers.host;
  if (host !== `127.0.0.1:${config.port}` && host !== `localhost:${config.port}`) {
    sendJson(response, 403, { error: 'Host da requisição recusado.' });
    return;
  }
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== config.origin) {
    sendJson(response, 403, { error: 'Origem da requisição recusada.' });
    return;
  }

  let url: URL;
  try {
    url = new URL(request.url ?? '/', `http://127.0.0.1:${config.port}`);
  } catch {
    sendJson(response, 400, { error: 'URL inválida.' });
    return;
  }

  const isEvents = url.pathname === '/__karont/events' && request.method === 'GET';
  const authStatus = authorized(request, url, config, isEvents);
  if (authStatus === 401) {
    sendJson(response, 401, { error: 'Token do preview inválido ou ausente.' });
    return;
  }

  if (isEvents) {
    handleEvents(response);
    return;
  }
  if (url.pathname === '/__karont/rpc' && request.method === 'POST') {
    void handleRpc(request, response).catch((error: unknown) => {
      if (!response.destroyed && !response.writableEnded)
        sendJson(response, 400, { error: errorMessage(error) });
    });
    return;
  }
  sendJson(response, 404, { error: 'Rota não encontrada.' });
}

function listen(port: number, config: PreviewConfig) {
  server = createServer((request, response) => handleRequest(request, response, config));
  return new Promise<void>((resolve, reject) => {
    const current = server;
    if (!current) return reject(Error('Servidor HTTP indisponível.'));
    const onError = (error: Error) => {
      current.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      current.off('error', onError);
      resolve();
    };
    current.once('error', onError);
    current.once('listening', onListening);
    current.listen(port, '127.0.0.1');
  }).then(() => {
    server?.on('error', (error) => {
      console.error(`Ponte do preview: ${error.message}`);
      void shutdown(1);
    });
  });
}

async function shutdown(exitCode: number) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    stopHeartbeat();
    if (pingTimer) clearInterval(pingTimer);
    rendererSinks.delete(eventSink);
    for (const response of eventClients) response.end();
    eventClients.clear();
    client.close();
    if (server?.listening) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    app.exit(exitCode);
  })();
  return shutdownPromise;
}

function start(config: PreviewConfig) {
  app.on('window-all-closed', () => {});
  app.on('before-quit', (event) => {
    event.preventDefault();
    void shutdown(0);
  });
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  void app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      await ensureDaemon().catch(() => {
        state.connected = false;
        state.lastFailure = 'Daemon indisponível';
        notify('daemon:startup', 'Daemon indisponível');
      });
      await startHeartbeat();
      rendererSinks.add(eventSink);
      await listen(config.port, config);
      pingTimer = setInterval(() => {
        for (const response of eventClients) response.write(': ping\n\n');
      }, 15_000);
      pingTimer.unref();
      console.log(JSON.stringify({ event: 'preview-bridge-ready', port: config.port }));
    })
    .catch((error: unknown) => {
      console.error(`Ponte do preview: ${errorMessage(error)}`);
      void shutdown(1);
    });
}

let config: PreviewConfig | undefined;
try {
  bootstrap();
  loadNotificationPreference();
  state.headless = true;
  config = readConfig();
} catch (error) {
  console.error(`Ponte do preview: ${errorMessage(error)}`);
  app.exit(1);
}

if (config) start(config);
