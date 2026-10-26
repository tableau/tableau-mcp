import { randomUUID } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { getBlobStorageProvider, isBlobStorageEnabled } from '../../../blobStorage/init.js';
import { toUploadData } from '../../../blobStorage/uploadData.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';

export type WorkbookToolResult =
  | { kind: 'url'; url: string; mimeType: string; filename: string }
  | { kind: 'path'; path: string; mimeType: string; filename: string };

export async function buildWorkbookToolResult({
  content,
  mimeType,
  filename,
  resourceId,
  toolName,
}: {
  content: Buffer;
  mimeType: string;
  filename: string;
  resourceId: string;
  toolName: string;
}): Promise<WorkbookToolResult> {
  if (!isBlobStorageEnabled() || !(await getFeatureGate().isFeatureEnabled('workbook-file-mode'))) {
    return await persistWorkbookToTempPath({ content, mimeType, filename });
  }

  let url: string;
  let started = false;
  try {
    const ext = mimeType === 'application/xml' ? 'twb' : 'twbx';
    const { data, contentLength } = toUploadData(content);
    ({ url } = await getBlobStorageProvider().upload({
      key: buildWorkbookKey(resourceId, ext),
      data: markStarted(data, () => (started = true)),
      contentType: mimeType,
      contentLength,
    }));
  } catch (error) {
    log({
      message: `${toolName}: blob storage workbook upload failed, falling back to temp-file output: ${describeUploadError(
        error,
      )}`,
      level: 'warning',
      logger: 'tool',
    });
    return await persistWorkbookToTempPath({ content, mimeType, filename });
  }

  if (!started) {
    throw new Error('Blob storage provider returned without reading the upload data.');
  }
  return { kind: 'url', url, mimeType, filename };
}

/** Builds the blob storage key for a workbook; any base path is the provider's concern. */
function buildWorkbookKey(resourceId: string, ext: 'twb' | 'twbx'): string {
  return `workbook-files/${resourceId}/${randomUUID()}.${ext}`;
}

// `started` flips on the first pull, so a provider that drained an empty payload still counts.
async function* markStarted(
  data: AsyncIterable<Uint8Array>,
  onStart: () => void,
): AsyncGenerator<Uint8Array> {
  onStart();
  yield* data;
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
  content: Buffer;
  mimeType: string;
  filename: string;
}): Promise<WorkbookToolResult> {
  const extension = mimeType === 'application/xml' ? 'twb' : 'twbx';
  const tempDir = join(tmpdir(), 'tableau-mcp-workbooks');
  await mkdir(tempDir, { recursive: true });
  const outputPath = join(tempDir, `${randomUUID()}-${sanitizeFileName(filename, extension)}`);
  await writeFile(outputPath, content);
  return { kind: 'path', path: outputPath, mimeType, filename };
}

function sanitizeFileName(filename: string, fallbackExtension: 'twb' | 'twbx'): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  if (!cleaned) {
    return `workbook.${fallbackExtension}`;
  }
  return cleaned;
}
