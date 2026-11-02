import { readFile } from "node:fs/promises";
import os from "node:os";

type UserNameOptions = {
  userInfo?: Pick<os.UserInfo<string>, "uid" | "username">;
  readPasswd?: () => Promise<string>;
  platform?: NodeJS.Platform;
};

export async function getSystemUserName(options: UserNameOptions = {}): Promise<string | null> {
  let userInfo: Pick<os.UserInfo<string>, "uid" | "username">;
  try {
    userInfo = options.userInfo ?? os.userInfo();
  } catch {
    return null;
  }

  const username = userInfo.username.trim();
  if ((options.platform ?? process.platform) === "linux") {
    try {
      const contents = await (options.readPasswd ?? (() => readFile("/etc/passwd", "utf8")))();
      const gecos = contents
        .split(/\r?\n/u)
        .map((line) => line.split(":"))
        .find((fields) => Number(fields[2]) === userInfo.uid)?.[4];
      const firstName = gecos?.split(",", 1)[0]?.trim().split(/\s+/u)[0];
      if (firstName) return firstName;
    } catch {
      // O nome de usuário continua sendo um fallback suficiente quando passwd não está legível.
    }
  }
  return username || null;
}
