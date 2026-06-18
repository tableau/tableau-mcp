import { getReadCachedXmlTool } from './cache/readCachedXml.js';
import { getValidateWorkbookXmlTool } from './cache/validateWorkbookXml.js';
import { getValidateWorksheetXmlTool } from './cache/validateWorksheetXml.js';
import { getWriteCachedXmlTool } from './cache/writeCachedXml.js';
import { getExecuteTableauCommandTool } from './commands/executeTableauCommand.js';
import { getBatchCreateAndCacheSheetsTool } from './coordination/batchCreateAndCacheSheets.js';
import { getBuildAndApplyWorksheetTool } from './coordination/buildAndApplyWorksheet.js';
import { getListTemplatesTool } from './coordination/listTemplates.js';
import { getPlanDashboardCreationTool } from './coordination/planDashboardCreation.js';
import { getApplyDashboardTool } from './dashboard/applyDashboard.js';
import { getApplyDashboardWithViewpointsTool } from './dashboard/applyDashboardWithViewpoints.js';
import { getBuildAndApplyDashboardTool } from './dashboard/buildAndApplyDashboard.js';
import { getGetDashboardXmlTool } from './dashboard/getDashboardXml.js';
import { getAddFieldToColsTool } from './fields/addFieldToCols.js';
import { getAddFieldToEncodingTool } from './fields/addFieldToEncoding.js';
import { getAddFieldToRowsTool } from './fields/addFieldToRows.js';
import { getListAvailableFieldsTool } from './fields/listAvailableFields.js';
import { getListFieldsTool } from './fields/listFields.js';
import { getRemoveFieldFromColsTool } from './fields/removeFieldFromCols.js';
import { getRemoveFieldFromEncodingTool } from './fields/removeFieldFromEncoding.js';
import { getRemoveFieldFromRowsTool } from './fields/removeFieldFromRows.js';
import { getResolveFieldTool } from './fields/resolveField.js';
import { getLookupWorkbookSchemaTool } from './search/lookupWorkbookSchema.js';
import { getSearchCommandsTool } from './search/searchCommands.js';
import { getSearchExamplesTool } from './search/searchExamples.js';
import { getSearchWorkbookExamplesTool } from './search/searchWorkbookExamples.js';
import { getCheckForUserChangesTool } from './session/checkForUserChanges.js';
import { getListInstancesTool } from './session/listInstances.js';
import { getInjectTemplateTool } from './template/injectTemplate.js';
import { getApplyWorkbookTool } from './workbook/applyWorkbook.js';
import { getGetWorkbookXmlTool } from './workbook/getWorkbookXml.js';
import { getListDashboardsTool } from './workbook/listDashboards.js';
import { getListWorksheetsTool } from './workbook/listWorksheets.js';
import { getApplyWorksheetTool } from './worksheet/applyWorksheet.js';
import { getGetWorksheetXmlTool } from './worksheet/getWorksheetXml.js';

export const desktopToolFactories = [
  getListInstancesTool,
  getCheckForUserChangesTool,
  getGetWorkbookXmlTool,
  getApplyWorkbookTool,
  getListWorksheetsTool,
  getListDashboardsTool,
  getGetWorksheetXmlTool,
  getApplyWorksheetTool,
  getGetDashboardXmlTool,
  getApplyDashboardTool,
  getApplyDashboardWithViewpointsTool,
  getBuildAndApplyDashboardTool,
  getListAvailableFieldsTool,
  getListFieldsTool,
  getAddFieldToEncodingTool,
  getAddFieldToRowsTool,
  getAddFieldToColsTool,
  getRemoveFieldFromEncodingTool,
  getRemoveFieldFromRowsTool,
  getRemoveFieldFromColsTool,
  getResolveFieldTool,
  getSearchExamplesTool,
  getSearchCommandsTool,
  getLookupWorkbookSchemaTool,
  getSearchWorkbookExamplesTool,
  getExecuteTableauCommandTool,
  getPlanDashboardCreationTool,
  getBatchCreateAndCacheSheetsTool,
  getBuildAndApplyWorksheetTool,
  getListTemplatesTool,
  getValidateWorksheetXmlTool,
  getValidateWorkbookXmlTool,
  getReadCachedXmlTool,
  getWriteCachedXmlTool,
  getInjectTemplateTool,
];
