import { AxiosError, AxiosResponse } from 'axios';
import { Err, Ok } from 'ts-results-es';

import {
  PulseDisabledError,
  PulseInsightsApiError,
  PulseNotAvailableError,
} from '../../errors/mcpToolError.js';
import { RestApiArgs } from '../../restApiInstance.js';
import { PULSE_PREMIUM_INSIGHTS_ENTITLEMENT } from '../../sdks/tableau/types/pulse.js';
import { ADMIN_SITE_ROLES, SiteRole } from '../../sdks/tableau/types/user.js';
import {
  checkRegistrationConditions,
  getUnmetConditionInstructions,
  MAX_API_RETRY_ATTEMPTS,
  RegistrationCondition,
  RegistrationContext,
} from './registrationConditions.js';

const mocks = vi.hoisted(() => ({
  useRestApi: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: mocks.useRestApi,
}));

// Probes are reached through the mocked useRestApi; only cancellation needs a real value.
const restApiArgs = { signal: new AbortController().signal } as RestApiArgs;

/** A successful `listAllPulseMetricDefinitions` page. An empty site still means Pulse is enabled. */
function pulseDefinitionsPage(definitionCount = 0): Ok<unknown> {
  return new Ok({
    pagination: { next_page_token: undefined, offset: 0, total_available: definitionCount },
    definitions: Array.from({ length: definitionCount }, (_, i) => ({
      metadata: { name: `m${i}` },
    })),
  });
}

/** A `queryFlowsForSite` result; `totalAvailable` defaults to the number of flows returned. */
function flowsPage(
  flows: Array<Record<string, unknown>>,
  totalAvailable = flows.length,
): { pagination: Record<string, number>; flows: Array<Record<string, unknown>> } {
  return { pagination: { pageNumber: 1, pageSize: 1, totalAvailable }, flows };
}

/** An entitlements response built from `{ entitlementType: enabled }` pairs. */
function entitlements(enabledByType: Record<string, boolean>): Ok<unknown> {
  return new Ok(
    Object.entries(enabledByType).map(([entitlement_type, enabled]) => ({
      entitlement_type,
      enabled,
    })),
  );
}

/** Stubs the two probe calls, each with an `Ok` or an `Err`. */
function stubPulseProbe(definitionsResult: unknown, entitlementsResult?: unknown): void {
  mocks.useRestApi.mockImplementation(async ({ callback }: { callback: (api: any) => unknown }) =>
    callback({
      pulseMethods: {
        listAllPulseMetricDefinitions: vi.fn().mockResolvedValue(definitionsResult),
        getPulseEntitlements: vi.fn().mockResolvedValue(entitlementsResult),
      },
    }),
  );
}

function stubKnowledgeProbe(result: unknown, reject = false): void {
  mocks.useRestApi.mockImplementation(async ({ callback }: { callback: (api: any) => unknown }) =>
    callback({
      knowledgeMethods: {
        listGraphs: reject ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result),
      },
    }),
  );
}

// The probe retries with real backoff delays. Fake timers keep the retry-path tests fast: schedule
// the call, drain all pending timers/microtasks, then await the settled result.
async function resolveWithFakeTimers<T>(op: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = op();
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

describe('checkRegistrationConditions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('decision logic', () => {
    it('is met when there are no conditions to satisfy', async () => {
      const context: RegistrationContext = {};
      await expect(checkRegistrationConditions([], context, restApiArgs)).resolves.toEqual({
        registrationConditionsMet: true,
      });
      expect(mocks.useRestApi).not.toHaveBeenCalled();
    });

    it('is met when a required capability is already satisfied in context', async () => {
      // Pre-populated context models a capability resolved earlier in the same registration pass.
      const context: RegistrationContext = { isPulseEnabled: true };
      await expect(
        checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
    });

    it('reports the failing condition when a required capability is disabled in context (fail-closed)', async () => {
      const context: RegistrationContext = { isPulseEnabled: false };
      await expect(
        checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: false, failingCondition: 'RequiresPulse' });
    });

    it('does not re-resolve a capability already present in context (memoized across tools)', async () => {
      const context: RegistrationContext = { hasPulsePremium: true };
      await expect(
        checkRegistrationConditions(['RequiresPulsePremium'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
      expect(mocks.useRestApi).not.toHaveBeenCalled();
    });

    it('requires every condition — one unmet condition hides the tool and names it', async () => {
      const context: RegistrationContext = { isPulseEnabled: true, hasPulsePremium: false };
      await expect(
        checkRegistrationConditions(
          ['RequiresPulse', 'RequiresPulsePremium'],
          context,
          restApiArgs,
        ),
      ).resolves.toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulsePremium',
      });
    });

    it('is met when every condition is satisfied', async () => {
      const context: RegistrationContext = { isPulseEnabled: true, hasPulsePremium: true };
      await expect(
        checkRegistrationConditions(
          ['RequiresPulse', 'RequiresPulsePremium'],
          context,
          restApiArgs,
        ),
      ).resolves.toEqual({ registrationConditionsMet: true });
    });

    it('fails closed with MissingConditionCheck on an unrecognized condition', async () => {
      // Only reachable via an unsound cast (the union type excludes it), but the runtime guard must
      // hide the tool rather than expose it, and flag it as a missing check.
      const context: RegistrationContext = {};
      await expect(
        checkRegistrationConditions(['Nonsense' as RegistrationCondition], context, restApiArgs),
      ).resolves.toEqual({
        registrationConditionsMet: false,
        failingCondition: 'MissingConditionCheck',
      });
    });
  });

  describe('UserCanViewFlows', () => {
    const queryFlowsForSite = vi.fn();
    const getCurrentServerSession = vi.fn();

    beforeEach(() => {
      queryFlowsForSite.mockReset().mockResolvedValue(flowsPage([]));
      getCurrentServerSession
        .mockReset()
        .mockResolvedValue(new Ok({ user: { siteRole: SiteRole.CREATOR } }));
      mocks.useRestApi.mockImplementation(async ({ callback }) =>
        callback({
          siteId: 'site-id',
          flowsMethods: { queryFlowsForSite },
          authenticatedServerMethods: { getCurrentServerSession },
        }),
      );
    });

    it.each([true, false])('caches visibility=$0 across Flow tools', async (hasVisibleFlows) => {
      queryFlowsForSite.mockResolvedValue(
        hasVisibleFlows ? flowsPage([{ id: 'flow-id', name: 'Sales Cleanup' }]) : flowsPage([]),
      );
      const context: RegistrationContext = {};
      const expected = hasVisibleFlows
        ? { registrationConditionsMet: true }
        : { registrationConditionsMet: false, failingCondition: 'UserCanViewFlows' };

      await expect(
        checkRegistrationConditions(['UserCanViewFlows'], context, restApiArgs),
      ).resolves.toEqual(expected);
      await expect(
        checkRegistrationConditions(['UserCanViewFlows'], context, restApiArgs),
      ).resolves.toEqual(expected);

      expect(queryFlowsForSite).toHaveBeenCalledExactlyOnceWith({
        siteId: 'site-id',
        pageSize: 1,
      });
      expect(getCurrentServerSession).toHaveBeenCalledTimes(hasVisibleFlows ? 0 : 1);
      expect(mocks.useRestApi).toHaveBeenCalledWith(
        expect.objectContaining({ jwtScopes: ['tableau:flows:read'] }),
      );
    });

    it.each([SiteRole.VIEWER, SiteRole.EXPLORER, SiteRole.EXPLORER_CAN_PUBLISH])(
      'allows a %s with a shared flow without a user ID or ownership lookup',
      async (siteRole) => {
        queryFlowsForSite.mockResolvedValue(
          flowsPage([{ id: 'shared-flow-id', name: 'Shared', owner: { id: 'another-user-id' } }]),
        );
        await expect(
          checkRegistrationConditions(['UserCanViewFlows'], { siteRole }, restApiArgs),
        ).resolves.toEqual({ registrationConditionsMet: true });
        expect(queryFlowsForSite).toHaveBeenCalledExactlyOnceWith({
          siteId: 'site-id',
          pageSize: 1,
        });
        expect(getCurrentServerSession).not.toHaveBeenCalled();
      },
    );

    describe('seeded sample flow', () => {
      const seed = {
        id: 'seed-id',
        name: 'Superstore Flow',
        fileType: 'tflx',
        createdAt: '2026-11-24T16:04:53Z',
        updatedAt: '2026-11-24T16:04:53Z',
      };

      it('treats a site whose only flow is the seed as having no flow', async () => {
        queryFlowsForSite.mockResolvedValue(flowsPage([seed]));
        await expect(
          checkRegistrationConditions(
            ['UserCanViewFlows'],
            { siteRole: SiteRole.VIEWER },
            restApiArgs,
          ),
        ).resolves.toEqual({
          registrationConditionsMet: false,
          failingCondition: 'UserCanViewFlows',
        });
      });

      it.each([
        ['0 seconds', '2026-11-24T16:04:53Z'],
        ['1 second, the update crossed a second boundary', '2026-11-24T16:04:54Z'],
      ])('treats a seed updated %s after creation as the seed', async (_label, updatedAt) => {
        queryFlowsForSite.mockResolvedValue(flowsPage([{ ...seed, updatedAt }]));
        await expect(
          checkRegistrationConditions(
            ['UserCanViewFlows'],
            { siteRole: SiteRole.VIEWER },
            restApiArgs,
          ),
        ).resolves.toEqual({
          registrationConditionsMet: false,
          failingCondition: 'UserCanViewFlows',
        });
      });

      it.each(ADMIN_SITE_ROLES)(
        'still allows %s when the seed is the only flow',
        async (siteRole) => {
          queryFlowsForSite.mockResolvedValue(flowsPage([seed]));
          getCurrentServerSession.mockResolvedValue(new Ok({ user: { siteRole } }));
          await expect(
            checkRegistrationConditions(['UserCanViewFlows'], {}, restApiArgs),
          ).resolves.toEqual({ registrationConditionsMet: true });
        },
      );

      it('counts the seed plus a customer flow', async () => {
        queryFlowsForSite.mockResolvedValue(flowsPage([seed], 2));
        await expect(
          checkRegistrationConditions(
            ['UserCanViewFlows'],
            { siteRole: SiteRole.VIEWER },
            restApiArgs,
          ),
        ).resolves.toEqual({ registrationConditionsMet: true });
        expect(getCurrentServerSession).not.toHaveBeenCalled();
      });

      it.each([
        ['a different name', { name: 'Superstore' }],
        ['a different case', { name: 'superstore flow' }],
        ['a different file type', { fileType: 'tfl' }],
        ['an edited flow', { updatedAt: '2026-11-25T09:00:00Z' }],
        ['an update 2 seconds after creation', { updatedAt: '2026-11-24T16:04:55Z' }],
        ['an update before creation', { updatedAt: '2026-11-24T16:04:52Z' }],
        ['an unparseable updated time', { updatedAt: 'not-a-date' }],
        ['no file type', { fileType: undefined }],
        ['no created time', { createdAt: undefined }],
        ['no updated time', { updatedAt: undefined }],
      ])('counts a single flow with %s', async (_label, override) => {
        queryFlowsForSite.mockResolvedValue(flowsPage([{ ...seed, ...override }]));
        await expect(
          checkRegistrationConditions(
            ['UserCanViewFlows'],
            { siteRole: SiteRole.VIEWER },
            restApiArgs,
          ),
        ).resolves.toEqual({ registrationConditionsMet: true });
      });
    });

    it.each(ADMIN_SITE_ROLES)('allows %s without a visible flow', async (siteRole) => {
      getCurrentServerSession.mockResolvedValue(new Ok({ user: { siteRole } }));
      await expect(
        checkRegistrationConditions(['UserCanViewFlows'], {}, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
    });

    it.each([SiteRole.CREATOR, SiteRole.SITE_ADMINISTRATOR_CREATOR])(
      'reuses a previously fetched %s role',
      async (siteRole) => {
        const context: RegistrationContext = { siteRole };
        const result = await checkRegistrationConditions(
          ['UserCanViewFlows'],
          context,
          restApiArgs,
        );
        expect(result.registrationConditionsMet).toBe(
          siteRole === SiteRole.SITE_ADMINISTRATOR_CREATOR,
        );
        expect(getCurrentServerSession).not.toHaveBeenCalled();
      },
    );

    it.each([401, 403, 404, 500, undefined])(
      'fails closed without retries on HTTP %s',
      async (status) => {
        queryFlowsForSite.mockRejectedValue(
          new AxiosError(
            'probe failed',
            undefined,
            undefined,
            undefined,
            status === undefined ? undefined : ({ status } as AxiosResponse),
          ),
        );
        const context: RegistrationContext = { siteRole: SiteRole.SITE_ADMINISTRATOR_CREATOR };
        const result = await checkRegistrationConditions(
          ['UserCanViewFlows'],
          context,
          restApiArgs,
        );
        expect(result).toEqual({
          registrationConditionsMet: false,
          failingCondition: 'UserCanViewFlows',
          ...((status === undefined || status >= 500) && { indeterminate: true }),
        });
        await checkRegistrationConditions(['UserCanViewFlows'], context, restApiArgs);
        expect(queryFlowsForSite).toHaveBeenCalledTimes(1);
        expect(getCurrentServerSession).not.toHaveBeenCalled();
      },
    );

    it.each(['unauthorized', 'unknown'] as const)(
      'fails closed if the admin check is %s',
      async (type) => {
        getCurrentServerSession.mockResolvedValue(new Err({ type, message: 'unavailable' }));
        const context: RegistrationContext = {};
        const result = await checkRegistrationConditions(
          ['UserCanViewFlows'],
          context,
          restApiArgs,
        );
        expect(result.registrationConditionsMet).toBe(false);
        await checkRegistrationConditions(['UserCanViewFlows'], context, restApiArgs);
        expect(getCurrentServerSession).toHaveBeenCalledTimes(1);
      },
    );

    it('bounds the probe to five seconds and preserves caller cancellation', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      const caller = new AbortController();
      try {
        await checkRegistrationConditions(
          ['UserCanViewFlows'],
          {},
          { ...restApiArgs, signal: caller.signal },
        );
        expect(timeout).toHaveBeenCalledWith(5_000);
        const signal = mocks.useRestApi.mock.calls[0][0].signal as AbortSignal;
        expect(signal.aborted).toBe(false);
        caller.abort();
        expect(signal.aborted).toBe(true);
      } finally {
        timeout.mockRestore();
      }
    });
  });

  describe('RequiresKnowledge', () => {
    it('is met when the Knowledge graph endpoint is available and reuses the result', async () => {
      stubKnowledgeProbe([]);
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresKnowledge'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
      await checkRegistrationConditions(['RequiresKnowledge'], context, restApiArgs);

      expect(context.isKnowledgeAvailable).toBe(true);
      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
      expect(mocks.useRestApi).toHaveBeenCalledWith(
        expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
      );
    });

    it.each([
      ['the site is not entitled', 'site_not_entitled', 403],
      ['the caller lacks a Knowledge role', 'tableau_forbidden', 403],
      ['authentication fails', 'unauthorized', 401],
      ['the Knowledge endpoint is unavailable', 'not_found', 404],
    ])('is unmet without retrying when %s', async (_, code, status) => {
      stubKnowledgeProbe(
        new AxiosError(code, 'ERR_BAD_REQUEST', undefined, undefined, {
          status,
        } as AxiosResponse),
        true,
      );

      await expect(
        checkRegistrationConditions(['RequiresKnowledge'], {}, restApiArgs),
      ).resolves.toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresKnowledge',
      });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    });

    it('retries a transient failure and succeeds when the endpoint recovers', async () => {
      mocks.useRestApi
        .mockRejectedValueOnce(new Error('transient'))
        .mockImplementationOnce(async ({ callback }: { callback: (api: any) => unknown }) =>
          callback({ knowledgeMethods: { listGraphs: vi.fn().mockResolvedValue([]) } }),
        );

      const result = await resolveWithFakeTimers(() =>
        checkRegistrationConditions(['RequiresKnowledge'], {}, restApiArgs),
      );

      expect(result).toEqual({ registrationConditionsMet: true });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(2);
    });

    it('fails closed after exhausting transient failures', async () => {
      mocks.useRestApi.mockRejectedValue(new Error('network down'));
      const context: RegistrationContext = {};

      const result = await resolveWithFakeTimers(() =>
        checkRegistrationConditions(['RequiresKnowledge'], context, restApiArgs),
      );

      expect(result).toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresKnowledge',
        indeterminate: true,
      });
      expect(context.isKnowledgeAvailable).toBe(false);
      expect(mocks.useRestApi).toHaveBeenCalledTimes(MAX_API_RETRY_ATTEMPTS + 1);
    });
  });

  describe('RequiresPulse — Pulse enablement scenarios', () => {
    it('is met when the site has Pulse enabled and published definitions', async () => {
      stubPulseProbe(pulseDefinitionsPage(3));
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
      expect(context.isPulseEnabled).toBe(true);
    });

    it('is met when Pulse is enabled but the site has no definitions yet', async () => {
      // Availability is about whether the request cleared the site-settings interceptor, not about
      // whether anyone has authored a metric — a brand new Pulse site must still get the tools.
      stubPulseProbe(pulseDefinitionsPage(0));
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
      expect(context.isPulseEnabled).toBe(true);
    });

    it('is unmet when Pulse is disabled for the site', async () => {
      stubPulseProbe(new PulseDisabledError().toErr());
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: false, failingCondition: 'RequiresPulse' });
      expect(context.isPulseEnabled).toBe(false);
    });

    it('does not retry when Pulse is disabled — the answer is deterministic', async () => {
      stubPulseProbe(new PulseDisabledError().toErr());

      await checkRegistrationConditions(['RequiresPulse'], {}, restApiArgs);

      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    });

    it('is unmet when Pulse is not available on the deployment (Tableau Server)', async () => {
      stubPulseProbe(new PulseNotAvailableError().toErr());
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: false, failingCondition: 'RequiresPulse' });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    });

    it('resolves the capability once and reuses it for every tool declaring the condition', async () => {
      stubPulseProbe(pulseDefinitionsPage(1));
      const context: RegistrationContext = {};

      await checkRegistrationConditions(['RequiresPulse'], context, restApiArgs);
      await checkRegistrationConditions(['RequiresPulse'], context, restApiArgs);
      await checkRegistrationConditions(['RequiresPulse'], context, restApiArgs);

      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    });

    it('retries an indeterminate failure and is met once a retry succeeds', async () => {
      mocks.useRestApi
        .mockRejectedValueOnce(new Error('transient 1'))
        .mockRejectedValueOnce(new Error('transient 2'))
        .mockImplementationOnce(
          async ({ callback }: { callback: (api: any) => unknown }) =>
            await callback({
              pulseMethods: {
                listAllPulseMetricDefinitions: vi.fn().mockResolvedValue(pulseDefinitionsPage(2)),
              },
            }),
        );

      const result = await resolveWithFakeTimers(() =>
        checkRegistrationConditions(['RequiresPulse'], {}, restApiArgs),
      );

      expect(result).toEqual({ registrationConditionsMet: true });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(MAX_API_RETRY_ATTEMPTS + 1);
    });

    it('fails closed after exhausting retries when every attempt fails', async () => {
      mocks.useRestApi.mockRejectedValue(new Error('network down'));
      const context: RegistrationContext = {};

      const result = await resolveWithFakeTimers(() =>
        checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
      );

      expect(result).toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulse',
        indeterminate: true,
      });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(MAX_API_RETRY_ATTEMPTS + 1);
      // Memoized so the failure is not re-probed for every remaining Pulse tool.
      expect(context.isPulseEnabled).toBe(false);
    });

    it('does not retry a 4xx transport error (deterministic — retrying cannot help)', async () => {
      const forbidden = new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
      } as AxiosResponse);
      mocks.useRestApi.mockRejectedValue(forbidden);

      await expect(
        checkRegistrationConditions(['RequiresPulse'], {}, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: false, failingCondition: 'RequiresPulse' });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 4xx Pulse API error', async () => {
      stubPulseProbe(new PulseInsightsApiError('bad request', 400).toErr());

      await expect(
        checkRegistrationConditions(['RequiresPulse'], {}, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: false, failingCondition: 'RequiresPulse' });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    });

    it('retries a 5xx Pulse API error before failing closed', async () => {
      stubPulseProbe(new PulseInsightsApiError('upstream down', 503).toErr());

      const result = await resolveWithFakeTimers(() =>
        checkRegistrationConditions(['RequiresPulse'], {}, restApiArgs),
      );

      expect(result).toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulse',
        indeterminate: true,
      });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(MAX_API_RETRY_ATTEMPTS + 1);
    });
  });

  describe('RequiresPulsePremium', () => {
    it('is unmet without a second probe when Pulse itself is disabled', async () => {
      // Premium is a superset of base Pulse, so a Pulse-less site short-circuits on the base probe.
      stubPulseProbe(new PulseDisabledError().toErr());
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresPulsePremium'], context, restApiArgs),
      ).resolves.toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulsePremium',
      });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
      expect(context.isPulseEnabled).toBe(false);
    });

    it('is met when the site has the premium insights entitlement enabled', async () => {
      stubPulseProbe(
        pulseDefinitionsPage(1),
        entitlements({ [PULSE_PREMIUM_INSIGHTS_ENTITLEMENT]: true }),
      );
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresPulsePremium'], context, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
      expect(context.hasPulsePremium).toBe(true);
    });

    it('is unmet when the premium insights entitlement is reported disabled', async () => {
      stubPulseProbe(
        pulseDefinitionsPage(1),
        entitlements({ [PULSE_PREMIUM_INSIGHTS_ENTITLEMENT]: false }),
      );
      const context: RegistrationContext = {};

      await expect(
        checkRegistrationConditions(['RequiresPulsePremium'], context, restApiArgs),
      ).resolves.toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulsePremium',
      });
      expect(context.hasPulsePremium).toBe(false);
    });

    it('is unmet when the entitlement is absent from the response entirely', async () => {
      // The service normally returns every type, but a missing type must read as disabled rather
      // than as permission to register.
      stubPulseProbe(pulseDefinitionsPage(1), entitlements({}));

      await expect(
        checkRegistrationConditions(['RequiresPulsePremium'], {}, restApiArgs),
      ).resolves.toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulsePremium',
      });
    });

    it('does not treat a different premium entitlement as the insights entitlement', async () => {
      stubPulseProbe(
        pulseDefinitionsPage(1),
        entitlements({
          ENTITLEMENT_TYPE_PULSE_PREMIUM_CONSUMPTION: true,
          ENTITLEMENT_TYPE_PULSE_PREMIUM_SCALE: true,
          [PULSE_PREMIUM_INSIGHTS_ENTITLEMENT]: false,
        }),
      );

      await expect(
        checkRegistrationConditions(['RequiresPulsePremium'], {}, restApiArgs),
      ).resolves.toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulsePremium',
      });
    });

    it('reuses an already-resolved base Pulse capability and probes only entitlements', async () => {
      stubPulseProbe(
        pulseDefinitionsPage(1),
        entitlements({ [PULSE_PREMIUM_INSIGHTS_ENTITLEMENT]: true }),
      );
      const context: RegistrationContext = { isPulseEnabled: true };

      await checkRegistrationConditions(['RequiresPulsePremium'], context, restApiArgs);

      expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    });

    it('costs one probe per capability when a tool declares both conditions', async () => {
      stubPulseProbe(
        pulseDefinitionsPage(1),
        entitlements({ [PULSE_PREMIUM_INSIGHTS_ENTITLEMENT]: true }),
      );

      await expect(
        checkRegistrationConditions(['RequiresPulse', 'RequiresPulsePremium'], {}, restApiArgs),
      ).resolves.toEqual({ registrationConditionsMet: true });
      // One Pulse probe plus one entitlements probe — the base capability is not re-resolved.
      expect(mocks.useRestApi).toHaveBeenCalledTimes(2);
    });

    it('fails closed when the entitlements lookup keeps failing', async () => {
      // Notably the case where the deployment has not granted `tableau:entitlements:read`.
      stubPulseProbe(
        pulseDefinitionsPage(1),
        new PulseInsightsApiError('upstream down', 503).toErr(),
      );
      const context: RegistrationContext = {};

      const result = await resolveWithFakeTimers(() =>
        checkRegistrationConditions(['RequiresPulsePremium'], context, restApiArgs),
      );

      expect(result).toEqual({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulsePremium',
        indeterminate: true,
      });
      expect(context.hasPulsePremium).toBe(false);
    });
  });
});

describe('getUnmetConditionInstructions', () => {
  it('explains that Knowledge is unavailable without blaming a missing Tableau+ entitlement', async () => {
    const message = getUnmetConditionInstructions('RequiresKnowledge');

    expect(message).toContain('Tableau Knowledge');
    expect(message).toContain(
      'NOTE: Tableau Knowledge tools were omitted because they could not be confirmed as available.',
    );
    expect(message).toContain('The site may not have Tableau Knowledge, or the check was denied.');
    expect(message).toContain(
      'explain that Tableau Knowledge is not available in this session and suggest they contact ' +
        'their Tableau administrator.',
    );
    // A 401/403 probe on an entitled site lands here too, so the note must not assert a missing entitlement.
    expect(message).not.toContain('Tableau+');
  });

  it('explains that Pulse is not available and points at Cloud setup guidance', async () => {
    const message = getUnmetConditionInstructions('RequiresPulse');

    // Kept generic — Pulse can be unavailable for site, user, or Server reasons.
    expect(message).toContain('Pulse is not available');
    expect(message).not.toContain('not enabled for this site');
    expect(message).toContain('https://help.tableau.com/current/online/en-us/pulse_set_up.htm');
  });

  it('explains that the Tableau+ entitlement could not be confirmed, without claiming the site lacks it', async () => {
    const message = getUnmetConditionInstructions('RequiresPulsePremium');

    expect(message).toContain('Tableau+');
    expect(message).toContain('could not be confirmed');
    expect(message).toContain('the check was denied');
    expect(message).toContain('contact their Tableau administrator');
    expect(message).not.toContain('does not have the Tableau+ entitlement');
  });

  it('describes a missing condition check as an unimplemented check, without a reconnect suggestion', async () => {
    const message = getUnmetConditionInstructions('MissingConditionCheck');

    expect(message).toContain('not implemented');
    expect(message).not.toContain('Disconnect and reconnect');
    expect(message).not.toContain('Tableau+');
  });
});
