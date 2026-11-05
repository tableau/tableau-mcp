/**
 * Locates the static data-app template zip the build ships.
 *
 * Disk candidates are relative to this module. In the bundled build every module
 * collapses into `build/index.js`, so `__dirname` is `build/` and the copy lands
 * at `build/templates/data-app-template.zip`. From source (tests, tsx) this file
 * sits three levels below `src/templates/`. Inside a SEA the same bytes are the
 * asset `templates/data-app-template.zip`.
 */

import { existsSync } from 'fs';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { readSeaAssetBytes, runningAsSea } from '../../../utils/sea.js';

const TEMPLATE_PARENT_CANDIDATES = ['templates', join('..', '..', '..', 'templates')];

export const SEA_TEMPLATE_ASSET_KEY = `templates/${TEMPLATE_ZIP_FILENAME}`;

export type TemplateSource = { path: string } | { bytes: Buffer };

function resolveTemplateZip(): string | undefined {
  for (const candidate of TEMPLATE_PARENT_CANDIDATES) {
    const path = join(__dirname, candidate, TEMPLATE_ZIP_FILENAME);
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

export function resolveTemplateSource(): TemplateSource | undefined {
  if (runningAsSea()) {
    const bytes = readSeaAssetBytes(SEA_TEMPLATE_ASSET_KEY);
    if (bytes) {
      return { bytes };
    }
  }
  const path = resolveTemplateZip();
  return path ? { path } : undefined;
}

let seaTemplatePath: Promise<string> | undefined;

// The caller may still be reading this file after we return, so it is not deleted on exit.
export async function materializeSeaTemplate(bytes: Buffer): Promise<string> {
  if (seaTemplatePath) {
    const cached = seaTemplatePath;
    try {
      const path = await cached;
      await access(path);
      return path;
    } catch {
      // Gone (tmp reaper, manual cleanup) or the earlier write failed: write a fresh copy below.
      if (seaTemplatePath === cached) {
        seaTemplatePath = undefined;
      }
      if (seaTemplatePath) {
        return materializeSeaTemplate(bytes);
      }
    }
  }
  const pending = (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tableau-mcp-template-'));
    const path = join(dir, TEMPLATE_ZIP_FILENAME);
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return path;
  })();
  seaTemplatePath = pending;
  pending.catch(() => {
    if (seaTemplatePath === pending) {
      seaTemplatePath = undefined;
    }
  });
  return pending;
}

export async function resolveDataAppTemplateZipPath(): Promise<string | undefined> {
  const source = resolveTemplateSource();
  if (!source) {
    return undefined;
  }
  if ('path' in source) {
    return source.path;
  }
  return materializeSeaTemplate(source.bytes);
}

export const exportedForTesting = {
  resetSeaTemplatePath: (): void => {
    seaTemplatePath = undefined;
  },
};
