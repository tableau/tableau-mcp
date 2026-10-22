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

export const MAX_STAGED_DATASOURCE_BYTES = MAX_STAGED_UPLOAD_BYTES;
export const DATASOURCE_UPLOAD_PREFIX_SEGMENT = 'datasource-uploads';

export type DatasourceFileType = 'tds' | 'tdsx';

const datasourceKind: StagedUploadKind<DatasourceFileType> = {
  prefixSegment: DATASOURCE_UPLOAD_PREFIX_SEGMENT,
  objectStem: 'datasource',
  label: 'Data source',
  noun: 'data source',
  fileTypes: ['tds', 'tdsx'],
  xmlFileType: 'tds',
};

export type ResolvedDatasource = ResolvedStagedFile;

export type RequestDatasourceUploadResult = {
  datasourceUploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export async function requestStagedDatasourceUpload({
  fileName,
  config,
}: {
  fileName: string;
  config: BucketS3Config;
}): Promise<RequestDatasourceUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload({
    kind: datasourceKind,
    fileName,
    config,
  });
  return { datasourceUploadId: uploadId, ...rest };
}

export async function resolveStagedDatasourceUpload({
  datasourceUploadId,
  config,
  maxBytes,
}: {
  datasourceUploadId: string;
  config: BucketS3Config;
  maxBytes?: number;
}): Promise<ResolvedDatasource> {
  return await resolveStagedUpload({
    kind: datasourceKind,
    uploadId: datasourceUploadId,
    config,
    maxBytes,
  });
}

export function buildDatasourceUploadS3Key(
  keyPrefix: string,
  datasourceUploadId: string,
  fileType: DatasourceFileType,
): string {
  return buildStagedUploadS3Key(datasourceKind, keyPrefix, datasourceUploadId, fileType);
}

export function getDatasourceFileType(fileName: string): DatasourceFileType | undefined {
  return getStagedFileType(datasourceKind, fileName);
}
