import { resolvePaths } from "./paths.ts";
import { ServiceAlreadyRunningError, startService } from "./server.ts";

try {
  const paths = resolvePaths();
  const service = await startService({
    paths,
    dev: process.env.KARONT_DEV === "1",
  });
  process.stderr.write(`karont-service ready ${paths.socketPath}\n`);

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await service.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
} catch (error) {
  if (error instanceof ServiceAlreadyRunningError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 3;
  } else {
    process.stderr.write(`Falha ao iniciar o serviço Karont: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
