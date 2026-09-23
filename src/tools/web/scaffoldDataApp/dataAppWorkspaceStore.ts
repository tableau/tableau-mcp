/**
 * Creates a new data app workspace from the committed placeholder template.
 *
 * Both output modes serve the exact same static, un-substituted template zip plus a `postUnzip`
 * plan (see `buildPostUnzipPlan`) the client applies after unzipping to finalize the workspace;
 * they differ only in transport:
 *  - disk (`config.bucketS3.enabled` false): the server returns the local filesystem `filePath`
 *    of the bundled template zip — the client skips the network download but still unzips and
 *    applies `postUnzip`.
 *  - S3 (`config.bucketS3.enabled` true): the server uploads its own already-built template zip —
 *    the exact same artifact local mode serves — to S3 fresh on every call, then presigns a
 *    short-lived GET URL (`s3URL`) for what it just uploaded; the client downloads it first, then
 *    unzips and applies `postUnzip`. There is no external publish step and nothing persists waiting
 *    to be trusted later: the object is always the bytes this code path just wrote.
 *
 * Datasource wiring is not performed here at all — it is entirely the caller's/skill's
 * responsibility, applied to the unzipped-and-finalized workbook after this returns.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import { DataAppTemplateUnavailableError, McpToolError } from '../../../errors/mcpToolError.js';
import { TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { joinS3Prefix, uploadBufferToS3 } from '../s3Client.js';
import {
  buildPostUnzipPlan,
  DataAppIdentity,
  deriveIdentity,
  PostUnzipPlan,
} from './templateIdentity.js';

/**
 * Result of scaffolding a workspace. A single shape covers both output modes; both always return
 * an un-substituted template zip plus the `postUnzip` plan the client applies after unzipping. The
 * modes differ only in transport:
 *  - disk: `filePath` points at the template zip already on the local filesystem — skip download,
 *    then unzip and apply `postUnzip`.
 *  - S3: `s3URL` is a presigned GET for the (un-substituted) template zip — download it first, then
 *    unzip and apply `postUnzip`.
 */
export type DataAppWorkspaceResult = {
  datappName: string;
  filePath?: string;
  s3URL?: string;
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

export async function createDataAppWorkspace({
  datappName,
  config,
}: {
  datappName: string;
  config: Config;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const identity = deriveIdentity(datappName);

  return config.bucketS3.enabled
    ? await createS3Workspace({ datappName, identity, config })
    : createLocalWorkspace({ datappName, identity });
}

async function createS3Workspace({
  datappName,
  identity,
  config,
}: {
  datappName: string;
  identity: DataAppIdentity;
  config: Config;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  // S3 mode serves the same static, un-substituted template zip as local mode — the artifact built
  // at `npm run build` time and resolved on disk here. If it isn't present in this deployment, S3
  // mode is unavailable for the same reason local mode is.
  const zipPath = resolveTemplateZip();
  if (!zipPath) {
    return new DataAppTemplateUnavailableError(
      'The data app template is not available in this deployment.',
    ).toErr();
  }

  // Upload the template zip to S3 fresh on every call, then presign a GET URL for exactly those
  // bytes. The uploaded content is identical regardless of `datappName` (only `postUnzip` varies),
  // so a fixed key is intentional — concurrent overwrites are harmless. Nothing is published out of
  // band; the object is always what this code path just wrote.
  let s3URL: string;
  try {
    const buffer = readFileSync(zipPath);
    const key = `${joinS3Prefix(config.bucketS3.keyPrefix, 'data-app-templates')}${TEMPLATE_ZIP_FILENAME}`;
    s3URL = await uploadBufferToS3(buffer, {
      key,
      contentType: 'application/zip',
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

function createLocalWorkspace({
  datappName,
  identity,
}: {
  datappName: string;
  identity: DataAppIdentity;
}): Result<DataAppWorkspaceResult, McpToolError> {
  // Local mode serves the same static, un-substituted template zip as S3 mode — just from the
  // local filesystem instead of a presigned URL. Nothing is written per call, so nothing can
  // collide; the client unzips and applies the same `postUnzip` plan to finalize.
  const zipPath = resolveTemplateZip();
  if (!zipPath) {
    return new DataAppTemplateUnavailableError(
      'The data app template is not available in this deployment.',
    ).toErr();
  }

  return new Ok({
    datappName,
    filePath: zipPath,
    postUnzip: buildPostUnzipPlan(identity),
  });
}
