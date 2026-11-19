import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { Subscription } from '../../../sdks/tableau/types/subscription.js';
import { WebMcpServer } from '../../../server.web.js';
import {
  getRequiredApiScopesForTool,
  getRequiredScopesForTool,
} from '../../../server/oauth/scopes.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { Provider } from '../../../utils/provider.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolGroups, webToolNames } from '../toolName.js';
import { getCreateSubscriptionTool } from './createSubscription.js';
import { getListSubscriptionsTool } from './listSubscriptions.js';
import { getResumeSubscriptionTool } from './resumeSubscription.js';
import { getSuspendSubscriptionTool } from './suspendSubscription.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const contentId = '11111111-1111-4111-8111-111111111111';
const subscriptionId = '22222222-2222-4222-8222-222222222222';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scheduleId = '33333333-3333-4333-8333-333333333333';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  session: vi.fn(),
  allowed: vi.fn(),
  visible: vi.fn(),
  identity: { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn(async ({ callback }) =>
    callback({
      siteId: 'site',
      userId: mocks.identity.userId,
      subscriptionsMethods: {
        querySubscriptions: mocks.list,
        getSubscription: mocks.get,
        createSubscription: mocks.create,
        setSuspended: mocks.update,
      },
      authenticatedServerMethods: { getCurrentServerSession: mocks.session },
      workbooksMethods: { getWorkbook: mocks.visible },
      viewsMethods: { getView: mocks.visible },
    }),
  ),
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: { isWorkbookAllowed: mocks.allowed, isViewAllowed: mocks.allowed },
}));

function subscription(patch: Partial<Subscription> = {}): Subscription {
  return {
    id: subscriptionId,
    subject: 'Report',
    suspended: false,
    content: { id: contentId, type: 'Workbook' },
    user: { id: userId },
    schedule: { id: scheduleId },
    ...patch,
  };
}
function extra(config = new OverridableConfig({})): TableauWebRequestHandlerExtra {
  return getMockRequestHandlerExtra({ getConfigWithOverrides: vi.fn().mockResolvedValue(config) });
}
function payload(result: CallToolResult): Record<string, unknown> {
  if (result.content[0].type !== 'text') throw new Error('Expected JSON text');
  return JSON.parse(result.content[0].text);
}
async function list(args = {}, config = new OverridableConfig({})): Promise<CallToolResult> {
  return (await Provider.from(getListSubscriptionsTool(new WebMcpServer()).callback))(
    {
      pageNumber: undefined,
      limit: undefined,
      contentType: undefined,
      contentId: undefined,
      ...args,
    },
    extra(config),
  );
}
const input = {
  contentType: 'Workbook' as const,
  contentId,
  subject: 'Report',
  schedule: { id: scheduleId },
  suspended: undefined,
  attachImage: undefined,
  attachPdf: undefined,
  message: undefined,
  sendIfViewEmpty: undefined,
};
async function create(args = {}): Promise<CallToolResult> {
  return (await Provider.from(getCreateSubscriptionTool(new WebMcpServer()).callback))(
    { ...input, ...args },
    extra(),
  );
}
async function suspend(paused = true): Promise<CallToolResult> {
  const tool = paused
    ? getSuspendSubscriptionTool(new WebMcpServer())
    : getResumeSubscriptionTool(new WebMcpServer());
  return (await Provider.from(tool.callback))({ subscriptionId }, extra());
}

describe('subscription tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    RestApi.version = '3.24';
    mocks.identity.userId = userId;
    mocks.list.mockResolvedValue(
      Ok({
        subscriptions: [subscription()],
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      }),
    );
    mocks.get.mockResolvedValue(Ok(subscription()));
    mocks.create.mockResolvedValue(Ok(subscription()));
    mocks.update.mockResolvedValue(Ok(subscription({ suspended: true })));
    mocks.allowed.mockResolvedValue({ allowed: true });
    mocks.visible.mockResolvedValue({ id: contentId });
    mocks.session.mockResolvedValue(Ok({ site: { id: 'site' }, user: { id: userId } }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('registers all four names, group membership, annotations, and least-privilege scopes', async () => {
    const tools = [
      getListSubscriptionsTool,
      getCreateSubscriptionTool,
      getSuspendSubscriptionTool,
      getResumeSubscriptionTool,
    ].map((factory) => factory(new WebMcpServer()));
    expect(tools.map((tool) => tool.name)).toEqual([...webToolGroups.subscriptions]);
    for (const tool of tools) {
      expect(webToolNames).toContain(tool.name);
      expect(getRequiredScopesForTool(tool.name)).toEqual([
        tool.name === 'list-subscriptions'
          ? 'tableau:mcp:subscriptions:read'
          : 'tableau:mcp:subscriptions:write',
      ]);
      expect(getRequiredApiScopesForTool(tool.name)).toContain('tableau:content:read');
      expect(getRequiredApiScopesForTool(tool.name)).not.toContain('tableau:tasks:write');
      expect(await Provider.from(tool.annotations)).toMatchObject({
        readOnlyHint: tool.name === 'list-subscriptions',
        destructiveHint: false,
      });
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema).not.toHaveProperty('userId');
    }
    expect(getRequiredApiScopesForTool('create-subscription')).toContain('tableau:tasks:create');
    expect(getRequiredApiScopesForTool('suspend-subscription')).toContain('tableau:tasks:update');
    expect(getRequiredApiScopesForTool('resume-subscription')).toContain('tableau:tasks:update');
  });
  it.each(['Workbook', 'View'] as const)(
    'uses one REST session for 100 distinct %s visibility checks',
    async (type) => {
      const subscriptions = Array.from({ length: 100 }, (_, index) =>
        subscription({
          content: { type, id: `11111111-1111-4111-8111-${index.toString().padStart(12, '0')}` },
        }),
      );
      mocks.list.mockResolvedValue(
        Ok({ subscriptions, pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 100 } }),
      );
      mocks.visible.mockImplementation(async ({ workbookId, viewId }) => ({
        id: workbookId ?? viewId,
      }));

      expect(payload(await list()).subscriptions).toEqual(subscriptions);
      expect(useRestApi).toHaveBeenCalledTimes(1);
      expect(mocks.allowed).toHaveBeenCalledTimes(100);
      expect(mocks.visible).toHaveBeenCalledTimes(100);
      const client = mocks.allowed.mock.calls[0][0].restApi;
      expect(client.siteId).toBe('site');
      expect(mocks.allowed.mock.calls.every(([args]) => args.restApi === client)).toBe(true);
      expect(vi.mocked(useRestApi).mock.calls[0][0].jwtScopes).toContain('tableau:content:read');
    },
  );
  it('deduplicates visibility by content type and ID within each list call', async () => {
    const subscriptions = Array.from({ length: 100 }, (_, index) =>
      subscription({ content: { id: contentId, type: index % 2 ? 'View' : 'Workbook' } }),
    );
    mocks.list.mockResolvedValue(
      Ok({ subscriptions, pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 100 } }),
    );
    expect(payload(await list()).subscriptions).toEqual(subscriptions);
    expect(useRestApi).toHaveBeenCalledTimes(1);
    expect(mocks.allowed).toHaveBeenCalledTimes(2);
    expect(mocks.visible).toHaveBeenCalledTimes(2);
  });
  it('caches denied checks only for the current call and rechecks changed access', async () => {
    mocks.list.mockResolvedValue(
      Ok({
        subscriptions: Array.from({ length: 100 }, () => subscription()),
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 100 },
      }),
    );
    mocks.allowed.mockResolvedValueOnce({ allowed: false });
    expect(payload(await list()).subscriptions).toEqual([]);
    expect(mocks.allowed).toHaveBeenCalledTimes(1);
    expect(mocks.visible).not.toHaveBeenCalled();

    mocks.visible.mockRejectedValueOnce(new Error('private visibility error'));
    expect(payload(await list()).subscriptions).toEqual([]);
    expect(mocks.allowed).toHaveBeenCalledTimes(2);
    expect(mocks.visible).toHaveBeenCalledTimes(1);

    expect(payload(await list()).subscriptions).toHaveLength(100);
    expect(mocks.allowed).toHaveBeenCalledTimes(3);
    expect(mocks.visible).toHaveBeenCalledTimes(2);
    expect(useRestApi).toHaveBeenCalledTimes(3);
  });
  it('reuses content fetched by a bounded access check without a second fetch', async () => {
    mocks.allowed.mockResolvedValue({ allowed: true, content: { id: contentId } });
    expect(payload(await list()).subscriptions).toEqual([subscription()]);
    expect(useRestApi).toHaveBeenCalledTimes(1);
    expect(mocks.visible).not.toHaveBeenCalled();
  });
  it('rejects mismatched content returned by a bounded access check', async () => {
    mocks.allowed.mockResolvedValue({ allowed: true, content: { id: otherId } });
    expect(payload(await list()).subscriptions).toEqual([]);
    expect(mocks.visible).not.toHaveBeenCalled();
  });
  it('filters another owner before any content check', async () => {
    mocks.list.mockResolvedValue(
      Ok({
        subscriptions: [subscription({ user: { id: otherId } })],
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      }),
    );
    expect(payload(await list()).subscriptions).toEqual([]);
    expect(mocks.allowed).not.toHaveBeenCalled();
    expect(mocks.visible).not.toHaveBeenCalled();
  });
  it('lists only self-owned visible content and does not reveal site totals', async () => {
    mocks.list.mockResolvedValue(
      Ok({
        subscriptions: [
          subscription(),
          subscription({ user: { id: otherId }, subject: 'Other user' }),
        ],
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1000 },
      }),
    );
    const result = payload(await list());
    expect(result.subscriptions).toEqual([subscription()]);
    expect(result).not.toHaveProperty('totalAvailable');
    expect(result.nextPageNumber).toBe(2);
    expect(mocks.allowed).toHaveBeenCalledTimes(1);
  });
  it('preserves an empty source page and its continuation after filtering', async () => {
    mocks.list.mockResolvedValue(
      Ok({
        subscriptions: [subscription()],
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 150 },
      }),
    );
    expect(payload(await list({ contentType: 'View' }))).toMatchObject({
      subscriptions: [],
      nextPageNumber: 2,
    });
    expect(mocks.allowed).not.toHaveBeenCalled();
  });
  it('fails closed when the configured boundary or current visibility denies content', async () => {
    mocks.allowed.mockResolvedValue({ allowed: false });
    expect(payload(await list()).subscriptions).toEqual([]);
    expect((await create()).isError).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.allowed.mockResolvedValue({ allowed: true });
    mocks.visible.mockRejectedValue(new Error('private server detail'));
    expect(payload(await list()).subscriptions).toEqual([]);
  });
  it('bounds access probes and reports per-page truncation', async () => {
    mocks.list.mockResolvedValue(
      Ok({
        subscriptions: [subscription(), subscription()],
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 2 },
      }),
    );
    expect(payload(await list({ limit: 1 }))).toMatchObject({
      subscriptions: [subscription()],
      pageTruncated: true,
    });
    expect(mocks.allowed).toHaveBeenCalledTimes(1);
  });
  it('honors the administrator result cap and rejects pages past it', async () => {
    const config = new OverridableConfig({ MAX_RESULT_LIMIT: '1' });
    expect(payload(await list({}, config)).hasMore).toBe(false);
    expect((await list({ pageNumber: 2 }, config)).isError).toBe(true);
  });
  it('creates using authenticated identity after permission probes finish', async () => {
    expect((await create()).isError).not.toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      siteId: 'site',
      userId,
      input: expect.objectContaining({ contentId }),
    });
    expect(mocks.create.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.visible.mock.invocationCallOrder[0],
    );
    expect(vi.mocked(useRestApi).mock.calls.every(([options]) => options.disableLogging)).toBe(
      true,
    );
  });
  it('creates a View with custom Cloud schedule and paused delivery', async () => {
    mocks.create.mockResolvedValue(
      Ok(subscription({ content: { id: contentId, type: 'View' }, suspended: true })),
    );
    expect(
      (
        await create({
          contentType: 'View',
          suspended: true,
          sendIfViewEmpty: false,
          schedule: {
            frequency: 'Weekly',
            frequencyDetails: {
              start: '23:00:00',
              intervals: { interval: [{ weekDay: 'Sunday' }] },
            },
          },
        })
      ).isError,
    ).not.toBe(true);
  });
  it('rejects invalid delivery and old Cloud API before mutation', async () => {
    expect((await create({ subject: ' ' })).isError).toBe(true);
    RestApi.version = '3.19';
    expect(
      (
        await create({
          schedule: {
            frequency: 'Weekly',
            frequencyDetails: {
              start: '23:00:00',
              intervals: { interval: [{ weekDay: 'Sunday' }] },
            },
          },
        })
      ).isError,
    ).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['invalid', ''])(
    'verifies identity %s or resolves it through a same-site session',
    async (identity) => {
      mocks.identity.userId = identity;
      const result = await create();
      expect(result.isError === true).toBe(identity === 'invalid');
      if (!identity) expect(mocks.session).toHaveBeenCalled();
    },
  );
  it('rejects a cross-site fallback session', async () => {
    mocks.identity.userId = '';
    mocks.session.mockResolvedValue(Ok({ site: { id: 'other-site' }, user: { id: userId } }));
    expect((await create()).isError).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects mismatched create response without exposing its subject', async () => {
    mocks.create.mockResolvedValue(
      Ok(subscription({ user: { id: otherId }, subject: 'Other private subscription' })),
    );
    const result = await create();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Other private');
  });
  it.each([true, false])(
    'sets suspended=%s using only the target ID and new state',
    async (paused) => {
      mocks.get.mockResolvedValue(Ok(subscription({ suspended: !paused })));
      mocks.update.mockResolvedValue(Ok(subscription({ suspended: paused })));
      expect(payload(await suspend(paused))).toMatchObject({
        suspended: paused,
        schedule: { id: scheduleId },
      });
      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(mocks.update).toHaveBeenCalledWith({
        siteId: 'site',
        subscriptionId,
        suspended: paused,
      });
    },
  );
  it.each([true, false])('is idempotent when already suspended=%s', async (paused) => {
    mocks.get.mockResolvedValue(Ok(subscription({ suspended: paused })));
    expect((await suspend(paused)).isError).not.toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses another owner before probing content or mutating', async () => {
    mocks.get.mockResolvedValue(Ok(subscription({ user: { id: otherId } })));
    expect((await suspend()).isError).toBe(true);
    expect(mocks.allowed).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses changed content between authorization and mutation', async () => {
    mocks.get
      .mockResolvedValueOnce(Ok(subscription()))
      .mockResolvedValueOnce(Ok(subscription({ content: { id: otherId, type: 'View' } })));
    expect((await suspend()).isError).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses an update response with the wrong target or state', async () => {
    mocks.update.mockResolvedValue(Ok(subscription()));
    expect((await suspend()).isError).toBe(true);
  });
  it('propagates a sanitized typed SDK failure through getErrorText', async () => {
    const error = new ArgsValidationError('The subscription response could not be validated.');
    const getErrorText = vi.spyOn(error, 'getErrorText');
    mocks.list.mockResolvedValue(error.toErr());
    const result = await list();
    expect(result.isError).toBe(true);
    expect(getErrorText).toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain('The subscription response could not be validated.');
  });
});
