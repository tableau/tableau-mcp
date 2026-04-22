import { ProcessEnvEx } from '../types/process-env.js';
import { removeClaudeMcpBundleUserConfigTemplates } from './config.js';
import { isToolGroupName, isToolName, toolGroups, ToolName } from './tools/toolName.js';

const overridableVariables = [
  'ALLOWED_REQUEST_OVERRIDES',
  'INCLUDE_TOOLS',
  'EXCLUDE_TOOLS',
  'INCLUDE_PROJECT_IDS',
  'INCLUDE_DATASOURCE_IDS',
  'INCLUDE_WORKBOOK_IDS',
  'INCLUDE_TAGS',
  'MAX_RESULT_LIMIT',
  'MAX_RESULT_LIMITS',
  'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS',
  'DISABLE_METADATA_API_REQUESTS',
] as const satisfies ReadonlyArray<keyof ProcessEnvEx>;

const requestOverridableVariables = overridableVariables.filter(
  (v) => v !== 'ALLOWED_REQUEST_OVERRIDES' && v !== 'INCLUDE_TOOLS' && v !== 'EXCLUDE_TOOLS',
);

type OverridableVariable = (typeof overridableVariables)[number];
type RequestOverridableVariable = (typeof requestOverridableVariables)[number];

export function isOverridableVariable(variable: unknown): variable is OverridableVariable {
  return overridableVariables.some((v) => v === variable);
}

export function isRequestOverridableVariable(
  variable: unknown,
): variable is RequestOverridableVariable {
  return requestOverridableVariables.some((v) => v === variable);
}

export type BoundedContext = {
  projectIds: Set<string> | null;
  datasourceIds: Set<string> | null;
  workbookIds: Set<string> | null;
  tags: Set<string> | null;
};

type RequestOverrideRestrictionType = 'restricted' | 'unrestricted';

export class OverridableConfig {
  private maxResultLimit: number | null;
  private maxResultLimits: Map<ToolName, number | null>;

  allowedRequestOverrides: Map<RequestOverridableVariable, RequestOverrideRestrictionType>;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;

  boundedContext: BoundedContext;

  disableQueryDatasourceValidationRequests: boolean;
  disableMetadataApiRequests: boolean;

  /**
   * General pattern for overriding variables:
   * 1. Initialize the value of a given variable using the ENVIRONMENT (process.env). Throw if any issues with ENVIORNMENT values / unallowed behavior.
   * 2. Using the Object.hasOwn() method, check if the given variable exists as a property in the siteOverrides object.
   *    Only when the variable is a property in the siteOverrides object, apply the following logic:
   *      a. If the site override value is an empty string or undefined, we generally revert the variable to its default value / behavior
   *         (each variable is different, so consider what makes the most sense for this case).
   *      b. If the site override value is invalid, do not throw. Either fallback to the value of the ENVIRONMENT or
   *         revert the value of the variable to its default value / behavior (similar to the empty string / undefined case).
   *      c. If the site override value is valid, replace the value of the given variable with its value from the site override.
   * 3. Using the Object.hasOwn() method, check if the given variable exists as a property in the requestOverrides object.
   *    Only when the variable is a property in the requestOverrides object, apply the following logic:
   *      a. If the request override variable is not listed as an allowed request override, throw an error.
   *      b. If the request override value is an empty string, we generally revert the variable to its default value / behavior;
   *         however, determine if the override behavior conforms to any restrictions imposed on it and throw if it does not.
   *      c. If the request override value is invalid, throw an error.
   *      d. If the request override value is valid, determine if the override conforms to any restrictions imposed on it and throw if it does not.
   *         Replace the value of the given variable with its value from the request override if it does not violate any restrictions.
   */
  constructor(
    siteOverrides: Record<string, string> = {},
    requestOverrides: Record<string, string> = {},
  ) {
    const envVariables = removeClaudeMcpBundleUserConfigTemplates({ ...process.env });
    if (envVariables.ENABLE_MCP_SITE_SETTINGS === 'false') {
      siteOverrides = {};
    }

    // ALLOWED_REQUEST_OVERRIDES
    this.allowedRequestOverrides = this.getAllowedRequestOverrides(envVariables, requestOverrides);

    // INCLUDE_TOOLS, EXCLUDE_TOOLS
    const { includeTools, excludeTools } = this.getToolsWithOverrides(envVariables, siteOverrides);
    this.includeTools = includeTools;
    this.excludeTools = excludeTools;

    // INCLUDE_PROJECT_IDS, INCLUDE_DATASOURCE_IDS, INCLUDE_WORKBOOK_IDS, INCLUDE_TAGS
    this.boundedContext = this.getBoundedContextWithOverrides(
      envVariables,
      siteOverrides,
      requestOverrides,
    );

    // DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS
    this.disableQueryDatasourceValidationRequests = this.getBooleanVariableWithOverrides(
      'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS',
      envVariables,
      siteOverrides,
      requestOverrides,
      false, // default value
      true, // allowed value when restricted
    );

    // DISABLE_METADATA_API_REQUESTS
    this.disableMetadataApiRequests = this.getBooleanVariableWithOverrides(
      'DISABLE_METADATA_API_REQUESTS',
      envVariables,
      siteOverrides,
      requestOverrides,
      false, // default value
      true, // allowed value when restricted
    );

    // MAX_RESULT_LIMIT
    this.maxResultLimit = this.getMaxResultLimitWithOverrides(
      envVariables,
      siteOverrides,
      requestOverrides,
    );

    // MAX_RESULT_LIMITS
    this.maxResultLimits = this.getMaxResultLimitsWithOverrides(
      envVariables,
      siteOverrides,
      requestOverrides,
    );
  }

  getAllowedRequestOverrides(
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string> = {},
  ): Map<RequestOverridableVariable, RequestOverrideRestrictionType> {
    let allowedRequestOverrides: Map<RequestOverridableVariable, RequestOverrideRestrictionType> =
      new Map();
    // Initializing allowed request overrides from environment variables
    if (envVariables.ALLOWED_REQUEST_OVERRIDES) {
      envVariables.ALLOWED_REQUEST_OVERRIDES.split(',').forEach((entry) => {
        const [variable, restrictionType = 'restricted'] = entry.split(':');
        if (restrictionType !== 'restricted' && restrictionType !== 'unrestricted') {
          throw new Error(
            `ALLOWED_REQUEST_OVERRIDES provides invalid restriction type: ${restrictionType}`,
          );
        }
        if (variable === '*') {
          requestOverridableVariables.forEach((v) => {
            allowedRequestOverrides.set(v, restrictionType);
          });
        } else if (isRequestOverridableVariable(variable)) {
          allowedRequestOverrides.set(variable, restrictionType);
        } else {
          throw new Error(
            `ALLOWED_REQUEST_OVERRIDES contains a request override variable that is not recognized: ${variable}`,
          );
        }
      });
    }
    // Applying site overrides
    if (
      envVariables.ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES &&
      Object.hasOwn(siteOverrides, 'ALLOWED_REQUEST_OVERRIDES')
    ) {
      const siteAllowedRequestOverrides: Map<
        RequestOverridableVariable,
        RequestOverrideRestrictionType
      > = new Map();
      let isValid = true;
      if (siteOverrides.ALLOWED_REQUEST_OVERRIDES) {
        siteOverrides.ALLOWED_REQUEST_OVERRIDES.split(',').forEach((entry) => {
          const [variable, restrictionType = 'restricted'] = entry.split(':');
          if (restrictionType !== 'restricted' && restrictionType !== 'unrestricted') {
            isValid = false;
            return;
          }
          if (variable === '*') {
            requestOverridableVariables.forEach((v) => {
              siteAllowedRequestOverrides.set(v, restrictionType);
            });
          } else if (isRequestOverridableVariable(variable)) {
            siteAllowedRequestOverrides.set(variable, restrictionType);
          } else {
            isValid = false;
            return;
          }
        });
      }
      if (isValid) {
        allowedRequestOverrides = siteAllowedRequestOverrides;
      }
    }

    return allowedRequestOverrides;
  }

  getToolsWithOverrides(
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string> = {},
  ): { includeTools: Array<ToolName>; excludeTools: Array<ToolName> } {
    let includeTools: Array<ToolName> = [];
    let excludeTools: Array<ToolName> = [];

    if (
      (!Object.hasOwn(siteOverrides, 'INCLUDE_TOOLS') &&
        !Object.hasOwn(siteOverrides, 'EXCLUDE_TOOLS')) ||
      (siteOverrides.INCLUDE_TOOLS && siteOverrides.EXCLUDE_TOOLS)
    ) {
      // if site overrides are set for both INCLUDE_TOOLS and EXCLUDE_TOOLS simultaneously or not set at all, fall back to environment variables
      includeTools = envVariables.INCLUDE_TOOLS
        ? envVariables.INCLUDE_TOOLS.split(',').flatMap((s) => {
            const v = s.trim();
            return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
          })
        : [];
      excludeTools = envVariables.EXCLUDE_TOOLS
        ? envVariables.EXCLUDE_TOOLS.split(',').flatMap((s) => {
            const v = s.trim();
            return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
          })
        : [];

      if (includeTools.length > 0 && excludeTools.length > 0) {
        throw new Error('Cannot include and exclude tools simultaneously');
      }
    } else if (siteOverrides.EXCLUDE_TOOLS) {
      // site override set for EXCLUDE_TOOLS
      excludeTools = siteOverrides.EXCLUDE_TOOLS.split(',').flatMap((s) => {
        const v = s.trim();
        return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
      });
    } else if (siteOverrides.INCLUDE_TOOLS) {
      // site override set for INCLUDE_TOOLS
      includeTools = siteOverrides.INCLUDE_TOOLS.split(',').flatMap((s) => {
        const v = s.trim();
        return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
      });
    }

    return { includeTools, excludeTools };
  }

  getBoundedVariableWithOverrides(
    variableName: OverridableVariable,
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string> = {},
    requestOverrides: Record<string, string> = {},
  ): Set<string> | null {
    // Initializing bounded context from environment variables
    let bounds = createSetFromCommaSeparatedString(envVariables[variableName]);
    if (bounds?.size === 0) {
      throw new Error(
        `When set, the environment variable ${variableName} must have at least one value`,
      );
    }
    // Applying site overrides
    if (Object.hasOwn(siteOverrides, variableName)) {
      if (!siteOverrides[variableName]) {
        // Overriding with empty string clears current bounds
        bounds = null;
      } else {
        const boundsOverrides = createSetFromCommaSeparatedString(siteOverrides[variableName]);
        // Only override if the set is non empty. An empty set means the override value was invalid
        if (boundsOverrides?.size !== 0) {
          bounds = boundsOverrides;
        }
      }
    }
    // Applying request overrides
    if (
      isRequestOverridableVariable(variableName) &&
      Object.hasOwn(requestOverrides, variableName)
    ) {
      if (!this.allowedRequestOverrides.has(variableName)) {
        throw new Error(`${variableName} is not an allowed request override`);
      }
      const restrictionType = this.allowedRequestOverrides.get(variableName)!;
      if (bounds === null) {
        // no bounds currently set, accept any request override that results in a valid set
        if (requestOverrides[variableName]) {
          const boundsOverrides = createSetFromCommaSeparatedString(requestOverrides[variableName]);
          if (boundsOverrides!.size === 0) {
            throw new Error(`${variableName} was provided an invalid request override value`);
          }
          bounds = boundsOverrides;
        }
      } else if (requestOverrides[variableName]) {
        const boundsOverrides = createSetFromCommaSeparatedString(requestOverrides[variableName]);
        if (boundsOverrides!.size === 0) {
          throw new Error(`${variableName} was provided an invalid request override value`);
        } else if (restrictionType === 'restricted') {
          // when restricted, request overrides must result in a subset of the current bounds
          boundsOverrides!.forEach((bound) => {
            if (!bounds!.has(bound)) {
              throw new Error(
                `${variableName} can only be overridden to a subset of the current bounds`,
              );
            }
          });
        }
        bounds = boundsOverrides;
      } else {
        // overriding with empty string clears current bounds, but only if the restriction type is unrestricted
        if (restrictionType === 'restricted') {
          throw new Error(`${variableName} is restricted and cannot be cleared`);
        }
        bounds = null;
      }
    }
    return bounds;
  }

  getBoundedContextWithOverrides(
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string> = {},
    requestOverrides: Record<string, string> = {},
  ): BoundedContext {
    const projectIds = this.getBoundedVariableWithOverrides(
      'INCLUDE_PROJECT_IDS',
      envVariables,
      siteOverrides,
      requestOverrides,
    );
    const datasourceIds = this.getBoundedVariableWithOverrides(
      'INCLUDE_DATASOURCE_IDS',
      envVariables,
      siteOverrides,
      requestOverrides,
    );
    const workbookIds = this.getBoundedVariableWithOverrides(
      'INCLUDE_WORKBOOK_IDS',
      envVariables,
      siteOverrides,
      requestOverrides,
    );
    const tags = this.getBoundedVariableWithOverrides(
      'INCLUDE_TAGS',
      envVariables,
      siteOverrides,
      requestOverrides,
    );
    return { projectIds, datasourceIds, workbookIds, tags };
  }

  getBooleanVariableWithOverrides(
    variableName: OverridableVariable,
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string> = {},
    requestOverrides: Record<string, string> = {},
    defaultValue: boolean,
    allowedValueWhenRestricted: boolean,
  ): boolean {
    // Initializing boolean from environment variables
    let toReturn = defaultValue;
    if (envVariables[variableName] === 'true') {
      toReturn = true;
    } else if (envVariables[variableName] === 'false') {
      toReturn = false;
    }
    // Applying site overrides
    if (Object.hasOwn(siteOverrides, variableName)) {
      if (!siteOverrides[variableName]) {
        toReturn = defaultValue;
      } else if (siteOverrides[variableName] === 'false') {
        toReturn = false;
      } else if (siteOverrides[variableName] === 'true') {
        toReturn = true;
      }
    }
    // Applying request overrides
    if (
      isRequestOverridableVariable(variableName) &&
      Object.hasOwn(requestOverrides, variableName)
    ) {
      if (!this.allowedRequestOverrides.has(variableName)) {
        throw new Error(`${variableName} is not an allowed request override`);
      }
      const restrictionType = this.allowedRequestOverrides.get(variableName)!;
      if (!requestOverrides[variableName]) {
        // empty string means revert to default value, check if the default value is allowed when restricted
        if (restrictionType === 'restricted' && defaultValue !== allowedValueWhenRestricted) {
          throw new Error(
            `${variableName} is restricted and can only be overridden to ${allowedValueWhenRestricted}`,
          );
        }
        toReturn = defaultValue;
      } else if (requestOverrides[variableName] === 'false') {
        if (restrictionType === 'restricted' && allowedValueWhenRestricted !== false) {
          throw new Error(`${variableName} is restricted and can only be overridden to true`);
        }
        toReturn = false;
      } else if (requestOverrides[variableName] === 'true') {
        if (restrictionType === 'restricted' && allowedValueWhenRestricted !== true) {
          throw new Error(`${variableName} is restricted and can only be overridden to false`);
        }
        toReturn = true;
      } else {
        throw new Error(`${variableName} was provided an invalid request override value`);
      }
    }
    return toReturn;
  }

  getMaxResultLimitWithOverrides(
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string> = {},
    requestOverrides: Record<string, string> = {},
  ): number | null {
    // Initializing max result limit from environment variables
    const maxResultLimitNumber = parseInt(envVariables.MAX_RESULT_LIMIT ?? '');
    let maxResultLimit =
      isNaN(maxResultLimitNumber) || maxResultLimitNumber <= 0 ? null : maxResultLimitNumber;
    // Applying site overrides
    if (Object.hasOwn(siteOverrides, 'MAX_RESULT_LIMIT')) {
      const maxResultLimitOverride = parseInt(siteOverrides.MAX_RESULT_LIMIT);
      if (!siteOverrides.MAX_RESULT_LIMIT) {
        maxResultLimit = null; // default to no limits
      } else if (maxResultLimitOverride > 0) {
        maxResultLimit = maxResultLimitOverride;
      }
    }
    // Applying request overrides
    if (Object.hasOwn(requestOverrides, 'MAX_RESULT_LIMIT')) {
      if (!this.allowedRequestOverrides.has('MAX_RESULT_LIMIT')) {
        throw new Error('MAX_RESULT_LIMIT is not an allowed request override');
      }
      const restrictionType = this.allowedRequestOverrides.get('MAX_RESULT_LIMIT')!;
      const maxResultLimitOverride = parseInt(requestOverrides.MAX_RESULT_LIMIT);
      if (!requestOverrides.MAX_RESULT_LIMIT) {
        if (restrictionType === 'restricted' && maxResultLimit !== null) {
          throw new Error('MAX_RESULT_LIMIT is restricted and cannot be cleared');
        }
        maxResultLimit = null; // default to no limits
      } else if (maxResultLimitOverride > 0) {
        if (
          restrictionType === 'restricted' &&
          maxResultLimit !== null &&
          maxResultLimitOverride > maxResultLimit
        ) {
          throw new Error(
            `MAX_RESULT_LIMIT is restricted and can only be overriden to values less than ${maxResultLimit}`,
          );
        }
        maxResultLimit = maxResultLimitOverride;
      } else {
        throw new Error('MAX_RESULT_LIMIT was provided an invalid request override value');
      }
    }
    return maxResultLimit;
  }

  // NOTE: this.maxResultLimit must be initialized via getMaxResultLimitWithOverrides before calling this method.
  getMaxResultLimitsWithOverrides(
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string> = {},
    requestOverrides: Record<string, string> = {},
  ): Map<ToolName, number | null> {
    // Initializing tool specific limits from environment variables
    let maxResultLimits = getMaxResultLimits(envVariables.MAX_RESULT_LIMITS ?? '');
    // Applying site overrides
    if (Object.hasOwn(siteOverrides, 'MAX_RESULT_LIMITS')) {
      const maxResultLimitsOverride = getMaxResultLimits(siteOverrides.MAX_RESULT_LIMITS);
      // Only override if the map is non empty or the default value is provided.
      if (maxResultLimitsOverride.size > 0 || !siteOverrides.MAX_RESULT_LIMITS) {
        maxResultLimits = maxResultLimitsOverride;
      }
    }
    // Applying request overrides
    if (Object.hasOwn(requestOverrides, 'MAX_RESULT_LIMITS')) {
      if (!this.allowedRequestOverrides.has('MAX_RESULT_LIMITS')) {
        throw new Error('MAX_RESULT_LIMITS is not an allowed request override');
      }
      const restrictionType = this.allowedRequestOverrides.get('MAX_RESULT_LIMITS')!;
      const maxResultLimitsOverride = getMaxResultLimits(requestOverrides.MAX_RESULT_LIMITS);
      // Accept any valid request override when unrestricted.
      if (restrictionType === 'unrestricted') {
        // Only override if the map is non empty or the default value is provided.
        if (maxResultLimitsOverride.size === 0 && requestOverrides.MAX_RESULT_LIMITS) {
          throw new Error('MAX_RESULT_LIMITS was provided an invalid request override value');
        }
        return maxResultLimitsOverride;
      }
      // By now this.maxResultLimit has had all override logic applied to it, and
      // maxResultLimits has had site overrides applied to it. We must consider
      // both of these values in conjunction when applying request override restrictions.
      // 1. For all tool specific limits that are currently set, check if the request overrides are below it.
      maxResultLimits.forEach((limit, toolName) => {
        if (limit === null) {
          // Tool is unbounded, any limit from the request override is allowed.
          return;
        }
        const limitOverride = maxResultLimitsOverride.get(toolName);
        if (limitOverride === undefined) {
          // No tool specific limit in request override means we'll fallback to global max result limit.
          // This is okay if the global max result limit is less than the current tool specific limit.
          if (this.maxResultLimit === null || this.maxResultLimit > limit) {
            throw new Error(
              `MAX_RESULT_LIMITS request override must include a limit for ${toolName} that is less than or equal to ${limit}`,
            );
          }
        } else if (limitOverride === null || limitOverride > limit) {
          // Tool specific limit in request override is unbounded or greater than the current limit. This is not allowed.
          throw new Error(
            `MAX_RESULT_LIMITS request override must include a limit for ${toolName} that is less than or equal to ${limit}`,
          );
        }
      });
      // 2. For any new tool specific limits, check if the request override is below the global max result limit.
      if (this.maxResultLimit !== null) {
        maxResultLimitsOverride.forEach((limit, toolName) => {
          if (maxResultLimits.has(toolName)) {
            // not a new tool specific limit, skip
            return;
          }
          if (limit === null || limit > this.maxResultLimit!) {
            throw new Error(
              `MAX_RESULT_LIMITS request override must include a limit for ${toolName} that is less than or equal to ${this.maxResultLimit}`,
            );
          }
        });
      }
      maxResultLimits = maxResultLimitsOverride;
    }
    return maxResultLimits;
  }

  getMaxResultLimit(toolName: ToolName): number | null {
    const maxResultLimit = this.maxResultLimits.get(toolName);
    return maxResultLimit !== undefined
      ? maxResultLimit // tool was explicitly set to a limit or unbounded (null)
      : this.maxResultLimit; // tool specific limit was not set, fallback to overall max result limit
  }
}

// Creates a set from a comma-separated string of values.
// Returns null if the value is undefined.
function createSetFromCommaSeparatedString(value: string | undefined): Set<string> | null {
  if (value === undefined) {
    return null;
  }

  return new Set(
    value
      .trim()
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function getMaxResultLimits(maxResultLimits: string): Map<ToolName, number | null> {
  const map = new Map<ToolName, number | null>();
  if (!maxResultLimits) {
    return map;
  }

  maxResultLimits.split(',').forEach((curr) => {
    const [toolName, maxResultLimit] = curr.split(':');
    const maxResultLimitNumber = maxResultLimit ? parseInt(maxResultLimit) : NaN;
    const actualLimit =
      isNaN(maxResultLimitNumber) || maxResultLimitNumber <= 0 ? null : maxResultLimitNumber;
    if (isToolName(toolName)) {
      map.set(toolName, actualLimit);
    } else if (isToolGroupName(toolName)) {
      toolGroups[toolName].forEach((toolName) => {
        if (!map.has(toolName)) {
          // Tool names take precedence over group names
          map.set(toolName, actualLimit);
        }
      });
    }
  });

  return map;
}

export const getOverridableConfig = (
  siteOverrides: Record<string, string> = {},
  requestOverrides: Record<string, string> = {},
): OverridableConfig => new OverridableConfig(siteOverrides, requestOverrides);

export const exportedForTesting = {
  OverridableConfig: OverridableConfig,
};
