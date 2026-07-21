import { getBindTemplateTool } from './binder/bindTemplate.js';
import { getListTemplatesTool } from './binder/listTemplates.js';
import { getProposeTemplateTool } from './binder/proposeTemplate.js';
import { getValidateProposalTool } from './binder/validateProposal.js';
import { getReadCachedXmlTool } from './cache/readCachedXml.js';
import { getValidateWorkbookXmlTool } from './cache/validateWorkbookXml.js';
import { getValidateWorksheetXmlTool } from './cache/validateWorksheetXml.js';
import { getWriteCachedXmlTool } from './cache/writeCachedXml.js';
import { getExecuteTableauCommandTool } from './commands/executeTableauCommand.js';
import { getBatchCreateAndCacheSheetsTool } from './coordination/batchCreateAndCacheSheets.js';
import { getBuildAndApplyWorksheetTool } from './coordination/buildAndApplyWorksheet.js';
import { getListXmlTemplatesTool } from './coordination/listXmlTemplates.js';
import { getPlanDashboardCreationTool } from './coordination/planDashboardCreation.js';
import { getApplyDashboardTool } from './dashboard/applyDashboard.js';
import { getApplyDashboardWithViewpointsTool } from './dashboard/applyDashboardWithViewpoints.js';
import { getBuildAndApplyDashboardTool } from './dashboard/buildAndApplyDashboard.js';
import { getDashboardAutoApplyTool } from './dashboard/dashboardAutoApply.js';
import { getGetDashboardGuideTool } from './dashboard/getDashboardGuide.js';
import { getGetDashboardXmlTool } from './dashboard/getDashboardXml.js';
import { getAuthorActionTool } from './data-source/authorAction.js';
import { getAuthorCalcTool } from './data-source/authorCalc.js';
import { getAuthorParameterTool } from './data-source/authorParameter.js';
import { getAuthorSetTool } from './data-source/authorSet.js';
import { getFormatLabelsTool } from './data-source/formatLabels.js';
import { getAddFieldTool } from './fields/addField.js';
import { getListAvailableFieldsTool } from './fields/listAvailableFields.js';
import { getListFieldsTool } from './fields/listFields.js';
import { getRemoveFieldTool } from './fields/removeField.js';
import { getResolveFieldTool } from './fields/resolveField.js';
import { getDashboardHealthCheckTool } from './health/dashboardHealthCheck.js';
import { getAskUserTool } from './interaction/askUser.js';
import { getBeginEpisodeTool, getEndEpisodeTool } from './interaction/episodeTools.js';
import { getListKnowledgeResourcesTool } from './knowledge/listKnowledgeResources.js';
import { getReadKnowledgeResourceTool } from './knowledge/readKnowledgeResource.js';
import { getSearchKnowledgeTool } from './knowledge/searchKnowledge.js';
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
import { getDeleteWorksheetTool } from './worksheet/deleteWorksheet.js';
import { getGetWorksheetXmlTool } from './worksheet/getWorksheetXml.js';
import { getRefineWorksheetTool } from './worksheet/refineWorksheet.js';

export const desktopToolFactories = [
  getListInstancesTool,
  getCheckForUserChangesTool,
  getGetWorkbookXmlTool,
  getApplyWorkbookTool,
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
  getDashboardHealthCheckTool,
  getListTemplatesTool,
  getProposeTemplateTool,
  getValidateProposalTool,
  getPlanDashboardCreationTool,
  getBatchCreateAndCacheSheetsTool,
  getBuildAndApplyWorksheetTool,
  getListXmlTemplatesTool,
  getAuthorCalcTool,
  getAuthorSetTool,
  getAuthorActionTool,
  getFormatLabelsTool,
  getAuthorParameterTool,
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
