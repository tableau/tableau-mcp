import { listDatasourcesTool } from './listDatasources.js';
import { listFieldsTool } from './listFields.js';
import { queryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { readMetadataTool } from './readMetadata.js';

export const tools = [listDatasourcesTool, listFieldsTool, queryDatasourceTool, readMetadataTool];
