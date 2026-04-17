import { Server } from '../../../server.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getContentWorkbooksTool } from './contentWorkbooks.js';

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockQueryWorkbooksForSite: vi.fn(),
  mockQueryWorkbooksForUser: vi.fn(),
  mockUpdateWorkbook: vi.fn(),
  mockDeleteWorkbook: vi.fn(),
  mockDownloadWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
        queryWorkbooksForSite: mocks.mockQueryWorkbooksForSite,
        queryWorkbooksForUser: mocks.mockQueryWorkbooksForUser,
        updateWorkbook: mocks.mockUpdateWorkbook,
        deleteWorkbook: mocks.mockDeleteWorkbook,
        downloadWorkbook: mocks.mockDownloadWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('content-workbooks tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDefaultEnvVars();
  });

  it('should create tool instance', () => {
    const tool = getContentWorkbooksTool(new Server());
    expect(tool.name).toBe('content-workbooks');
  });

  it('should query workbooks for site', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue({ workbooks: { workbook: [] } });

    const tool = getContentWorkbooksTool(new Server());
    await tool.callback({ operation: 'query-workbooks-for-site' }, getMockRequestHandlerExtra());

    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalled();
  });
});
