import { describe, expect, test, vi } from 'vitest';
import { Ok } from 'ts-results-es';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { getViewLineageByLuid, getViewLineageQuery, mergeViewLineage } from '../../../sdks/tableau/methods/lineageUtils.js';
import { View } from '../../../sdks/tableau/types/view.js';
import { WebMcpServer } from '../../../server.web.js';
import { exportedForTesting, resourceAccessChecker } from '../resourceAccessChecker.js';
import { getGetViewTool } from './getView.js';
import { mockView } from './mockView.js';

vi.mock('../../../restApiInstance.js');
vi.mock('../resourceAccessChecker.js');

const mockUseRestApi = vi.mocked(useRestApi);
const mockResourceAccessChecker = vi.mocked(resourceAccessChecker);

describe('getView', () => {
  const mockServer = {} as WebMcpServer;
  const mockExtra = {
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      disableMetadataApiRequests: false,
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
  };

  test('successfully fetches view metadata without enrichment when Metadata API is disabled', async () => {
    const tool = getGetViewTool(mockServer);

    mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: true,
    });

    const viewWithUsage: View = {
      ...mockView,
      usage: {
        totalViewCount: 42,
      },
    };

    mockUseRestApi.mockImplementation(async ({ callback }) => {
      const restApi = {
        viewsMethods: {
          getView: vi.fn().mockResolvedValue(viewWithUsage),
        },
        siteId: 'site-123',
      };
      return await callback(restApi as any);
    });

    const extraWithDisabledMetadata = {
      ...mockExtra,
      getConfigWithOverrides: vi.fn().mockResolvedValue({
        disableMetadataApiRequests: true,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      }),
    };

    const result = await tool.callback(
      { viewId: mockView.id },
      extraWithDisabledMetadata as any
    );

    expect(result.isError).toBe(false);
    if (!result.isError) {
      const content = JSON.parse(result.content[0].text);
      expect(content.id).toBe(mockView.id);
      expect(content.name).toBe(mockView.name);
      expect(content.totalViewCount).toBe(42);
      expect(content.usage).toBeUndefined();
      expect(content.upstreamDatasources).toBeUndefined();
    }
  });
});
