import type { TenantLuids } from '../../../blobStorage/tenantKey.js';
import {
  buildStagedUploadKey,
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
  expiresAt?: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export async function requestStagedDatasourceUpload({
  fileName,
  tenant,
}: {
  fileName: string;
  tenant: TenantLuids;
}): Promise<RequestDatasourceUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload({
    kind: datasourceKind,
    fileName,
    tenant,
  });
  return { datasourceUploadId: uploadId, ...rest };
}

export async function resolveStagedDatasourceUpload({
  datasourceUploadId,
  tenant,
  maxBytes,
}: {
  datasourceUploadId: string;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedDatasource> {
  return await resolveStagedUpload({
    kind: datasourceKind,
    uploadId: datasourceUploadId,
    tenant,
    maxBytes,
  });
}

export function buildDatasourceUploadKey(
  tenant: TenantLuids,
  datasourceUploadId: string,
  fileType: DatasourceFileType,
): string {
  return buildStagedUploadKey(datasourceKind, tenant, datasourceUploadId, fileType);
}

export function getDatasourceFileType(fileName: string): DatasourceFileType | undefined {
  return getStagedFileType(datasourceKind, fileName);
}
