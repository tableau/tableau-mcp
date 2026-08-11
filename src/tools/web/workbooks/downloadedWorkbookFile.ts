import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, join, posix } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { type Entry, Parse } from 'unzipper';

import { DownloadedWorkbook } from '../../../sdks/tableau/methods/workbooksMethods.js';

export type DownloadedWorkbookFile = {
  workbookFilePath: string;
  fileName: string;
  fileType: 'twb';
  sourceFileType: 'twb' | 'twbx';
  sizeBytes: number;
};

type PersistDownloadedWorkbookOptions = {
  temporaryDirectory?: string;
  generateUuid?: () => string;
};

/**
 * Normalizes a Tableau workbook download into a local editable TWB. Native TWB
 * responses are streamed directly to disk; TWBX responses are parsed as ZIP
 * streams and only their single embedded TWB is retained.
 */
export async function persistDownloadedWorkbook(
  workbook: DownloadedWorkbook,
  options: PersistDownloadedWorkbookOptions = {},
): Promise<DownloadedWorkbookFile> {
  const generateUuid = options.generateUuid ?? randomUUID;
  const fileNameFromHeader = getContentDispositionFileName(workbook.contentDisposition);
  const sourceFileType = getWorkbookFileType(fileNameFromHeader, workbook.contentType);
  const directory = await mkdtemp(
    join(options.temporaryDirectory ?? tmpdir(), 'tableau-mcp-workbook-'),
  );

  try {
    if (sourceFileType === 'twb') {
      return await persistTwbStream({
        content: workbook.content,
        directory,
        fileName: getSafeTwbFileName(fileNameFromHeader, generateUuid),
        sourceFileType,
      });
    }

    return await extractTwbFromTwbx({
      content: workbook.content,
      directory,
      generateUuid,
    });
  } catch (error) {
    workbook.content.destroy();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function persistTwbStream({
  content,
  directory,
  fileName,
  sourceFileType,
}: {
  content: Readable;
  directory: string;
  fileName: string;
  sourceFileType: 'twb' | 'twbx';
}): Promise<DownloadedWorkbookFile> {
  const workbookFilePath = join(directory, fileName);
  await pipeline(content, createWriteStream(workbookFilePath, { flags: 'wx', mode: 0o600 }));
  const fileStats = await stat(workbookFilePath);

  return {
    workbookFilePath,
    fileName,
    fileType: 'twb',
    sourceFileType,
    sizeBytes: fileStats.size,
  };
}

async function extractTwbFromTwbx({
  content,
  directory,
  generateUuid,
}: {
  content: Readable;
  directory: string;
  generateUuid: () => string;
}): Promise<DownloadedWorkbookFile> {
  const parser = Parse({ forceStream: true });
  const forwardSourceError = (error: Error): void => {
    parser.destroy(error);
  };
  content.once('error', forwardSourceError);
  content.pipe(parser);

  let extractedWorkbook: DownloadedWorkbookFile | undefined;

  try {
    for await (const candidate of parser as AsyncIterable<Entry>) {
      const entry = candidate as Entry;
      if (entry.type !== 'File' || extname(entry.path).toLowerCase() !== '.twb') {
        await entry.autodrain().promise();
        continue;
      }

      if (extractedWorkbook) {
        await entry.autodrain().promise();
        throw new Error('Downloaded TWBX contains multiple TWB files.');
      }

      const fileName = getSafeTwbFileName(posix.basename(entry.path), generateUuid);
      extractedWorkbook = await persistTwbStream({
        content: entry,
        directory,
        fileName,
        sourceFileType: 'twbx',
      });
    }
  } finally {
    content.off('error', forwardSourceError);
  }

  if (!extractedWorkbook) {
    throw new Error('Downloaded TWBX does not contain a TWB file.');
  }

  return extractedWorkbook;
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

function getSafeTwbFileName(fileName: string | undefined, generateUuid: () => string): string {
  if (!fileName) return `${generateUuid()}.twb`;

  const localName = basename(fileName).replace(/[^A-Za-z0-9._ -]/g, '_');
  if (
    localName.length > 0 &&
    localName.length <= 240 &&
    /^[A-Za-z0-9]/.test(localName) &&
    !localName.includes('..') &&
    extname(localName).toLowerCase() === '.twb'
  ) {
    return localName;
  }

  return `${generateUuid()}.twb`;
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

export const exportedForTesting = {
  getContentDispositionFileName,
  getWorkbookFileType,
  getSafeTwbFileName,
};
