/**
 * Creates a new data app workspace from the committed placeholder template.
 *
 * Both output modes share one finalize path (`finalizeTemplateFiles`): walk the bundled template,
 * rewrite identity tokens, optionally wire a datasource, and write the finished files under a
 * destination root. They differ only in where that root lives and what's returned:
 *  - S3 configured (`config.bucketS3.enabled`): finalize into a temp scratch directory, zip it,
 *    upload the zip to S3, and return a short-lived presigned GET URL to the zip.
 *  - otherwise (or if the S3 upload fails): finalize directly into the server-controlled
 *    `dataAppWorkspaceRoot` on disk and return the workspace's file path.
 */

import { randomUUID } from 'node:crypto';

import { existsSync } from 'fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import {
  DataAppTemplateUnavailableError,
  DataAppWiringFailedError,
  DataAppWorkspaceExistsError,
  InvalidDataAppNameError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
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
  username,
  config,
  extra,
  productVersion,
  datasourceLuid,
}: {
  datappName: string;
  username?: string;
  config: Config;
  extra: TableauWebRequestHandlerExtra;
  productVersion: ProductVersion;
  datasourceLuid?: string;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const identity = deriveIdentity(datappName, username);

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
 * Walks the bundled template, rewrites identity tokens (and, if `wiringEdits` is given, the .twb's
 * datasource anchors), and writes the finished files under `destRoot`. Shared by both output modes
 * so they finalize a workspace identically, differing only in where `destRoot` lives.
 */
async function finalizeTemplateFiles({
  templateRoot,
  destRoot,
  identity,
  wiringEdits,
}: {
  templateRoot: string;
  destRoot: string;
  identity: DataAppIdentity;
  wiringEdits?: DatasourceWiringEdits;
}): Promise<Result<void, McpToolError>> {
  const replacements = buildTextReplacements(identity);

  try {
    const relFiles = (await walkFiles(templateRoot)).sort();
    for (const rel of relFiles) {
      const finalRel = mapToFinalRelativePath(rel, identity);
      const finalPath = join(destRoot, ...finalRel.split('/'));
      await mkdir(dirname(finalPath), { recursive: true });

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
        await writeFile(finalPath, finalContent, 'utf8');
      } else {
        await writeFile(finalPath, await readFile(join(templateRoot, ...rel.split('/'))));
      }
    }
  } catch (error) {
    return new DataAppTemplateUnavailableError(
      `Failed to create the data app workspace: ${getExceptionMessage(error)}.`,
    ).toErr();
  }

  return new Ok(undefined);
}

/** Zips every file under `root` (recursively, preserving relative paths) into an in-memory buffer. */
async function zipDirectoryToBuffer(root: string): Promise<Buffer> {
  const relFiles = await walkFiles(root);
  const entries: ZipEntry[] = await Promise.all(
    relFiles.map(async (rel) => ({
      path: rel,
      data: await readFile(join(root, ...rel.split('/'))),
    })),
  );
  return buildZip(entries);
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

  let scratchRoot: string | undefined;
  try {
    scratchRoot = await mkdtemp(join(tmpdir(), 'data-app-workspace-'));
    const destRoot = join(scratchRoot, datappName);

    const finalizeResult = await finalizeTemplateFiles({
      templateRoot,
      destRoot,
      identity,
      wiringEdits,
    });
    if (finalizeResult.isErr()) {
      return finalizeResult;
    }

    const zipBuffer = await zipDirectoryToBuffer(scratchRoot);
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
    log({
      message: `scaffold-data-app: S3 workspace upload failed, falling back to disk output: ${getExceptionMessage(
        error,
      )}`,
      level: 'warning',
      logger: 'tool',
    });
    return await createLocalWorkspace({ datappName, identity, config, wiringEdits });
  } finally {
    if (scratchRoot) {
      await rm(scratchRoot, { recursive: true, force: true });
    }
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

  const finalizeResult = await finalizeTemplateFiles({
    templateRoot,
    destRoot: dest,
    identity,
    wiringEdits,
  });
  if (finalizeResult.isErr()) {
    return finalizeResult;
  }

  return new Ok({
    datappName,
    filePath: dest,
  });
}
