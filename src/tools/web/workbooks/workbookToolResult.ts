import { randomUUID } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { getBlobStorageProvider, isBlobStorageEnabled } from '../../../blobStorage/init.js';
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
  keyPrefixSegment,
}: {
  content: Buffer;
  mimeType: string;
  filename: string;
  resourceId: string;
  toolName: string;
  keyPrefixSegment: string;
}): Promise<WorkbookToolResult> {
  if (
    !isBlobStorageEnabled() ||
    !(await getFeatureGate().isFeatureEnabled('workbook-file-mode'))
  ) {
    return await persistWorkbookToTempPath({ content, mimeType, filename });
  }

  try {
    const ext = mimeType === 'application/xml' ? 'twb' : 'twbx';
    const key = `${keyPrefixSegment}${resourceId}/${randomUUID()}.${ext}`;
    const { url } = await getBlobStorageProvider().upload({
      key,
      data: content,
      contentType: mimeType,
    });
    return { kind: 'url', url, mimeType, filename };
  } catch (error) {
    log({
      message: `${toolName}: blob storage workbook upload failed, falling back to temp-file output: ${getExceptionMessage(
        error,
      )}`,
      level: 'warning',
      logger: 'tool',
    });
    return await persistWorkbookToTempPath({ content, mimeType, filename });
  }
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
