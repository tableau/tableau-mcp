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
      'the host has no command key for bin field, width, or origin; histogram auto-binning is undocumented',
    detect: (plan: CensusPlan) => argsHaveKey(plan, BIN_KEYS),
  },
  {
    name: 'calc-authoring',
    reason:
      'the host has no guarded command contract for creating a calculated field; authoring is host-file-only today',
    detect: (plan: CensusPlan) => argsHaveKey(plan, CALC_KEYS),
  },
  {
    name: 'worksheet-lifecycle',
    reason: 'the host has no create, name, or activate worksheet command',
    detect: 'route-prose',
  },
  {
    name: 'dashboard-composition',
    reason: 'the host has no dashboard create or compose command step',
    detect: 'route-prose',
  },
  {
    name: 'multi-summary-readback',
    reason: 'the host accepts at most one summary worksheet per plan',
    detect: (plan: CensusPlan) =>
      Array.isArray(plan.summaryWorksheet) && plan.summaryWorksheet.length > 1,
  },
  {
    name: 'summary-rows-beyond-200',
    reason: 'the host readback is capped at 200 summary rows',
    detect: 'route-prose',
  },
  {
    name: 'structural-verify',
    reason:
      'UNKNOWN: structural targets beyond the declared typed expectations have not been verified on the host surface',
    detect: 'route-prose',
  },
  {
    name: 'fiscal-calendar',
    reason: 'the host has no fiscal-year-start or current-period command key',
    detect: (plan: CensusPlan) => argsHaveKey(plan, FISCAL_KEYS),
  },
  {
    name: 'relative-date-window',
    reason: 'the host has no current-plus-previous-N-quarters semantic',
    detect: 'route-prose',
  },
  {
    name: 'filter-identity-readback',
    reason: 'the host omits members, mode, and function from filter identity',
    detect: 'route-prose',
  },
  {
    name: 'goto-sheet-contract',
    reason: 'the host goto-sheet argument contract is unverified live',
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
  const missing = CENSUS.find(({ name }) => capabilitiesUsed.includes(name));

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
