import { readFile, rm } from 'fs/promises';
import { z } from 'zod';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolGroups } from '../toolName.js';
import { getDownloadWorkbookRevisionTool } from './downloadWorkbookRevision.js';
import { getListWorkbookRevisionsTool } from './listWorkbookRevisions.js';

const mocks = vi.hoisted(() => ({
  allowed: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
  flag: vi.fn(),
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: { isWorkbookAllowed: mocks.allowed },
}));
vi.mock('../../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.flag }),
}));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: async ({ callback }: { callback: (api: unknown) => unknown }) =>
    callback({
      siteId: 'test-site',
      workbooksMethods: {
        getWorkbookRevisions: mocks.list,
        downloadWorkbookRevision: mocks.download,
      },
    }),
}));
const workbookId = '96a43833-27db-40b6-aa80-751efc776b9a';
const paths: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue({ allowed: true });
  mocks.flag.mockResolvedValue(false);
  mocks.list.mockResolvedValue({
    pagination: { pageNumber: 2, pageSize: 1, totalAvailable: 3 },
    revisions: [{ revisionNumber: 2 }],
  });
  mocks.download.mockResolvedValue({
    content: Buffer.from('<workbook/>'),
    contentType: 'application/xml',
    filename: 'Revision.twb',
  });
});
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true })));
});

describe('workbook revision tools', () => {
  it('registers in the workbook group with documented scopes and role', () => {
    const list = getListWorkbookRevisionsTool(new WebMcpServer());
    const download = getDownloadWorkbookRevisionTool(new WebMcpServer());
    expect(webToolGroups.workbook).toEqual(expect.arrayContaining([list.name, download.name]));
    expect(list.minRequiredRole).toBe('ExplorerCanPublish');
    expect(list.requiredApiScopes).toContain('tableau:content:read');
    expect(download.requiredApiScopes).toContain('tableau:workbooks:download');
  });
  it('returns server pagination without collapsing revisions', async () => {
    const tool = getListWorkbookRevisionsTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ workbookId, pageSize: 1, pageNumber: 2 }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(false);
    expect(mocks.list).toHaveBeenCalledWith({
      siteId: 'test-site',
      workbookId,
      pageSize: 1,
      pageNumber: 2,
    });
    expect(result.content).toContainEqual({
      type: 'text',
      text: JSON.stringify({
        pagination: { pageNumber: 2, pageSize: 1, totalAvailable: 3 },
        revisions: [{ revisionNumber: 2 }],
      }),
    });
  });
  it('persists the requested revision bytes through the existing file result', async () => {
    const tool = getDownloadWorkbookRevisionTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ workbookId, revisionNumber: 2, includeExtract: false }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(false);
    const text = result.content.find((item) => item.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Expected file metadata');
    const payload = JSON.parse(text.text);
    paths.push(payload.path);
    await expect(readFile(payload.path)).resolves.toEqual(Buffer.from('<workbook/>'));
    expect(mocks.download).toHaveBeenCalledWith({
      siteId: 'test-site',
      workbookId,
      revisionNumber: 2,
      includeExtract: false,
    });
  });
  it('refuses both operations before REST when the workbook is outside its bounds', async () => {
    mocks.allowed.mockResolvedValue({ allowed: false, message: 'Outside workbook bounds' });
    const list = getListWorkbookRevisionsTool(new WebMcpServer());
    const download = getDownloadWorkbookRevisionTool(new WebMcpServer());
    expect(
      (
        await (
          await Provider.from(list.callback)
        )({ workbookId, pageSize: 1, pageNumber: 1 }, getMockRequestHandlerExtra())
      ).isError,
    ).toBe(true);
    expect(
      (
        await (
          await Provider.from(download.callback)
        )(
          { workbookId, revisionNumber: 2, includeExtract: undefined },
          getMockRequestHandlerExtra(),
        )
      ).isError,
    ).toBe(true);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid revision input %s',
    async (revisionNumber) => {
      const tool = getDownloadWorkbookRevisionTool(new WebMcpServer());
      expect(
        z.object(await Provider.from(tool.paramsSchema)).safeParse({ workbookId, revisionNumber })
          .success,
      ).toBe(false);
    },
  );
  it('surfaces revision-history errors without a successful file result', async () => {
    mocks.list.mockRejectedValue(new Error('Version history not enabled'));
    const tool = getListWorkbookRevisionsTool(new WebMcpServer());
    const result = await (
      await Provider.from(tool.callback)
    )({ workbookId, pageSize: 1, pageNumber: 1 }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Version history not enabled');
  });
});
