import type { Result } from 'ts-results-es';

import type { McpToolError } from '../../errors/mcpToolError.js';
import { writeCacheFileArg, writeCacheTextFile } from '../cachePath.js';
import { redactDatasourceCredentials } from './datasourceCredentialRedaction.js';

/** Every cache write of workbook, datasource or sheet XML goes through these two, so no writer can leak credentials. */
export function writeRedactedXmlCacheFile(path: string, xml: string): void {
  writeCacheTextFile(path, redactDatasourceCredentials(xml));
}

export function writeRedactedXmlCacheFileArg(
  argName: string,
  raw: string,
  xml: string,
): Result<string, McpToolError> {
  return writeCacheFileArg(argName, raw, redactDatasourceCredentials(xml));
}
