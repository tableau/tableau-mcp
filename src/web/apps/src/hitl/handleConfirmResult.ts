import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { extractToolErrorMessage } from '../../../../utils/extractToolErrorMessage.js';
import { showError } from '../shared/showError.js';
import {
  isDeleteDatasourceConfirmResult,
  renderDeleteDatasourceConfirm,
} from './deleteDatasourceConfirmClient.js';
import {
  isDeleteExtractRefreshTaskConfirmResult,
  renderDeleteExtractRefreshTaskConfirm,
} from './deleteExtractRefreshTaskConfirmClient.js';
import {
  isDeleteWorkbookConfirmResult,
  renderDeleteWorkbookConfirm,
} from './deleteWorkbookConfirmClient.js';
import {
  isUpdateCloudExtractRefreshTaskConfirmResult,
  renderUpdateCloudExtractRefreshTaskConfirm,
} from './updateCloudExtractRefreshTaskConfirmClient.js';

/**
 * Handles a tool result from a delete/update preview tool and renders the in-iframe MCP-Apps HITL
 * confirm panel. A preview returns a confirm-panel payload keyed by result shape; branch on that
 * shape and render the matching panel. Anything that doesn't match a known confirm shape (including
 * an error/null result) falls through to the error UI.
 * @param app - The MCP App instance
 * @param result - The tool result containing the confirm-panel payload
 */
export function handleConfirmResult(app: App, result: CallToolResult): void {
  if (!result || result.isError) {
    const cause = result ? extractToolErrorMessage(result) : undefined;
    showError('TOOL_ERROR', cause, app);
    return;
  }

  if (isDeleteWorkbookConfirmResult(result)) {
    renderDeleteWorkbookConfirm(app, result);
    return;
  }
  if (isDeleteDatasourceConfirmResult(result)) {
    renderDeleteDatasourceConfirm(app, result);
    return;
  }
  if (isDeleteExtractRefreshTaskConfirmResult(result)) {
    renderDeleteExtractRefreshTaskConfirm(app, result);
    return;
  }
  if (isUpdateCloudExtractRefreshTaskConfirmResult(result)) {
    renderUpdateCloudExtractRefreshTaskConfirm(app, result);
    return;
  }

  // No known confirm-panel shape matched — surface the error UI rather than silently doing nothing.
  showError('TOOL_ERROR', undefined, app);
}
