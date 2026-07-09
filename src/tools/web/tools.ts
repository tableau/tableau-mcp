import { getGetStaleContentReportTool } from './adminInsights/getStaleContentReport.js';
import { getQueryAdminInsightsJobPerformanceTool } from './adminInsights/queryJobPerformance.js';
import { getQueryAdminInsightsSiteContentTool } from './adminInsights/querySiteContent.js';
import { getQueryAdminInsightsTsEventsTool } from './adminInsights/queryTsEvents.js';
import { getSearchContentTool } from './contentExploration/searchContent.js';
import { getConfirmDeleteDatasourceTool } from './datasources/confirmDeleteDatasource.js';
import { getDeleteDatasourceTool } from './datasources/deleteDatasource.js';
import { getListDatasourcesTool } from './datasources/listDatasources.js';
import { getResolveDatasourceLuidTool } from './datasources/resolveDatasourceLuid.js';
import { getConfirmDeleteExtractRefreshTaskTool } from './extractRefreshTasks/confirmDeleteExtractRefreshTask.js';
import { getConfirmUpdateCloudExtractRefreshTaskTool } from './extractRefreshTasks/confirmUpdateCloudExtractRefreshTask.js';
import { getDeleteExtractRefreshTaskTool } from './extractRefreshTasks/deleteExtractRefreshTask.js';
import { getListExtractRefreshTasksTool } from './extractRefreshTasks/listExtractRefreshTasks.js';
import { getUpdateCloudExtractRefreshTaskTool } from './extractRefreshTasks/updateCloudExtractRefreshTask.js';
import { getGetDatasourceMetadataTool } from './getDatasourceMetadata/getDatasourceMetadata.js';
import { getEmbedTokenTool } from './getEmbedToken/getEmbedToken.js';
import { getListJobsTool } from './jobs/listJobs.js';
import { getListProjectsTool } from './projects/listProjects.js';
import { getGenerateChironInsightFromDatasourceContextTool } from './pulse/chiron/generateChironInsightFromDatasourceContextTool.js';
import { getGeneratePulseInsightBriefTool } from './pulse/generateInsightBrief/generatePulseInsightBriefTool.js';
import { getGeneratePulseMetricValueInsightBundleTool } from './pulse/generateMetricValueInsightBundle/generatePulseMetricValueInsightBundleTool.js';
import { getListAllPulseMetricDefinitionsTool } from './pulse/listAllMetricDefinitions/listAllPulseMetricDefinitions.js';
import { getListPulseMetricDefinitionsFromDefinitionIdsTool } from './pulse/listMetricDefinitionsFromDefinitionIds/listPulseMetricDefinitionsFromDefinitionIds.js';
import { getListPulseMetricsFromMetricDefinitionIdTool } from './pulse/listMetricsFromMetricDefinitionId/listPulseMetricsFromMetricDefinitionId.js';
import { getListPulseMetricsFromMetricIdsTool } from './pulse/listMetricsFromMetricIds/listPulseMetricsFromMetricIds.js';
import { getListPulseMetricSubscriptionsTool } from './pulse/listMetricSubscriptions/listPulseMetricSubscriptions.js';
import { getQueryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { getResetConsentTool } from './resetConsent/resetConsent.js';
import { getRevokeAccessTokenTool } from './revokeAccessToken/revokeAccessToken.js';
import { getListUsersTool } from './users/listUsers.js';
import { getGetCustomViewDataTool } from './views/getCustomViewData.js';
import { getGetCustomViewImageTool } from './views/getCustomViewImage.js';
import { getGetViewTool } from './views/getView.js';
import { getGetViewDataTool } from './views/getViewData.js';
import { getGetViewImageTool } from './views/getViewImage.js';
import { getListCustomViewsTool } from './views/listCustomViews.js';
import { getListViewsTool } from './views/listViews.js';
import { getConfirmDeleteWorkbookTool } from './workbooks/confirmDeleteWorkbook.js';
import { getDeleteWorkbookTool } from './workbooks/deleteWorkbook.js';
import { getGetWorkbookTool } from './workbooks/getWorkbook.js';
import { getListWorkbooksTool } from './workbooks/listWorkbooks.js';

export const webToolFactories = [
  getGetDatasourceMetadataTool,
  getEmbedTokenTool,
  getListDatasourcesTool,
  getResolveDatasourceLuidTool,
  getDeleteDatasourceTool,
  getConfirmDeleteDatasourceTool,
  getListExtractRefreshTasksTool,
  getDeleteExtractRefreshTaskTool,
  getConfirmDeleteExtractRefreshTaskTool,
  getUpdateCloudExtractRefreshTaskTool,
  getConfirmUpdateCloudExtractRefreshTaskTool,
  getListJobsTool,
  getListUsersTool,
  getQueryDatasourceTool,
  getListAllPulseMetricDefinitionsTool,
  getListPulseMetricDefinitionsFromDefinitionIdsTool,
  getListPulseMetricsFromMetricDefinitionIdTool,
  getListPulseMetricsFromMetricIdsTool,
  getListPulseMetricSubscriptionsTool,
  getGeneratePulseMetricValueInsightBundleTool,
  getGeneratePulseInsightBriefTool,
  getGenerateChironInsightFromDatasourceContextTool,
  getGetWorkbookTool,
  getGetViewTool,
  getGetViewDataTool,
  getGetViewImageTool,
  getListWorkbooksTool,
  getDeleteWorkbookTool,
  getConfirmDeleteWorkbookTool,
  getListProjectsTool,
  getListViewsTool,
  getListCustomViewsTool,
  getGetCustomViewDataTool,
  getGetCustomViewImageTool,
  getSearchContentTool,
  getRevokeAccessTokenTool,
  getResetConsentTool,
  getQueryAdminInsightsTsEventsTool,
  getQueryAdminInsightsSiteContentTool,
  getQueryAdminInsightsJobPerformanceTool,
  getGetStaleContentReportTool,
];
