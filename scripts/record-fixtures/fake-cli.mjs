import { createFakeCli } from "./fake-transport.mjs";

const [agent] = process.argv.slice(2);
if (agent !== "claude" && agent !== "codex") {
  process.stderr.write(`Agente falso desconhecido: ${agent ?? "(vazio)"}\n`);
  process.exitCode = 2;
} else {
  const fake = createFakeCli(agent, process.env.KARONT_RECORDER_SCENARIO ?? "texto");
  process.stdin.pipe(fake.stdin);
  fake.stdout.pipe(process.stdout);
  fake.stderr.pipe(process.stderr);
  fake.once("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
