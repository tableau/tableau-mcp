import { randomUUID } from 'crypto';
import { extname } from 'path';

import {
  BucketS3Config,
  createPresignedPutUrlToS3,
  downloadObjectFromS3IfExists,
  joinS3Prefix,
} from './s3Client.js';

// Intentionally decimal GB (not GiB) to leave headroom under S3's 5GB single-PUT ceiling.
export const MAX_STAGED_UPLOAD_BYTES = 5 * 1000 * 1000 * 1000;

export type StagedUploadKind<FileType extends string> = {
  // Keys are `<prefix>/<prefixSegment>/<uuid>/<objectStem>.<fileType>`; changing them orphans in-flight uploads.
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
};

export async function requestStagedUpload<FileType extends string>({
  kind,
  fileName,
  config,
}: {
  kind: StagedUploadKind<FileType>;
  fileName: string;
  config: BucketS3Config;
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
    key: buildStagedUploadS3Key(kind, config.keyPrefix, uploadId, fileType),
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
  maxBytes = MAX_STAGED_UPLOAD_BYTES,
}: {
  kind: StagedUploadKind<FileType>;
  uploadId: string;
  config: BucketS3Config;
  maxBytes?: number;
}): Promise<ResolvedStagedFile> {
  assertStagedUploadId(kind, uploadId);

  for (const fileType of kind.fileTypes) {
    const bytes = await downloadObjectFromS3IfExists({
      key: buildStagedUploadS3Key(kind, config.keyPrefix, uploadId, fileType),
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

    return { fileName: `${uploadId}.${fileType}`, bytes };
  }

  throw new Error(
    `${kind.label} upload not found. Upload the ${kind.noun} bytes before publishing.`,
  );
}

export function buildStagedUploadS3Key<FileType extends string>(
  kind: StagedUploadKind<FileType>,
  keyPrefix: string,
  uploadId: string,
  fileType: FileType,
): string {
  assertStagedUploadId(kind, uploadId);
  return `${joinS3Prefix(keyPrefix, kind.prefixSegment)}${uploadId}/${kind.objectStem}.${fileType}`;
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
