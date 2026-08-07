import { getActivateSheetTool } from './api/activateSheet.js';
import { getApplyDashboardTool } from './api/applyDashboard.js';
import { getApplyStoryboardTool } from './api/applyStoryboard.js';
import { getApplyWorkbookTool } from './api/applyWorkbook.js';
import { getApplyWorksheetTool } from './api/applyWorksheet.js';
import { getExecuteTableauCommandTool } from './api/executeTableauCommand.js';
import { exportDashboardImageTool } from './api/exportDashboardImage.js';
import { exportWorksheetImageTool } from './api/exportWorksheetImage.js';
import { getApiRootTool } from './api/getApiRoot.js';
import { getAppInfoTool } from './api/getAppInfo.js';
import { getDashboardInfoTool } from './api/getDashboardInfo.js';
import { getGetDashboardXmlTool } from './api/getDashboardXml.js';
import { getHealthTool } from './api/getHealth.js';
import { getSiteInfoTool } from './api/getSiteInfo.js';
import { getStoryboardInfoTool } from './api/getStoryboardInfo.js';
import { getStoryboardXmlTool } from './api/getStoryboardXml.js';
import { getSummaryDataTool } from './api/getSummaryData.js';
import { getWorkbookInventoryTool } from './api/getWorkbookInventory.js';
import { getGetWorkbookXmlTool } from './api/getWorkbookXml.js';
import { getWorksheetInfoTool } from './api/getWorksheetInfo.js';
import { getGetWorksheetXmlTool } from './api/getWorksheetXml.js';
import { getListDashboardsTool } from './api/listDashboards.js';
import { getListInstancesTool } from './api/listInstances.js';
import { getListSiteDatasourcesTool } from './api/listSiteDatasources.js';
import { getListSiteWorkbooksTool } from './api/listSiteWorkbooks.js';
import { getListStoryboardsTool } from './api/listStoryboards.js';
import { getListWorkbookDatasourcesTool } from './api/listWorkbookDatasources.js';
import { getListWorksheetsTool } from './api/listWorksheets.js';
import { getRedoWorkbookTool } from './api/redoWorkbook.js';
import { getUndoWorkbookTool } from './api/undoWorkbook.js';
import { getValidateWorkbookXmlTool } from './api/validateWorkbookXml.js';
import { getBindTemplateTool } from './authoring/binder/bindTemplate.js';
import { getListTemplatesTool } from './authoring/binder/listTemplates.js';
import { getAuthorActionTool } from './authoring/datasource/authorAction.js';
import { getAuthorCalcTool } from './authoring/datasource/authorCalc.js';
import { getAuthorParameterTool } from './authoring/datasource/authorParameter.js';
import { getAuthorSetTool } from './authoring/datasource/authorSet.js';
import { getFormatLabelsTool } from './authoring/datasource/formatLabels.js';
import { getAddFieldTool } from './authoring/fields/addField.js';
import { getListAvailableFieldsTool } from './authoring/fields/listAvailableFields.js';
import { getListFieldsTool } from './authoring/fields/listFields.js';
import { getRemoveFieldTool } from './authoring/fields/removeField.js';
import { getResolveFieldTool } from './authoring/fields/resolveField.js';
import { getApplyDashboardWithViewpointsTool } from './authoring/sheets/applyDashboardWithViewpoints.js';
import { getBatchCreateAndCacheSheetsTool } from './authoring/sheets/batchCreateAndCacheSheets.js';
import { getBuildAndApplyDashboardTool } from './authoring/sheets/buildAndApplyDashboard.js';
import { getBuildAndApplyWorksheetTool } from './authoring/sheets/buildAndApplyWorksheet.js';
import { getComposeDashboardTool } from './authoring/sheets/composeDashboard.js';
import { getDashboardAutoApplyTool } from './authoring/sheets/dashboardAutoApply.js';
import { getDashboardHealthCheckTool } from './authoring/sheets/dashboardHealthCheck.js';
import { getDeleteWorksheetTool } from './authoring/sheets/deleteWorksheet.js';
import { getPlanDashboardCreationTool } from './authoring/sheets/planDashboardCreation.js';
import { getRefineWorksheetTool } from './authoring/sheets/refineWorksheet.js';
import { getBuildWorksheetsFromTemplatesTool } from './authoring/templates/buildWorksheetsFromTemplates.js';
import { getInjectTemplateTool } from './authoring/templates/injectTemplate.js';
import { getAskUserTool } from './local/askUser.js';
import { getReadCachedXmlTool } from './local/cache/readCachedXml.js';
import { getValidateWorksheetXmlTool } from './local/cache/validateWorksheetXml.js';
import { getWriteCachedXmlTool } from './local/cache/writeCachedXml.js';
import { getBeginEpisodeTool, getEndEpisodeTool } from './local/episodeTools.js';
import { getGetDashboardGuideTool } from './local/getDashboardGuide.js';
import { getListKnowledgeResourcesTool } from './local/knowledge/listKnowledgeResources.js';
import { getReadKnowledgeResourceTool } from './local/knowledge/readKnowledgeResource.js';
import { getSearchKnowledgeTool } from './local/knowledge/searchKnowledge.js';
import { getLookupWorkbookSchemaTool } from './local/search/lookupWorkbookSchema.js';
import { getSearchCommandsTool } from './local/search/searchCommands.js';
import { getSearchExamplesTool } from './local/search/searchExamples.js';
import { getSearchWorkbookExamplesTool } from './local/search/searchWorkbookExamples.js';

export const desktopToolFactories = [
  getListInstancesTool,
  getGetWorkbookXmlTool,
  getApplyWorkbookTool,
  getActivateSheetTool,
  getUndoWorkbookTool,
  getRedoWorkbookTool,
  getListWorksheetsTool,
  getListDashboardsTool,
  getGetWorksheetXmlTool,
  getApplyWorksheetTool,
  getDeleteWorksheetTool,
  getRefineWorksheetTool,
  getGetDashboardXmlTool,
  getApplyDashboardTool,
  getApplyDashboardWithViewpointsTool,
  getBuildAndApplyDashboardTool,
  getListAvailableFieldsTool,
  getListFieldsTool,
  getAddFieldTool,
  getRemoveFieldTool,
  getResolveFieldTool,
  getSearchExamplesTool,
  getSearchCommandsTool,
  getLookupWorkbookSchemaTool,
  getSearchWorkbookExamplesTool,
  getExecuteTableauCommandTool,
  getAskUserTool,
  getBindTemplateTool,
  getDashboardAutoApplyTool,
  getComposeDashboardTool,
  getDashboardHealthCheckTool,
  getListTemplatesTool,
  getBuildWorksheetsFromTemplatesTool,
  getPlanDashboardCreationTool,
  getBatchCreateAndCacheSheetsTool,
  getBuildAndApplyWorksheetTool,
  getAuthorCalcTool,
  getAuthorSetTool,
  getAuthorActionTool,
  getFormatLabelsTool,
  getAuthorParameterTool,
  getHealthTool,
  getWorksheetInfoTool,
  getListStoryboardsTool,
  getStoryboardXmlTool,
  getApplyStoryboardTool,
  getApiRootTool,
  getSiteInfoTool,
  getDashboardInfoTool,
  getStoryboardInfoTool,
  getSummaryDataTool,
  exportWorksheetImageTool,
  exportDashboardImageTool,
  getWorkbookInventoryTool,
  getListWorkbookDatasourcesTool,
  getListSiteDatasourcesTool,
  getListSiteWorkbooksTool,
  getAppInfoTool,
  getValidateWorksheetXmlTool,
  getValidateWorkbookXmlTool,
  getReadCachedXmlTool,
  getWriteCachedXmlTool,
  getInjectTemplateTool,
  getGetDashboardGuideTool,
  getListKnowledgeResourcesTool,
  getReadKnowledgeResourceTool,
  getSearchKnowledgeTool,
];

export const episodeToolFactories = [getBeginEpisodeTool, getEndEpisodeTool];
