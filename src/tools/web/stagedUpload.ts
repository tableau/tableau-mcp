import { randomUUID } from 'crypto';
import { extname } from 'path';

import { getBlobStorageProvider } from '../../blobStorage/init.js';

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

export type ResolvedStagedFile = {
  fileName: string;
  bytes: Buffer;
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
    });

  return {
    uploadId,
    uploadUrl,
    expiresAt,
    maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
    requiredHeaders,
  };
}

export async function resolveStagedUpload<FileType extends string>({
  kind,
  uploadId,
  maxBytes = MAX_STAGED_UPLOAD_BYTES,
}: {
  kind: StagedUploadKind<FileType>;
  uploadId: string;
  maxBytes?: number;
}): Promise<ResolvedStagedFile> {
  assertStagedUploadId(kind, uploadId);

  for (const fileType of kind.fileTypes) {
    const stream = await getBlobStorageProvider().download({
      key: buildStagedUploadKey(kind, uploadId, fileType),
      maxBytes,
    });

    if (stream === undefined) {
      continue;
    }

    const bytes = await collectBytes(kind, stream, maxBytes);
    if (bytes.byteLength === 0) {
      throw new Error(`${kind.label} upload bytes must not be empty.`);
    }

    return { fileName: `${uploadId}.${fileType}`, bytes };
  }

  throw new Error(
    `${kind.label} upload not found. Upload the ${kind.noun} bytes before publishing.`,
  );
}

/** Buffers a provider download stream, throwing once it exceeds `maxBytes`. */
async function collectBytes(
  kind: StagedUploadKind<string>,
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const pieces: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const piece of stream) {
    totalBytes += piece.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(
        `${kind.label} upload exceeds the maximum allowed size of ${maxBytes} bytes.`,
      );
    }
    pieces.push(piece);
  }
  return Buffer.concat(pieces, totalBytes);
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
