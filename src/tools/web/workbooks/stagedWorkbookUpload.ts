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
  config,
}: {
  fileName: string;
  config: BucketS3Config;
}): Promise<RequestWorkbookUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload({ kind: workbookKind, fileName, config });
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
  return await resolveStagedUpload({
    kind: workbookKind,
    uploadId: workbookUploadId,
    config,
    maxBytes,
  });
}

export function buildWorkbookUploadS3Key(
  keyPrefix: string,
  workbookUploadId: string,
  fileType: WorkbookFileType,
): string {
  return buildStagedUploadS3Key(workbookKind, keyPrefix, workbookUploadId, fileType);
}

export function getWorkbookFileType(fileName: string): WorkbookFileType | undefined {
  return getStagedFileType(workbookKind, fileName);
}

export type RequestClientWorkbookUploadResult = {
  workbookUploadId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  maxChunkBytes: number;
};

// Tableau upload session ids carry no file type, so it rides along in the id the client returns.
export function buildClientWorkbookUploadId(
  fileType: WorkbookFileType,
  uploadSessionId: string,
): string {
  return `${fileType}:${uploadSessionId}`;
}

export function parseClientWorkbookUploadId(
  workbookUploadId: string,
): { fileType: WorkbookFileType; uploadSessionId: string } | undefined {
  const match = /^(twbx?):(.+)$/.exec(workbookUploadId);
  return match ? { fileType: match[1] as WorkbookFileType, uploadSessionId: match[2] } : undefined;
}
