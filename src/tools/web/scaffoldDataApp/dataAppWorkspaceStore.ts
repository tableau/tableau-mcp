/**
 * Creates a new data app workspace from the committed placeholder template.
 *
 * Both output modes serve the exact same static, un-substituted template zip plus a `postUnzip`
 * plan (see `buildPostUnzipPlan`) the client applies after unzipping to finalize the workspace;
 * they differ only in transport:
 *  - disk (`config.bucketS3.enabled` false): the server returns the local filesystem `filePath`
 *    of the bundled template zip — the client skips the network download but still unzips and
 *    applies `postUnzip`.
 *  - S3 (`config.bucketS3.enabled` true): the template zip is already published to S3 out of band
 *    (see `config.dataAppTemplateS3Key`); the server presigns a short-lived GET URL (`s3URL`) for
 *    that existing object — the client downloads it first, then unzips and applies `postUnzip`.
 *    Neither uploads nor builds a zip.
 *
 * Datasource wiring is not performed here at all — it is entirely the caller's/skill's
 * responsibility, applied to the unzipped-and-finalized workbook after this returns.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import { DataAppTemplateUnavailableError, McpToolError } from '../../../errors/mcpToolError.js';
import { TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { presignGetObjectUrl } from '../s3Client.js';
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
  if (!config.dataAppTemplateS3Key) {
    return new DataAppTemplateUnavailableError(
      'S3 data app scaffolding is not available: DATA_APP_TEMPLATE_S3_KEY must be configured.',
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
