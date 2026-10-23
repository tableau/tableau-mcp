/**
 * Creates a new data app workspace from the committed placeholder template.
 */

import { existsSync } from 'fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok, Result } from 'ts-results-es';

import { getBlobStorageProvider, isBlobStorageEnabled } from '../../../blobStorage/init.js';
import { toUploadData } from '../../../blobStorage/uploadData.js';
import { DataAppTemplateUnavailableError, McpToolError } from '../../../errors/mcpToolError.js';
import { TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { readSeaAssetBytes, runningAsSea } from '../../../utils/sea.js';
import {
  buildPostUnzipPlan,
  buildRequestedOriginsGuide,
  DataAppIdentity,
  deriveIdentity,
  PostUnzipPlan,
  RequestedOriginsGuide,
} from './templateIdentity.js';

/**
 * Result of scaffolding a workspace. A single shape covers both output modes; both always return
 * an un-substituted template zip plus the `postUnzip` plan the client applies after unzipping. The
 * modes differ only in transport:
 *  - disk: `filePath` points at the template zip already on the local filesystem — skip download,
 *    then unzip and apply `postUnzip`.
 *  - blob storage: `downloadUrl` is a URL (from the configured BlobStorageProvider) for the
 *    (un-substituted) template zip — download it first, then unzip and apply `postUnzip`.
 * Both also return `requestedOrigins`: where the finalized manifest.json is and how to declare the
 * app's external origins in it.
 */
export type DataAppWorkspaceResult = {
  datappName: string;
  allowedOrigins: string[];
  requestedOrigins: RequestedOriginsGuide;
  filePath?: string;
  downloadUrl?: string;
  postUnzip?: PostUnzipPlan;
};

// Candidate parents of the template zip, tried in order, resolved relative to this module's own
// directory. In the bundled build everything collapses into `build/index.js`, so `__dirname` is
// `build/` and the build step's copy lands at `build/templates/`; when running from source (tests,
// tsx) `__dirname` is this module's directory, three levels below `src/templates/`.
const TEMPLATE_PARENT_CANDIDATES = ['templates', join('..', '..', '..', 'templates')];

function resolveTemplateZip(): string | undefined {
  for (const candidate of TEMPLATE_PARENT_CANDIDATES) {
    const path = join(__dirname, candidate, TEMPLATE_ZIP_FILENAME);
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

const SEA_TEMPLATE_ASSET_KEY = `templates/${TEMPLATE_ZIP_FILENAME}`;

type TemplateSource = { path: string } | { bytes: Buffer };

function resolveTemplateSource(): TemplateSource | undefined {
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

// WHY: the client may still be reading this file after we return, so it is not deleted on exit.
async function materializeSeaTemplate(bytes: Buffer): Promise<string> {
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

export const exportedForTesting = {
  resetSeaTemplatePath: (): void => {
    seaTemplatePath = undefined;
  },
};

export async function createDataAppWorkspace({
  datappName,
  allowedOrigins,
}: {
  datappName: string;
  allowedOrigins: string[];
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const identity = deriveIdentity(datappName);

  // Both output modes serve the same static, un-substituted template zip — the artifact built at
  // `npm run build` time, resolved on disk or, inside a SEA, from the embedded asset. If it isn't
  // present in this deployment, both modes are unavailable for the same reason.
  const source = resolveTemplateSource();
  if (!source) {
    return new DataAppTemplateUnavailableError(
      'The data app template is not available in this deployment.',
    ).toErr();
  }

  if (isBlobStorageEnabled()) {
    return await createBlobStorageWorkspace({ datappName, allowedOrigins, identity, source });
  }

  let zipPath: string;
  try {
    zipPath = 'path' in source ? source.path : await materializeSeaTemplate(source.bytes);
  } catch (error) {
    return new DataAppTemplateUnavailableError(
      `Failed to prepare the data app template: ${getExceptionMessage(error)}.`,
    ).toErr();
  }
  return createLocalWorkspace({ datappName, allowedOrigins, identity, zipPath });
}

async function createBlobStorageWorkspace({
  datappName,
  allowedOrigins,
  identity,
  source,
}: {
  datappName: string;
  allowedOrigins: string[];
  identity: DataAppIdentity;
  source: TemplateSource;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  // Upload the template zip to blob storage fresh on every call and return the URL for exactly
  // those bytes. The uploaded content is identical regardless of `datappName` (only `postUnzip`
  // varies), so a fixed key is intentional — concurrent overwrites are harmless. Nothing is
  // published out of band; the object is always what this code path just wrote.
  //
  // Don't "optimize" this into an exists-check-then-skip-upload: the key has no version or content
  // hash in it, so a stale object from a previous deploy (or a different pod on shared storage)
  // would look like a hit and get served forever instead of refreshed. Always writing first is what
  // guarantees the object matches this instance's on-disk template.
  let downloadUrl: string;
  try {
    const { url } = await getBlobStorageProvider().upload({
      key: `data-app-templates/${TEMPLATE_ZIP_FILENAME}`,
      ...toUploadData('path' in source ? await readFile(source.path) : source.bytes),
      contentType: 'application/zip',
    });
    downloadUrl = url;
  } catch (error) {
    return new DataAppTemplateUnavailableError(
      `Failed to prepare the data app template: ${getExceptionMessage(error)}.`,
    ).toErr();
  }

  return new Ok({
    datappName,
    allowedOrigins,
    requestedOrigins: buildRequestedOriginsGuide(identity),
    downloadUrl,
    postUnzip: buildPostUnzipPlan(identity),
  });
}

function createLocalWorkspace({
  datappName,
  allowedOrigins,
  identity,
  zipPath,
}: {
  datappName: string;
  allowedOrigins: string[];
  identity: DataAppIdentity;
  zipPath: string;
}): Result<DataAppWorkspaceResult, McpToolError> {
  // Local mode serves the same static, un-substituted template zip as blob storage mode — just
  // from the local filesystem instead of a URL. Nothing is written per call, so nothing can
  // collide; the client unzips and applies the same `postUnzip` plan to finalize.
  return new Ok({
    datappName,
    allowedOrigins,
    requestedOrigins: buildRequestedOriginsGuide(identity),
    filePath: zipPath,
    postUnzip: buildPostUnzipPlan(identity),
  });
}
