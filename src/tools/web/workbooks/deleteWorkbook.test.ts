import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { DEFAULT_PENDING_DELETION_TAG, getDeleteWorkbookTool } from './deleteWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

// A workbook that has been through the preview phase: carries the pending-deletion tag the confirm
// phase re-fetches and verifies before deleting.
const mockTaggedWorkbook = {
  ...mockWorkbook,
  tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
};

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockAddTagsToWorkbook: vi.fn(),
  mockDeleteWorkbook: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsWorkbookAllowed: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
        addTagsToWorkbook: mocks.mockAddTagsToWorkbook,
        deleteWorkbook: mocks.mockDeleteWorkbook,
      },
      usersMethods: {
        queryUserOnSite: mocks.mockQueryUserOnSite,
      },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isWorkbookAllowed: mocks.mockIsWorkbookAllowed,
  },
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

describe('deleteWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: true });
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
    });
    mocks.mockAddTagsToWorkbook.mockResolvedValue(undefined);
    mocks.mockDeleteWorkbook.mockResolvedValue(undefined);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getDeleteWorkbookTool(new WebMcpServer());
    expect(tool.name).toBe('delete-workbook');
    expect(tool.description).toContain('deletes a workbook');
    expect(tool.paramsSchema).toHaveProperty('workbookId');
    expect(tool.paramsSchema).toHaveProperty('confirm');
  });

  it('should be disabled when admin tools are not enabled', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({
      adminToolsEnabled: false,
    } as ReturnType<typeof getConfig>);
    const tool = getDeleteWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('should have correct annotations for destructive operation', () => {
    const tool = getDeleteWorkbookTool(new WebMcpServer());
    expect(tool.annotations).toEqual({
      title: 'Delete Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  // --- AuthZ (mirrors delete-extract-refresh-task) ---

  it('should call assertAdmin before any action', async () => {
    await getToolResult({ workbookId: 'wb-1' });
    expect(mocks.mockAssertAdmin).toHaveBeenCalled();
  });

  it('should fail when user is not admin and perform no side effects', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const result = await getToolResult({
      workbookId: 'wb-1',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('site administrator');
    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  // --- Tool scoping (bounded context) ---

  it('should reject preview when the workbook is out of scope and perform no side effects', async () => {
    mocks.mockIsWorkbookAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the workbook with LUID wb-1 is not allowed.',
    });
    const result = await getToolResult({ workbookId: 'wb-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed');
    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  it('should reject delete when the workbook is out of scope and perform no side effects', async () => {
    mocks.mockIsWorkbookAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the workbook with LUID wb-1 is not allowed.',
    });
    const result = await getToolResult({
      workbookId: 'wb-1',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed');
    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  it('should reuse the workbook returned by the access check instead of fetching it again', async () => {
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: true, content: mockWorkbook });
    const result = await getToolResult({ workbookId: 'wb-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(mockWorkbook.name);
    // The access check already resolved the workbook, so no second fetch is made.
    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalled();
  });

  // --- Server-authoritative pending-deletion tag gate ---

  it('should block delete when the workbook is not tagged pending-deletion (bypass closed)', async () => {
    // A caller that jumps straight to confirm: true without previewing. The live re-fetch returns a
    // workbook with no pending-deletion tag (mockWorkbook carries only 'tag-1'), so the destructive
    // path must be rejected. Proves the caller-computable-token bypass is closed.
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({ workbookId: 'wb-1', confirm: true });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not tagged');
    expect(result.content[0].text).toContain(DEFAULT_PENDING_DELETION_TAG);
    expect(mocks.mockGetWorkbook).toHaveBeenCalled();
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  it('should verify the tag with a fresh live re-fetch, not the access-check cached content', async () => {
    // The gate must NOT trust possibly-stale cached content. Cached carries the tag, live does not →
    // delete is blocked.
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: true, content: mockTaggedWorkbook });
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook); // live: untagged
    const result = await getToolResult({ workbookId: 'wb-1', confirm: true });
    expect(result.isError).toBe(true);
    expect(mocks.mockGetWorkbook).toHaveBeenCalled();
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  it('should surface a re-fetch error on confirm and not delete', async () => {
    mocks.mockGetWorkbook.mockRejectedValue(new Error('Workbook not found'));
    const result = await getToolResult({ workbookId: 'wb-1', confirm: true });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Workbook not found');
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  // --- Preview phase (confirm omitted/false) ---

  it('should tag with the default tag and report on preview without deleting', async () => {
    const result = await getToolResult({ workbookId: 'wb-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    expect(text).toContain('Preview');
    expect(text).toContain(mockWorkbook.name);
    expect(text).toContain('owner@example.com');
    expect(text).toContain(DEFAULT_PENDING_DELETION_TAG);
    expect(text).toContain('confirm: true');
    expect(text).toContain('recycle_bin');

    expect(mocks.mockGetWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
    });
    expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
      tagLabels: [DEFAULT_PENDING_DELETION_TAG],
    });
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  it('should use a caller-provided tag on preview', async () => {
    const result = await getToolResult({ workbookId: 'wb-1', tag: 'stale-pending-deletion' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('stale-pending-deletion');
    expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
      tagLabels: ['stale-pending-deletion'],
    });
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  it('should fall back to the default tag when the caller passes an empty or whitespace tag', async () => {
    const result = await getToolResult({ workbookId: 'wb-1', tag: '   ' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(DEFAULT_PENDING_DELETION_TAG);
    expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
      tagLabels: [DEFAULT_PENDING_DELETION_TAG],
    });
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  it('should still preview when owner cannot be resolved', async () => {
    mocks.mockQueryUserOnSite.mockRejectedValue(new Error('owner lookup failed'));
    const result = await getToolResult({ workbookId: 'wb-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('owner unknown');
    expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalled();
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  // --- Delete phase (confirm: true) ---

  it('should delete the workbook when confirm is true and it is tagged pending-deletion', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
    const result = await getToolResult({
      workbookId: 'wb-1',
      confirm: true,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    expect(text).toContain('Deleted');
    expect(text).toContain(mockWorkbook.name);
    expect(text).toContain('owner@example.com');
    expect(text).toContain('recycle_bin');
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
    });
    // Identity is resolved for the confirmation record, but the workbook is NOT tagged on delete.
    expect(mocks.mockGetWorkbook).toHaveBeenCalled();
    expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
  });

  it('should verify a caller-provided tag on confirm', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({
      ...mockWorkbook,
      tags: { tag: [{ label: 'stale-pending-deletion' }] },
    });
    const result = await getToolResult({
      workbookId: 'wb-1',
      confirm: true,
      tag: 'stale-pending-deletion',
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Workbook delete failed';
    mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
    mocks.mockDeleteWorkbook.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({
      workbookId: 'wb-1',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(args: {
  workbookId: string;
  confirm?: boolean;
  tag?: string;
}): Promise<CallToolResult> {
  const tool = getDeleteWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      workbookId: args.workbookId,
      confirm: args.confirm,
      tag: args.tag,
    },
    getMockRequestHandlerExtra(),
  );
}
