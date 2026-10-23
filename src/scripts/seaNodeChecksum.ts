import { createHash } from 'crypto';
import { createReadStream } from 'fs';

export function findExpectedSha256(shasums: string, fileName: string): string | undefined {
  for (const line of shasums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (match && match[2] === fileName) {
      return match[1].toLowerCase();
    }
  }
  return undefined;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function verifyNodeArchive(
  archivePath: string,
  fileName: string,
  shasums: string,
): Promise<void> {
  const expected = findExpectedSha256(shasums, fileName);
  if (!expected) {
    throw new Error(`SHASUMS256.txt has no entry for ${fileName}`);
  }
  const actual = await sha256OfFile(archivePath);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${archivePath}: expected ${expected}, got ${actual}. Delete the file and rebuild.`,
    );
  }
}
