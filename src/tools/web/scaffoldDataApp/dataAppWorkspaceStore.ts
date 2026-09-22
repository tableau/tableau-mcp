/**
 * Creates a new data app workspace from the committed placeholder template.
 *
 * Both output modes share one finalize path (`buildFinalizedEntries`): walk the bundled template,
 * rewrite identity tokens, optionally wire a datasource, and produce the finished files entirely
 * in memory. They differ only in what happens with those entries and what's returned:
 *  - S3 configured (`config.bucketS3.enabled`): zip the in-memory entries directly, upload the zip
 *    to S3, and return a short-lived presigned GET URL to the zip. No scratch directory is written.
 *    A failed upload is returned as an error (`DataAppS3UploadFailedError`), not silently retried
 *    against disk — a misconfigured or unreachable bucket should surface, not quietly redirect the
 *    workspace to server-local disk instead.
 *  - otherwise: write the entries under the server-controlled `dataAppWorkspaceRoot` on disk and
 *    return the workspace's file path.
 */

import { randomUUID } from 'node:crypto';

import { existsSync } from 'fs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import {
  DataAppS3UploadFailedError,
  DataAppTemplateUnavailableError,
  DataAppWiringFailedError,
  DataAppWorkspaceExistsError,
  InvalidDataAppNameError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { joinS3Prefix, uploadBufferToS3 } from '../s3Client.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import {
  applyDatasourceWiring,
  buildDatasourceWiringEdits,
  DatasourceWiringEdits,
  resolveDatasourceDescriptor,
} from './datasourceWiring.js';
import { buildZip, ZipEntry } from './deterministicZip.js';
import {
  applyReplacements,
  buildTextReplacements,
  DataAppIdentity,
  deriveIdentity,
  mapToFinalRelativePath,
  slug,
  TEMPLATE_ROOT_DIRNAME,
  TWB_RELPATH,
} from './templateIdentity.js';

/**
 * Result of scaffolding a workspace. A single shape covers both output modes, distinguished by
 * which delivery field is set:
 *  - disk: `filePath` points at the finished, on-disk workspace.
 *  - S3: `s3URL` is a presigned GET for a zip of the finished workspace.
 */
export type DataAppWorkspaceResult = {
  datappName: string;
  filePath?: string;
  s3URL?: string;
};

// Candidate parents of the template root dir, tried in order, resolved relative to this module's own
// directory. In the bundled build everything collapses into `build/index.js`, so `__dirname` is
// `build/` and the build step's copy lands at `build/templates/`; when running from source (tests,
// tsx) `__dirname` is this module's directory, three levels below `src/templates/`.
const TEMPLATE_PARENT_CANDIDATES = ['templates', join('..', '..', '..', 'templates')];

function resolveTemplateRoot(): string | undefined {
  for (const candidate of TEMPLATE_PARENT_CANDIDATES) {
    const path = join(__dirname, candidate, TEMPLATE_ROOT_DIRNAME);
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

/** Recursively lists files under `root`, returning POSIX paths relative to it. */
async function walkFiles(root: string, rel = ''): Promise<string[]> {
  const entries = await readdir(rel ? join(root, rel) : root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, childRel)));
    } else if (entry.isFile()) {
      files.push(childRel);
    }
  }
  return files;
}

export async function createDataAppWorkspace({
  datappName,
  config,
  extra,
  productVersion,
  datasourceLuid,
}: {
  datappName: string;
  config: Config;
  extra: TableauWebRequestHandlerExtra;
  productVersion: ProductVersion;
  datasourceLuid?: string;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const identity = deriveIdentity(datappName);

  let wiringEdits: DatasourceWiringEdits | undefined;
  if (datasourceLuid) {
    const descriptorResult = await resolveDatasourceDescriptor({
      datasourceLuid,
      extra,
      productVersion,
    });
    if (descriptorResult.isErr()) {
      return descriptorResult;
    }
    try {
      wiringEdits = buildDatasourceWiringEdits(descriptorResult.value);
    } catch (error) {
      return new DataAppWiringFailedError(
        `Failed to wire the datasource into the workbook: ${getExceptionMessage(error)}.`,
      ).toErr();
    }
  }

  return config.bucketS3.enabled
    ? await createS3Workspace({ datappName, identity, config, wiringEdits })
    : await createLocalWorkspace({ datappName, identity, config, wiringEdits });
}

/**
 * Walks the bundled template and, entirely in memory, rewrites identity tokens (and, if
 * `wiringEdits` is given, the .twb's datasource anchors), returning each file's finished content
 * keyed by its final relative path. Shared by both output modes so they finalize a workspace
 * identically, differing only in what they do with the resulting entries (write to disk vs. zip
 * for S3) — neither writes a scratch copy of the template to disk.
 */
async function buildFinalizedEntries({
  templateRoot,
  identity,
  wiringEdits,
}: {
  templateRoot: string;
  identity: DataAppIdentity;
  wiringEdits?: DatasourceWiringEdits;
}): Promise<Result<ZipEntry[], McpToolError>> {
  const replacements = buildTextReplacements(identity);

  try {
    const relFiles = (await walkFiles(templateRoot)).sort();
    const entries: ZipEntry[] = [];
    for (const rel of relFiles) {
      const finalRel = mapToFinalRelativePath(rel, identity);

      const edits = replacements[rel];
      if (edits) {
        const original = await readFile(join(templateRoot, ...rel.split('/')), 'utf8');
        let finalContent = applyReplacements(original, edits);
        if (rel === TWB_RELPATH && wiringEdits) {
          try {
            finalContent = applyDatasourceWiring(finalContent, wiringEdits);
          } catch (error) {
            return new DataAppWiringFailedError(
              `Failed to wire the datasource into the workbook: ${getExceptionMessage(error)}.`,
            ).toErr();
          }
        }
        entries.push({ path: finalRel, data: Buffer.from(finalContent, 'utf8') });
      } else {
        entries.push({ path: finalRel, data: await readFile(join(templateRoot, ...rel.split('/'))) });
      }
    }
    return new Ok(entries);
  } catch (error) {
    return new DataAppTemplateUnavailableError(
      `Failed to create the data app workspace: ${getExceptionMessage(error)}.`,
    ).toErr();
  }
}

/** Writes finalized entries (relative path + content) under `destRoot`. */
async function writeEntriesToDisk(entries: ZipEntry[], destRoot: string): Promise<void> {
  for (const entry of entries) {
    const finalPath = join(destRoot, ...entry.path.split('/'));
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, entry.data);
  }
}

async function createS3Workspace({
  datappName,
  identity,
  config,
  wiringEdits,
}: {
  datappName: string;
  identity: DataAppIdentity;
  config: Config;
  wiringEdits?: DatasourceWiringEdits;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const templateRoot = resolveTemplateRoot();
  if (!templateRoot) {
    return new DataAppTemplateUnavailableError(
      'The data app template is not available in this deployment.',
    ).toErr();
  }

  const finalizeResult = await buildFinalizedEntries({ templateRoot, identity, wiringEdits });
  if (finalizeResult.isErr()) {
    return finalizeResult;
  }

  try {
    const zipBuffer = buildZip(finalizeResult.value);
    const keyPrefix = joinS3Prefix(config.bucketS3.keyPrefix, 'data-app-workspaces');
    const key = `${keyPrefix}${slug(datappName)}/${randomUUID()}.zip`;
    const s3URL = await uploadBufferToS3(zipBuffer, {
      key,
      contentType: 'application/zip',
      bucket: config.bucketS3.bucket,
      region: config.bucketS3.region,
      presignTtlSeconds: config.bucketS3.presignTtlSeconds,
    });

    return new Ok({ datappName, s3URL });
  } catch (error) {
    return new DataAppS3UploadFailedError(
      `Failed to upload the data app workspace to S3: ${getExceptionMessage(error)}.`,
    ).toErr();
  }
}

async function createLocalWorkspace({
  datappName,
  identity,
  config,
  wiringEdits,
}: {
  datappName: string;
  identity: DataAppIdentity;
  config: Config;
  wiringEdits?: DatasourceWiringEdits;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const resolvedRoot = resolve(config.dataAppWorkspaceRoot);
  const dest = resolve(resolvedRoot, datappName);

  // Defense-in-depth: the tool's paramsSchema already rejects separators and
  // "..", but never write outside the server-controlled root regardless.
  if (dirname(dest) !== resolvedRoot) {
    return new InvalidDataAppNameError(`Invalid data app name: "${datappName}".`).toErr();
  }

  if (existsSync(dest)) {
    return new DataAppWorkspaceExistsError(
      `A data app workspace named "${datappName}" already exists at ${dest}. Choose a different name.`,
    ).toErr();
  }

  const templateRoot = resolveTemplateRoot();
  if (!templateRoot) {
    return new DataAppTemplateUnavailableError(
      'The data app template is not available in this deployment.',
    ).toErr();
  }

  const finalizeResult = await buildFinalizedEntries({ templateRoot, identity, wiringEdits });
  if (finalizeResult.isErr()) {
    return finalizeResult;
  }

  try {
    await writeEntriesToDisk(finalizeResult.value, dest);
  } catch (error) {
    return new DataAppTemplateUnavailableError(
      `Failed to create the data app workspace: ${getExceptionMessage(error)}.`,
    ).toErr();
  }

  return new Ok({
    datappName,
    filePath: dest,
  });
}
