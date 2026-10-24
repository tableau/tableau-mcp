import {
  buildStagedUploadKey,
  getStagedFileType,
  MAX_STAGED_UPLOAD_BYTES,
  requestStagedUpload,
  type ResolvedStagedFileStream,
  resolveStagedUploadStream,
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

export type ResolvedDatasource = ResolvedStagedFileStream<DatasourceFileType>;

export type RequestDatasourceUploadResult = {
  datasourceUploadId: string;
  uploadUrl: string;
  expiresAt?: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export async function requestStagedDatasourceUpload({
  fileName,
}: {
  fileName: string;
}): Promise<RequestDatasourceUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload({
    kind: datasourceKind,
    fileName,
  });
  return { datasourceUploadId: uploadId, ...rest };
}

export async function resolveStagedDatasourceUpload({
  datasourceUploadId,
  maxBytes,
}: {
  datasourceUploadId: string;
  maxBytes?: number;
}): Promise<ResolvedDatasource> {
  return await resolveStagedUploadStream({
    kind: datasourceKind,
    uploadId: datasourceUploadId,
    maxBytes,
  });
}

export function buildDatasourceUploadKey(
  datasourceUploadId: string,
  fileType: DatasourceFileType,
): string {
  return buildStagedUploadKey(datasourceKind, datasourceUploadId, fileType);
}

export function getDatasourceFileType(fileName: string): DatasourceFileType | undefined {
  return getStagedFileType(datasourceKind, fileName);
}
