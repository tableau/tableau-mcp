import { getListDatasourcesTool } from './listDatasources/listDatasources.js';
import { getListFieldsTool } from './listFields.js';
import { getQueryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { getReadMetadataTool } from './readMetadata.js';

export const toolFactories = [
  getListDatasourcesTool,
  getListFieldsTool,
  getQueryDatasourceTool,
  getReadMetadataTool,
];
