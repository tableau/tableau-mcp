import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';

import { BucketS3Config, uploadStreamToS3 } from '../s3Client.js';
import { DownloadedWorkbookFile } from './downloadedWorkbookFile.js';

export type UploadedWorkbookArtifact = Omit<DownloadedWorkbookFile, 'workbookFilePath'> & {
  url: string;
};

export async function uploadWorkbookToS3(
  workbook: DownloadedWorkbookFile,
  {
    workbookId,
    config,
  }: {
    workbookId: string;
    config: BucketS3Config;
  },
): Promise<UploadedWorkbookArtifact> {
  const key = buildWorkbookS3Key(config.keyPrefix, workbookId);
  const contentDisposition = `attachment; filename="${workbook.fileName}"`;
  const url = await uploadStreamToS3(createReadStream(workbook.workbookFilePath), {
    key,
    contentType: 'application/xml',
    contentDisposition,
    contentLength: workbook.sizeBytes,
    bucket: config.bucket,
    region: config.region,
    presignTtlSeconds: config.presignTtlSeconds,
  });

  return {
    url,
    fileName: workbook.fileName,
    fileType: 'twb',
    sourceFileType: workbook.sourceFileType,
    sizeBytes: workbook.sizeBytes,
  };
}

export function buildWorkbookS3Key(
  keyPrefix: string,
  workbookId: string,
  generateUuid: () => string = randomUUID,
): string {
  const normalizedPrefix = keyPrefix.replace(/^\/+/, '').replace(/\/*$/, '/');
  const safeWorkbookId = workbookId.replace(/[^A-Za-z0-9_-]/g, '_') || 'workbook';
  return `${normalizedPrefix}${safeWorkbookId}/${generateUuid()}.twb`;
}
