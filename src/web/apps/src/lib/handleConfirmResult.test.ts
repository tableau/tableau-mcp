/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the four confirm clients + showError so we can assert routing without exercising their DOM.
vi.mock('./deleteWorkbookConfirmClient.js');
vi.mock('./deleteDatasourceConfirmClient.js');
vi.mock('./deleteExtractRefreshTaskConfirmClient.js');
vi.mock('./updateCloudExtractRefreshTaskConfirmClient.js');
vi.mock('./showError.js');

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
import { handleConfirmResult } from './handleConfirmResult.js';
import { showError } from './showError.js';
import {
  isUpdateCloudExtractRefreshTaskConfirmResult,
  renderUpdateCloudExtractRefreshTaskConfirm,
} from './updateCloudExtractRefreshTaskConfirmClient.js';

// A well-formed (non-error) tool result; the shape guards are mocked so the contents don't matter.
const okResult: CallToolResult = {
  content: [{ type: 'text', text: '{}' }],
};

describe('handleConfirmResult', () => {
  let mockApp: App;

  beforeEach(() => {
    mockApp = { callServerTool: vi.fn() } as unknown as App;

    // Default: no shape matches.
    vi.mocked(isDeleteWorkbookConfirmResult).mockReturnValue(false);
    vi.mocked(isDeleteDatasourceConfirmResult).mockReturnValue(false);
    vi.mocked(isDeleteExtractRefreshTaskConfirmResult).mockReturnValue(false);
    vi.mocked(isUpdateCloudExtractRefreshTaskConfirmResult).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error UI when tool returns error result (isError: true)', () => {
    handleConfirmResult(mockApp, { isError: true, content: [{ type: 'text', text: 'boom' }] });

    expect(vi.mocked(showError)).toHaveBeenCalledWith('TOOL_ERROR', 'boom', mockApp);
    expect(vi.mocked(renderDeleteWorkbookConfirm)).not.toHaveBeenCalled();
  });

  it('shows error UI when tool result is null or undefined', () => {
    handleConfirmResult(mockApp, undefined as any);
    handleConfirmResult(mockApp, null as any);

    expect(vi.mocked(showError)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(showError)).toHaveBeenCalledWith('TOOL_ERROR', undefined, mockApp);
  });

  it('routes a delete-workbook confirm result to renderDeleteWorkbookConfirm', () => {
    vi.mocked(isDeleteWorkbookConfirmResult).mockReturnValue(true);

    handleConfirmResult(mockApp, okResult);

    expect(vi.mocked(renderDeleteWorkbookConfirm)).toHaveBeenCalledWith(mockApp, okResult);
    expect(vi.mocked(showError)).not.toHaveBeenCalled();
  });

  it('routes a delete-datasource confirm result to renderDeleteDatasourceConfirm', () => {
    vi.mocked(isDeleteDatasourceConfirmResult).mockReturnValue(true);

    handleConfirmResult(mockApp, okResult);

    expect(vi.mocked(renderDeleteDatasourceConfirm)).toHaveBeenCalledWith(mockApp, okResult);
    expect(vi.mocked(showError)).not.toHaveBeenCalled();
  });

  it('routes a delete-extract-refresh-task confirm result to renderDeleteExtractRefreshTaskConfirm', () => {
    vi.mocked(isDeleteExtractRefreshTaskConfirmResult).mockReturnValue(true);

    handleConfirmResult(mockApp, okResult);

    expect(vi.mocked(renderDeleteExtractRefreshTaskConfirm)).toHaveBeenCalledWith(
      mockApp,
      okResult,
    );
    expect(vi.mocked(showError)).not.toHaveBeenCalled();
  });

  it('routes an update-cloud-extract-refresh-task confirm result to renderUpdateCloudExtractRefreshTaskConfirm', () => {
    vi.mocked(isUpdateCloudExtractRefreshTaskConfirmResult).mockReturnValue(true);

    handleConfirmResult(mockApp, okResult);

    expect(vi.mocked(renderUpdateCloudExtractRefreshTaskConfirm)).toHaveBeenCalledWith(
      mockApp,
      okResult,
    );
    expect(vi.mocked(showError)).not.toHaveBeenCalled();
  });

  it('shows error UI when no known confirm-panel shape matches', () => {
    handleConfirmResult(mockApp, okResult);

    expect(vi.mocked(showError)).toHaveBeenCalledWith('TOOL_ERROR', undefined, mockApp);
    expect(vi.mocked(renderDeleteWorkbookConfirm)).not.toHaveBeenCalled();
    expect(vi.mocked(renderDeleteDatasourceConfirm)).not.toHaveBeenCalled();
    expect(vi.mocked(renderDeleteExtractRefreshTaskConfirm)).not.toHaveBeenCalled();
    expect(vi.mocked(renderUpdateCloudExtractRefreshTaskConfirm)).not.toHaveBeenCalled();
  });
});
