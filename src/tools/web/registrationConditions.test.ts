import { AxiosError, AxiosResponse } from 'axios';
import { Ok } from 'ts-results-es';

import {
  PulseDisabledError,
  PulseInsightsApiError,
  PulseNotAvailableError,
} from '../../errors/mcpToolError.js';
import { RestApiArgs } from '../../restApiInstance.js';
import { PULSE_PREMIUM_INSIGHTS_ENTITLEMENT } from '../../sdks/tableau/types/pulse.js';
import {
  checkRegistrationConditions,
  getUnmetConditionInstructions,
  MAX_PULSE_PROBE_ATTEMPTS,
  RegistrationCondition,
  RegistrationContext,
} from './registrationConditions.js';

const mocks = vi.hoisted(() => ({
  useRestApi: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: mocks.useRestApi,
}));

// The Pulse probe is reached through the mocked useRestApi, so a minimal stub is sufficient here.
const restApiArgs = {} as unknown as RestApiArgs;

/** A successful `listAllPulseMetricDefinitions` page. An empty site still means Pulse is enabled. */
function pulseDefinitionsPage(definitionCount = 0): Ok<unknown> {
  return new Ok({
    pagination: { next_page_token: undefined, offset: 0, total_available: definitionCount },
    definitions: Array.from({ length: definitionCount }, (_, i) => ({
      metadata: { name: `m${i}` },
    })),
  });
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
      expect(mocks.useRestApi).toHaveBeenCalledTimes(MAX_PULSE_PROBE_ATTEMPTS);
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
      });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(MAX_PULSE_PROBE_ATTEMPTS);
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
      });
      expect(mocks.useRestApi).toHaveBeenCalledTimes(MAX_PULSE_PROBE_ATTEMPTS);
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
      });
      expect(context.hasPulsePremium).toBe(false);
    });
  });
});

describe('getUnmetConditionInstructions', () => {
  it('explains that Pulse is not enabled and how to enable it', async () => {
    const message = getUnmetConditionInstructions('RequiresPulse');

    expect(message).toContain('Pulse');
    expect(message).toContain('not enabled');
    // The client-facing copy must point somewhere actionable rather than just stating the failure.
    expect(message).toContain('https://help.tableau.com/current/online/en-us/pulse_set_up.htm');
  });

  it('explains that AI insights require the Tableau+ entitlement', async () => {
    const message = getUnmetConditionInstructions('RequiresPulsePremium');

    expect(message).toContain('Tableau+');
    expect(message).toContain('insight');
  });

  it('describes a missing condition check as a server-side defect, not a permissions problem', async () => {
    const message = getUnmetConditionInstructions('MissingConditionCheck');

    expect(message).toContain('server-side defect');
    expect(message).not.toContain('Tableau+');
  });
});
