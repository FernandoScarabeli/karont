import { stat } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { RecentFolder } from "@karont/contract";
import { listRecentFolderRecords } from "./db.ts";
import { ServiceError } from "./errors.ts";

export async function validateFolder(folderPath: string): Promise<{
  path: string;
  exists: boolean;
  isDirectory: boolean;
}> {
  const normalizedPath = path.resolve(folderPath);
  if (normalizedPath.length > 4_096) {
    throw new ServiceError("invalid_request", "O caminho normalizado excede 4.096 caracteres.");
  }
  try {
    const details = await stat(normalizedPath);
    return { path: normalizedPath, exists: true, isDirectory: details.isDirectory() };
  } catch {
    return { path: normalizedPath, exists: false, isDirectory: false };
  }
}

export async function listRecentFolders(
  db: DatabaseSync,
  homeDir: string,
): Promise<{ folders: RecentFolder[] }> {
  const homePath = path.resolve(homeDir);
  const folders: RecentFolder[] = [];
  for (const record of listRecentFolderRecords(db)) {
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(record.path);
    } catch {
      continue;
    }
    if (!details.isDirectory()) continue;

    const normalizedPath = path.resolve(record.path);
    const name =
      normalizedPath === homePath
        ? "~"
        : path.basename(normalizedPath) || path.parse(normalizedPath).root;
    folders.push({ path: normalizedPath, name, usedAt: record.usedAt });
    if (folders.length === 8) break;
  }
  return { folders };
}
