import { randomUUID } from 'crypto';
import { extname } from 'path';

import { type TenantLuids } from '../../blobStorage/tenantKey.js';
import { log } from '../../logging/logger.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import {
  BucketS3Config,
  buildTenantS3Key,
  createPresignedPutUrlToS3,
  deleteObjectFromS3,
  downloadObjectFromS3IfExists,
} from './s3Client.js';

// Intentionally decimal GB (not GiB) to leave headroom under S3's 5GB single-PUT ceiling.
export const MAX_STAGED_UPLOAD_BYTES = 5 * 1000 * 1000 * 1000;

export type StagedUploadKind<FileType extends string> = {
  // Keys are `<prefix>/<prefixSegment>/<siteLuid>/<userLuid>/<uuid>/<objectStem>.<fileType>`; changing them orphans in-flight uploads.
  prefixSegment: string;
  objectStem: string;
  label: string;
  noun: string;
  fileTypes: ReadonlyArray<FileType>;
  xmlFileType: FileType;
};

export type ResolvedStagedFile = {
  fileName: string;
  bytes: Buffer;
  // Set only when read from S3; the key to delete once published.
  stagedKey?: string;
};

export async function requestStagedUpload<FileType extends string>({
  kind,
  fileName,
  config,
  tenant,
}: {
  kind: StagedUploadKind<FileType>;
  fileName: string;
  config: BucketS3Config;
  tenant: TenantLuids;
}): Promise<{
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
}> {
  const fileType = getStagedFileType(kind, fileName);
  if (!fileType) {
    const extensions = kind.fileTypes.map((type) => `.${type}`).join(' or ');
    throw new Error(`${kind.label} upload filename must end in ${extensions}.`);
  }

  const uploadId = randomUUID();
  const contentType =
    fileType === kind.xmlFileType ? 'application/xml' : 'application/octet-stream';
  const uploadUrl = await createPresignedPutUrlToS3({
    key: buildStagedUploadS3Key(kind, config.keyPrefix, tenant, uploadId, fileType),
    contentType,
    bucket: config.bucket,
    region: config.region,
    presignTtlSeconds: config.presignTtlSeconds,
  });

  return {
    uploadId,
    uploadUrl,
    expiresAt: new Date(Date.now() + config.presignTtlSeconds * 1000).toISOString(),
    maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
    requiredHeaders: { 'Content-Type': contentType },
  };
}

export async function resolveStagedUpload<FileType extends string>({
  kind,
  uploadId,
  config,
  tenant,
  maxBytes = MAX_STAGED_UPLOAD_BYTES,
}: {
  kind: StagedUploadKind<FileType>;
  uploadId: string;
  config: BucketS3Config;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedStagedFile> {
  assertStagedUploadId(kind, uploadId);

  // The key is rebuilt from the caller's own tenant, so an id staged by another tenant misses.
  for (const fileType of kind.fileTypes) {
    const key = buildStagedUploadS3Key(kind, config.keyPrefix, tenant, uploadId, fileType);
    const bytes = await downloadObjectFromS3IfExists({
      key,
      bucket: config.bucket,
      region: config.region,
      maxBytes,
    });

    if (bytes === undefined) {
      continue;
    }

    if (bytes.byteLength === 0) {
      throw new Error(`${kind.label} upload bytes must not be empty.`);
    }

    return { fileName: `${uploadId}.${fileType}`, bytes, stagedKey: key };
  }

  throw new Error(
    `${kind.label} upload not found. Upload the ${kind.noun} bytes before publishing.`,
  );
}

/** Best-effort deletion of a published staged upload; never throws. No-op for local files. */
export async function deleteStagedUpload(
  stagedKey: string | undefined,
  config: BucketS3Config,
  logger: string,
): Promise<void> {
  if (stagedKey === undefined) {
    return;
  }
  try {
    await deleteObjectFromS3({
      key: stagedKey,
      bucket: config.bucket,
      region: config.region,
    });
  } catch (error) {
    log({
      message: `${logger}: failed to delete staged upload (best-effort)`,
      level: 'warning',
      logger,
      data: getExceptionMessage(error),
    });
  }
}

export function buildStagedUploadS3Key<FileType extends string>(
  kind: StagedUploadKind<FileType>,
  keyPrefix: string,
  tenant: TenantLuids,
  uploadId: string,
  fileType: FileType,
): string {
  assertStagedUploadId(kind, uploadId);
  return buildTenantS3Key(
    keyPrefix,
    tenant,
    kind.prefixSegment,
    `${uploadId}/${kind.objectStem}.${fileType}`,
  );
}

export function getStagedFileType<FileType extends string>(
  kind: StagedUploadKind<FileType>,
  fileName: string,
): FileType | undefined {
  const extension = extname(fileName).toLowerCase();
  return kind.fileTypes.find((fileType) => extension === `.${fileType}`);
}

function assertStagedUploadId(kind: StagedUploadKind<string>, uploadId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)
  ) {
    throw new Error(`${kind.label} upload id is invalid.`);
  }
}
