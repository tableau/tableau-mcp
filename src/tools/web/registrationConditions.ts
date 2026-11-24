import { isAxiosError } from 'axios';

import {
  McpToolError,
  PulseDisabledError,
  PulseNotAvailableError,
} from '../../errors/mcpToolError.js';
import { RestApiArgs, useRestApi } from '../../restApiInstance.js';
import type { Flow } from '../../sdks/tableau/types/flow.js';
import { PULSE_PREMIUM_INSIGHTS_ENTITLEMENT } from '../../sdks/tableau/types/pulse.js';
import { isAdminSiteRole } from '../../sdks/tableau/types/user.js';
// Type-only: erased at compile time, so scopes.ts can import the value map below without a
// runtime import cycle.
import type { TableauApiScope } from '../../server/oauth/scopes.js';
import { retry } from '../../utils/retry.js';

/**
 * A capability a tool can require at registration time to be verified by {@link checkRegistrationConditions}.
 *
 * Adding a new registration condition - Step 1: add condition string to RegistrationCondition type,
 * then add or update the `registrationConditions` property for all the tools the condition should apply to.
 */
export type RegistrationCondition =
  | 'UserCanViewFlows'
  | 'RequiresKnowledge'
  | 'RequiresPulse'
  | 'RequiresPulsePremium'
  | 'MissingConditionCheck';

/**
 * Map of registration conditions to the JWT scopes needed for checking said condition.
 *
 * Each tool that requires registration conditions must also add the associated scopes to the
 * `toolScopeMap` in scopes.ts
 */
export const REGISTRATION_CONDITION_API_SCOPES: Record<
  RegistrationCondition,
  ReadonlyArray<TableauApiScope>
> = {
  UserCanViewFlows: ['tableau:flows:read'],
  RequiresKnowledge: ['tableau:knowledge:read'],
  RequiresPulse: ['tableau:insight_definitions_metrics:read'],
  RequiresPulsePremium: ['tableau:entitlements:read'],
  MissingConditionCheck: [],
};

/**
 * Context to be populated during tool registration. Useful for storing
 * information on a session / role so that information does not need to be refetched.
 */
export type RegistrationContext = {
  siteRole?: string;
  userCanViewFlows?: boolean;
  isKnowledgeAvailable?: boolean;
  isPulseEnabled?: boolean;
  hasPulsePremium?: boolean;
  // Conditions whose probe failed transiently; a retry could change the answer.
  indeterminateConditions?: Set<RegistrationCondition>;
};

type ConditionsCheckResult =
  | {
      registrationConditionsMet: true;
    }
  | {
      registrationConditionsMet: false;
      failingCondition: RegistrationCondition;
      // True when the probe failed transiently rather than answering "not available".
      indeterminate?: boolean;
    };

/**
 * True only when every condition in `conditions` is satisfied for the current caller.
 * Fail-closed: an unrecognized condition, or a capability that cannot be confirmed, returns an unmet
 * result; a transient probe failure is also flagged `indeterminate` so callers can retry.
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
      case 'UserCanViewFlows': {
        if (context.userCanViewFlows === undefined) {
          context.userCanViewFlows = recordProbe(
            context,
            'UserCanViewFlows',
            await checkFlowsAvailable(restApiArgs, context),
          );
        }
        if (!context.userCanViewFlows) {
          return unmet(context, 'UserCanViewFlows');
        }
        continue;
      }
      case 'RequiresKnowledge': {
        if (context.isKnowledgeAvailable === undefined) {
          context.isKnowledgeAvailable = recordProbe(
            context,
            'RequiresKnowledge',
            await checkKnowledgeAvailable(restApiArgs),
          );
        }
        if (!context.isKnowledgeAvailable) {
          return unmet(context, 'RequiresKnowledge');
        }
        continue;
      }
      case 'RequiresPulse': {
        if (context.isPulseEnabled === undefined) {
          context.isPulseEnabled = recordProbe(
            context,
            'RequiresPulse',
            await checkPulseEnabled(restApiArgs),
          );
        }
        if (!context.isPulseEnabled) {
          return unmet(context, 'RequiresPulse');
        }
        continue;
      }
      case 'RequiresPulsePremium': {
        if (context.hasPulsePremium === undefined) {
          context.hasPulsePremium = recordProbe(
            context,
            'RequiresPulsePremium',
            await checkPulsePremium(restApiArgs, context),
          );
        }
        if (!context.hasPulsePremium) {
          return unmet(context, 'RequiresPulsePremium');
        }
        continue;
      }
      /**
       * Adding a new registration condition - Step 2: Add a case for checking new condition above.
       * Update `REGISTRATION_CONDITION_API_SCOPES` with any JWT scopes required for checking the new condition.
       * After checking a condition, populate the `context` object to prevent the same condition from being rechecked with each pass.
       * See `getCurrentUserSiteRole` or above functions for examples on checking conditions.
       */
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

// A probe returns undefined when it could not be confirmed (transient failure).
function recordProbe(
  context: RegistrationContext,
  condition: RegistrationCondition,
  result: boolean | undefined,
): boolean {
  if (result === undefined) {
    (context.indeterminateConditions ??= new Set()).add(condition);
    return false;
  }
  return result;
}

function unmet(
  context: RegistrationContext,
  condition: RegistrationCondition,
): ConditionsCheckResult {
  return {
    registrationConditionsMet: false,
    failingCondition: condition,
    ...(context.indeterminateConditions?.has(condition) && { indeterminate: true }),
  };
}

/**
 * Client-facing explanation for each condition, appended to the initialize instructions when that
 * condition hid at least one tool. Registration runs before the transport connects, so the
 * instructions are the only channel that reaches the user — without this the caller just sees a
 * short tool list with no explanation.
 *
 * Typed as a total `Record` so adding a {@link RegistrationCondition} without user-facing copy is
 * a compile error rather than a silent omission.
 *
 * Adding a new registration condition - Step 3: append an initialization message to inform clients
 * that some tools were omitted due to an unmet registration condition.
 */
const UNMET_CONDITION_INSTRUCTIONS: Record<RegistrationCondition, string> = {
  UserCanViewFlows:
    'NOTE: Tableau Flow tools were omitted because access to a visible flow or administrator access ' +
    'could not be confirmed. Ask your Tableau administrator about access to flows, ' +
    'then reconnect to check again.',
  // Kept generic: the probe cannot tell a site without Knowledge from a denied check.
  RequiresKnowledge:
    'NOTE: Tableau Knowledge tools were omitted because they could not be confirmed as ' +
    'available. The site may not have Tableau Knowledge, or the check was denied. If the user ' +
    'asks for Knowledge context, explain that Tableau Knowledge is not available in this session ' +
    'and suggest they contact their Tableau administrator.',
  // Kept generic: Pulse can be unavailable for several reasons (Tableau Server, site setting
  // off, or a user-level preference), and the probe cannot distinguish them cleanly enough to
  // name a single cause here.
  RequiresPulse:
    'NOTE: Tableau Pulse tools were omitted from this session because Pulse is not available. ' +
    'Do not offer Pulse metrics or insights; if the user asks for them, explain that Pulse is ' +
    'not available and suggest they contact their Tableau administrator. For setup guidance ' +
    'on Tableau Cloud, see https://help.tableau.com/current/online/en-us/pulse_set_up.htm.',
  // Kept generic: the probe cannot tell a site without Tableau+ from a denied check.
  RequiresPulsePremium:
    'NOTE: AI-powered Tableau Pulse insight tools were omitted from this session because the ' +
    'Tableau+ entitlement could not be confirmed. The site may not have Tableau+, or the check ' +
    'was denied. Basic Pulse metric tools may still be available. Do not offer AI-generated ' +
    'Pulse insights or briefs; if the user asks for them, explain that they are not available ' +
    'in this session and suggest they contact their Tableau administrator.',
  // Developer-facing only: reached when a RegistrationCondition is declared on a tool but has
  // no corresponding case in checkRegistrationConditions. Reconnecting cannot help.
  MissingConditionCheck:
    'WARNING: Some tools were omitted from this session because a required registration ' +
    'condition check is not implemented.',
};

const CONDITION_TOOL_LABELS: Record<RegistrationCondition, string> = {
  UserCanViewFlows: 'Flow',
  RequiresKnowledge: 'Knowledge',
  RequiresPulse: 'Pulse',
  RequiresPulsePremium: 'AI-powered Pulse insight',
  MissingConditionCheck: 'some',
};

/** The warning to surface when a transient probe failure hid tools for `condition`. */
export function getIndeterminateConditionWarning(
  condition: RegistrationCondition,
  retryAdvice: string,
): string {
  return (
    `WARNING: Tableau ${CONDITION_TOOL_LABELS[condition]} tools were omitted from this session ` +
    `because their availability could not be confirmed. This is likely a transient error. ${retryAdvice}`
  );
}

/** The client-facing explanation to surface when `condition` hid one or more tools. */
export function getUnmetConditionInstructions(condition: RegistrationCondition): string {
  return UNMET_CONDITION_INSTRUCTIONS[condition];
}

/** Number of retries for API calls for a condition check (1 initial attempt + {@link MAX_API_RETRY_ATTEMPTS} retries = 3 total attempts). */
export const MAX_API_RETRY_ATTEMPTS = 2;

/**
 * Publishing writes the seed again ~50 ms after creating it, and the REST API rounds to whole
 * seconds, so an untouched seed is 0 or 1 second apart (99.7% of Cloud seeds; the rest were edited).
 */
const SEED_MAX_UPDATE_LAG_MS = 1_000;

/**
 * Whether `flow` looks like the sample flow seeded when a site is provisioned. The name is not
 * localized, but customers can publish the same sample themselves, so also require an untouched
 * `.tflx`. Missing or unparseable fields mean "not the seed": it errs toward counting a flow.
 */
function isSeededSampleFlow(flow: Flow): boolean {
  if (flow.name !== 'Superstore Flow' || flow.fileType !== 'tflx') return false;
  if (flow.createdAt === undefined || flow.updatedAt === undefined) return false;

  const lagMs = Date.parse(flow.updatedAt) - Date.parse(flow.createdAt);
  return lagMs >= 0 && lagMs <= SEED_MAX_UPDATE_LAG_MS;
}

/**
 * One single-item visible-flow query, with no retries or pagination. A site's only flow being the
 * seeded sample counts as no flow, so it does not enable Flow tools for everyone. Admins need not
 * have flows.
 */
async function checkFlowsAvailable(
  restApiArgs: RestApiArgs,
  context: RegistrationContext,
): Promise<boolean | undefined> {
  try {
    return await useRestApi({
      ...restApiArgs,
      signal: AbortSignal.any([restApiArgs.signal, AbortSignal.timeout(5_000)]),
      jwtScopes: REGISTRATION_CONDITION_API_SCOPES.UserCanViewFlows,
      callback: async (restApi) => {
        const { flows, pagination } = await restApi.flowsMethods.queryFlowsForSite({
          siteId: restApi.siteId,
          pageSize: 1,
        });
        const onlyTheSeededSample =
          flows.length === 1 && pagination.totalAvailable === 1 && isSeededSampleFlow(flows[0]);
        if (flows.length > 0 && !onlyTheSeededSample) return true;

        if (!Object.hasOwn(context, 'siteRole')) {
          const session = await restApi.authenticatedServerMethods.getCurrentServerSession();
          if (session.isErr()) {
            return session.error.type === 'unauthorized' ? false : undefined;
          }
          context.siteRole = session.value.user.siteRole;
        }
        return isAdminSiteRole(context.siteRole);
      },
    });
  } catch (error) {
    return isRetryableProbeError(error) ? undefined : false;
  }
}

/** `listGraphs` is available to every Knowledge read role and succeeds for an entitled empty site. */
async function checkKnowledgeAvailable(restApiArgs: RestApiArgs): Promise<boolean | undefined> {
  try {
    return await retry(
      () =>
        useRestApi({
          ...restApiArgs,
          jwtScopes: REGISTRATION_CONDITION_API_SCOPES.RequiresKnowledge,
          callback: async (restApi) => {
            await restApi.knowledgeMethods.listGraphs();
            return true;
          },
        }),
      {
        maxRetries: MAX_API_RETRY_ATTEMPTS,
        retryIf: isRetryableProbeError,
      },
    );
  } catch (error) {
    return isRetryableProbeError(error) ? undefined : false;
  }
}

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
 * returns `undefined`, so a tool declaring `RequiresPulse` is hidden rather than exposed, and the
 * caller can tell it apart from a definitive `false`.
 */
async function checkPulseEnabled(restApiArgs: RestApiArgs): Promise<boolean | undefined> {
  try {
    return await retry(
      () =>
        useRestApi({
          ...restApiArgs,
          jwtScopes: REGISTRATION_CONDITION_API_SCOPES.RequiresPulse,
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
        maxRetries: MAX_API_RETRY_ATTEMPTS,
        retryIf: isRetryableProbeError,
      },
    );
  } catch (error) {
    // Retries exhausted on a retryable error is inconclusive; a 4xx is a definitive no.
    return isRetryableProbeError(error) ? undefined : false;
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
): Promise<boolean | undefined> {
  if (context.isPulseEnabled === undefined) {
    context.isPulseEnabled = recordProbe(
      context,
      'RequiresPulse',
      await checkPulseEnabled(restApiArgs),
    );
  }

  if (!context.isPulseEnabled) {
    // Premium is unknown, not absent, when the base Pulse probe was inconclusive.
    return context.indeterminateConditions?.has('RequiresPulse') ? undefined : false;
  }

  try {
    return await retry(
      () =>
        useRestApi({
          ...restApiArgs,
          jwtScopes: REGISTRATION_CONDITION_API_SCOPES.RequiresPulsePremium,
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
        maxRetries: MAX_API_RETRY_ATTEMPTS,
        retryIf: isRetryableProbeError,
      },
    );
  } catch (error) {
    // Retries exhausted on a retryable error is inconclusive; a 4xx is a definitive no.
    return isRetryableProbeError(error) ? undefined : false;
  }
}
