import type { TenantLuids } from '../../../blobStorage/tenantKey.js';
import { BucketS3Config } from '../s3Client.js';
import {
  buildStagedUploadS3Key,
  getStagedFileType,
  MAX_STAGED_UPLOAD_BYTES,
  requestStagedUpload,
  type ResolvedStagedFile,
  resolveStagedUpload,
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

export type ResolvedWorkbook = ResolvedStagedFile;

export type RequestWorkbookUploadResult = {
  workbookUploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export async function requestStagedWorkbookUpload({
  fileName,
  fileSizeBytes,
  config,
  tenant,
}: {
  fileName: string;
  fileSizeBytes: number;
  config: BucketS3Config;
  tenant: TenantLuids;
}): Promise<RequestWorkbookUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload({
    kind: workbookKind,
    fileName,
    fileSizeBytes,
    config,
    tenant,
  });
  return { workbookUploadId: uploadId, ...rest };
}

export async function resolveStagedWorkbookUpload({
  workbookUploadId,
  config,
  tenant,
  maxBytes,
}: {
  workbookUploadId: string;
  config: BucketS3Config;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedWorkbook> {
  return await resolveStagedUpload({
    kind: workbookKind,
    uploadId: workbookUploadId,
    config,
    tenant,
    maxBytes,
  });
}

export function buildWorkbookUploadS3Key(
  keyPrefix: string,
  tenant: TenantLuids,
  workbookUploadId: string,
  fileType: WorkbookFileType,
): string {
  return buildStagedUploadS3Key(workbookKind, keyPrefix, tenant, workbookUploadId, fileType);
}

export function getWorkbookFileType(fileName: string): WorkbookFileType | undefined {
  return getStagedFileType(workbookKind, fileName);
}
