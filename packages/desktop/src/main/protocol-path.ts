import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

const protocolPrefix = "karont://app";

export async function resolveProtocolPath(
  url: string,
  distDirectory: string,
): Promise<string | null> {
  if (!url.toLowerCase().startsWith(`${protocolPrefix}/`)) return null;
  const rawPath = url.slice(protocolPrefix.length);
  if (rawPath.includes("?") || rawPath.includes("#") || /%(?:2f|5c)/i.test(rawPath)) {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (
    !decodedPath.startsWith("/") ||
    decodedPath.startsWith("//") ||
    decodedPath.includes("\\") ||
    decodedPath.includes("\0")
  ) {
    return null;
  }

  const segments = decodedPath.slice(1).split("/");
  if (segments.length === 1 && segments[0] === "") {
    segments[0] = "index.html";
  } else if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  let root: string;
  let candidate: string;
  try {
    const absoluteDistDirectory = path.resolve(distDirectory);
    const rootInfo = await lstat(absoluteDistDirectory);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return null;
    root = await realpath(absoluteDistDirectory);
    candidate = path.resolve(root, ...segments);
  } catch {
    return null;
  }

  if (!isWithinDirectory(root, candidate)) return null;

  try {
    const realCandidate = await realpath(candidate);
    if (!isWithinDirectory(root, realCandidate)) return null;
    if (!(await stat(realCandidate)).isFile()) return null;
    return realCandidate;
  } catch {
    return null;
  }
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relativePath = path.relative(directory, candidate);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
