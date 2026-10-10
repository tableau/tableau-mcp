import { randomUUID } from 'crypto';
import { extname } from 'path';

import { type ByteStream } from '../../sdks/tableau/methods/publishingMethods.js';
import {
  BucketS3Config,
  createPresignedPutUrlToS3,
  downloadObjectFromS3IfExists,
  joinS3Prefix,
  openObjectStreamFromS3IfExists,
} from './s3Client.js';

// Intentionally decimal GB (not GiB) to leave headroom under S3's 5GB single-PUT ceiling.
export const MAX_STAGED_UPLOAD_BYTES = 5 * 1000 * 1000 * 1000;

/** Describes one kind of staged content (workbooks, data sources, ...). */
export type StagedUploadKind<T extends string> = {
  /** Capitalized label used in error messages, e.g. "Workbook". */
  label: string;
  /** S3 key segment appended to the configured key prefix, e.g. "workbook-uploads". */
  prefixSegment: string;
  /** Object basename under the upload id folder, e.g. "workbook" → `workbook.twbx`. */
  objectBaseName: string;
  fileTypes: ReadonlyArray<T>;
  contentTypeFor: (fileType: T) => string;
};

export type RequestStagedUploadResult = {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export type ResolvedStagedUpload<T extends string> = {
  fileName: string;
  fileType: T;
  bytes: Buffer;
};

export type StreamedStagedUpload<T extends string> = {
  fileName: string;
  fileType: T;
  stream: ByteStream;
};

export async function requestStagedUpload<T extends string>(
  kind: StagedUploadKind<T>,
  { fileName, config }: { fileName: string; config: BucketS3Config },
): Promise<RequestStagedUploadResult> {
  const fileType = getStagedUploadFileType(kind, fileName);
  if (!fileType) {
    throw new Error(
      `${kind.label} upload filename must end in ${formatExtensions(kind.fileTypes)}.`,
    );
  }

  const uploadId = randomUUID();
  const contentType = kind.contentTypeFor(fileType);
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

/** Downloads the staged object fully into memory. Prefer {@link streamStagedUpload} for large files. */
export async function resolveStagedUpload<T extends string>(
  kind: StagedUploadKind<T>,
  {
    uploadId,
    config,
    maxBytes = MAX_STAGED_UPLOAD_BYTES,
  }: { uploadId: string; config: BucketS3Config; maxBytes?: number },
): Promise<ResolvedStagedUpload<T>> {
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

    return { fileName: `${uploadId}.${fileType}`, fileType, bytes };
  }

  throw notFoundError(kind);
}

/**
 * Opens the staged object as a byte stream without buffering it. The stream throws if the object
 * turns out to be empty or larger than `maxBytes`.
 */
export async function streamStagedUpload<T extends string>(
  kind: StagedUploadKind<T>,
  {
    uploadId,
    config,
    maxBytes = MAX_STAGED_UPLOAD_BYTES,
  }: { uploadId: string; config: BucketS3Config; maxBytes?: number },
): Promise<StreamedStagedUpload<T>> {
  assertStagedUploadId(kind, uploadId);

  for (const fileType of kind.fileTypes) {
    const object = await openObjectStreamFromS3IfExists({
      key: buildStagedUploadS3Key(kind, config.keyPrefix, uploadId, fileType),
      bucket: config.bucket,
      region: config.region,
      maxBytes,
    });

    if (object === undefined) {
      continue;
    }

    if (object.contentLength === 0) {
      throw new Error(`${kind.label} upload bytes must not be empty.`);
    }

    return {
      fileName: `${uploadId}.${fileType}`,
      fileType,
      stream: object.stream,
    };
  }

  throw notFoundError(kind);
}

export function buildStagedUploadS3Key<T extends string>(
  kind: StagedUploadKind<T>,
  keyPrefix: string,
  uploadId: string,
  fileType: T,
): string {
  assertStagedUploadId(kind, uploadId);
  return `${joinS3Prefix(keyPrefix, kind.prefixSegment)}${uploadId}/${kind.objectBaseName}.${fileType}`;
}

export function getStagedUploadFileType<T extends string>(
  kind: StagedUploadKind<T>,
  fileName: string,
): T | undefined {
  const extension = extname(fileName).toLowerCase().slice(1);
  return kind.fileTypes.find((fileType) => fileType === extension);
}

function formatExtensions(fileTypes: ReadonlyArray<string>): string {
  const extensions = fileTypes.map((fileType) => `.${fileType}`);
  return extensions.length > 1
    ? `${extensions.slice(0, -1).join(', ')} or ${extensions.at(-1)}`
    : (extensions[0] ?? '');
}

function notFoundError<T extends string>(kind: StagedUploadKind<T>): Error {
  return new Error(
    `${kind.label} upload not found. Upload the ${kind.label.toLowerCase()} bytes before publishing.`,
  );
}

function assertStagedUploadId<T extends string>(kind: StagedUploadKind<T>, uploadId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)
  ) {
    throw new Error(`${kind.label} upload id is invalid.`);
  }
}
