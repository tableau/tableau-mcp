import { BucketS3Config } from '../s3Client.js';
import {
  getStagedUploadFileType,
  requestStagedUpload,
  StagedUploadKind,
  StreamedStagedUpload,
  streamStagedUpload,
} from '../stagedUpload.js';

export type DatasourceFileType = 'tdsx' | 'hyper';

export const DATASOURCE_UPLOAD_KIND: StagedUploadKind<DatasourceFileType> = {
  label: 'Data source',
  prefixSegment: 'datasource-uploads',
  objectBaseName: 'datasource',
  fileTypes: ['tdsx', 'hyper'],
  contentTypeFor: () => 'application/octet-stream',
};

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
  const { uploadId, ...rest } = await requestStagedUpload(DATASOURCE_UPLOAD_KIND, {
    fileName,
    config,
  });
  return { datasourceUploadId: uploadId, ...rest };
}

export async function streamStagedDatasourceUpload({
  datasourceUploadId,
  config,
}: {
  datasourceUploadId: string;
  config: BucketS3Config;
}): Promise<StreamedStagedUpload<DatasourceFileType>> {
  return await streamStagedUpload(DATASOURCE_UPLOAD_KIND, {
    uploadId: datasourceUploadId,
    config,
  });
}

export function getDatasourceFileType(fileName: string): DatasourceFileType | undefined {
  return getStagedUploadFileType(DATASOURCE_UPLOAD_KIND, fileName);
}
