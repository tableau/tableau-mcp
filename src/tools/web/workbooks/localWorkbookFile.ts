import { randomUUID } from 'crypto';
import { open } from 'fs/promises';
import { basename, extname, isAbsolute } from 'path';

import { LocalWorkbookFileError } from '../../../errors/mcpToolError.js';

export const MAX_LOCAL_WORKBOOK_BYTES = 5 * 1024 * 1024;

export type ResolvedWorkbook = {
  fileName: string;
  bytes: Buffer;
};

type ResolveLocalWorkbookOptions = {
  maxBytes?: number;
  generateUuid?: () => string;
};

export async function resolveLocalWorkbook(
  workbookFilePath: string,
  options: ResolveLocalWorkbookOptions = {},
): Promise<ResolvedWorkbook> {
  const maxBytes = options.maxBytes ?? MAX_LOCAL_WORKBOOK_BYTES;
  const generateUuid = options.generateUuid ?? randomUUID;
  assertAllowedLocalWorkbookPath(workbookFilePath);

  let file;
  try {
    file = await open(workbookFilePath, 'r');
  } catch {
    throw new LocalWorkbookFileError('Local workbook file could not be opened.');
  }

  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw new LocalWorkbookFileError('Local workbook path must refer to a regular file.');
    }
    if (stats.size > maxBytes) {
      throw new LocalWorkbookFileError(`Local workbook file exceeds the ${maxBytes}-byte limit.`);
    }

    const bytes = await file.readFile();
    if (bytes.byteLength > maxBytes) {
      throw new LocalWorkbookFileError(`Local workbook file exceeds the ${maxBytes}-byte limit.`);
    }

    return {
      fileName: getSafeWorkbookFileName(workbookFilePath, generateUuid),
      bytes,
    };
  } catch (error) {
    if (error instanceof LocalWorkbookFileError) throw error;
    throw new LocalWorkbookFileError('Local workbook file could not be read.');
  } finally {
    try {
      await file.close();
    } catch {
      // A close failure cannot make an otherwise bounded read unsafe.
    }
  }
}

function assertAllowedLocalWorkbookPath(workbookFilePath: string): void {
  if (!isAbsolute(workbookFilePath)) {
    throw new LocalWorkbookFileError('Local workbook file path must be absolute.');
  }
  if (extname(workbookFilePath).toLowerCase() !== '.twb') {
    throw new LocalWorkbookFileError('Local workbook file path must end in .twb.');
  }
}

function getSafeWorkbookFileName(workbookFilePath: string, generateUuid: () => string): string {
  const fileName = basename(workbookFilePath);
  if (
    fileName.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._ -]*\.twb$/i.test(fileName) &&
    !fileName.includes('..')
  ) {
    return fileName;
  }

  return `${generateUuid()}.twb`;
}
