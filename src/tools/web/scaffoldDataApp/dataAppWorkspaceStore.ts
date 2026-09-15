/**
 * Creates a new data app workspace from the committed placeholder template.
 *
 * Behavior branches on the transport (see the design doc / plan):
 *  - stdio (local): copy the bundled template to a server-controlled directory,
 *    rewriting identity tokens and renaming files as they are written, and
 *    return the finished workspace path.
 *  - http (remote): the template zip is already published to S3 out of band; the tool presigns a
 *    short-lived GET URL for that object (via the shared `presignGetObjectUrl` helper) and returns
 *    it plus a post-unzip rename/edit plan for the client to download, unzip, and finalize. It
 *    neither uploads nor downloads the zip itself.
 */

import { existsSync } from 'fs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import {
  DataAppTemplateUnavailableError,
  DataAppWorkspaceExistsError,
  InvalidDataAppNameError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { presignGetObjectUrl } from '../s3Client.js';
import {
  applyReplacements,
  buildPostUnzipPlan,
  buildTextReplacements,
  DataAppIdentity,
  deriveIdentity,
  mapToFinalRelativePath,
  PostUnzipPlan,
  TEMPLATE_ROOT_DIRNAME,
} from './templateIdentity.js';

/**
 * Result of scaffolding a workspace. A single shape covers both transports, distinguished by which
 * delivery field is set:
 *  - stdio (local): `filePath` points at the finished, on-disk workspace; `postUnzip` is omitted.
 *  - http (remote): `s3URL` is a presigned GET for the template zip, and `postUnzip` is the
 *    rename/edit plan the client applies after unzipping to finalize the workspace.
 */
export type DataAppWorkspaceResult = {
  datappName: string;
  filePath?: string;
  s3URL?: string;
  postUnzip?: PostUnzipPlan;
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
}: {
  datappName: string;
  username?: string;
  config: Config;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const identity = deriveIdentity(datappName, username);

  return config.transport === 'http'
    ? await createRemoteWorkspace({ datappName, identity, config })
    : await createLocalWorkspace({ datappName, identity, config });
}

async function createRemoteWorkspace({
  datappName,
  identity,
  config,
}: {
  datappName: string;
  identity: DataAppIdentity;
  config: Config;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  if (!config.bucketS3.enabled || !config.dataAppTemplateS3Key) {
    return new DataAppTemplateUnavailableError(
      'Remote data app scaffolding is not available: MCP_S3_BUCKET and DATA_APP_TEMPLATE_S3_KEY must both be configured.',
    ).toErr();
  }

  // The template zip is published to S3 out of band; the tool only signs a short-lived GET URL for
  // that existing object (reusing the same presign path `download-workbook` uses). The client
  // fetches the zip directly from S3 rather than receiving it inline.
  let s3URL: string;
  try {
    s3URL = await presignGetObjectUrl({
      key: config.dataAppTemplateS3Key,
      bucket: config.bucketS3.bucket,
      region: config.bucketS3.region,
      presignTtlSeconds: config.bucketS3.presignTtlSeconds,
    });
  } catch (error) {
    return new DataAppTemplateUnavailableError(
      `Failed to prepare the data app template: ${getExceptionMessage(error)}.`,
    ).toErr();
  }

  return new Ok({
    datappName,
    s3URL,
    postUnzip: buildPostUnzipPlan(identity),
  });
}

async function createLocalWorkspace({
  datappName,
  identity,
  config,
}: {
  datappName: string;
  identity: DataAppIdentity;
  config: Config;
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

  const replacements = buildTextReplacements(identity);

  try {
    const relFiles = (await walkFiles(templateRoot)).sort();
    for (const rel of relFiles) {
      const finalRel = mapToFinalRelativePath(rel, identity);
      const finalPath = join(dest, ...finalRel.split('/'));
      await mkdir(dirname(finalPath), { recursive: true });

      const edits = replacements[rel];
      if (edits) {
        const original = await readFile(join(templateRoot, ...rel.split('/')), 'utf8');
        await writeFile(finalPath, applyReplacements(original, edits), 'utf8');
      } else {
        await writeFile(finalPath, await readFile(join(templateRoot, ...rel.split('/'))));
      }
    }
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
