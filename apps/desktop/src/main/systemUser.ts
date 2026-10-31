import fs from 'node:fs';
import os from 'node:os';

export function parseGecosName(passwd: string, uid: number): string | null {
  for (const line of passwd.split('\n')) {
    const fields = line.split(':');
    if (fields[2] !== String(uid)) continue;

    const name = fields[4]?.split(',')[0]?.trim();
    return name || null;
  }

  return null;
}

export function localUserName(): string {
  let username = '';
  let uid: number | undefined;

  try {
    const user = os.userInfo();
    username = user.username;
    uid = user.uid;
  } catch {
    return '';
  }

  if (process.platform === 'linux' && uid !== undefined) {
    try {
      const name = parseGecosName(fs.readFileSync('/etc/passwd', 'utf8'), uid);
      if (name) return cleanName(name);
    } catch {
      // Se o arquivo não estiver disponível, usa o nome retornado pelo sistema.
    }
  }

  return cleanName(username);
}

function cleanName(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
    })
    .slice(0, 80)
    .join('');
}
