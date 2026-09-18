/**
 * Builds the deterministic scaffold-data-app template zip from a template tree on disk.
 *
 * Used by the `buildDataAppTemplate.ts` script to produce the artifact that is published to S3
 * out of band (the object the http transport later presigns; see `dataAppWorkspaceStore.ts`).
 * Produces a byte-stable STORE zip whose entries carry a top-level `Data App Name/` folder prefix
 * (the shape the remote post-unzip plan finalizes against).
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

import { buildZip, ZipEntry } from './deterministicZip.js';
import { TEMPLATE_ROOT_DIRNAME } from './templateIdentity.js';

/** Recursively collects files under `root` as zip entries with POSIX paths relative to `root`. */
async function collectEntries(root: string, rel = ''): Promise<ZipEntry[]> {
  const dirents = await readdir(rel ? join(root, rel) : root, { withFileTypes: true });
  const entries: ZipEntry[] = [];
  for (const dirent of dirents) {
    const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      entries.push(...(await collectEntries(root, childRel)));
    } else if (dirent.isFile()) {
      entries.push({ path: childRel, data: await readFile(join(root, ...childRel.split('/'))) });
    }
  }
  return entries;
}

/**
 * Builds the deterministic template zip from `templateRoot` (the directory that holds the
 * template contents). Every entry is prefixed with `Data App Name/` so the archive unzips to
 * a top-level folder that the post-unzip rename/edit plan then finalizes.
 */
export async function buildTemplateZip(templateRoot: string): Promise<Buffer> {
  const entries = (await collectEntries(templateRoot)).map((entry) => ({
    path: `${TEMPLATE_ROOT_DIRNAME}/${entry.path}`,
    data: entry.data,
  }));
  return buildZip(entries);
}
