import { randomUUID } from 'crypto';
import { extname } from 'path';

import {
  BucketS3Config,
  createPresignedPutUrlToS3,
  downloadObjectFromS3IfExists,
  joinS3Prefix,
} from '../s3Client.js';

// Intentionally decimal GB (not GiB) to leave headroom under S3's 5GB single-PUT ceiling.
export const MAX_STAGED_DATASOURCE_BYTES = 5 * 1000 * 1000 * 1000;
export const DATASOURCE_UPLOAD_PREFIX_SEGMENT = 'datasource-uploads';

export type DatasourceFileType = 'tds' | 'tdsx';
const DATASOURCE_FILE_TYPES: ReadonlyArray<DatasourceFileType> = ['tds', 'tdsx'];

export type ResolvedDatasource = {
  fileName: string;
  bytes: Buffer;
};

export type RequestDatasourceUploadResult = {
  datasourceUploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

type DatasourceUploadOptions = {
  fileName: string;
  config: BucketS3Config;
};

type ResolveDatasourceUploadOptions = {
  datasourceUploadId: string;
  config: BucketS3Config;
  maxBytes?: number;
};

export async function requestStagedDatasourceUpload({
  fileName,
  config,
}: DatasourceUploadOptions): Promise<RequestDatasourceUploadResult> {
  const fileType = assertDatasourceUploadFileName(fileName);

  const datasourceUploadId = randomUUID();
  const contentType = getDatasourceUploadContentType(fileType);
  const uploadUrl = await createPresignedPutUrlToS3({
    key: buildDatasourceUploadS3Key(config.keyPrefix, datasourceUploadId, fileType),
    contentType,
    bucket: config.bucket,
    region: config.region,
    presignTtlSeconds: config.presignTtlSeconds,
  });

  return {
    datasourceUploadId,
    uploadUrl,
    expiresAt: new Date(Date.now() + config.presignTtlSeconds * 1000).toISOString(),
    maxSizeBytes: MAX_STAGED_DATASOURCE_BYTES,
    requiredHeaders: { 'Content-Type': contentType },
  };
}

export async function resolveStagedDatasourceUpload({
  datasourceUploadId,
  config,
  maxBytes = MAX_STAGED_DATASOURCE_BYTES,
}: ResolveDatasourceUploadOptions): Promise<ResolvedDatasource> {
  assertDatasourceUploadId(datasourceUploadId);

  for (const fileType of DATASOURCE_FILE_TYPES) {
    const bytes = await downloadObjectFromS3IfExists({
      key: buildDatasourceUploadS3Key(config.keyPrefix, datasourceUploadId, fileType),
      bucket: config.bucket,
      region: config.region,
      maxBytes,
    });

    if (bytes === undefined) {
      continue;
    }

    if (bytes.byteLength === 0) {
      throw new Error('Data source upload bytes must not be empty.');
    }

    return {
      fileName: `${datasourceUploadId}.${fileType}`,
      bytes,
    };
  }

  throw new Error('Data source upload not found. Upload the data source bytes before publishing.');
}

export function buildDatasourceUploadS3Key(
  keyPrefix: string,
  datasourceUploadId: string,
  fileType: DatasourceFileType,
): string {
  assertDatasourceUploadId(datasourceUploadId);
  return `${joinS3Prefix(keyPrefix, DATASOURCE_UPLOAD_PREFIX_SEGMENT)}${datasourceUploadId}/datasource.${fileType}`;
}

function assertDatasourceUploadFileName(fileName: string): DatasourceFileType {
  const fileType = getDatasourceFileType(fileName);
  if (!fileType) {
    throw new Error('Data source upload filename must end in .tds or .tdsx.');
  }
  return fileType;
}

export function getDatasourceFileType(fileName: string): DatasourceFileType | undefined {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.tds') {
    return 'tds';
  }
  if (extension === '.tdsx') {
    return 'tdsx';
  }
  return undefined;
}

function getDatasourceUploadContentType(fileType: DatasourceFileType): string {
  return fileType === 'tds' ? 'application/xml' : 'application/octet-stream';
}

function assertDatasourceUploadId(datasourceUploadId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      datasourceUploadId,
    )
  ) {
    throw new Error('Data source upload id is invalid.');
  }
}
