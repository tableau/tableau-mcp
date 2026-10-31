import { randomUUID } from 'crypto';
import { extname } from 'path';

import { getBlobStorageProvider } from '../../blobStorage/init.js';
import { buildTenantBlobKey, type TenantLuids } from '../../blobStorage/tenantKey.js';

// Intentionally decimal GB (not GiB) to leave headroom under common blob storage
// single-PUT ceilings (e.g. S3's 5GB limit).
export const MAX_STAGED_UPLOAD_BYTES = 5 * 1000 * 1000 * 1000;

export type StagedUploadKind<FileType extends string> = {
  // Keys are `<prefixSegment>/<siteLuid>/<userLuid>/<uuid>/<objectStem>.<fileType>`; changing them orphans in-flight uploads.
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
  tenant,
}: {
  kind: StagedUploadKind<FileType>;
  fileName: string;
  tenant: TenantLuids;
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
      key: buildStagedUploadKey(kind, tenant, uploadId, fileType),
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

export async function resolveStagedUpload<FileType extends string>({
  kind,
  uploadId,
  tenant,
  maxBytes = MAX_STAGED_UPLOAD_BYTES,
}: {
  kind: StagedUploadKind<FileType>;
  uploadId: string;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedStagedFile> {
  assertStagedUploadId(kind, uploadId);

  // The key is rebuilt from the caller's own tenant, so an id staged by another tenant misses.
  for (const fileType of kind.fileTypes) {
    const download = await getBlobStorageProvider().download({
      key: buildStagedUploadKey(kind, tenant, uploadId, fileType),
      maxBytes,
    });

    if (download === undefined) {
      continue;
    }

    const bytes = await collectBytes(kind, download.data, maxBytes);
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
    // A string- or object-mode stream would make byteLength undefined and the total NaN, which
    // never exceeds maxBytes.
    if (!(piece instanceof Uint8Array)) {
      throw new Error('Blob storage provider yielded a non-byte chunk.');
    }
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
  tenant: TenantLuids,
  uploadId: string,
  fileType: FileType,
): string {
  assertStagedUploadId(kind, uploadId);
  return buildTenantBlobKey(
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
