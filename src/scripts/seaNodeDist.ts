import { existsSync } from 'fs';
import { mkdtemp, rename, rm } from 'fs/promises';
import { join } from 'path';

import { verifyNodeArchive } from './seaNodeChecksum.js';

export type NodeDistOptions = {
  archivePath: string;
  archiveFileName: string;
  distDir: string;
  distName: string;
  shasums: () => Promise<string>;
  download: (destination: string) => Promise<void>;
  extract: (archivePath: string, intoDir: string) => void;
  // Dist dirs already rebuilt in this run; a dir from an earlier run may be half-extracted.
  freshDirs: Set<string>;
};

export async function ensureNodeDist(options: NodeDistOptions): Promise<void> {
  const { archivePath, archiveFileName, distDir, distName, freshDirs } = options;

  if (!existsSync(archivePath)) {
    const partPath = `${archivePath}.part`;
    await rm(partPath, { force: true });
    await options.download(partPath);
    await verifyNodeArchive(partPath, archiveFileName, await options.shasums());
    await rename(partPath, archivePath);
  } else {
    await verifyNodeArchive(archivePath, archiveFileName, await options.shasums());
  }

  if (!freshDirs.has(distDir)) {
    await rm(distDir, { recursive: true, force: true });
    freshDirs.add(distDir);
  }
  if (!existsSync(distDir)) {
    const tempDir = await mkdtemp(join(distDir, '..', `${distName}.tmp-`));
    try {
      options.extract(archivePath, tempDir);
      await rename(join(tempDir, distName), distDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
