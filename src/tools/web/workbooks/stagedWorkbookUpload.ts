import { randomUUID } from 'crypto';
import { extname } from 'path';

import { getBlobStorageProvider } from '../../../blobStorage/init.js';

// Intentionally decimal GB (not GiB) to leave headroom under common blob storage
// single-PUT ceilings (e.g. S3's 5GB limit).
export const MAX_STAGED_WORKBOOK_BYTES = 5 * 1000 * 1000 * 1000;
export const WORKBOOK_UPLOAD_PREFIX_SEGMENT = 'workbook-uploads';

export type WorkbookFileType = 'twb' | 'twbx';
const WORKBOOK_FILE_TYPES: ReadonlyArray<WorkbookFileType> = ['twb', 'twbx'];

export type ResolvedWorkbook = {
  fileName: string;
  bytes: Buffer;
};

export type RequestWorkbookUploadResult = {
  workbookUploadId: string;
  uploadUrl: string;
  expiresAt?: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

type WorkbookUploadOptions = {
  fileName: string;
};

type ResolveWorkbookUploadOptions = {
  workbookUploadId: string;
  maxBytes?: number;
};

export async function requestStagedWorkbookUpload({
  fileName,
}: WorkbookUploadOptions): Promise<RequestWorkbookUploadResult> {
  const fileType = assertWorkbookUploadFileName(fileName);

  const workbookUploadId = randomUUID();
  const contentType = getWorkbookUploadContentType(fileType);
  const { uploadUrl, requiredHeaders, expiresAt } = await getBlobStorageProvider().getPresignedUploadUrl({
    key: buildWorkbookUploadKey(workbookUploadId, fileType),
    contentType,
  });

  return {
    workbookUploadId,
    uploadUrl,
    expiresAt,
    maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
    requiredHeaders,
  };
}

export async function resolveStagedWorkbookUpload({
  workbookUploadId,
  maxBytes = MAX_STAGED_WORKBOOK_BYTES,
}: ResolveWorkbookUploadOptions): Promise<ResolvedWorkbook> {
  assertWorkbookUploadId(workbookUploadId);

  for (const fileType of WORKBOOK_FILE_TYPES) {
    const bytes = await getBlobStorageProvider().download({
      key: buildWorkbookUploadKey(workbookUploadId, fileType),
      maxBytes,
    });

    if (bytes === undefined) {
      continue;
    }

    if (bytes.byteLength === 0) {
      throw new Error('Workbook upload bytes must not be empty.');
    }

    return {
      fileName: `${workbookUploadId}.${fileType}`,
      bytes,
    };
  }

  throw new Error('Workbook upload not found. Upload the workbook bytes before publishing.');
}

export function buildWorkbookUploadKey(
  workbookUploadId: string,
  fileType: WorkbookFileType,
): string {
  assertWorkbookUploadId(workbookUploadId);
  return `${WORKBOOK_UPLOAD_PREFIX_SEGMENT}/${workbookUploadId}/workbook.${fileType}`;
}

function assertWorkbookUploadFileName(fileName: string): WorkbookFileType {
  const fileType = getWorkbookFileType(fileName);
  if (!fileType) {
    throw new Error('Workbook upload filename must end in .twb or .twbx.');
  }
  return fileType;
}

export function getWorkbookFileType(fileName: string): WorkbookFileType | undefined {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.twb') {
    return 'twb';
  }
  if (extension === '.twbx') {
    return 'twbx';
  }
  return undefined;
}

function getWorkbookUploadContentType(fileType: WorkbookFileType): string {
  return fileType === 'twb' ? 'application/xml' : 'application/octet-stream';
}

function assertWorkbookUploadId(workbookUploadId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      workbookUploadId,
    )
  ) {
    throw new Error('Workbook upload id is invalid.');
  }
}
