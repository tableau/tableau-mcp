import { knownCommands } from '../../../desktop/commandRegistry.js';

type CensusPlan = {
  steps: ReadonlyArray<{ command: string; args?: Record<string, unknown> }>;
  summaryWorksheet?: string | readonly string[];
};

type PlanDetector = (plan: CensusPlan) => boolean;

const BIN_KEYS = new Set(['bin', 'binfield', 'binwidth', 'binorigin']);
const CALC_KEYS = new Set([
  'formula',
  'calculation',
  'calculationformula',
  'calculatedfieldformula',
]);
const FISCAL_KEYS = new Set(['fiscal', 'fiscalyearstart', 'currentperiod']);

const CENSUS = [
  {
    name: 'bin-spec',
    reason:
      "No command key exists for bin field, width, or origin. Use author-calc {role: 'dimension', datatype: 'integer'} or bind-template with calcs[] to author FLOOR([measure] / width) * width, add COUNTD([row-level key]), then build the bar.",
    detect: (plan: CensusPlan) => argsHaveKey(plan, BIN_KEYS),
  },
  {
    name: 'calc-authoring',
    reason:
      'Calculated fields are unavailable in plan command args. Use author-calc or bind-template with calcs[]; put aggregation inside the formula.',
    detect: (plan: CensusPlan) => argsHaveKey(plan, CALC_KEYS),
  },
  {
    name: 'worksheet-lifecycle',
    reason:
      'Use tabdoc:new-worksheet {NewSheet, ActivateNew: true} to create, name, and activate a worksheet in one step. If those arguments fail, use tabdoc:new-worksheet {}, tabdoc:rename-sheet {Sheet,NewSheet}, and activate-sheet {sheetName}; placing fields on the new worksheet still has no command.',
    detect: 'route-prose',
  },
  {
    name: 'dashboard-composition',
    reason:
      'The plan grammar cannot compose a dashboard directly. Use tabdoc:new-dashboard {}, then tabdoc:add-sheet-to-dashboard {Dashboard,Worksheet,AddAsFloating:false}.',
    detect: 'route-prose',
  },
  {
    name: 'multi-summary-readback',
    reason:
      'A plan reads one summary worksheet. Submit one plan per summary worksheet, or use get-summary-data with each additional worksheet after the plan.',
    detect: (plan: CensusPlan) =>
      Array.isArray(plan.summaryWorksheet) && plan.summaryWorksheet.length > 1,
  },
  {
    name: 'summary-rows-beyond-200',
    reason: 'Plan summary readback is capped at 200 rows. Aggregate or filter before readback.',
    detect: 'route-prose',
  },
  {
    name: 'structural-verify',
    reason:
      'UNKNOWN: structural targets beyond the declared typed expectations are not live-verified. Use only the declared typed expectations.',
    detect: 'route-prose',
  },
  {
    name: 'fiscal-calendar',
    reason:
      "There is no fiscal-year-start or current-period command key. Use author-calc {datatype: 'date'} to author a fiscal-period date-arithmetic field, then bind it.",
    detect: (plan: CensusPlan) => argsHaveKey(plan, FISCAL_KEYS),
  },
  {
    name: 'relative-date-window',
    reason:
      "There is no current-plus-previous-N-quarters plan semantic. Use author-calc {datatype: 'boolean'} to author a date-window field comparing dates against {MAX([Date])}, then bind it.",
    detect: 'route-prose',
  },
  {
    name: 'filter-identity-readback',
    reason:
      'Filter readback omits members, mode, and function, so it cannot identify the filter. Use get-summary-data values to verify the filter effect.',
    detect: 'route-prose',
  },
  {
    name: 'goto-sheet-contract',
    reason:
      'The tabdoc:goto-sheet argument contract is not live-verified. Use activate-sheet {sheetName}.',
    detect: (plan: CensusPlan) => plan.steps.some(({ command }) => command === 'tabdoc:goto-sheet'),
  },
] as const satisfies ReadonlyArray<{
  name: string;
  reason: string;
  detect: PlanDetector | 'route-prose';
}>;

type CensusResult = {
  capabilitiesUsed: string[];
  missing?: { name: string; reason: string };
  outcomes: Array<{
    name: string;
    reason: string;
    detect: 'plan-shape' | 'route-prose';
  }>;
};

export function checkAuthoringCapabilityCensus(plan: CensusPlan): CensusResult {
  const capabilitiesUsed = CENSUS.filter(
    (entry) => typeof entry.detect === 'function' && entry.detect(plan),
  ).map(({ name }) => name);
  const missingCapability = CENSUS.find(({ name }) => capabilitiesUsed.includes(name));
  const commandCensus = knownCommands();
  const uncensusedCommand = plan.steps.find(({ command }) => !commandCensus?.has(command))?.command;
  const missing =
    missingCapability ??
    (uncensusedCommand
      ? {
          name: uncensusedCommand,
          reason:
            'No bundled Tableau command matches this name. Use search-commands to find the correct command name, then resubmit the plan.',
        }
      : undefined);

  return {
    capabilitiesUsed,
    ...(missing ? { missing: { name: missing.name, reason: missing.reason } } : {}),
    outcomes: CENSUS.map(({ name, reason, detect }) => ({
      name,
      reason,
      detect: typeof detect === 'function' ? ('plan-shape' as const) : detect,
    })),
  };
}

function argsHaveKey(plan: CensusPlan, keys: ReadonlySet<string>): boolean {
  return plan.steps.some(({ args }) => args !== undefined && valueHasKey(args, keys));
}

function valueHasKey(root: unknown, keys: ReadonlySet<string>): boolean {
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      const parsed = parseEmbeddedJson(value);
      if (parsed !== undefined) pending.push(parsed);
      continue;
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (keys.has(normalizeKey(key))) return true;
      pending.push(nested);
    }
  }

  return false;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseEmbeddedJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
