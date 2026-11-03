import { subscriptionsApis } from '../apis/subscriptionsApi.js';
import SubscriptionsMethods from './subscriptionsMethods.js';

const mocks = vi.hoisted(() => ({
  querySubscriptions: vi.fn(),
  getSubscription: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
}));
vi.mock('../../routeSafety/zodios.js', () => ({
  createGuardedZodios: vi.fn(() => mocks),
  installRouteGuards: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const content = { id, type: 'Workbook' as const };
const subscription = {
  id,
  subject: 'Report',
  suspended: 'false',
  content,
  user: { id: userId, email: 'private@example.invalid' },
};

describe('SubscriptionsMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.querySubscriptions.mockResolvedValue({
      pagination: { pageNumber: '1', pageSize: '100', totalAvailable: '1' },
      subscriptions: { subscription: [subscription] },
    });
    mocks.getSubscription.mockResolvedValue({ subscription });
    mocks.createSubscription.mockResolvedValue({ subscription });
    mocks.updateSubscription.mockResolvedValue({
      subscription: { ...subscription, suspended: 'true' },
    });
  });
  function methods(): SubscriptionsMethods {
    return new SubscriptionsMethods(
      'https://tableau.example/api/3.24',
      { type: 'Bearer', token: 'unit-test-placeholder' },
      {},
    );
  }
  it('normalizes pagination and strips undocumented user fields', async () => {
    const result = await methods().querySubscriptions({
      siteId: 'site',
      pageNumber: 1,
      pageSize: 100,
    });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().subscriptions[0].user).toEqual({ id: userId });
    expect(result.unwrap().pagination).toEqual({ pageNumber: 1, pageSize: 100, totalAvailable: 1 });
  });
  it('accepts an explicitly empty subscriptions object', async () => {
    mocks.querySubscriptions.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
      subscriptions: {},
    });
    expect(
      (
        await methods().querySubscriptions({ siteId: 'site', pageNumber: 1, pageSize: 100 })
      ).unwrap().subscriptions,
    ).toEqual([]);
  });
  it.each([
    { pageNumber: 2, pageSize: 100, totalAvailable: 1 },
    { pageNumber: 1, pageSize: 100, totalAvailable: -1 },
    { pageNumber: 1, pageSize: 100, totalAvailable: 1.5 },
    { pageNumber: 1, pageSize: 10, totalAvailable: 1 },
  ])('rejects invalid or mismatched pagination %#', async (pagination) => {
    mocks.querySubscriptions.mockResolvedValue({
      pagination,
      subscriptions: { subscription: [subscription] },
    });
    expect(
      (
        await methods().querySubscriptions({ siteId: 'site', pageNumber: 1, pageSize: 100 })
      ).isErr(),
    ).toBe(true);
  });
  it('rejects an oversized page without exposing its raw values', async () => {
    mocks.querySubscriptions.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 101 },
      subscriptions: { subscription: Array.from({ length: 101 }, () => subscription) },
    });
    const result = await methods().querySubscriptions({
      siteId: 'site',
      pageNumber: 1,
      pageSize: 100,
    });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).not.toContain('private@example');
  });
  it('puts Server schedule IDs inside subscription', async () => {
    await methods().createSubscription({
      siteId: 'site',
      userId,
      input: { contentType: 'Workbook', contentId: id, subject: 'Report', schedule: { id } },
    });
    expect(mocks.createSubscription).toHaveBeenCalledWith(
      { subscription: { subject: 'Report', content, user: { id: userId }, schedule: { id } } },
      expect.objectContaining({ params: { siteId: 'site' } }),
    );
  });
  it('puts Cloud custom schedules alongside subscription', async () => {
    const schedule = {
      frequency: 'Weekly' as const,
      frequencyDetails: {
        start: '23:00:00',
        intervals: { interval: [{ weekDay: 'Sunday' as const }] },
      },
    };
    await methods().createSubscription({
      siteId: 'site',
      userId,
      input: {
        contentType: 'View',
        contentId: id,
        subject: 'Report',
        schedule,
        suspended: true,
        sendIfViewEmpty: false,
      },
    });
    expect(mocks.createSubscription).toHaveBeenCalledWith(
      {
        subscription: {
          subject: 'Report',
          suspended: true,
          content: { id, type: 'View', sendIfViewEmpty: false },
          user: { id: userId },
        },
        schedule,
      },
      expect.anything(),
    );
  });
  it('updates only suspended and never resubmits schedule/content', async () => {
    const result = await methods().setSuspended({
      siteId: 'site',
      subscriptionId: id,
      suspended: true,
    });
    expect(result.unwrap().suspended).toBe(true);
    expect(mocks.updateSubscription).toHaveBeenCalledWith(
      { subscription: { suspended: true } },
      expect.objectContaining({ params: { siteId: 'site', subscriptionId: id } }),
    );
  });
  it('normalizes a top-level Cloud schedule and rejects malformed responses safely', async () => {
    mocks.getSubscription
      .mockResolvedValueOnce({
        subscription,
        schedule: { id, frequency: 'Weekly', private: 'omit' },
      })
      .mockResolvedValueOnce({
        subscription: { ...subscription, id: 'invalid', subject: 'do not disclose' },
      });
    expect(
      (await methods().getSubscription({ siteId: 'site', subscriptionId: id })).unwrap().schedule,
    ).toEqual({ id, frequency: 'Weekly' });
    const result = await methods().getSubscription({ siteId: 'site', subscriptionId: id });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toBe(
      'The Tableau subscription response could not be validated.',
    );
  });
  it('declares traversal-safe LUID route parameters on detail and mutation endpoints', () => {
    for (const endpoint of subscriptionsApis) {
      for (const parameter of endpoint.parameters ?? []) {
        if (parameter.type !== 'Path') continue;
        expect(() => parameter.schema.parse('../outside')).toThrow();
      }
    }
  });
});
