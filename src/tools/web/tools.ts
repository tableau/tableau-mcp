import { getConfirmDeleteContentTool } from './_lib/confirmDeleteContent.js';
import { getDeleteContentTool } from './_lib/deleteContent.js';
import { getQueryAdminInsightsTool } from './adminInsights/queryAdminInsights.js';
import { getSearchContentTool } from './contentExploration/searchContent.js';
import { getListDatasourcesTool } from './datasources/listDatasources.js';
import { getResolveDatasourceLuidTool } from './datasources/resolveDatasourceLuid.js';
import { getConfirmUpdateCloudExtractRefreshTaskTool } from './extractRefreshTasks/confirmUpdateCloudExtractRefreshTask.js';
import { getListExtractRefreshTasksTool } from './extractRefreshTasks/listExtractRefreshTasks.js';
import { getUpdateCloudExtractRefreshTaskTool } from './extractRefreshTasks/updateCloudExtractRefreshTask.js';
import { getGetFlowTool } from './flows/getFlow/getFlow.js';
import { getListFlowsTool } from './flows/listFlows/listFlows.js';
import { getGetDatasourceMetadataTool } from './getDatasourceMetadata/getDatasourceMetadata.js';
import { getEmbedTokenTool } from './getEmbedToken/getEmbedToken.js';
import { getListJobsTool } from './jobs/listJobs.js';
import { getListProjectsTool } from './projects/listProjects.js';
import { getGeneratePulseInsightBriefTool } from './pulse/generateInsightBrief/generatePulseInsightBriefTool.js';
import { getGeneratePulseMetricValueInsightBundleTool } from './pulse/generateMetricValueInsightBundle/generatePulseMetricValueInsightBundleTool.js';
import { getGenerateInsightCardsTool } from './pulse/insights/generateInsightCardsTool.js';
import { getListAllPulseMetricDefinitionsTool } from './pulse/listAllMetricDefinitions/listAllPulseMetricDefinitions.js';
import { getListPulseMetricDefinitionsFromDefinitionIdsTool } from './pulse/listMetricDefinitionsFromDefinitionIds/listPulseMetricDefinitionsFromDefinitionIds.js';
import { getListPulseMetricsFromMetricDefinitionIdTool } from './pulse/listMetricsFromMetricDefinitionId/listPulseMetricsFromMetricDefinitionId.js';
import { getListPulseMetricsFromMetricIdsTool } from './pulse/listMetricsFromMetricIds/listPulseMetricsFromMetricIds.js';
import { getListPulseMetricSubscriptionsTool } from './pulse/listMetricSubscriptions/listPulseMetricSubscriptions.js';
import { getQueryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { getRecordEventTool } from './recordEvent/recordEvent.js';
import { getResetConsentTool } from './resetConsent/resetConsent.js';
import { getRevokeAccessTokenTool } from './revokeAccessToken/revokeAccessToken.js';
import { getListUsersTool } from './users/listUsers.js';
import { getUpdateUserTool } from './users/updateUser.js';
import { getGetCustomViewDataTool } from './views/getCustomViewData.js';
import { getGetCustomViewImageTool } from './views/getCustomViewImage.js';
import { getGetViewTool } from './views/getView.js';
import { getGetViewDataTool } from './views/getViewData.js';
import { getGetViewImageTool } from './views/getViewImage.js';
import { getListCustomViewsTool } from './views/listCustomViews.js';
import { getListViewsTool } from './views/listViews.js';
import { getGetWorkbookTool } from './workbooks/getWorkbook.js';
import { getListWorkbooksTool } from './workbooks/listWorkbooks.js';

export const webToolFactories = [
  getGetDatasourceMetadataTool,
  getEmbedTokenTool,
  getRecordEventTool,
  getListDatasourcesTool,
  getResolveDatasourceLuidTool,
  getListExtractRefreshTasksTool,
  getUpdateCloudExtractRefreshTaskTool,
  getConfirmUpdateCloudExtractRefreshTaskTool,
  getListJobsTool,
  getListUsersTool,
  getUpdateUserTool,
  getQueryDatasourceTool,
  getListFlowsTool,
  getGetFlowTool,
  getListAllPulseMetricDefinitionsTool,
  getListPulseMetricDefinitionsFromDefinitionIdsTool,
  getListPulseMetricsFromMetricDefinitionIdTool,
  getListPulseMetricsFromMetricIdsTool,
  getListPulseMetricSubscriptionsTool,
  getGeneratePulseMetricValueInsightBundleTool,
  getGeneratePulseInsightBriefTool,
  getGenerateInsightCardsTool,
  getGetWorkbookTool,
  getGetViewTool,
  getGetViewDataTool,
  getGetViewImageTool,
  getListWorkbooksTool,
  getListProjectsTool,
  getListViewsTool,
  getListCustomViewsTool,
  getGetCustomViewDataTool,
  getGetCustomViewImageTool,
  getSearchContentTool,
  getRevokeAccessTokenTool,
  getResetConsentTool,
  getQueryAdminInsightsTool,
  getDeleteContentTool,
  getConfirmDeleteContentTool,
];
