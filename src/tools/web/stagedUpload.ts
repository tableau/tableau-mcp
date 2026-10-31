import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Readable } from 'stream';

import { getBlobStorageProvider } from '../../blobStorage/init.js';
import { buildTenantBlobKey, type TenantLuids } from '../../blobStorage/tenantKey.js';
import { ArgsValidationError } from '../../errors/mcpToolError.js';

// Intentionally decimal GB (not GiB) to leave headroom under common blob storage
// single-PUT ceilings (e.g. S3's 5GB limit).
export const MAX_STAGED_UPLOAD_BYTES = 5 * 1000 * 1000 * 1000;

export type UploadConsumer<FileType extends string = string> = {
  // Keys are `<kind>/<siteLuid>/<userLuid>/<uuid>/<objectStem>.<fileType>`.
  kind: string;
  objectStem: string;
  noun: string;
  fileTypes: ReadonlyArray<FileType>;
  xmlFileType: FileType;
  isAvailable: (clientId?: string) => Promise<boolean>;
};

const registeredConsumers = new Set<UploadConsumer>();

/**
 * Declares a tool that consumes staged uploads, the file types it accepts, and the key kind
 * they are staged under. request-upload accepts the union of all declared file types.
 */
export function defineUploadConsumer<FileType extends string>(
  consumer: UploadConsumer<FileType>,
): UploadConsumer<FileType> {
  registeredConsumers.add(consumer);
  return consumer;
}

export function getSupportedUploadFileTypes(): string[] {
  return [...new Set([...registeredConsumers].flatMap((consumer) => consumer.fileTypes))];
}

/** File types whose consuming publish tool is currently available to the client. */
export async function getAvailableUploadFileTypes(clientId?: string): Promise<string[]> {
  const available: string[] = [];
  for (const consumer of registeredConsumers) {
    if (await consumer.isAvailable(clientId)) {
      available.push(...consumer.fileTypes);
    }
  }
  return [...new Set(available)];
}

export async function requestStagedUpload({
  fileName,
  clientId,
  tenant,
}: {
  fileName: string;
  clientId?: string;
  tenant: TenantLuids;
}): Promise<{
  uploadId: string;
  uploadUrl: string;
  expiresAt?: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
}> {
  const supported = await getAvailableUploadFileTypes(clientId);
  const extension = extname(fileName).toLowerCase();
  const fileType = supported.find((type) => extension === `.${type}`);
  const consumer = fileType
    ? [...registeredConsumers].find((candidate) => candidate.fileTypes.includes(fileType))
    : undefined;
  if (!fileType || !consumer) {
    throw new ArgsValidationError(
      `Upload filename must end in one of: ${supported.map((type) => `.${type}`).join(', ')}.`,
    );
  }

  const uploadId = randomUUID();
  const { uploadUrl, requiredHeaders, expiresAt } =
    await getBlobStorageProvider().getPresignedUploadUrl({
      key: buildStagedUploadKey(consumer, tenant, uploadId, fileType),
      contentType:
        fileType === consumer.xmlFileType ? 'application/xml' : 'application/octet-stream',
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
  consumer,
  uploadId,
  tenant,
  maxBytes = MAX_STAGED_UPLOAD_BYTES,
}: {
  consumer: UploadConsumer<FileType>;
  uploadId: string;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedStagedFileStream<FileType>> {
  assertStagedUploadId(uploadId);

  // The key is rebuilt from the caller's own tenant, so an id staged by another tenant misses.
  for (const fileType of consumer.fileTypes) {
    const download = await getBlobStorageProvider().download({
      key: buildStagedUploadKey(consumer, tenant, uploadId, fileType),
      maxBytes,
    });

    if (download === undefined) {
      continue;
    }

    // Fail before the caller opens a Tableau upload session it would abandon at the cap.
    if (download.contentLength !== undefined && download.contentLength > maxBytes) {
      discard(download.data);
      throw new ArgsValidationError(
        `Upload exceeds the maximum allowed size of ${maxBytes} bytes.`,
      );
    }

    return {
      fileName: `${uploadId}.${fileType}`,
      fileType,
      fileStream: requireByteChunks(download.data),
      contentLength: download.contentLength,
    };
  }

  // Not under this consumer's kind: distinguish a wrong-type upload from a missing one.
  const accepted = consumer.fileTypes.map((type) => `.${type}`).join(' or ');
  for (const other of registeredConsumers) {
    if (other.kind === consumer.kind) {
      continue;
    }
    for (const fileType of other.fileTypes) {
      const download = await getBlobStorageProvider().download({
        key: buildStagedUploadKey(other, tenant, uploadId, fileType),
        maxBytes,
      });
      if (download !== undefined) {
        discard(download.data);
        throw new ArgsValidationError(
          `Upload is a .${fileType} file, but ${consumer.noun} publishing accepts ${accepted}.`,
        );
      }
    }
  }

  throw new ArgsValidationError(
    `Upload not found. Call request-upload and upload the ${consumer.noun} bytes before publishing.`,
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

export function buildStagedUploadKey(
  consumer: Pick<UploadConsumer, 'kind' | 'objectStem'>,
  tenant: TenantLuids,
  uploadId: string,
  fileType: string,
): string {
  assertStagedUploadId(uploadId);
  return buildTenantBlobKey(tenant, consumer.kind, `${uploadId}/${consumer.objectStem}.${fileType}`);
}

export function getUploadFileType<FileType extends string>(
  consumer: UploadConsumer<FileType>,
  fileName: string,
): FileType | undefined {
  const extension = extname(fileName).toLowerCase();
  return consumer.fileTypes.find((fileType) => extension === `.${fileType}`);
}

function assertStagedUploadId(uploadId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)
  ) {
    throw new ArgsValidationError('Upload id is invalid.');
  }
}
