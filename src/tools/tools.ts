import { getListDatasourcesTool } from './listDatasources/listDatasources.js';
import { getListFieldsTool } from './listFields.js';
import { getListDefinitionsTool } from './pulse/listDefinitions.js';
import { getListMetricsInDefinitionsTool } from './pulse/listMetricsInDefinitions.js';
import { getQueryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { getReadMetadataTool } from './readMetadata.js';
import { getGetWorkbookTool } from './workbook/getWorkbook.js';
import { getQueryViewDataTool } from './workbook/queryViewData.js';
import { getQueryViewImageTool } from './workbook/queryViewImage.js';
import { getQueryWorkbooksTool } from './workbook/queryWorkbooks.js';

export const toolFactories = [
  getListDatasourcesTool,
  getListDefinitionsTool,
  getListMetricsInDefinitionsTool,
  getListFieldsTool,
  getGetWorkbookTool,
  getQueryDatasourceTool,
  getQueryViewDataTool,
  getQueryViewImageTool,
  getQueryWorkbooksTool,
  getReadMetadataTool,
];
