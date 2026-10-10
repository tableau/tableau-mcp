import { BucketS3Config } from '../s3Client.js';
import {
  buildStagedUploadS3Key,
  getStagedUploadFileType,
  MAX_STAGED_UPLOAD_BYTES,
  requestStagedUpload,
  resolveStagedUpload,
  StagedUploadKind,
} from '../stagedUpload.js';

export const MAX_STAGED_WORKBOOK_BYTES = MAX_STAGED_UPLOAD_BYTES;
export const WORKBOOK_UPLOAD_PREFIX_SEGMENT = 'workbook-uploads';

export type WorkbookFileType = 'twb' | 'twbx';

const WORKBOOK_UPLOAD_KIND: StagedUploadKind<WorkbookFileType> = {
  label: 'Workbook',
  prefixSegment: WORKBOOK_UPLOAD_PREFIX_SEGMENT,
  objectBaseName: 'workbook',
  fileTypes: ['twb', 'twbx'],
  contentTypeFor: (fileType) =>
    fileType === 'twb' ? 'application/xml' : 'application/octet-stream',
};

export type ResolvedWorkbook = {
  fileName: string;
  bytes: Buffer;
};

export type RequestWorkbookUploadResult = {
  workbookUploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export async function requestStagedWorkbookUpload({
  fileName,
  config,
}: {
  fileName: string;
  config: BucketS3Config;
}): Promise<RequestWorkbookUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload(WORKBOOK_UPLOAD_KIND, {
    fileName,
    config,
  });
  return { workbookUploadId: uploadId, ...rest };
}

export async function resolveStagedWorkbookUpload({
  workbookUploadId,
  config,
  maxBytes,
}: {
  workbookUploadId: string;
  config: BucketS3Config;
  maxBytes?: number;
}): Promise<ResolvedWorkbook> {
  const { fileName, bytes } = await resolveStagedUpload(WORKBOOK_UPLOAD_KIND, {
    uploadId: workbookUploadId,
    config,
    maxBytes,
  });
  return { fileName, bytes };
}

export function buildWorkbookUploadS3Key(
  keyPrefix: string,
  workbookUploadId: string,
  fileType: WorkbookFileType,
): string {
  return buildStagedUploadS3Key(WORKBOOK_UPLOAD_KIND, keyPrefix, workbookUploadId, fileType);
}

export function getWorkbookFileType(fileName: string): WorkbookFileType | undefined {
  return getStagedUploadFileType(WORKBOOK_UPLOAD_KIND, fileName);
}
