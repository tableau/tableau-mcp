import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';
import { pipeline } from 'stream/promises';

import { DownloadedWorkbook } from '../../../sdks/tableau/methods/workbooksMethods.js';

export type DownloadedWorkbookFile = {
  workbookFilePath: string;
  fileName: string;
  fileType: 'twb' | 'twbx';
  sizeBytes: number;
};

type PersistDownloadedWorkbookOptions = {
  temporaryDirectory?: string;
  generateUuid?: () => string;
};

export async function persistDownloadedWorkbook(
  workbook: DownloadedWorkbook,
  options: PersistDownloadedWorkbookOptions = {},
): Promise<DownloadedWorkbookFile> {
  const generateUuid = options.generateUuid ?? randomUUID;
  const fileNameFromHeader = getContentDispositionFileName(workbook.contentDisposition);
  const fileType = getWorkbookFileType(fileNameFromHeader, workbook.contentType);
  const fileName = getSafeFileName(fileNameFromHeader, fileType, generateUuid);
  const directory = await mkdtemp(
    join(options.temporaryDirectory ?? tmpdir(), 'tableau-mcp-workbook-'),
  );
  const workbookFilePath = join(directory, fileName);

  try {
    await pipeline(
      workbook.content,
      createWriteStream(workbookFilePath, { flags: 'wx', mode: 0o600 }),
    );
    const fileStats = await stat(workbookFilePath);

    return {
      workbookFilePath,
      fileName,
      fileType,
      sizeBytes: fileStats.size,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function getContentDispositionFileName(contentDisposition?: string): string | undefined {
  if (!contentDisposition) return undefined;

  const encodedMatch = /(?:^|;)\s*filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(contentDisposition);
  if (encodedMatch) {
    const encodedFileName = stripQuotes(encodedMatch[1].trim());
    try {
      return decodeURIComponent(encodedFileName);
    } catch {
      return encodedFileName;
    }
  }

  const quotedMatch = /(?:^|;)\s*filename\s*=\s*"([^"]+)"/i.exec(contentDisposition);
  if (quotedMatch) return quotedMatch[1];

  const unquotedMatch = /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(contentDisposition);
  return unquotedMatch ? stripQuotes(unquotedMatch[1].trim()) : undefined;
}

function getWorkbookFileType(
  fileName: string | undefined,
  contentType: string | undefined,
): 'twb' | 'twbx' {
  const extension = fileName ? extname(fileName).toLowerCase() : '';
  if (extension === '.twb') return 'twb';
  if (extension === '.twbx') return 'twbx';

  const normalizedContentType = contentType?.split(';', 1)[0].trim().toLowerCase();
  return normalizedContentType === 'application/xml' || normalizedContentType === 'text/xml'
    ? 'twb'
    : 'twbx';
}

function getSafeFileName(
  fileName: string | undefined,
  fileType: 'twb' | 'twbx',
  generateUuid: () => string,
): string {
  if (!fileName) return `${generateUuid()}.${fileType}`;

  const localName = basename(fileName).replace(/[^A-Za-z0-9._ -]/g, '_');
  if (
    localName.length > 0 &&
    localName.length <= 240 &&
    /^[A-Za-z0-9]/.test(localName) &&
    !localName.includes('..') &&
    extname(localName).toLowerCase() === `.${fileType}`
  ) {
    return localName;
  }

  return `${generateUuid()}.${fileType}`;
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

export const exportedForTesting = {
  getContentDispositionFileName,
  getWorkbookFileType,
  getSafeFileName,
};
