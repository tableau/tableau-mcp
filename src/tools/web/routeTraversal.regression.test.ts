/**
 * Regression test for W-24452700: a tool ID interpolated into a REST path could traverse to another
 * route. `get-view-image` with viewId `../workbooks/<id>/content?includeExtract=true&x=` downloaded
 * the workbook's TWBX instead of an image.
 *
 * The tool callbacks are called directly (bypassing MCP input validation) against the REAL SDK
 * methods, so this proves the SDK guards alone stop the payload before any request is sent.
 */
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import ViewsMethods from '../../sdks/tableau/methods/viewsMethods.js';
import WorkbooksMethods from '../../sdks/tableau/methods/workbooksMethods.js';
import { WebMcpServer } from '../../server.web.js';
import { stubDefaultEnvVars, testProductVersion } from '../../testShared.js';
import { Provider } from '../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from './resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';
import { getGetViewImageTool } from './views/getViewImage.js';
import { getDownloadWorkbookTool } from './workbooks/downloadWorkbook.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const SITE_ID = '22222222-2222-2222-2222-222222222222';
const WORKBOOK_ID = '11111111-1111-1111-1111-111111111111';
const PAYLOAD = `../workbooks/${WORKBOOK_ID}/content?includeExtract=true&x=`;
const BASE = 'https://tableau.test/api/3.24';

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) => {
    const creds = { type: 'Bearer', token: 'test-token' } as const;
    const axiosConfig = { adapter: mocks.adapter };
    return callback({
      viewsMethods: new ViewsMethods(BASE, creds, axiosConfig),
      workbooksMethods: new WorkbooksMethods(BASE, creds, axiosConfig),
      siteId: SITE_ID,
    });
  }),
}));

vi.mock('../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const tools = [
  {
    name: 'get-view-image',
    idParam: 'viewId',
    getTool: () => getGetViewImageTool(new WebMcpServer(), testProductVersion),
  },
  {
    name: 'download-workbook',
    idParam: 'workbookId',
    getTool: () => getDownloadWorkbookTool(new WebMcpServer()),
  },
] as const;

describe('W-24452700 route traversal regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe.each(tools)('$name', ({ idParam, getTool }) => {
    it('rejects the payload at MCP input validation', async () => {
      const shape = await Provider.from(getTool().paramsSchema);
      const result = z.object(shape).safeParse({ [idParam]: PAYLOAD });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe('must be a Tableau LUID (UUID format)');
    });

    it('sends no request when the callback receives the payload directly', async () => {
      const callback = await Provider.from(getTool().callback);
      const result: CallToolResult = await callback(
        { [idParam]: PAYLOAD } as never,
        getMockRequestHandlerExtra(),
      );

      expect(mocks.adapter).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain(`Path parameter '${idParam}' must be a Tableau LUID (UUID format)`);
      expect(text).not.toContain('..');
    });

    // Control: the adapter is really on the request path, so the assertion above is not vacuous.
    it('does reach the adapter for a valid LUID', async () => {
      mocks.adapter.mockRejectedValue(new Error('adapter reached'));
      const callback = await Provider.from(getTool().callback);
      await callback({ [idParam]: WORKBOOK_ID } as never, getMockRequestHandlerExtra());

      expect(mocks.adapter).toHaveBeenCalledTimes(1);
      expect(mocks.adapter.mock.calls[0][0].url).toContain(`/sites/${SITE_ID}/`);
    });
  });
});
