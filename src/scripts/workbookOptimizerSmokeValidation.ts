import { z } from 'zod';

import {
  WorkbookOptimizerResult,
  workbookOptimizerResultSchema,
} from '../desktop/externalApi/types.js';

export const workbookOptimizerToolName = 'run-workbook-optimizer';

export type RuleStatus = WorkbookOptimizerResult['suggestions'][number]['status'];

export type ExpectedRule = {
  ruleId: number;
  status: RuleStatus;
  minimumAffected: number;
};

export type OptimizerValidationSummary = {
  ruleCount: number;
  failedRuleIds: number[];
  needsReviewRuleIds: number[];
  ignoredRuleIds: number[];
  expectedRules: ExpectedRule[];
};

const rulesManifestSchema = z
  .object({
    rules: z.array(
      z
        .object({
          ruleId: z.number().int().positive(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const ruleStatuses = ['PASS', 'FAIL', 'NEEDS_REVIEW', 'IGNORED'] as const;

/**
 * Parse CLI expectations such as `5:FAIL,6:NEEDS_REVIEW,20:NEEDS_REVIEW`.
 * Every expected trigger must report at least one affected item.
 */
export function parseExpectedRules(value: string): ExpectedRule[] {
  if (!value.trim()) {
    throw new Error('At least one expected Workbook Optimizer rule is required.');
  }

  const seen = new Set<number>();
  return value.split(',').map((entry) => {
    const [rawRuleId, rawStatus, ...extra] = entry.split(':');
    const ruleId = Number(rawRuleId);
    if (
      !Number.isInteger(ruleId) ||
      ruleId <= 0 ||
      !rawStatus ||
      !ruleStatuses.includes(rawStatus as RuleStatus) ||
      extra.length > 0
    ) {
      throw new Error(
        `Invalid rule expectation "${entry}". Expected <positive-id>:${ruleStatuses.join('|')}.`,
      );
    }
    if (seen.has(ruleId)) {
      throw new Error(`Duplicate expected Workbook Optimizer rule ${ruleId}.`);
    }
    seen.add(ruleId);
    return { ruleId, status: rawStatus as RuleStatus, minimumAffected: 1 };
  });
}

/** Read the rule IDs that the npm-package manifest says native C++ must evaluate. */
export function readManifestRuleIds(value: unknown): number[] {
  const manifest = rulesManifestSchema.parse(value);
  const ids = manifest.rules.map((rule) => rule.ruleId);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw new Error('Workbook Optimizer rules manifest contains duplicate rule IDs.');
  }
  return [...ids].sort((a, b) => a - b);
}

/** Accept the names emitted by MCP itself and by tab-agent-south's SDK bridge. */
export function isWorkbookOptimizerToolName(toolName: unknown): boolean {
  if (typeof toolName !== 'string') {
    return false;
  }
  return (
    toolName === workbookOptimizerToolName || toolName.endsWith(`__${workbookOptimizerToolName}`)
  );
}

/**
 * Find a typed optimizer result inside MCP content or a tab-agent-south tool-result frame.
 * The agent bridge can wrap the JSON as a text content block, so the search deliberately
 * handles nested objects, arrays, and JSON-encoded strings.
 */
export function extractWorkbookOptimizerResult(value: unknown): WorkbookOptimizerResult | null {
  const visited = new Set<object>();

  const visit = (candidate: unknown): WorkbookOptimizerResult | null => {
    const direct = workbookOptimizerResultSchema.safeParse(candidate);
    if (direct.success) {
      return direct.data;
    }

    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        return null;
      }
      try {
        return visit(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }
    if (visited.has(candidate)) {
      return null;
    }
    visited.add(candidate);

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const result = visit(item);
        if (result) {
          return result;
        }
      }
      return null;
    }

    const record = candidate as Record<string, unknown>;
    const preferredKeys = ['structuredContent', 'content', 'text', 'result', 'value', 'data'];
    for (const key of preferredKeys) {
      if (key in record) {
        const result = visit(record[key]);
        if (result) {
          return result;
        }
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      if (!preferredKeys.includes(key)) {
        const result = visit(nested);
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  return visit(value);
}

/**
 * Verify both halves of the native-generation contract:
 *  - Desktop returned every rule declared by the npm package manifest, exactly once.
 *  - The deterministic workbook still trips its pinned representative rules.
 */
export function validateWorkbookOptimizerResult({
  result,
  manifestRuleIds,
  expectedRules,
}: {
  result: WorkbookOptimizerResult;
  manifestRuleIds: number[];
  expectedRules: ExpectedRule[];
}): OptimizerValidationSummary {
  const actualRuleIds = result.suggestions.map((suggestion) => suggestion.ruleId);
  const uniqueActualIds = new Set(actualRuleIds);
  if (uniqueActualIds.size !== actualRuleIds.length) {
    throw new Error('Workbook Optimizer returned duplicate rule IDs.');
  }

  const actualSorted = [...actualRuleIds].sort((a, b) => a - b);
  const expectedSorted = [...manifestRuleIds].sort((a, b) => a - b);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    const missing = expectedSorted.filter((id) => !uniqueActualIds.has(id));
    const unexpected = actualSorted.filter((id) => !expectedSorted.includes(id));
    throw new Error(
      'Workbook Optimizer rule set differs from the npm manifest. ' +
        `Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`,
    );
  }

  for (const expected of expectedRules) {
    const suggestion = result.suggestions.find(({ ruleId }) => ruleId === expected.ruleId);
    if (!suggestion) {
      throw new Error(`Workbook Optimizer did not return expected rule ${expected.ruleId}.`);
    }
    if (suggestion.status !== expected.status) {
      throw new Error(
        `Workbook Optimizer rule ${expected.ruleId} returned ${suggestion.status}; expected ${expected.status}.`,
      );
    }
    if (suggestion.affected.count < expected.minimumAffected) {
      throw new Error(
        `Workbook Optimizer rule ${expected.ruleId} affected ${suggestion.affected.count} item(s); ` +
          `expected at least ${expected.minimumAffected}.`,
      );
    }
  }

  const idsWithStatus = (status: RuleStatus): number[] =>
    result.suggestions
      .filter((suggestion) => suggestion.status === status)
      .map((suggestion) => suggestion.ruleId)
      .sort((a, b) => a - b);

  return {
    ruleCount: result.suggestions.length,
    failedRuleIds: idsWithStatus('FAIL'),
    needsReviewRuleIds: idsWithStatus('NEEDS_REVIEW'),
    ignoredRuleIds: idsWithStatus('IGNORED'),
    expectedRules,
  };
}

export function validateDesktopRouteLog(logText: string): void {
  const path = '/v0/workbook:runWorkbookOptimizer';
  if (!logText.includes(`External API request received: POST ${path}`)) {
    throw new Error(`Desktop log has no received entry for POST ${path}.`);
  }
  const completed = new RegExp(
    `External API request completed: POST ${escapeRegex(path)} -> (?:200|202)`,
  );
  if (!completed.test(logText)) {
    throw new Error(`Desktop log has no successful completed entry for POST ${path}.`);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
