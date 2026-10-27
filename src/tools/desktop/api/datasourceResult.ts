import { DatasourceItem } from '../../../desktop/externalApi/types.js';

export type ProjectedDatasource = {
  id?: string;
  luid?: string;
  name?: string;
  caption?: string;
  type?: string;
  isExtract?: boolean;
  hasDownloadFilePermission?: boolean;
};

/** Build the credential-safe datasource result exposed by Desktop MCP tools. */
export function projectDatasource(datasource: DatasourceItem): ProjectedDatasource {
  return {
    ...(typeof datasource.id === 'string' ? { id: datasource.id } : {}),
    ...(typeof datasource.luid === 'string' ? { luid: datasource.luid } : {}),
    ...(typeof datasource.name === 'string' ? { name: datasource.name } : {}),
    ...(typeof datasource.caption === 'string' ? { caption: datasource.caption } : {}),
    ...(typeof datasource.type === 'string' ? { type: datasource.type } : {}),
    ...(typeof datasource.isExtract === 'boolean' ? { isExtract: datasource.isExtract } : {}),
    ...(typeof datasource.hasDownloadFilePermission === 'boolean'
      ? { hasDownloadFilePermission: datasource.hasDownloadFilePermission }
      : {}),
  };
}
