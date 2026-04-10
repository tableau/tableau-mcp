import { ProcessEnvEx } from '../types/process-env.js';
import { removeClaudeMcpBundleUserConfigTemplates } from './config.js';
import { isToolGroupName, isToolName, toolGroups, ToolName } from './tools/toolName.js';

const overridableVariables = [
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

type OverridableVariable = (typeof overridableVariables)[number];
export function isOverridableVariable(variable: unknown): variable is OverridableVariable {
  return overridableVariables.some((v) => v === variable);
}

export type BoundedContext = {
  projectIds: Set<string> | null;
  datasourceIds: Set<string> | null;
  workbookIds: Set<string> | null;
  tags: Set<string> | null;
};

export class OverridableConfig {
  private maxResultLimit: number | null;
  private maxResultLimits: Map<ToolName, number | null> | null;

  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;

  disableQueryDatasourceValidationRequests: boolean;
  disableMetadataApiRequests: boolean;

  boundedContext: BoundedContext;

  getMaxResultLimit(toolName: ToolName): number | null {
    return this.maxResultLimits?.get(toolName) ?? this.maxResultLimit;
  }

  getToolsWithOverrides(
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string | undefined> = {},
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

  getBoundedContextWithOverrides(
    envVariables: Record<string, string | undefined>,
    siteOverrides: Record<string, string | undefined> = {},
  ): BoundedContext {
    let projectIds = createSetFromCommaSeparatedString(envVariables.INCLUDE_PROJECT_IDS);
    let datasourceIds = createSetFromCommaSeparatedString(envVariables.INCLUDE_DATASOURCE_IDS);
    let workbookIds = createSetFromCommaSeparatedString(envVariables.INCLUDE_WORKBOOK_IDS);
    let tags = createSetFromCommaSeparatedString(envVariables.INCLUDE_TAGS);

    if (projectIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_PROJECT_IDS must have at least one value',
      );
    } else if (datasourceIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_DATASOURCE_IDS must have at least one value',
      );
    } else if (workbookIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_WORKBOOK_IDS must have at least one value',
      );
    } else if (tags?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_TAGS must have at least one value',
      );
    }

    if (Object.hasOwn(siteOverrides, 'INCLUDE_PROJECT_IDS')) {
      if (!siteOverrides.INCLUDE_PROJECT_IDS) {
        // overriding with empty string clears current bounds
        projectIds = null;
      } else {
        const projectIdsOverrides = createSetFromCommaSeparatedString(
          siteOverrides.INCLUDE_PROJECT_IDS,
        );
        if (projectIdsOverrides?.size !== 0) {
          projectIds = projectIdsOverrides;
        }
      }
    }
    if (Object.hasOwn(siteOverrides, 'INCLUDE_DATASOURCE_IDS')) {
      if (!siteOverrides.INCLUDE_DATASOURCE_IDS) {
        // overriding with empty string clears current bounds
        datasourceIds = null;
      } else {
        const datasourceIdsOverrides = createSetFromCommaSeparatedString(
          siteOverrides.INCLUDE_DATASOURCE_IDS,
        );
        if (datasourceIdsOverrides?.size !== 0) {
          datasourceIds = datasourceIdsOverrides;
        }
      }
    }
    if (Object.hasOwn(siteOverrides, 'INCLUDE_WORKBOOK_IDS')) {
      if (!siteOverrides.INCLUDE_WORKBOOK_IDS) {
        // overriding with empty string clears current bounds
        workbookIds = null;
      } else {
        const workbookIdsOverrides = createSetFromCommaSeparatedString(
          siteOverrides.INCLUDE_WORKBOOK_IDS,
        );
        if (workbookIdsOverrides?.size !== 0) {
          workbookIds = workbookIdsOverrides;
        }
      }
    }
    if (Object.hasOwn(siteOverrides, 'INCLUDE_TAGS')) {
      if (!siteOverrides.INCLUDE_TAGS) {
        // overriding with empty string clears current bounds
        tags = null;
      } else {
        const tagsOverrides = createSetFromCommaSeparatedString(siteOverrides.INCLUDE_TAGS);
        if (tagsOverrides?.size !== 0) {
          tags = tagsOverrides;
        }
      }
    }

    return { projectIds, datasourceIds, workbookIds, tags };
  }

  constructor(siteOverrides: Record<string, string | undefined> = {}) {
    const envVariables = removeClaudeMcpBundleUserConfigTemplates({ ...process.env });

    // INCLUDE_TOOLS, EXCLUDE_TOOLS
    const { includeTools, excludeTools } = this.getToolsWithOverrides(envVariables, siteOverrides);
    this.includeTools = includeTools;
    this.excludeTools = excludeTools;

    // INCLUDE_PROJECT_IDS, INCLUDE_DATASOURCE_IDS, INCLUDE_WORKBOOK_IDS, INCLUDE_TAGS
    this.boundedContext = this.getBoundedContextWithOverrides(envVariables, siteOverrides);

    // DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS
    this.disableQueryDatasourceValidationRequests =
      envVariables.DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS === 'true';
    if (Object.hasOwn(siteOverrides, 'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS')) {
      this.disableQueryDatasourceValidationRequests =
        siteOverrides.DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS === 'true';
    }

    // DISABLE_METADATA_API_REQUESTS
    this.disableMetadataApiRequests = envVariables.DISABLE_METADATA_API_REQUESTS === 'true';
    if (Object.hasOwn(siteOverrides, 'DISABLE_METADATA_API_REQUESTS')) {
      this.disableMetadataApiRequests = siteOverrides.DISABLE_METADATA_API_REQUESTS === 'true';
    }

    // MAX_RESULT_LIMIT
    let maxResultLimitNumber = envVariables.MAX_RESULT_LIMIT
      ? parseInt(envVariables.MAX_RESULT_LIMIT)
      : NaN;
    if (Object.hasOwn(siteOverrides, 'MAX_RESULT_LIMIT')) {
      maxResultLimitNumber = siteOverrides.MAX_RESULT_LIMIT
        ? parseInt(siteOverrides.MAX_RESULT_LIMIT)
        : NaN;
    }
    this.maxResultLimit =
      isNaN(maxResultLimitNumber) || maxResultLimitNumber <= 0 ? null : maxResultLimitNumber;

    // MAX_RESULT_LIMITS
    this.maxResultLimits = envVariables.MAX_RESULT_LIMITS
      ? getMaxResultLimits(envVariables.MAX_RESULT_LIMITS)
      : null;
    if (Object.hasOwn(siteOverrides, 'MAX_RESULT_LIMITS')) {
      this.maxResultLimits = siteOverrides.MAX_RESULT_LIMITS
        ? getMaxResultLimits(siteOverrides.MAX_RESULT_LIMITS)
        : null;
    }
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
  siteOverrides: Record<string, string> | undefined,
): OverridableConfig => new OverridableConfig(siteOverrides);

export const exportedForTesting = {
  OverridableConfig: OverridableConfig,
};
