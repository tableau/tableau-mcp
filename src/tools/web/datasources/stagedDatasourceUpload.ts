import type { TenantLuids } from '../../../blobStorage/tenantKey.js';
import {
  defineUploadConsumer,
  getUploadFileType,
  MAX_STAGED_UPLOAD_BYTES,
  type ResolvedStagedFileStream,
  resolveStagedUploadStream,
} from '../stagedUpload.js';
import { isDatasourcePublishAvailable } from '../uploadAvailability.js';

export const MAX_STAGED_DATASOURCE_BYTES = MAX_STAGED_UPLOAD_BYTES;
export const DATASOURCE_UPLOAD_PREFIX_SEGMENT = 'datasource-uploads';

export type DatasourceFileType = 'tds' | 'tdsx';

const datasourceConsumer = defineUploadConsumer<DatasourceFileType>({
  kind: DATASOURCE_UPLOAD_PREFIX_SEGMENT,
  objectStem: 'datasource',
  noun: 'data source',
  fileTypes: ['tds', 'tdsx'],
  xmlFileType: 'tds',
  isAvailable: isDatasourcePublishAvailable,
});

export type ResolvedDatasource = ResolvedStagedFileStream<DatasourceFileType>;

export async function resolveStagedDatasourceUpload({
  uploadId,
  tenant,
  maxBytes,
}: {
  uploadId: string;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedDatasource> {
  return await resolveStagedUploadStream({
    consumer: datasourceConsumer,
    uploadId,
    tenant,
    maxBytes,
  });
}

export function getDatasourceFileType(fileName: string): DatasourceFileType | undefined {
  return getUploadFileType(datasourceConsumer, fileName);
}
