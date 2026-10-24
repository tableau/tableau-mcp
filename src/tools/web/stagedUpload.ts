import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Readable } from 'stream';

import { getBlobStorageProvider } from '../../blobStorage/init.js';
import { ArgsValidationError } from '../../errors/mcpToolError.js';

// Intentionally decimal GB (not GiB) to leave headroom under common blob storage
// single-PUT ceilings (e.g. S3's 5GB limit).
export const MAX_STAGED_UPLOAD_BYTES = 5 * 1000 * 1000 * 1000;

export type StagedUploadKind<FileType extends string> = {
  // Keys are `<prefixSegment>/<uuid>/<objectStem>.<fileType>`; changing them orphans in-flight uploads.
  prefixSegment: string;
  objectStem: string;
  label: string;
  noun: string;
  fileTypes: ReadonlyArray<FileType>;
  xmlFileType: FileType;
};

export async function requestStagedUpload<FileType extends string>({
  kind,
  fileName,
}: {
  kind: StagedUploadKind<FileType>;
  fileName: string;
}): Promise<{
  uploadId: string;
  uploadUrl: string;
  expiresAt?: string;
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
  const { uploadUrl, requiredHeaders, expiresAt } =
    await getBlobStorageProvider().getPresignedUploadUrl({
      key: buildStagedUploadKey(kind, uploadId, fileType),
      contentType,
      maxBytes: MAX_STAGED_UPLOAD_BYTES,
    });

  return {
    uploadId,
    uploadUrl,
    expiresAt,
    maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
    requiredHeaders,
  };
}

export type ResolvedStagedFileStream<FileType extends string> = {
  fileName: string;
  fileType: FileType;
  fileStream: AsyncIterable<Uint8Array>;
  contentLength?: number;
};

/**
 * Locates a staged upload and returns its bytes as a stream, without buffering. Rejects up front
 * when the provider reports a length over `maxBytes`; otherwise non-byte chunks are rejected as
 * they are consumed, and size and emptiness are enforced by the consumer.
 */
export async function resolveStagedUploadStream<FileType extends string>({
  kind,
  uploadId,
  maxBytes = MAX_STAGED_UPLOAD_BYTES,
}: {
  kind: StagedUploadKind<FileType>;
  uploadId: string;
  maxBytes?: number;
}): Promise<ResolvedStagedFileStream<FileType>> {
  assertStagedUploadId(kind, uploadId);

  for (const fileType of kind.fileTypes) {
    const download = await getBlobStorageProvider().download({
      key: buildStagedUploadKey(kind, uploadId, fileType),
      maxBytes,
    });

    if (download === undefined) {
      continue;
    }

    // Fail before the caller opens a Tableau upload session it would abandon at the cap.
    if (download.contentLength !== undefined && download.contentLength > maxBytes) {
      discard(download.data);
      throw new ArgsValidationError(
        `${kind.label} upload exceeds the maximum allowed size of ${maxBytes} bytes.`,
      );
    }

    return {
      fileName: `${uploadId}.${fileType}`,
      fileType,
      fileStream: requireByteChunks(download.data),
      contentLength: download.contentLength,
    };
  }

  throw new Error(
    `${kind.label} upload not found. Upload the ${kind.noun} bytes before publishing.`,
  );
}

async function* requireByteChunks(stream: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  for await (const piece of stream) {
    if (!(piece instanceof Uint8Array)) {
      throw new Error('Blob storage provider yielded a non-byte chunk.');
    }
    yield piece;
  }
}

/** Best-effort release of a provider stream that won't be read (destroys a Node `Readable`). */
function discard(stream: AsyncIterable<Uint8Array>): void {
  // `return()` on a fresh, unstarted Readable iterator is a no-op, so destroy it directly.
  if (stream instanceof Readable) {
    stream.destroy();
    return;
  }
  Promise.resolve(stream[Symbol.asyncIterator]().return?.()).catch(() => undefined);
}

export function buildStagedUploadKey<FileType extends string>(
  kind: StagedUploadKind<FileType>,
  uploadId: string,
  fileType: FileType,
): string {
  assertStagedUploadId(kind, uploadId);
  return `${kind.prefixSegment}/${uploadId}/${kind.objectStem}.${fileType}`;
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
