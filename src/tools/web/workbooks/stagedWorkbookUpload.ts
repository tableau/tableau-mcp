import { randomUUID } from 'crypto';
import { extname } from 'path';

import { getBlobStorageProvider } from '../../../blobStorage/init.js';
import { buildTenantBlobKey, TenantLuids } from '../../../blobStorage/tenantKey.js';

// Intentionally decimal GB (not GiB) to leave headroom under common blob storage
// single-PUT ceilings (e.g. S3's 5GB limit).
export const MAX_STAGED_WORKBOOK_BYTES = 5 * 1000 * 1000 * 1000;
export const WORKBOOK_UPLOAD_PREFIX_SEGMENT = 'workbook-uploads';

export type WorkbookFileType = 'twb' | 'twbx';
const WORKBOOK_FILE_TYPES: ReadonlyArray<WorkbookFileType> = ['twb', 'twbx'];

export type ResolvedWorkbook = {
  fileName: string;
  content: AsyncIterable<Uint8Array>;
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
  tenant: TenantLuids;
};

type ResolveWorkbookUploadOptions = {
  workbookUploadId: string;
  tenant: TenantLuids;
  maxBytes?: number;
};

export async function requestStagedWorkbookUpload({
  fileName,
  tenant,
}: WorkbookUploadOptions): Promise<RequestWorkbookUploadResult> {
  const fileType = assertWorkbookUploadFileName(fileName);

  const workbookUploadId = randomUUID();
  const contentType = getWorkbookUploadContentType(fileType);
  const { uploadUrl, requiredHeaders, expiresAt } =
    await getBlobStorageProvider().getPresignedUploadUrl({
      key: buildWorkbookUploadKey(tenant, workbookUploadId, fileType),
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
  tenant,
  maxBytes = MAX_STAGED_WORKBOOK_BYTES,
}: ResolveWorkbookUploadOptions): Promise<ResolvedWorkbook> {
  assertWorkbookUploadId(workbookUploadId);

  // The key is rebuilt from the caller's own tenant, so an id staged by another tenant misses.
  for (const fileType of WORKBOOK_FILE_TYPES) {
    const content = await getBlobStorageProvider().download({
      key: buildWorkbookUploadKey(tenant, workbookUploadId, fileType),
      maxBytes,
    });

    if (content === undefined) {
      continue;
    }

    // Emptiness and maxBytes are enforced while the publish path consumes the stream.
    return {
      fileName: `${workbookUploadId}.${fileType}`,
      content,
    };
  }

  throw new Error('Workbook upload not found. Upload the workbook bytes before publishing.');
}

export function buildWorkbookUploadKey(
  tenant: TenantLuids,
  workbookUploadId: string,
  fileType: WorkbookFileType,
): string {
  assertWorkbookUploadId(workbookUploadId);
  return buildTenantBlobKey(
    tenant,
    `${WORKBOOK_UPLOAD_PREFIX_SEGMENT}/${workbookUploadId}/workbook.${fileType}`,
  );
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
