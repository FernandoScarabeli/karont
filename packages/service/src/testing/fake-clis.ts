import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createFakeCliDir(names: string[]): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "karont-fake-clis-"));
  for (const name of names) {
    const executablePath = path.join(directory, name);
    await writeFile(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await chmod(executablePath, 0o755);
  }
  return directory;
}
