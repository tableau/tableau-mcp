import { apiVersionAtLeast, type ApiVersionFloor } from '../externalApi/apiVersion.js';

const INTERNAL_NAME_QUALIFIER_MIN_API_VERSION: ApiVersionFloor = '0.2.25';

export type ColumnFilterDatasource = { caption: string; internalName: string };

export function qualifyDatasourceColumn(
  apiVersion: string | undefined,
  datasource: ColumnFilterDatasource,
  column: string,
): string {
  const qualifier = apiVersionAtLeast(apiVersion, INTERNAL_NAME_QUALIFIER_MIN_API_VERSION)
    ? datasource.internalName
    : datasource.caption;
  return `[${qualifier}].[${stripBrackets(column)}]`;
}

function stripBrackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}
