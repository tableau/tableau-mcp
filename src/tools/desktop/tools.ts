import { getActivateSheetTool } from './api/activateSheet.js';
import { getAddDashboardTool } from './api/addDashboard.js';
import { getAddStoryboardTool } from './api/addStoryboard.js';
import { getAddWorksheetTool } from './api/addWorksheet.js';
import { getApplyDashboardTool } from './api/applyDashboard.js';
import { getApplyStoryboardTool } from './api/applyStoryboard.js';
import { getApplyWorkbookTool } from './api/applyWorkbook.js';
import { getApplyWorksheetTool } from './api/applyWorksheet.js';
import { getDeleteSheetTool } from './api/deleteSheet.js';
import { getExecuteTableauCommandTool } from './api/executeTableauCommand.js';
import { exportDashboardImageTool } from './api/exportDashboardImage.js';
import { exportStoryboardImageTool } from './api/exportStoryboardImage.js';
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
import { getWorksheetUnderlyingDataTool } from './api/getWorksheetUnderlyingData.js';
import { getGetWorksheetXmlTool } from './api/getWorksheetXml.js';
import { getListDashboardsTool } from './api/listDashboards.js';
import { getListInstancesTool } from './api/listInstances.js';
import { getListSiteDatasourcesTool } from './api/listSiteDatasources.js';
import { getListSiteWorkbooksTool } from './api/listSiteWorkbooks.js';
import { getListStoryboardsTool } from './api/listStoryboards.js';
import { getListWorkbookDatasourcesTool } from './api/listWorkbookDatasources.js';
import { getListWorksheetLogicalTablesTool } from './api/listWorksheetLogicalTables.js';
import { getListWorksheetsTool } from './api/listWorksheets.js';
import { getOpenFileTool } from './api/openFile.js';
import { getPauseAutoUpdatesTool } from './api/pauseAutoUpdates.js';
import { getPublishWorkbookTool } from './api/publishWorkbook.js';
import { getRedoWorkbookTool } from './api/redoWorkbook.js';
import { getRefreshDatasourceDataTool } from './api/refreshDatasourceData.js';
import { getRefreshDatasourceExtractTool } from './api/refreshDatasourceExtract.js';
import { getRenameSheetTool } from './api/renameSheet.js';
import { getResumeAutoUpdatesTool } from './api/resumeAutoUpdates.js';
import { getSaveWorkbookTool } from './api/saveWorkbook.js';
import { getSortWorksheetTool } from './api/sortWorksheet.js';
import { getUndoWorkbookTool } from './api/undoWorkbook.js';
import { getValidateWorkbookXmlTool } from './api/validateWorkbookXml.js';
import { getWorkbookExportAsTool } from './api/workbookExportAs.js';
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
import { getSearchWorkbookFieldsTool } from './authoring/fields/searchWorkbookFields.js';
import { getApplyDashboardWithViewpointsTool } from './authoring/sheets/applyDashboardWithViewpoints.js';
import { getBatchCreateAndCacheSheetsTool } from './authoring/sheets/batchCreateAndCacheSheets.js';
import { getBuildAndApplyDashboardTool } from './authoring/sheets/buildAndApplyDashboard.js';
import { getBuildAndApplyWorksheetTool } from './authoring/sheets/buildAndApplyWorksheet.js';
import { getComposeDashboardTool } from './authoring/sheets/composeDashboard.js';
import { getDashboardHealthCheckTool } from './authoring/sheets/dashboardHealthCheck.js';
import { getPlanDashboardCreationTool } from './authoring/sheets/planDashboardCreation.js';
import { getRefineWorksheetTool } from './authoring/sheets/refineWorksheet.js';
import { getRunDashboardBatchTool } from './authoring/sheets/runDashboardBatch.js';
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
  getOpenFileTool,
  getSaveWorkbookTool,
  getWorkbookExportAsTool,
  getAddWorksheetTool,
  getAddDashboardTool,
  getAddStoryboardTool,
  getPublishWorkbookTool,
  getRefreshDatasourceDataTool,
  getRefreshDatasourceExtractTool,
  getListWorksheetsTool,
  getListDashboardsTool,
  getGetWorksheetXmlTool,
  getApplyWorksheetTool,
  getDeleteSheetTool,
  getRenameSheetTool,
  getSortWorksheetTool,
  getPauseAutoUpdatesTool,
  getResumeAutoUpdatesTool,
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
  getSearchWorkbookFieldsTool,
  getSearchExamplesTool,
  getSearchCommandsTool,
  getLookupWorkbookSchemaTool,
  getSearchWorkbookExamplesTool,
  getExecuteTableauCommandTool,
  getAskUserTool,
  getBindTemplateTool,
  getRunDashboardBatchTool,
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
  getListWorksheetLogicalTablesTool,
  getWorksheetUnderlyingDataTool,
  exportWorksheetImageTool,
  exportDashboardImageTool,
  exportStoryboardImageTool,
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
