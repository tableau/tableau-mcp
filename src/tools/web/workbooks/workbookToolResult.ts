import { randomUUID } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { getBlobStorageProvider, isBlobStorageEnabled } from '../../../blobStorage/init.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { MAX_STAGED_WORKBOOK_BYTES } from './stagedWorkbookUpload.js';

export type WorkbookToolResult =
  | { kind: 'url'; url: string; mimeType: string; filename: string }
  | { kind: 'path'; path: string; mimeType: string; filename: string };

type BuildWorkbookToolResultParams = {
  content: AsyncIterable<Uint8Array>;
  contentLength?: number;
  mimeType: string;
  filename: string;
  resourceId: string;
  toolName: string;
  keyPrefixSegment: string;
  maxBytes?: number;
};

/**
 * Streams workbook content to blob storage, or to a temp file when storage is off, without ever
 * holding it in memory whole. Throws once the content exceeds `maxBytes`.
 */
export async function buildWorkbookToolResult(
  params: BuildWorkbookToolResultParams,
): Promise<WorkbookToolResult> {
  try {
    return await buildWorkbookToolResultInner(params);
  } catch (error) {
    // Release the source on every failure path; a no-op if it was already consumed or destroyed.
    discard(params.content);
    throw error;
  }
}

async function buildWorkbookToolResultInner({
  content,
  contentLength,
  mimeType,
  filename,
  resourceId,
  toolName,
  keyPrefixSegment,
  maxBytes = MAX_STAGED_WORKBOOK_BYTES,
}: BuildWorkbookToolResultParams): Promise<WorkbookToolResult> {
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw tooLargeError(maxBytes);
  }

  let started = false;
  const capped = capBytes(content, maxBytes, () => (started = true));

  if (!isBlobStorageEnabled() || !(await getFeatureGate().isFeatureEnabled('workbook-file-mode'))) {
    return await persistWorkbookToTempPath({ content: capped, mimeType, filename });
  }

  let url: string;
  try {
    const ext = mimeType === 'application/xml' ? 'twb' : 'twbx';
    const key = `${keyPrefixSegment}${resourceId}/${randomUUID()}.${ext}`;
    ({ url } = await getBlobStorageProvider().upload({
      key,
      data: capped,
      contentType: mimeType,
      contentLength,
    }));
  } catch (error) {
    // Once the provider has started reading, the stream can't be replayed into a temp file.
    if (started) {
      throw new Error(`Failed to store workbook in blob storage: ${describeUploadError(error)}`, {
        cause: error,
      });
    }
    log({
      message: `${toolName}: blob storage workbook upload failed, falling back to temp-file output: ${getExceptionMessage(
        error,
      )}`,
      level: 'warning',
      logger: 'tool',
    });
    // Fresh wrapper: the provider may have closed `capped` without reading the source.
    return await persistWorkbookToTempPath({
      content: capBytes(content, maxBytes, () => undefined),
      mimeType,
      filename,
    });
  }

  // `started` flips on the first pull, so a provider that drained an empty stream still counts.
  if (!started) {
    throw new Error('Blob storage provider returned without reading the upload data.');
  }
  return { kind: 'url', url, mimeType, filename };
}

export function workbookToolResultToCallToolResult(result: WorkbookToolResult): CallToolResult {
  if (result.kind === 'path') {
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path: result.path,
            filename: result.filename,
            mimeType: result.mimeType,
          }),
        },
      ],
    };
  }

  return {
    isError: false,
    content: [
      {
        type: 'resource_link',
        uri: result.url,
        name: result.filename,
        mimeType: result.mimeType,
        description: 'Downloaded Tableau workbook content stored in blob storage.',
      },
    ],
  };
}

async function persistWorkbookToTempPath({
  content,
  mimeType,
  filename,
}: {
  content: AsyncIterable<Uint8Array>;
  mimeType: string;
  filename: string;
}): Promise<WorkbookToolResult> {
  const extension = mimeType === 'application/xml' ? 'twb' : 'twbx';
  const tempDir = join(tmpdir(), 'tableau-mcp-workbooks');
  await mkdir(tempDir, { recursive: true });
  const outputPath = join(tempDir, `${randomUUID()}-${sanitizeFileName(filename, extension)}`);
  const file = createWriteStream(outputPath);
  try {
    await pipeline(content, file);
  } catch (error) {
    // pipeline can reject while the destroyed file stream is still opening; wait for it to close
    // so the removal can't race the open that creates the file.
    if (!file.closed) {
      await new Promise<void>((resolve) => file.once('close', () => resolve()));
    }
    await rm(outputPath, { force: true });
    throw error;
  }
  return { kind: 'path', path: outputPath, mimeType, filename };
}

async function* capBytes(
  content: AsyncIterable<Uint8Array>,
  maxBytes: number,
  onStart: () => void,
): AsyncGenerator<Uint8Array> {
  onStart();
  let totalBytes = 0;
  for await (const piece of content) {
    totalBytes += piece.byteLength;
    if (totalBytes > maxBytes) {
      throw tooLargeError(maxBytes);
    }
    yield piece;
  }
}

// Node connect failures can be an AggregateError with an empty message; the reason is on
// `code` or the inner errors.
function describeUploadError(error: unknown): string {
  if (!(error instanceof Error)) {
    return getExceptionMessage(error) || 'unknown error';
  }
  if (error.message) {
    return error.message;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code) {
    return code;
  }
  if (error instanceof AggregateError) {
    const inner = error.errors.map(getExceptionMessage).filter(Boolean).join('; ');
    if (inner) {
      return inner;
    }
  }
  return 'unknown error';
}

function tooLargeError(maxBytes: number): Error {
  return new Error(`Workbook content exceeds the maximum allowed size of ${maxBytes} bytes.`);
}

/** Best-effort release of a stream that won't be read to the end (destroys a Node `Readable`). */
function discard(content: AsyncIterable<Uint8Array>): void {
  // `return()` on a fresh, unstarted Readable iterator is a no-op, so destroy it directly.
  if (content instanceof Readable) {
    content.destroy();
    return;
  }
  Promise.resolve(content[Symbol.asyncIterator]().return?.()).catch(() => undefined);
}

function sanitizeFileName(filename: string, fallbackExtension: 'twb' | 'twbx'): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  if (!cleaned) {
    return `workbook.${fallbackExtension}`;
  }
  return cleaned;
}
