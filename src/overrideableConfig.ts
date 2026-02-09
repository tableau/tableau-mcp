import { ProcessEnvEx } from '../types/process-env.js';
import { removeClaudeMcpBundleUserConfigTemplates } from './config.js';
import { isToolGroupName, isToolName, toolGroups, ToolName } from './tools/toolName.js';

const overrideableVariables = [
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

type OverrideableVariable = (typeof overrideableVariables)[number];
function isOverrideableVariable(variable: unknown): variable is OverrideableVariable {
  return overrideableVariables.some((v) => v === variable);
}

function filterEnvVarsToOverrideable(
  environmentVariables: Record<string, string | undefined>,
): Record<OverrideableVariable, string | undefined> {
  return Object.fromEntries(
    Object.entries(environmentVariables).filter(([key]) => isOverrideableVariable(key)),
  ) as Record<OverrideableVariable, string | undefined>;
}

export type BoundedContext = {
  projectIds: Set<string> | null;
  datasourceIds: Set<string> | null;
  workbookIds: Set<string> | null;
  tags: Set<string> | null;
};

export class OverrideableConfig {
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

  constructor(overrides: Record<string, string | undefined> | undefined) {
    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates({
      ...process.env,
      ...(overrides ? filterEnvVarsToOverrideable(overrides) : {}),
    });

    const {
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
      MAX_RESULT_LIMIT: maxResultLimit,
      MAX_RESULT_LIMITS: maxResultLimits,
      DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: disableQueryDatasourceValidationRequests,
      DISABLE_METADATA_API_REQUESTS: disableMetadataApiRequests,
      INCLUDE_PROJECT_IDS: includeProjectIds,
      INCLUDE_DATASOURCE_IDS: includeDatasourceIds,
      INCLUDE_WORKBOOK_IDS: includeWorkbookIds,
      INCLUDE_TAGS: includeTags,
    } = cleansedVars;

    this.disableQueryDatasourceValidationRequests =
      disableQueryDatasourceValidationRequests === 'true';
    this.disableMetadataApiRequests = disableMetadataApiRequests === 'true';

    this.boundedContext = {
      projectIds: createSetFromCommaSeparatedString(includeProjectIds),
      datasourceIds: createSetFromCommaSeparatedString(includeDatasourceIds),
      workbookIds: createSetFromCommaSeparatedString(includeWorkbookIds),
      tags: createSetFromCommaSeparatedString(includeTags),
    };

    if (this.boundedContext.projectIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_PROJECT_IDS must have at least one value',
      );
    }

    if (this.boundedContext.datasourceIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_DATASOURCE_IDS must have at least one value',
      );
    }

    if (this.boundedContext.workbookIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_WORKBOOK_IDS must have at least one value',
      );
    }

    if (this.boundedContext.tags?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_TAGS must have at least one value',
      );
    }

    const maxResultLimitNumber = maxResultLimit ? parseInt(maxResultLimit) : NaN;
    this.maxResultLimit =
      isNaN(maxResultLimitNumber) || maxResultLimitNumber <= 0 ? null : maxResultLimitNumber;

    this.maxResultLimits = maxResultLimits ? getMaxResultLimits(maxResultLimits) : null;

    this.includeTools = includeTools
      ? includeTools.split(',').flatMap((s) => {
          const v = s.trim();
          return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
        })
      : [];

    this.excludeTools = excludeTools
      ? excludeTools.split(',').flatMap((s) => {
          const v = s.trim();
          return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
        })
      : [];

    if (this.includeTools.length > 0 && this.excludeTools.length > 0) {
      throw new Error('Cannot include and exclude tools simultaneously');
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

export const getOverrideableConfig = (
  overrides: Record<string, string | undefined> | undefined,
): OverrideableConfig => new OverrideableConfig(overrides);

export const exportedForTesting = {
  OverrideableConfig,
};
