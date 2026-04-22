import { getCombinationsOfBoundedContextInputs } from '../utils/getCombinationsOfBoundedContextInputs.js';
import { mockDatasources } from './listDatasources/mockDatasources.js';
import { exportedForTesting } from './resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from './toolContext.web.mock.js';
import { mockCustomView } from './views/mockCustomView.js';
import { mockView } from './views/mockView.js';
import { mockWorkbook } from './workbooks/mockWorkbook.js';

const { createResourceAccessChecker } = exportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockGetCustomView: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockQueryDatasource: vi.fn(),
}));

vi.mock('../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
        getCustomView: mocks.mockGetCustomView,
      },
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('ResourceAccessChecker', () => {
  const extra = getMockRequestHandlerExtra();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isDatasourceAllowed', () => {
    const mockDatasource = mockDatasources.datasources[0];

    beforeEach(() => {
      mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);
    });

    describe('allowed', () => {
      test.each(
        getCombinationsOfBoundedContextInputs({
          projectIds: [null, new Set([mockDatasource.project.id])],
          datasourceIds: [null, new Set([mockDatasource.id])],
          workbookIds: [null], // n/a for datasources
          tags: [null, new Set([mockDatasource.tags.tag[0].label])],
        }),
      )(
        'should return allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          });

          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              extra,
            }),
          ).toEqual({ allowed: true });

          // Check again to exercise the cache.
          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              extra,
            }),
          ).toEqual({ allowed: true });

          // If project or tag filtering is enabled, we cannot cache the result so we need to call the "Query Datasource" API each time.
          const expectedNumberOfCalls = projectIds || tags ? 2 : 0;
          expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });

    describe('not allowed', () => {
      const notAllowedCombinations = getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set(['some-project-id'])],
        datasourceIds: [null, new Set(['some-datasource-id'])],
        workbookIds: [null], // n/a for datasources
        tags: [null, new Set(['some-tag-label'])],
      }).filter(({ projectIds, datasourceIds, workbookIds, tags }) => {
        // Remove the combination where they are all null
        return (
          projectIds !== null || datasourceIds !== null || workbookIds !== null || tags !== null
        );
      });

      test.each(notAllowedCombinations)(
        'should return not allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          });

          const sentences = [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
          ];
          if (datasourceIds) {
            sentences.push(
              `Querying the datasource with LUID ${mockDatasource.id} is not allowed.`,
            );
          } else if (projectIds) {
            sentences.push(
              `The datasource with LUID ${mockDatasource.id} cannot be queried because it does not belong to an allowed project.`,
            );
          } else if (tags) {
            sentences.push(
              `The datasource with LUID ${mockDatasource.id} cannot be queried because it does not have one of the allowed tags.`,
            );
          }

          const expectedMessage = sentences.join(' ');

          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          // If project or tag filtering is enabled, we cannot cache the result so we need to call the "Query Datasource" API each time.
          const expectedNumberOfCalls = !datasourceIds && (projectIds || tags) ? 2 : 0;
          expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });
  });

  describe('isWorkbookAllowed', () => {
    beforeEach(() => {
      mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    });

    describe('allowed', () => {
      test.each(
        getCombinationsOfBoundedContextInputs({
          projectIds: [null, new Set([mockWorkbook.project.id])],
          datasourceIds: [null], // n/a for workbooks
          workbookIds: [null, new Set([mockWorkbook.id])],
          tags: [null, new Set([mockWorkbook.tags.tag[0].label])],
        }),
      )(
        'should return allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          });

          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              extra,
            }),
          ).toEqual({ allowed: true, content: projectIds || tags ? mockWorkbook : undefined });

          // Check again to exercise the cache.
          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              extra,
            }),
          ).toEqual({ allowed: true, content: projectIds || tags ? mockWorkbook : undefined });

          // If project or tag filtering is enabled, we cannot cache the result so we need to call the "Get Workbook" API each time.
          const expectedNumberOfCalls = projectIds || tags ? 2 : 0;
          expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });

    describe('not allowed', () => {
      const notAllowedCombinations = getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set(['some-project-id'])],
        datasourceIds: [null], // n/a for workbooks
        workbookIds: [null, new Set(['some-workbook-id'])],
        tags: [null, new Set(['some-tag-label'])],
      }).filter(({ projectIds, datasourceIds, workbookIds, tags }) => {
        // Remove the combination where they are all null
        return (
          projectIds !== null || datasourceIds !== null || workbookIds !== null || tags !== null
        );
      });

      test.each(notAllowedCombinations)(
        'should return not allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          });

          const sentences = [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
          ];
          if (workbookIds) {
            sentences.push(`Querying the workbook with LUID ${mockWorkbook.id} is not allowed.`);
          } else if (projectIds) {
            sentences.push(
              `The workbook with LUID ${mockWorkbook.id} cannot be queried because it does not belong to an allowed project.`,
            );
          } else if (tags) {
            sentences.push(
              `The workbook with LUID ${mockWorkbook.id} cannot be queried because it does not have one of the allowed tags.`,
            );
          }

          const expectedMessage = sentences.join(' ');

          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          // If project or tag filtering is enabled, we cannot cache the result so we need to call the "Get Workbook" API each time.
          const expectedNumberOfCalls = !workbookIds && (projectIds || tags) ? 2 : 0;
          expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });
  });

  describe('isViewAllowed', () => {
    beforeEach(() => {
      mocks.mockGetView.mockResolvedValue(mockView);
    });

    describe('allowed', () => {
      test.each(
        getCombinationsOfBoundedContextInputs({
          projectIds: [null, new Set([mockView.project.id])],
          datasourceIds: [null], // n/a for views
          workbookIds: [null, new Set([mockView.workbook.id])],
          tags: [null, new Set([mockView.tags.tag[0].label])],
        }),
      )(
        'should return allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          });

          expect(
            await resourceAccessChecker.isViewAllowed({
              viewId: mockView.id,
              extra,
            }),
          ).toEqual({ allowed: true });

          // Check again to exercise the cache.
          expect(
            await resourceAccessChecker.isViewAllowed({
              viewId: mockView.id,
              extra,
            }),
          ).toEqual({ allowed: true });

          let expectedNumberOfCalls = 0;
          if (projectIds || tags) {
            // If project or tag filtering is enabled, we cannot cache the result so we need to call the "Get View" API each time.
            expectedNumberOfCalls = 2;
          } else if (workbookIds) {
            // If only workbook filtering is enabled, we can cache the result so we only need to call the "Get View" API once.
            expectedNumberOfCalls = 1;
          }

          expect(mocks.mockGetView).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });

    describe('not allowed', () => {
      const notAllowedCombinations = getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set(['some-project-id'])],
        datasourceIds: [null], // n/a for views
        workbookIds: [null, new Set(['some-workbook-id'])],
        tags: [null, new Set(['some-tag-label'])],
      }).filter(({ projectIds, datasourceIds, workbookIds, tags }) => {
        // Remove the combination where they are all null
        return (
          projectIds !== null || datasourceIds !== null || workbookIds !== null || tags !== null
        );
      });

      test.each(notAllowedCombinations)(
        'should return not allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          });

          const sentences = [
            'The set of allowed views that can be queried is limited by the server configuration.',
          ];
          if (workbookIds) {
            sentences.push(
              `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed workbook.`,
            );
          } else if (projectIds) {
            sentences.push(
              `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed project.`,
            );
          } else if (tags) {
            sentences.push(
              `The view with LUID ${mockView.id} cannot be queried because it does not have one of the allowed tags.`,
            );
          }

          const expectedMessage = sentences.join(' ');

          expect(
            await resourceAccessChecker.isViewAllowed({
              viewId: mockView.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          expect(
            await resourceAccessChecker.isViewAllowed({
              viewId: mockView.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          let expectedNumberOfCalls = 0;
          if (projectIds || tags) {
            // If project or tag filtering is enabled, we cannot cache the result so we need to call the "Get View" API each time.
            expectedNumberOfCalls = 2;
          } else if (workbookIds) {
            // If only workbook filtering is enabled, we can cache the result so we only need to call the "Get View" API once.
            expectedNumberOfCalls = 1;
          }

          expect(mocks.mockGetView).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });
  });

  describe('isCustomViewAllowed', () => {
    beforeEach(() => {
      mocks.mockGetCustomView.mockResolvedValue(mockCustomView);
      mocks.mockGetView.mockResolvedValue(mockView);
    });

    it('should allow when the underlying published view is allowed', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({ allowed: true });

      // When no filtering is enabled, we don't need to resolve the underlying view.
      expect(mocks.mockGetCustomView).not.toHaveBeenCalled();
    });

    it('should not allow the custom view when resolving it fails', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: new Set(['some-workbook-id']),
        tags: null,
      });

      // mock getCustomView to throw an error
      mocks.mockGetCustomView.mockRejectedValue(new Error('Custom view not found'));

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: 'some-custom-view-id',
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          'An error occurred while checking if the custom view with LUID some-custom-view-id belongs to an allowed view.',
          'Please verify that the custom view LUID is correct and you have access to it.',
          'Custom view not found',
        ].join(' '),
      });
    });

    it('should not allow when the underlying view is excluded by workbook id gate', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: new Set(['some-workbook-id']),
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed workbook.`,
        ].join(' '),
      });
    });

    it('should not allow when the underlying view is excluded by project id gate', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: new Set(['some-project-id']),
        datasourceIds: null,
        workbookIds: null,
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' '),
      });
    });

    it('should not allow when the underlying view is excluded by tag gate', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        tags: new Set(['some-tag-label']),
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not have one of the allowed tags.`,
        ].join(' '),
      });
    });
  });
});
