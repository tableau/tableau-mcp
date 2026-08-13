import { randomUUID } from 'crypto';
import { extname } from 'path';

import {
  BucketS3Config,
  createPresignedPutUrlToS3,
  downloadObjectFromS3,
  joinS3Prefix,
} from '../s3Client.js';

export const MAX_STAGED_WORKBOOK_BYTES = 100 * 1024 * 1024;
export const WORKBOOK_UPLOAD_CONTENT_TYPE = 'application/xml';
export const WORKBOOK_UPLOAD_PREFIX_SEGMENT = 'workbook-uploads';

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

type WorkbookUploadOptions = {
  fileName: string;
  contentType?: string;
  sizeBytes?: number;
  config: BucketS3Config;
  generateUuid?: () => string;
  now?: () => Date;
  maxBytes?: number;
};

type ResolveWorkbookUploadOptions = {
  workbookUploadId: string;
  config: BucketS3Config;
  maxBytes?: number;
};

export async function requestStagedWorkbookUpload({
  fileName,
  contentType = WORKBOOK_UPLOAD_CONTENT_TYPE,
  sizeBytes,
  config,
  generateUuid = randomUUID,
  now = () => new Date(),
  maxBytes = MAX_STAGED_WORKBOOK_BYTES,
}: WorkbookUploadOptions): Promise<RequestWorkbookUploadResult> {
  assertWorkbookUploadFileName(fileName);
  if (sizeBytes !== undefined && (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)) {
    throw new Error('Workbook upload sizeBytes must be a positive integer when provided.');
  }
  if (sizeBytes !== undefined && sizeBytes > maxBytes) {
    throw new Error(`Workbook upload exceeds the ${maxBytes}-byte limit.`);
  }

  const workbookUploadId = generateUuid();
  assertWorkbookUploadId(workbookUploadId);
  const uploadUrl = await createPresignedPutUrlToS3({
    key: buildWorkbookUploadS3Key(config.keyPrefix, workbookUploadId),
    contentType,
    bucket: config.bucket,
    region: config.region,
    presignTtlSeconds: config.presignTtlSeconds,
  });

  return {
    workbookUploadId,
    uploadUrl,
    expiresAt: new Date(now().getTime() + config.presignTtlSeconds * 1000).toISOString(),
    maxSizeBytes: maxBytes,
    requiredHeaders: { 'Content-Type': contentType },
  };
}

export async function resolveStagedWorkbookUpload({
  workbookUploadId,
  config,
  maxBytes = MAX_STAGED_WORKBOOK_BYTES,
}: ResolveWorkbookUploadOptions): Promise<ResolvedWorkbook> {
  assertWorkbookUploadId(workbookUploadId);
  const bytes = await downloadObjectFromS3({
    key: buildWorkbookUploadS3Key(config.keyPrefix, workbookUploadId),
    bucket: config.bucket,
    region: config.region,
    maxBytes,
  });

  if (bytes.byteLength === 0) {
    throw new Error('Workbook upload bytes must not be empty.');
  }

  return {
    fileName: `${workbookUploadId}.twb`,
    bytes,
  };
}

export function buildWorkbookUploadS3Key(keyPrefix: string, workbookUploadId: string): string {
  assertWorkbookUploadId(workbookUploadId);
  return `${joinS3Prefix(keyPrefix, WORKBOOK_UPLOAD_PREFIX_SEGMENT)}${workbookUploadId}/workbook.twb`;
}

function assertWorkbookUploadFileName(fileName: string): void {
  if (extname(fileName).toLowerCase() !== '.twb') {
    throw new Error('Workbook upload filename must end in .twb.');
  }
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
