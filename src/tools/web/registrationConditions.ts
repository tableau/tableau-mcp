import { RestApiArgs } from '../../restApiInstance.js';

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
          context.hasPulsePremium = await checkPulsePremium(restApiArgs);
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
 * Whether Pulse is enabled for the caller's site.
 *
 * TODO(pulse): implement the Tableau REST lookup (near-term roadmap). Model it on
 * {@link getCurrentUserSiteRole} — fetch via `useRestApi(restApiArgs)` and fail closed on error.
 * Until then this returns `false`, so any tool declaring `RequiresPulse` is hidden rather than
 * exposed.
 */
async function checkPulseEnabled(_restApiArgs: RestApiArgs): Promise<boolean> {
  return false;
}

/**
 * Whether the caller's site has the Pulse premium entitlement.
 *
 * TODO(pulse): implement the entitlement lookup (near-term roadmap). Returns `false` until then, so
 * `RequiresPulsePremium` is fail-closed.
 */
async function checkPulsePremium(_restApiArgs: RestApiArgs): Promise<boolean> {
  return false;
}
