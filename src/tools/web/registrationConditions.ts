import { isAxiosError } from 'axios';

import {
  McpToolError,
  PulseDisabledError,
  PulseNotAvailableError,
} from '../../errors/mcpToolError.js';
import { RestApiArgs, useRestApi } from '../../restApiInstance.js';
import { PULSE_PREMIUM_INSIGHTS_ENTITLEMENT } from '../../sdks/tableau/types/pulse.js';
import { retry } from '../../utils/retry.js';

/**
 * A capability a tool can require at registration time to be verified by {@link checkRegistrationConditions}.
 */
export type RegistrationCondition =
  | 'RequiresPulse'
  | 'RequiresPulsePremium'
  | 'MissingConditionCheck';

/**
 * Context to be populated during tool registration. Useful for storing
 * information on a session / role so that information does not need to be refetched.
 */
export type RegistrationContext = {
  siteRole?: string;
  isPulseEnabled?: boolean;
  hasPulsePremium?: boolean;
};

type ConditionsCheckResult =
  | {
      registrationConditionsMet: true;
    }
  | {
      registrationConditionsMet: false;
      failingCondition: RegistrationCondition;
    };

/**
 * True only when every condition in `conditions` is satisfied for the current caller.
 * Fail-closed: an unrecognized condition, or a capability that cannot be confirmed, returns falsy result
 *
 * `context` is mutated in place to memoize each capability, so it is looked up at most once per
 * registration pass even when many tools declare the same condition. If the context for a condition
 * has not been initialized, populate the context. If an undefined context value
 * has its own interpretation (e.g. condition check failed), then use `Object.hasOwn` method to determine
 * if the context was initialized instead of rechecking condition.
 */
export async function checkRegistrationConditions(
  conditions: ReadonlyArray<RegistrationCondition>,
  context: RegistrationContext,
  restApiArgs: RestApiArgs,
): Promise<ConditionsCheckResult> {
  for (const condition of conditions) {
    switch (condition) {
      case 'RequiresPulse': {
        if (context.isPulseEnabled === undefined) {
          context.isPulseEnabled = await checkPulseEnabled(restApiArgs);
        }
        if (!context.isPulseEnabled) {
          return { registrationConditionsMet: false, failingCondition: 'RequiresPulse' };
        }
        continue;
      }
      case 'RequiresPulsePremium': {
        if (context.hasPulsePremium === undefined) {
          context.hasPulsePremium = await checkPulsePremium(restApiArgs, context);
        }
        if (!context.hasPulsePremium) {
          return { registrationConditionsMet: false, failingCondition: 'RequiresPulsePremium' };
        }
        continue;
      }
      default: {
        // guard: a RegistrationCondition without a case above results in a
        // missing condition check failure and all tools associated with the condition will
        // not be registered.
        return { registrationConditionsMet: false, failingCondition: 'MissingConditionCheck' };
      }
    }
  }

  return { registrationConditionsMet: true };
}

/**
 * Client-facing explanation for each condition, appended to the initialize instructions when that
 * condition hid at least one tool. Registration runs before the transport connects, so the
 * instructions are the only channel that reaches the user — without this the caller just sees a
 * short tool list with no explanation.
 *
 * Typed as a total `Record` so adding a {@link RegistrationCondition} without user-facing copy is
 * a compile error rather than a silent omission.
 */
const UNMET_CONDITION_INSTRUCTIONS: Record<RegistrationCondition, string> = {
  RequiresPulse:
    'NOTE: Tableau Pulse tools were omitted from this session because Pulse is not enabled for ' +
    'this site. Pulse is available on Tableau Cloud and must be turned on by a site ' +
    'administrator — see https://help.tableau.com/current/online/en-us/pulse_set_up.htm. Do not ' +
    'offer Pulse metrics or insights; if the user asks for them, explain that Pulse is not ' +
    'enabled and suggest they contact their Tableau administrator.',
  RequiresPulsePremium:
    'NOTE: AI-powered Tableau Pulse insight tools were omitted from this session because this ' +
    'site does not have the Tableau+ entitlement those insights require. Basic Pulse metric ' +
    'tools may still be available. Do not offer AI-generated Pulse insights or briefs; if the ' +
    'user asks for them, explain that the feature requires Tableau+.',
  MissingConditionCheck:
    'WARNING: Some tools were omitted from this session because a required capability check ' +
    'could not be evaluated. This is a server-side defect rather than a permissions or licensing ' +
    'problem. Disconnect and reconnect to retry; if it persists, report it to your Tableau ' +
    'administrator.',
};

/** The client-facing explanation to surface when `condition` hid one or more tools. */
export function getUnmetConditionInstructions(condition: RegistrationCondition): string {
  return UNMET_CONDITION_INSTRUCTIONS[condition];
}

/** Total number of Pulse probe attempts (1 initial + {@link MAX_PULSE_PROBE_ATTEMPTS}-1 retries). */
export const MAX_PULSE_PROBE_ATTEMPTS = 3;

/**
 * Whether a failed capability probe is worth retrying.
 *
 * A 4xx is a deterministic answer ("not allowed", "not found") that retrying cannot change, so we
 * fail fast rather than delaying registration for every caller on a Pulse-less site. Mirrors the
 * retry predicate in {@link getCurrentUserSiteRole}, but also understands {@link McpToolError},
 * which is what the Pulse methods return rather than a raw `AxiosError`.
 */
function isRetryableProbeError(error: unknown): boolean {
  if (error instanceof McpToolError) {
    return !(error.statusCode >= 400 && error.statusCode < 500);
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined && status >= 400 && status < 500) {
      return false;
    }
  }

  return true;
}

/**
 * Whether Pulse is enabled for the caller's site.
 *
 * There is no endpoint that reports Pulse availability directly, so this probes the cheapest Pulse
 * read there is — a single-item page of metric definitions — and classifies the outcome. What
 * matters is only whether the request cleared the site-settings interceptor, not what came back: a
 * site with zero definitions is still Pulse-enabled.
 *
 * Fail-closed: an indeterminate outcome (transient API error, exhausted retries, failed sign-in)
 * returns `false`, so a tool declaring `RequiresPulse` is hidden rather than exposed.
 */
async function checkPulseEnabled(restApiArgs: RestApiArgs): Promise<boolean> {
  try {
    return await retry(
      () =>
        useRestApi({
          ...restApiArgs,
          jwtScopes: ['tableau:insight_definitions_metrics:read'],
          callback: async (restApi) => {
            const result = await restApi.pulseMethods.listAllPulseMetricDefinitions(
              undefined,
              undefined,
              1,
            );

            if (result.isOk()) {
              return true;
            }

            // Both of these are definitive "Pulse is not usable here" answers rather than
            // failures: the site setting is off, or this is Tableau Server, where Pulse
            // does not exist. Returning resolves the probe, so no retry is attempted.
            if (
              result.error instanceof PulseDisabledError ||
              result.error instanceof PulseNotAvailableError
            ) {
              return false;
            }

            // Anything else is indeterminate. Throw so `retry` can attempt again; exhausting
            // retries falls through to the fail-closed catch below.
            throw result.error;
          },
        }),
      {
        maxRetries: MAX_PULSE_PROBE_ATTEMPTS - 1,
        retryIf: isRetryableProbeError,
      },
    );
  } catch {
    // Retries exhausted or a non-retryable error was thrown — fail closed.
    return false;
  }
}

/**
 * Whether the caller's site has the Pulse premium (Tableau+) entitlement for AI-powered insights.
 *
 * Premium is a superset of base Pulse, so this short-circuits on the base probe first — memoized
 * via `context`, so a tool declaring both conditions costs one Pulse probe, not two.
 *
 * Reads the site's entitlements directly. The service returns every known entitlement type with a
 * boolean and substitutes an all-false response when its own upstream lookup fails, so a missing
 * or absent entitlement is treated as disabled.
 *
 * Note on scopes: this requests `tableau:entitlements:read`, and a Connected App rejects a JWT
 * mint that asks for a scope it has not granted. A deployment that enables
 * `enforce-registration-conditions` must therefore grant that scope, or the probe fails closed and
 * hides the premium tools. That is why the condition is only consulted for tools that declare it.
 */
async function checkPulsePremium(
  restApiArgs: RestApiArgs,
  context: RegistrationContext,
): Promise<boolean> {
  if (context.isPulseEnabled === undefined) {
    context.isPulseEnabled = await checkPulseEnabled(restApiArgs);
  }

  if (!context.isPulseEnabled) {
    return false;
  }

  try {
    return await retry(
      () =>
        useRestApi({
          ...restApiArgs,
          jwtScopes: ['tableau:entitlements:read'],
          callback: async (restApi) => {
            const result = await restApi.pulseMethods.getPulseEntitlements();

            if (result.isOk()) {
              return result.value.some(
                (entitlement) =>
                  entitlement.entitlement_type === PULSE_PREMIUM_INSIGHTS_ENTITLEMENT &&
                  entitlement.enabled === true,
              );
            }

            if (
              result.error instanceof PulseDisabledError ||
              result.error instanceof PulseNotAvailableError
            ) {
              return false;
            }

            throw result.error;
          },
        }),
      {
        maxRetries: MAX_PULSE_PROBE_ATTEMPTS - 1,
        retryIf: isRetryableProbeError,
      },
    );
  } catch {
    // Retries exhausted or a non-retryable error was thrown — fail closed.
    return false;
  }
}
