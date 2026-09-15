import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NODE_FILE_SYSTEM } from './fileSystem.js';

describe('NODE_FILE_SYSTEM', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function temporaryFile(bytes: Buffer): string {
    const directory = mkdtempSync(join(tmpdir(), 'tableau-file-system-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'fixture.bin');
    writeFileSync(path, bytes);
    return path;
  }

  it('returns the complete file when it is shorter than the read limit', () => {
    const path = temporaryFile(Buffer.from('short'));
    const fd = NODE_FILE_SYSTEM.open(path, 0);

    try {
      expect(NODE_FILE_SYSTEM.read(fd, 16)).toEqual(Buffer.from('short'));
    } finally {
      NODE_FILE_SYSTEM.close(fd);
    }
  });

  it('returns one overflow byte and no more when the file exceeds the read limit', () => {
    const path = temporaryFile(Buffer.from('0123456789'));
    const fd = NODE_FILE_SYSTEM.open(path, 0);

    try {
      expect(NODE_FILE_SYSTEM.read(fd, 4)).toEqual(Buffer.from('01234'));
    } finally {
      NODE_FILE_SYSTEM.close(fd);
    }
  });
});
