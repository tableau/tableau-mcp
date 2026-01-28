import { getConfig } from '../config.js';
import { Server } from '../server.js';
import { mockDatasources } from './listDatasources/mockDatasources.js';
import { exportedForTesting } from './resourceAccessChecker.js';
import { mockView } from './views/mockView.js';
import { mockWorkbook } from './workbooks/mockWorkbook.js';

const { createResourceAccessChecker } = exportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockQueryDatasource: vi.fn(),
}));

vi.mock('../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
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
  const restApiArgs = {
    config: getConfig(),
    requestId: 'request-id',
    server: getServer(),
    signal: new AbortController().signal,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  type BoundedContextInputs = {
    projectIds: Array<Set<string> | null>;
    datasourceIds: Array<Set<string> | null>;
    workbookIds: Array<Set<string> | null>;
    tags: Array<Set<string> | null>;
  };

  function getCombinationsOfBoundedContextInputs({
    projectIds,
    datasourceIds,
    workbookIds,
    tags,
  }: BoundedContextInputs): Array<{
    projectIds: Set<string> | null;
    datasourceIds: Set<string> | null;
    workbookIds: Set<string> | null;
    tags: Set<string> | null;
  }> {
    const combinations = projectIds.flatMap((projectIds) =>
      datasourceIds.flatMap((datasourceIds) =>
        workbookIds.flatMap((workbookIds) =>
          tags.flatMap((tags) => ({
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          })),
        ),
      ),
    );

    return combinations;
  }

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
              restApiArgs,
            }),
          ).toEqual({ allowed: true });

          // Check again to exercise the cache.
          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              restApiArgs,
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
              restApiArgs,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              restApiArgs,
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
              restApiArgs,
            }),
          ).toEqual({ allowed: true, content: projectIds || tags ? mockWorkbook : undefined });

          // Check again to exercise the cache.
          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              restApiArgs,
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
              restApiArgs,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              restApiArgs,
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
    describe('allowed', () => {
      it('should return allowed when the view exists in a workbook that is allowed by the workbooks in the bounded context', async () => {
        mocks.mockGetView.mockResolvedValue(mockView);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: null,
          datasourceIds: null,
          workbookIds: new Set([mockWorkbook.id]),
          tags: null,
        });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        // Since project filtering is not enabled, we cached the result so we only need to call the "Get View" API once.
        expect(mocks.mockGetView).toHaveBeenCalledOnce();
      });

      it('should return allowed when the view exists in a workbook that is allowed by the projects in the bounded context', async () => {
        mocks.mockGetView.mockResolvedValue(mockView);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set([mockView.project.id]),
          datasourceIds: null,
          workbookIds: null,
          tags: null,
        });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        // Since project filtering is enabled, we can't cache the result and we need to call the "Get View" API each time.
        expect(mocks.mockGetView).toHaveBeenCalledTimes(2);
      });

      it('should return allowed when the view exists in a workbook that is allowed by the workbooks and the projects in the bounded context', async () => {
        mocks.mockGetView.mockResolvedValue(mockView);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set([mockView.project.id]),
          datasourceIds: null,
          workbookIds: new Set([mockWorkbook.id]),
          tags: null,
        });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        // Since project filtering is enabled, we can't cache the result and we need to call the "Get View" API each time.
        expect(mocks.mockGetView).toHaveBeenCalledTimes(2);
      });
    });

    describe('not allowed', () => {
      it('should return not allowed when the view exists in a workbook that is not allowed by the workbooks in the bounded context', async () => {
        mocks.mockGetView.mockResolvedValue(mockView);
        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: null,
          datasourceIds: null,
          workbookIds: new Set(['some-workbook-id']),
          tags: null,
        });

        const expectedMessage = [
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed workbook.`,
        ].join(' ');

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: expectedMessage,
        });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: expectedMessage,
        });

        // Since project filtering is not enabled, we can cache the result so we only need to call the "Get View" API once.
        expect(mocks.mockGetView).toHaveBeenCalledTimes(1);
      });

      it('should return not allowed when the view exists in a workbook that is not allowed by the projects in the bounded context', async () => {
        mocks.mockGetView.mockResolvedValue(mockView);
        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set(['some-project-id']),
          datasourceIds: null,
          workbookIds: null,
          tags: null,
        });

        const expectedMessage = [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' ');

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: expectedMessage,
        });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: expectedMessage,
        });

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Get View" API each time.
        expect(mocks.mockGetView).toHaveBeenCalledTimes(2);
      });

      it('should return not allowed when the view exists in a workbook that is allowed in the bounded context but exists in a project that is not allowed by the projects in the bounded context', async () => {
        mocks.mockGetView.mockResolvedValue(mockView);
        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set(['some-project-id']),
          datasourceIds: null,
          workbookIds: new Set([mockWorkbook.id]),
          tags: null,
        });

        const expectedMessage = [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' ');

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: expectedMessage,
        });

        expect(
          await resourceAccessChecker.isViewAllowed({
            viewId: mockView.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: expectedMessage,
        });

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Get View" API each time.
        expect(mocks.mockGetView).toHaveBeenCalledTimes(2);
      });
    });
  });
});

function getServer(): InstanceType<typeof Server> {
  const server = new Server();
  server.tool = vi.fn();
  return server;
}
