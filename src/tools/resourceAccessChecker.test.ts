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
  const restApiArgs = { config: getConfig(), requestId: 'request-id', server: getServer() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isDatasourceAllowed', () => {
    describe('allowed', () => {
      it('should return allowed when the datasource LUID is allowed by the datasources in the bounded context', async () => {
        const mockDatasource = mockDatasources.datasources[0];

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: null,
          datasourceIds: new Set([mockDatasource.id]),
          workbookIds: null,
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

        expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
      });

      it('should return allowed when the datasource exists in a project that is allowed by the projects in the bounded context', async () => {
        const mockDatasource = mockDatasources.datasources[0];
        mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set([mockDatasource.project.id]),
          datasourceIds: null,
          workbookIds: null,
        });

        expect(
          await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        expect(
          await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Query Datasource" API each time.
        expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
      });

      it('should return allowed when the datasource is allowed by the datasources in the bounded context and exists in a project that is allowed by the projects in the bounded context', async () => {
        const mockDatasource = mockDatasources.datasources[0];
        mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set([mockDatasource.project.id]),
          datasourceIds: new Set([mockDatasource.id]),
          workbookIds: null,
        });

        expect(
          await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        expect(
          await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Query Datasource" API each time.
        expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
      });
    });

    describe('not allowed', () => {
      it('should return not allowed when the datasource LUID is not allowed by the datasources in the bounded context', async () => {
        const mockDatasource = mockDatasources.datasources[0];
        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: null,
          datasourceIds: new Set(['some-datasource-luid']),
          workbookIds: null,
        });

        expect(
          await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `Querying the datasource with LUID ${mockDatasource.id} is not allowed.`,
          ].join(' '),
        });
      });

      it('should return not allowed when the datasource exists in a project that is not allowed by the projects in the bounded context', async () => {
        const mockDatasource = mockDatasources.datasources[0];
        mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set(['some-project-id']),
          datasourceIds: null,
          workbookIds: null,
        });

        const expectedMessage = [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          `The datasource with LUID ${mockDatasource.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' ');

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

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Query Datasource" API each time.
        expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
      });

      it('should return not allowed when the datasource is allowed by the datasources in the bounded context but exists in a project that is not allowed by the projects in the bounded context', async () => {
        const mockDatasource = mockDatasources.datasources[0];
        mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set(['some-project-id']),
          datasourceIds: new Set([mockDatasource.id]),
          workbookIds: null,
        });

        const expectedMessage = [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          `The datasource with LUID ${mockDatasource.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' ');

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

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Query Datasource" API each time.
        expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('isWorkbookAllowed', () => {
    describe('allowed', () => {
      it('should return allowed when the workbook ID is allowed by the workbooks in the bounded context', async () => {
        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: null,
          datasourceIds: null,
          workbookIds: new Set([mockWorkbook.id]),
        });

        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        // Check again to exercise the cache.
        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true });

        expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
      });

      it('should return allowed when the workbook is in a project that is allowed by the projects in the bounded context', async () => {
        mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set([mockWorkbook.project.id]),
          datasourceIds: null,
          workbookIds: null,
        });

        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true, content: mockWorkbook });

        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true, content: mockWorkbook });

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Get Workbook" API each time.
        expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(2);
      });

      it('should return allowed when the workbook is allowed by the workbooks in the bounded context and exists in a project that is allowed by the projects in the bounded context', async () => {
        mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set([mockWorkbook.project.id]),
          datasourceIds: null,
          workbookIds: new Set([mockWorkbook.id]),
        });

        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true, content: mockWorkbook });

        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({ allowed: true, content: mockWorkbook });

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Get Workbook" API each time.
        expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(2);
      });
    });

    describe('not allowed', () => {
      it('should return not allowed when the workbook ID is not allowed by the workbooks in the bounded context', async () => {
        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: null,
          datasourceIds: null,
          workbookIds: new Set(['some-workbook-id']),
        });

        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `Querying the workbook with LUID ${mockWorkbook.id} is not allowed.`,
          ].join(' '),
        });

        // Check again to exercise the cache.
        expect(
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: mockWorkbook.id,
            restApiArgs,
          }),
        ).toEqual({
          allowed: false,
          message: [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
            `Querying the workbook with LUID ${mockWorkbook.id} is not allowed.`,
          ].join(' '),
        });

        expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
      });

      it('should return not allowed when the workbook is in a project that is not allowed by the projects in the bounded context', async () => {
        mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set(['some-project-id']),
          datasourceIds: null,
          workbookIds: null,
        });

        const expectedMessage = [
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          `The workbook with LUID ${mockWorkbook.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' ');

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

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Get Workbook" API each time.
        expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(2);
      });

      it('should return not allowed when the workbook is allowed by the workbooks in the bounded context and exists in a project that is not allowed by the projects in the bounded context', async () => {
        mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set(['some-project-id']),
          datasourceIds: null,
          workbookIds: new Set([mockWorkbook.id]),
        });

        const expectedMessage = [
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          `The workbook with LUID ${mockWorkbook.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' ');

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

        // Since project filtering is enabled, we cannot cache the result so we need to call the "Get Workbook" API each time.
        expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(2);
      });
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
