import { createHash } from 'node:crypto';

import { z } from 'zod';

const summaryScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const postconditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('worksheet-exists'), name: z.string() }),
  z.object({ kind: z.literal('dashboard-exists'), name: z.string() }),
  z.object({ kind: z.literal('datasource-exists'), name: z.string() }),
  z.object({
    kind: z.literal('calculation-signature'),
    datasource: z.string(),
    name: z.string(),
    formula: z.string(),
    datatype: z.string(),
    role: z.string(),
  }),
  z.object({
    kind: z.literal('datasource-binding'),
    worksheet: z.string(),
    datasource: z.string(),
  }),
  z
    .object({
      kind: z.literal('field-binding'),
      worksheet: z.string(),
      placement: z.string(),
      field: z.string(),
    })
    .passthrough(),
  z.object({
    kind: z.literal('filter-signature'),
    worksheet: z.string(),
    column: z.string(),
    members: z.array(z.string()),
    mode: z.enum(['include', 'exclude']),
    function: z.string().optional(),
  }),
  z.object({ kind: z.literal('mark-type'), worksheet: z.string(), mark: z.string() }),
  z.object({
    kind: z.literal('encoding'),
    worksheet: z.string(),
    channel: z.string(),
    field: z.string(),
  }),
  z.object({
    kind: z.literal('dashboard-contains'),
    dashboard: z.string(),
    worksheet: z.string(),
  }),
  z.object({
    kind: z.literal('dashboard-zone'),
    dashboard: z.string(),
    worksheet: z.string(),
    zoneType: z.string(),
    multiplicity: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('summary-signature'),
    worksheet: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(summaryScalarSchema)),
  }),
]);

export type PlanPostcondition = z.infer<typeof postconditionSchema>;

type FilterSignaturePostcondition = Extract<PlanPostcondition, { kind: 'filter-signature' }>;
type DatasourceExistsPostcondition = Extract<PlanPostcondition, { kind: 'datasource-exists' }>;

export type IntentAssertion =
  | Exclude<PlanPostcondition, FilterSignaturePostcondition | DatasourceExistsPostcondition>
  | (Omit<FilterSignaturePostcondition, 'function'> & { function: string | null });

export type IntentAssertionRecord = {
  id: string;
  introducedByStep: number;
  checkpoint: 'immediate' | 'final';
  expect: IntentAssertion;
};

export type IntentDigestPayload = {
  schemaVersion: 1;
  assertions: IntentAssertionRecord[];
};

export type IntentDigest = IntentDigestPayload & {
  sha256: string;
};

export type EffectSymbol = {
  kind: 'worksheet' | 'dashboard';
  identity: string;
};

export type CompiledStepEffects = {
  provides: EffectSymbol[];
  requires: EffectSymbol[];
  derivedAssertions: IntentAssertion[];
  mutationClass: 'load-bearing' | 'non-asserting-checkpoint';
};

export type PreparedIntentStep = {
  step: number;
  command: string;
  dispatchArgs: Record<string, unknown>;
  expect?: PlanPostcondition;
};

export type DependencyEdge = {
  fromStep: number;
  toStep: number;
  symbol: EffectSymbol;
};

export type CompiledPlan<TStep extends PreparedIntentStep = PreparedIntentStep> = {
  steps: TStep[];
  effectsByStep: Record<number, CompiledStepEffects>;
  dependencyEdges: DependencyEdge[];
  digest: IntentDigest;
  immediateAssertionIdsByProducingStep: Record<number, string[]>;
};

export type AssertionReadback = {
  id: string;
  introducedByStep: number;
  checkpoint: 'immediate' | 'final';
  status: 'passed' | 'mismatch' | 'unobservable';
  expected: IntentAssertion;
  observed: unknown;
  delta: {
    kind: 'none' | 'mismatch' | 'unobservable';
    expected: unknown;
    observed: unknown;
  };
};

export class IntentDigestCompileError extends Error {
  readonly step: number;
  readonly command: string;

  constructor(step: number, command: string, message: string) {
    super(message);
    this.name = 'IntentDigestCompileError';
    this.step = step;
    this.command = command;
  }
}

type DigestBuild = IntentDigest & { canonicalBytes: string };

type CompilerState = {
  activeWorksheet?: { identity: string; observable: boolean; producerStep: number };
};

type EffectCompiler = (step: PreparedIntentStep, state: CompilerState) => CompiledStepEffects;

const effectRegistry = new Map<string, EffectCompiler>([
  ['tabdoc:new-worksheet', compileNewWorksheet],
  ['tabdoc:new-dashboard', compileNewDashboard],
  ['tabdoc:generate-viz-from-notional-spec', compileNotionalSpec],
  ['tabdoc:save', emptyEffects],
]);

export function compileIntentPlan<TStep extends PreparedIntentStep>(
  steps: TStep[],
): CompiledPlan<TStep> {
  const effectsByStep: Record<number, CompiledStepEffects> = {};
  const dependencyEdges: DependencyEdge[] = [];
  const providers = new Map<string, number>();
  const state: CompilerState = {};
  const futureWorksheetProducer = steps.find(
    ({ command, dispatchArgs }) =>
      command === 'tabdoc:new-worksheet' && nonEmptyString(dispatchArgs.NewSheet) !== undefined,
  );

  for (const step of steps) {
    const compiler = effectRegistry.get(step.command);
    if (!compiler) {
      throw new IntentDigestCompileError(
        step.step,
        step.command,
        `Intent digest has no effect rule for unclassified command "${step.command}".`,
      );
    }

    if (step.expect?.kind === 'field-binding' && step.expect.derivation !== undefined) {
      throw new IntentDigestCompileError(
        step.step,
        step.command,
        'Intent digest refused the assertion because worksheet readback cannot observe field derivation.',
      );
    }

    if (step.expect?.kind === 'datasource-exists') {
      throw new IntentDigestCompileError(
        step.step,
        step.command,
        'Intent digest refused the assertion because no admitted command can create a datasource.',
      );
    }

    if (
      step.command === 'tabdoc:generate-viz-from-notional-spec' &&
      state.activeWorksheet === undefined
    ) {
      const reason =
        futureWorksheetProducer && futureWorksheetProducer.step > step.step
          ? 'forward reference'
          : 'unresolved reference';
      throw new IntentDigestCompileError(
        step.step,
        step.command,
        `Intent digest ${reason}: no earlier worksheet producer exists.`,
      );
    }

    const effects = compiler(step, state);
    effectsByStep[step.step] = effects;

    for (const symbol of effects.requires) {
      const producer = providers.get(symbolKey(symbol));
      if (producer === undefined) {
        throw new IntentDigestCompileError(
          step.step,
          step.command,
          `Intent digest unresolved reference ${JSON.stringify(symbol)}.`,
        );
      }
      dependencyEdges.push({ fromStep: producer, toStep: step.step, symbol });
    }

    for (const symbol of effects.provides) {
      const key = symbolKey(symbol);
      const previous = providers.get(key);
      if (previous !== undefined) {
        throw new IntentDigestCompileError(
          step.step,
          step.command,
          `Intent digest duplicate producer for ${JSON.stringify(symbol)} at steps ${previous} and ${step.step}.`,
        );
      }
      providers.set(key, step.step);
    }
  }

  const immediateProducerSteps = new Set(dependencyEdges.map(({ fromStep }) => fromStep));
  const seenAssertions = new Set<string>();
  const assertions: IntentAssertionRecord[] = [];
  for (const step of steps) {
    const effects = effectsByStep[step.step];
    const candidates = [
      ...effects.derivedAssertions,
      ...(step.expect === undefined ? [] : [normalizePostcondition(step.expect)]),
    ];
    for (const expect of candidates) {
      const assertionKey = canonicalize(expect);
      if (seenAssertions.has(assertionKey)) continue;
      seenAssertions.add(assertionKey);
      const checkpoint =
        immediateProducerSteps.has(step.step) &&
        assertionProvesProvidedSymbol(expect, effects.provides)
          ? 'immediate'
          : 'final';
      assertions.push({
        id: assertionId(step.step, expect),
        introducedByStep: step.step,
        checkpoint,
        expect,
      });
    }
  }

  const payload: IntentDigestPayload = { schemaVersion: 1, assertions };
  const builtDigest = createIntentDigest(payload);
  const digest: IntentDigest = {
    schemaVersion: builtDigest.schemaVersion,
    assertions: builtDigest.assertions,
    sha256: builtDigest.sha256,
  };
  const immediateAssertionIdsByProducingStep: Record<number, string[]> = {};
  for (const assertion of assertions) {
    if (assertion.checkpoint !== 'immediate') continue;
    (immediateAssertionIdsByProducingStep[assertion.introducedByStep] ??= []).push(assertion.id);
  }

  return {
    steps,
    effectsByStep,
    dependencyEdges,
    digest,
    immediateAssertionIdsByProducingStep,
  };
}

export function normalizePostcondition(expect: PlanPostcondition): IntentAssertion {
  const parsed = postconditionSchema.parse(expect);
  if (parsed.kind === 'datasource-exists') {
    throw new Error('Datasource existence must be refused before digest normalization.');
  }
  return parsed.kind === 'filter-signature'
    ? { ...parsed, function: parsed.function ?? null }
    : parsed;
}

export function createIntentDigest(payload: IntentDigestPayload): DigestBuild {
  const canonicalBytes = canonicalize(payload);
  return {
    ...payload,
    sha256: createHash('sha256').update(canonicalBytes).digest('hex'),
    canonicalBytes,
  };
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

function compileNewWorksheet(step: PreparedIntentStep, state: CompilerState): CompiledStepEffects {
  const name = nonEmptyString(step.dispatchArgs.NewSheet);
  state.activeWorksheet = {
    identity: name ?? `$active:${step.step}`,
    observable: name !== undefined,
    producerStep: step.step,
  };
  return {
    mutationClass: 'load-bearing',
    provides: [{ kind: 'worksheet', identity: state.activeWorksheet.identity }],
    requires: [],
    derivedAssertions: name ? [{ kind: 'worksheet-exists', name }] : [],
  };
}

function compileNewDashboard(step: PreparedIntentStep, state: CompilerState): CompiledStepEffects {
  const name =
    nonEmptyString(step.dispatchArgs.NewSheet) ?? nonEmptyString(step.dispatchArgs.NewDashboard);
  state.activeWorksheet = undefined;
  return {
    mutationClass: 'load-bearing',
    provides: name ? [{ kind: 'dashboard', identity: name }] : [],
    requires: [],
    derivedAssertions: name ? [{ kind: 'dashboard-exists', name }] : [],
  };
}

function compileNotionalSpec(step: PreparedIntentStep, state: CompilerState): CompiledStepEffects {
  const active = state.activeWorksheet;
  if (!active) {
    throw new IntentDigestCompileError(
      step.step,
      step.command,
      'Intent digest unresolved reference: no active worksheet producer.',
    );
  }
  if (!active.observable) {
    throw new IntentDigestCompileError(
      step.step,
      step.command,
      'Intent digest requires an observable worksheet identity; set NewSheet on the producer.',
    );
  }

  const spec = parseNotionalSpec(step);
  const derivedAssertions: IntentAssertion[] = [];
  const chart = nonEmptyString(spec.chart);
  const mark = chart === undefined ? undefined : markForChart(chart);
  if (mark) {
    derivedAssertions.push({
      kind: 'mark-type',
      worksheet: active.identity,
      mark,
    });
  }

  if (Array.isArray(spec.fields)) {
    for (const value of spec.fields) {
      if (!isRecord(value)) continue;
      const field = nonEmptyString(value.fieldIdentifier);
      const channel = nonEmptyString(value.encoding);
      if (!field) continue;
      if (channel) {
        derivedAssertions.push({
          kind: 'encoding',
          worksheet: active.identity,
          channel,
          field,
        });
      }
    }
  }

  return {
    mutationClass: 'load-bearing',
    provides: [],
    requires: [{ kind: 'worksheet', identity: active.identity }],
    derivedAssertions,
  };
}

function parseNotionalSpec(step: PreparedIntentStep): Record<string, unknown> {
  const raw = step.dispatchArgs.NotionalSpecJson;
  if (typeof raw !== 'string') {
    throw new IntentDigestCompileError(
      step.step,
      step.command,
      'Intent digest cannot classify a notional spec without NotionalSpecJson.',
    );
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // The command guard normally catches this; keep the digest boundary fail-closed too.
  }
  throw new IntentDigestCompileError(
    step.step,
    step.command,
    'Intent digest cannot classify invalid NotionalSpecJson.',
  );
}

function markForChart(chart: string): string | undefined {
  const marks: Record<string, string> = {
    area: 'Area',
    bar: 'Bar',
    circle: 'Circle',
    line: 'Line',
    pie: 'Pie',
    text: 'Text',
  };
  return marks[chart];
}

function emptyEffects(): CompiledStepEffects {
  return {
    mutationClass: 'non-asserting-checkpoint',
    provides: [],
    requires: [],
    derivedAssertions: [],
  };
}

function assertionProvesProvidedSymbol(
  assertion: IntentAssertion,
  provides: EffectSymbol[],
): boolean {
  if (assertion.kind === 'worksheet-exists') {
    return provides.some(
      ({ kind, identity }) => kind === 'worksheet' && identity === assertion.name,
    );
  }
  if (assertion.kind === 'dashboard-exists') {
    return provides.some(
      ({ kind, identity }) => kind === 'dashboard' && identity === assertion.name,
    );
  }
  return false;
}

function assertionId(step: number, assertion: IntentAssertion): string {
  const suffix = createHash('sha256')
    .update(canonicalize({ introducedByStep: step, expect: assertion }))
    .digest('hex')
    .slice(0, 16);
  return `assertion-${step}-${suffix}`;
}

function symbolKey(symbol: EffectSymbol): string {
  return `${symbol.kind}:${symbol.identity}`;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
