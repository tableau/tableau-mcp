import type { TenantLuids } from '../../../blobStorage/tenantKey.js';
import {
  buildStagedUploadKey,
  getStagedFileType,
  MAX_STAGED_UPLOAD_BYTES,
  requestStagedUpload,
  type ResolvedStagedFileStream,
  resolveStagedUploadStream,
  type StagedUploadKind,
} from '../stagedUpload.js';

export const MAX_STAGED_WORKBOOK_BYTES = MAX_STAGED_UPLOAD_BYTES;
export const WORKBOOK_UPLOAD_PREFIX_SEGMENT = 'workbook-uploads';

export type WorkbookFileType = 'twb' | 'twbx';

const workbookKind: StagedUploadKind<WorkbookFileType> = {
  prefixSegment: WORKBOOK_UPLOAD_PREFIX_SEGMENT,
  objectStem: 'workbook',
  label: 'Workbook',
  noun: 'workbook',
  fileTypes: ['twb', 'twbx'],
  xmlFileType: 'twb',
};

export type ResolvedWorkbook = ResolvedStagedFileStream<WorkbookFileType>;

export type RequestWorkbookUploadResult = {
  workbookUploadId: string;
  uploadUrl: string;
  expiresAt?: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export async function requestStagedWorkbookUpload({
  fileName,
  tenant,
}: {
  fileName: string;
  tenant: TenantLuids;
}): Promise<RequestWorkbookUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload({ kind: workbookKind, fileName, tenant });
  return { workbookUploadId: uploadId, ...rest };
}

export async function resolveStagedWorkbookUpload({
  workbookUploadId,
  tenant,
  maxBytes,
}: {
  workbookUploadId: string;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedWorkbook> {
  return await resolveStagedUploadStream({
    kind: workbookKind,
    uploadId: workbookUploadId,
    tenant,
    maxBytes,
  });
}

export function buildWorkbookUploadKey(
  tenant: TenantLuids,
  workbookUploadId: string,
  fileType: WorkbookFileType,
): string {
  return buildStagedUploadKey(workbookKind, tenant, workbookUploadId, fileType);
}

export function getWorkbookFileType(fileName: string): WorkbookFileType | undefined {
  return getStagedFileType(workbookKind, fileName);
}
