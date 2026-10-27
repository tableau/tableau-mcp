/**
 * Creates a new data app workspace from the committed placeholder template.
 */

import { readFile } from 'fs/promises';
import { Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import { DataAppTemplateUnavailableError, McpToolError } from '../../../errors/mcpToolError.js';
import { TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { joinS3Prefix, uploadBufferToS3 } from '../s3Client.js';
import { DatasourceWiringInfo } from './datasourceWiring.js';
import {
  buildPostUnzipPlan,
  buildRequestedOriginsGuide,
  deriveIdentity,
  PostUnzipPlan,
  RequestedOriginsGuide,
} from './templateIdentity.js';
import {
  exportedForTesting as templateZipForTesting,
  materializeSeaTemplate,
  resolveTemplateSource,
  type TemplateSource,
} from './templateZip.js';

/**
 * Result of scaffolding a workspace. A single shape covers both output modes; both always return
 * an un-substituted template zip plus the `postUnzip` plan the client applies after unzipping. The
 * modes differ only in transport:
 *  - disk: `filePath` points at the template zip already on the local filesystem — skip download,
 *    then unzip and apply `postUnzip`.
 *  - S3: `s3URL` is a presigned GET for the (un-substituted) template zip — download it first, then
 *    unzip and apply `postUnzip`.
 * Both also return `requestedOrigins`: where the finalized manifest.json is and how to declare the
 * app's external origins in it, and `wiring`: the server/site values every datasource descriptor needs.
 */
export type DataAppWorkspaceResult = {
  datappName: string;
  allowedOrigins: string[];
  requestedOrigins: RequestedOriginsGuide;
  wiring: DatasourceWiringInfo;
  filePath?: string;
  s3URL?: string;
  postUnzip?: PostUnzipPlan;
};

export const exportedForTesting = {
  resetSeaTemplatePath: templateZipForTesting.resetSeaTemplatePath,
};

export async function createDataAppWorkspace({
  datappName,
  productVersion,
  allowedOrigins,
  wiring,
  config,
}: {
  datappName: string;
  productVersion: ProductVersion;
  allowedOrigins: string[];
  wiring: DatasourceWiringInfo;
  config: Config;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  const identity = deriveIdentity(datappName);
  const workspace: DataAppWorkspaceResult = {
    datappName,
    allowedOrigins,
    requestedOrigins: buildRequestedOriginsGuide(identity),
    wiring,
    postUnzip: buildPostUnzipPlan(identity, productVersion),
  };

  // Both output modes serve the same static, un-substituted template zip — the artifact built at
  // `npm run build` time, resolved on disk or, inside a SEA, from the embedded asset. If it isn't
  // present in this deployment, both modes are unavailable for the same reason.
  const source = resolveTemplateSource();
  if (!source) {
    return new DataAppTemplateUnavailableError(
      'The data app template is not available in this deployment.',
    ).toErr();
  }

  if (config.bucketS3.enabled) {
    return await createS3Workspace({
      workspace,
      config,
      source,
    });
  }

  let zipPath: string;
  try {
    zipPath = 'path' in source ? source.path : await materializeSeaTemplate(source.bytes);
  } catch (error) {
    return new DataAppTemplateUnavailableError(
      `Failed to prepare the data app template: ${getExceptionMessage(error)}.`,
    ).toErr();
  }
  return new Ok({ ...workspace, filePath: zipPath });
}

async function createS3Workspace({
  workspace,
  config,
  source,
}: {
  workspace: DataAppWorkspaceResult;
  config: Config;
  source: TemplateSource;
}): Promise<Result<DataAppWorkspaceResult, McpToolError>> {
  // Upload the template zip to S3 fresh on every call, then presign a GET URL for exactly those
  // bytes. The uploaded content is identical regardless of `datappName` (only `postUnzip` varies),
  // so a fixed key is intentional — concurrent overwrites are harmless. Nothing is published out of
  // band; the object is always what this code path just wrote.
  //
  // Don't "optimize" this into an exists-check-then-skip-upload: the key has no version or content
  // hash in it, so a stale object from a previous deploy (or a different pod on shared storage)
  // would look like a hit and get served forever instead of refreshed. Always writing first is what
  // guarantees the object matches this instance's on-disk template.
  let s3URL: string;
  try {
    const buffer = 'path' in source ? await readFile(source.path) : source.bytes;
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

  return new Ok({ ...workspace, s3URL });
}
