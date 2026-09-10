import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { resolveLooseFieldReference } from '../../../../desktop/binder/classify.js';
import {
  bareName,
  type SchemaField,
  summarizeSchema,
} from '../../../../desktop/binder/schema-summary.js';
import { WithExecutorAndAbortSignal } from '../../../../desktop/externalApi/executorTypes.js';
import { validateWorkbookDocumentApply } from '../../../../desktop/guards/workbookDocumentGuard.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { applyAndVerify } from './applyAndVerify.js';
import { prettyPrintFormula } from './prettyPrintFormula.js';

export const roleSchema = z.enum(['measure', 'dimension']);
export const datatypeSchema = z.enum(['real', 'integer', 'string', 'boolean', 'date', 'datetime']);

export type DatasourceElement = {
  name: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  xml: string;
  selfClosing: boolean;
};

type XmlRange = {
  start: number;
  end: number;
};

export type Role = z.infer<typeof roleSchema>;
export type Datatype = z.infer<typeof datatypeSchema>;

export type AuthorCalcInput = {
  caption: string;
  formula: string;
  role?: Role;
  datatype?: Datatype;
  defaultFormat?: 'p0%';
};

export type AuthoredCalc = {
  calcName: string;
  caption: string;
  datasource: string;
};

export type AuthorCalculationsResult = {
  workbookXml: string;
  authoredCalcs: AuthoredCalc[];
};

export type CalcRole = z.infer<typeof roleSchema>;
export type CalcDatatype = z.infer<typeof datatypeSchema>;

// One calculated field to author. No per-calc datasource: a batch is single-DS.
export interface CalcSpec {
  caption: string;
  formula: string;
  role: CalcRole;
  datatype: CalcDatatype;
}

// The batch handed to the core. The whole batch shares one datasource.
export interface AuthorCalcBatchRequest {
  calcs: CalcSpec[];
  datasource?: string;
}

export type CalcFailureKind =
  | 'invalid-formula' // validator ran and reported errors for this formula
  | 'dependency-failed' // an in-batch calc it references failed; never attempted
  | 'cycle'; // caught in a dependency cycle; never attempted
// An infra failure of the validate command (transport / non-completed envelope) is NOT a per-calc
// verdict — it aborts the whole batch with a DesktopCommandExecutionError, so callers never mistake
// it for a bad formula. See authorCalculationsWithValidation.

export type AuthoredCalcOutcome =
  | { status: 'created'; caption: string; calcName: string; datasource: string }
  | { status: 'failed'; caption: string; failure: CalcFailureKind; message: string };

type AuthorCalcError = ArgsValidationError | DesktopCommandExecutionError | XmlModificationError;

export async function authorCalculationsInWorkbook({
  workbookXml,
  calcs,
  datasource,
  executor,
  signal,
  labelErrors = true,
  resolveLooseReferences = false,
}: {
  workbookXml: string;
  calcs: AuthorCalcInput[];
  datasource?: string;
  labelErrors?: boolean;
  resolveLooseReferences?: boolean;
} & WithExecutorAndAbortSignal): Promise<Result<AuthorCalculationsResult, AuthorCalcError>> {
  const prepared = prepareCalculationsInWorkbook({
    workbookXml,
    calcs,
    datasource,
    labelErrors,
    resolveLooseReferences,
  });
  if (prepared.isErr()) {
    return prepared;
  }

  // A calc is not something the user looks at, and this helper also runs as an early leg of
  // bind-template, where the apply that follows names the chart it built.
  const outcome = await applyAndVerify({
    xml: prepared.value.workbookXml,
    baselineXml: workbookXml,
    settled: (xml) =>
      prepared.value.authoredCalcs.every((calc) =>
        hasColumnNameAndCaption(xml, calc.calcName, calc.caption),
      ),
    executor,
    signal,
  });
  if (outcome.status === 'failed') {
    return outcome.error.toErr();
  }
  if (outcome.status === 'not-applied') {
    return new XmlModificationError(
      'load completed but did not apply: readback did not contain the new column name and caption',
    ).toErr();
  }

  return new Ok({ workbookXml: outcome.workbookXml, authoredCalcs: prepared.value.authoredCalcs });
}

export interface CalcDependencyLayering {
  // Dependency layers, each a list of indices into the input `calcs`. A calc in layer k
  // references only calcs in layers < k, so processing layers in order creates every
  // dependency before the calc that references it.
  layers: number[][];
  // Indices caught in a dependency cycle: unresolvable, so never placed in a layer.
  cycleIndices: number[];
  // Per-calc set of the indices it references within the batch (its direct dependencies).
  dependencies: Array<Set<number>>;
}

/**
 * Topologically layers a batch of calcs by their in-batch `[Caption]` references.
 * Only captions that name another calc in the same batch form edges; references to
 * existing workbook fields or unknown names are ignored (the validator judges those).
 * Uses Kahn's algorithm; any calcs still unresolved once no further layer can form are
 * returned as `cycleIndices`.
 */
export function layerCalculationsByDependency(
  calcs: ReadonlyArray<Pick<CalcSpec, 'caption' | 'formula'>>,
): CalcDependencyLayering {
  const captionToIndex = new Map<string, number>();
  calcs.forEach((calc, index) => {
    const caption = calc.caption.trim();
    if (caption.length > 0 && !captionToIndex.has(caption)) {
      captionToIndex.set(caption, index);
    }
  });

  const dependencies = calcs.map((calc, index) => {
    const deps = new Set<number>();
    for (const token of captionTokens(calc.formula)) {
      const dep = captionToIndex.get(token);
      if (dep !== undefined && dep !== index) {
        deps.add(dep);
      }
    }
    return deps;
  });

  const layers: number[][] = [];
  const resolved = new Set<number>();
  let remaining = calcs.map((_, index) => index);

  while (remaining.length > 0) {
    const layer = remaining.filter((index) =>
      [...dependencies[index]].every((dep) => resolved.has(dep)),
    );
    if (layer.length === 0) {
      break; // everything left references (or is downstream of) a cycle
    }
    for (const index of layer) {
      resolved.add(index);
    }
    remaining = remaining.filter((index) => !resolved.has(index));
    layers.push(layer);
  }

  return { layers, cycleIndices: remaining, dependencies };
}

function captionTokens(formula: string): string[] {
  const tokens: string[] = [];
  rewriteUnquotedFieldReferences(formula, (whole, token) => {
    tokens.push(token);
    return whole;
  });
  return tokens;
}

/**
 * Authors a batch of calculations with per-calc validation and dependency ordering.
 * Resolves ONE target datasource for the whole batch, activates it once, then walks the
 * dependency layers: within a layer it validates each formula (cascading a failure to any
 * calc that depends on it), then creates the layer's valid calcs in a single whole-document
 * apply. Returns a per-calc outcome; calcs created in earlier layers persist even when a
 * later calc fails (partial success). An unresolvable/failed activation, a caption collision,
 * an empty batch, or a duplicate caption aborts the whole batch with no partial state.
 */
export async function authorCalculationsWithValidation({
  workbookXml,
  calcs,
  datasource,
  executor,
  signal,
  resolveLooseReferences = false,
}: {
  workbookXml: string;
  calcs: CalcSpec[];
  datasource?: string;
  resolveLooseReferences?: boolean;
} & WithExecutorAndAbortSignal): Promise<Result<AuthoredCalcOutcome[], AuthorCalcError>> {
  if (calcs.length === 0) {
    return new ArgsValidationError('at least one calculation is required').toErr();
  }

  const specs = calcs.map((calc) => ({ ...calc, caption: calc.caption.trim() }));
  for (const [index, calc] of specs.entries()) {
    const label = `calc "${calc.caption || `#${index + 1}`}": `;
    if (calc.caption.length === 0) {
      return new ArgsValidationError(`calc #${index + 1}: caption empty`).toErr();
    }
    if (calc.formula.trim().length === 0) {
      return new ArgsValidationError(`${label}formula empty`).toErr();
    }
    if (!roleSchema.safeParse(calc.role).success) {
      return new ArgsValidationError(`${label}invalid role`).toErr();
    }
    if (!datatypeSchema.safeParse(calc.datatype).success) {
      return new ArgsValidationError(`${label}invalid datatype`).toErr();
    }
  }

  // Captions are the dependency key, so a duplicate is ambiguous — abort the batch.
  const seenCaptions = new Set<string>();
  for (const calc of specs) {
    if (seenCaptions.has(calc.caption)) {
      return new ArgsValidationError(`duplicate caption "${calc.caption}" in batch`).toErr();
    }
    seenCaptions.add(calc.caption);
  }

  // One datasource for the whole batch. An unresolvable datasource aborts before any write.
  const targetResult = selectTargetDatasource(workbookXml, datasource);
  if (targetResult.isErr()) {
    return targetResult.error.toErr();
  }
  const datasourceName = targetResult.value.name;

  // A pre-existing caption is either an idempotent retry (identical resolved definition -> reuse the
  // existing calc and author nothing) or a real collision (abort with no partial state rather than
  // silently shadowing a real field). Decided before any apply. The resolved-formula comparison
  // mirrors prepareCalculationBatch so an author-calc retry with identical args succeeds on its own
  // prior output instead of erroring. No write has happened yet, so the initial workbook is the
  // basis for both loose- and caption-reference resolution.
  const looseFields = resolveLooseReferences
    ? summarizeSchema(workbookXml).fields.filter((field) => field.datasource === datasourceName)
    : undefined;
  const idempotentOutcomes = new Map<number, AuthoredCalcOutcome>();
  for (const [index, calc] of specs.entries()) {
    const existingColumn = findColumnByCaption(targetResult.value.xml, calc.caption);
    if (existingColumn === undefined) {
      continue;
    }
    let comparisonFormula = calc.formula;
    if (looseFields !== undefined) {
      const loose = resolveLooseFormulaReferences(
        comparisonFormula,
        { datasource: datasourceName, fields: looseFields },
        '',
      );
      // An unresolvable loose reference can't be an identical retry; fall through to collision.
      if (loose.isOk()) {
        comparisonFormula = loose.value;
      }
    }
    const resolvedFormula = resolveCaptionReferences(
      comparisonFormula,
      targetResult.value.xml,
      workbookXml,
    );
    if (existingCalcMatches(existingColumn, resolvedFormula, calc)) {
      idempotentOutcomes.set(index, {
        status: 'created',
        caption: calc.caption,
        calcName: unescapeXml(getAttr(existingColumn, 'name') ?? ''),
        datasource: datasourceName,
      });
      continue;
    }
    return new ArgsValidationError(
      'caption collision — pick a new caption or use the existing field',
    ).toErr();
  }

  // Every requested calc already exists identically: report reuse without activating the
  // datasource or applying anything.
  if (idempotentOutcomes.size === specs.length) {
    return new Ok(specs.map((_, index) => idempotentOutcomes.get(index)!));
  }

  const layering = layerCalculationsByDependency(specs);

  // Activate the target datasource exactly once, by its internal <datasource name=...> id.
  // A failed activation aborts: validating/creating against the wrong active datasource
  // would be silently wrong.
  const activation = await executor.executeCommand({
    namespace: 'tabdoc',
    command: 'set-active-datasource',
    args: { datasource: datasourceName },
    signal,
  });
  if (activation.isErr()) {
    return new DesktopCommandExecutionError(activation.error).toErr();
  }

  const outcomes = new Array<AuthoredCalcOutcome | undefined>(specs.length).fill(undefined);
  for (const [index, outcome] of idempotentOutcomes) {
    outcomes[index] = outcome;
  }
  for (const index of layering.cycleIndices) {
    outcomes[index] = {
      status: 'failed',
      caption: specs[index].caption,
      failure: 'cycle',
      message: 'calculation is part of a dependency cycle within the batch',
    };
  }

  let liveXml = workbookXml;
  for (const layer of layering.layers) {
    const pending: number[] = [];
    for (const index of layer) {
      if (outcomes[index] !== undefined) {
        // Idempotent reuse already recorded in the pre-check; nothing to validate or create.
        continue;
      }
      const failedDep = [...layering.dependencies[index]].find(
        (dep) => outcomes[dep]?.status === 'failed',
      );
      if (failedDep !== undefined) {
        outcomes[index] = {
          status: 'failed',
          caption: specs[index].caption,
          failure: 'dependency-failed',
          message: `depends on "${specs[failedDep].caption}", which was not created`,
        };
      } else {
        pending.push(index);
      }
    }

    const toCreate: Array<{ index: number; formula: string }> = [];
    for (const index of pending) {
      const calc = specs[index];
      let formula = calc.formula;
      if (resolveLooseReferences) {
        const schema = summarizeSchema(liveXml);
        const loose = resolveLooseFormulaReferences(
          formula,
          {
            datasource: datasourceName,
            fields: schema.fields.filter((field) => field.datasource === datasourceName),
          },
          '',
        );
        if (loose.isErr()) {
          outcomes[index] = {
            status: 'failed',
            caption: calc.caption,
            failure: 'invalid-formula',
            message: loose.error.message,
          };
          continue;
        }
        formula = loose.value;
      }

      const validation = await validateCalcFormula({
        formula,
        caption: calc.caption,
        executor,
        signal,
      });
      if (validation.status === 'error') {
        // The validate command could not run (transport / non-completed envelope) — an infra
        // failure, not a verdict on this formula. Abort with the typed execution error rather than
        // reporting invalid-formula, so the agent is never told to "fix" a correct formula. Matches
        // the set-active-datasource activation abort above.
        return validation.error.toErr();
      }
      if (validation.status === 'invalid') {
        outcomes[index] = {
          status: 'failed',
          caption: calc.caption,
          failure: 'invalid-formula',
          message: validation.message,
        };
        continue;
      }
      toCreate.push({ index, formula });
    }

    if (toCreate.length === 0) {
      continue;
    }

    // Re-resolve the target after every splice: each insertion shifts later offsets.
    let editedXml = liveXml;
    const created: Array<{ index: number; calcName: string; caption: string }> = [];
    for (const item of toCreate) {
      const calc = specs[item.index];
      const target = selectTargetDatasource(editedXml, datasourceName);
      if (target.isErr()) {
        return target.error.toErr();
      }
      const resolvedFormula = resolveCaptionReferences(item.formula, target.value.xml, editedXml);
      const calcName = nextCalculationName(editedXml, Date.now());
      const columnXml = renderCalculationColumn({
        caption: calc.caption,
        formula: resolvedFormula,
        role: calc.role,
        datatype: calc.datatype,
        calcName,
      });
      editedXml = spliceColumnIntoDatasource(editedXml, target.value, columnXml);
      created.push({ index: item.index, calcName, caption: calc.caption });
    }

    const guard = validateWorkbookDocumentApply(editedXml, liveXml);
    if (!guard.ok) {
      return new ArgsValidationError(guard.message).toErr();
    }

    const applied = await applyAndVerify({
      xml: editedXml,
      baselineXml: liveXml,
      settled: (xml) =>
        created.every((calc) => hasColumnNameAndCaption(xml, calc.calcName, calc.caption)),
      executor,
      signal,
    });
    if (applied.status === 'failed') {
      return applied.error.toErr();
    }
    if (applied.status === 'not-applied') {
      return new XmlModificationError(
        'load completed but did not apply: readback did not contain the new column name and caption',
      ).toErr();
    }

    // The readback is the live base for the next layer, so its dependencies resolve against
    // the internal names just created.
    liveXml = applied.workbookXml;
    for (const calc of created) {
      outcomes[calc.index] = {
        status: 'created',
        caption: calc.caption,
        calcName: calc.calcName,
        datasource: datasourceName,
      };
    }
  }

  // Every calc is created, reused, cycled, dependency-failed, or invalid above. An undefined
  // outcome means the layering/loop missed an index — an internal bug, not a formula problem.
  const finalized: AuthoredCalcOutcome[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome === undefined) {
      return new ArgsValidationError(
        `internal error: calculation "${specs[index].caption}" was not processed`,
      ).toErr();
    }
    finalized.push(outcome);
  }
  return new Ok(finalized);
}

type CalcValidation =
  | { status: 'valid' }
  | { status: 'invalid'; message: string }
  // Infra failure: carries the typed error so the caller aborts with a DesktopCommandExecutionError
  // instead of misreporting the formula as invalid.
  | { status: 'error'; error: DesktopCommandExecutionError };

async function validateCalcFormula({
  formula,
  caption,
  executor,
  signal,
}: {
  formula: string;
  caption: string;
} & WithExecutorAndAbortSignal): Promise<CalcValidation> {
  const result = await executor.executeCommand({
    namespace: 'tabdoc',
    command: 'get-calc-details-pres-model-for-formula',
    args: { 'calculation-formula': formula, 'calculation-caption': caption },
    signal,
  });
  // A rejected command (transport error / non-completed envelope) is an infra failure, not a
  // verdict on the formula. An invalid formula comes back as a completed command with errors.
  if (result.isErr()) {
    return { status: 'error', error: new DesktopCommandExecutionError(result.error) };
  }
  if (result.value.status !== 'completed') {
    // A non-completed envelope carries Desktop's own error for a 'failed' command; surface it as an
    // execution error and note the terminal status so the failure is diagnosable.
    return {
      status: 'error',
      error: new DesktopCommandExecutionError(
        { type: 'command-failed', error: result.value.error },
        `formula validation did not complete (status: ${result.value.status})`,
      ),
    };
  }
  const errors = calcErrorMessages(result.value.result);
  if (errors === undefined) {
    // errorMsgs is always present in a well-formed response (empty for a valid formula). Its absence
    // means the command's result shape changed, so "no errors" is not trustworthy — fail closed and
    // author nothing rather than silently create an unvalidated calc (the W-24061123 false-success bug).
    return {
      status: 'error',
      error: new DesktopCommandExecutionError(
        { type: 'invalid-response', error: result.value.result },
        'formula validation succeeded but its result did not contain the expected errorMsgs field',
      ),
    };
  }
  if (errors.length > 0) {
    return { status: 'invalid', message: formatValidatorErrors(errors) };
  }
  return { status: 'valid' };
}

// Mirrors the numbered-list format used by XmlValidationError in mcpToolError.ts:447 so agents
// see a consistent multi-error shape across the tool surface. A single error stays inline for
// terseness; multiple errors get the numbered list with a leading count.
function formatValidatorErrors(errors: string[]): string {
  if (errors.length === 1) {
    return errors[0];
  }
  const list = errors.map((error, index) => `${index + 1}. ${error}`).join('\n');
  return `Formula validation reported ${errors.length} error(s):\n${list}`;
}

/**
 * Reads the calc validator's error list out of the command result.
 *
 * tabdoc:get-calc-details-pres-model-for-formula returns a completed (SUCCEEDED) command whose
 * out-param is a UserCalculationDetailsPresModel; an invalid formula is DATA — a non-empty
 * errorMsgs array — never a command failure. executeCommand hands back the command envelope, so
 * the out-params live on `.result`. Captured live payloads (the __fixtures__ pair) pin the shape:
 * `result.userCalculationDetails.errorMsgs: string[]`, present-and-empty for a valid formula and
 * non-empty for an invalid one.
 *
 * Returns `undefined` ONLY when no errorMsgs array exists anywhere in the result. Because errorMsgs
 * is always present in a well-formed response, that absence means the command contract changed, so
 * the caller must fail CLOSED (author nothing) rather than treat it as "no errors" — treating an
 * unparseable response as valid is the W-24061123 false-success bug. An empty array means valid.
 * The walk descends objects AND arrays and matches the errorMsg(s) key case-insensitively so a
 * nesting/casing drift still finds the array rather than silently missing it.
 */
export function calcErrorMessages(
  result: Record<string, unknown> | undefined,
): string[] | undefined {
  return findErrorMessagesNode(result);
}

function findErrorMessagesNode(node: unknown): string[] | undefined {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findErrorMessagesNode(entry);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (node === null || typeof node !== 'object') {
    return undefined;
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value) && /^errormsgs?$/.test(key.replace(/[^a-z]/gi, '').toLowerCase())) {
      return value.map((entry) => String(entry)).filter((entry) => entry.length > 0);
    }
  }
  for (const value of Object.values(node)) {
    const found = findErrorMessagesNode(value);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Pure calculation-authoring seam for a trusted caller that composes datasource
 * calculations and a worksheet into one workbook mutation. The ordinary
 * author-calc path still uses {@link authorCalculationsInWorkbook}, which applies
 * and verifies immediately.
 */
export function prepareCalculationsInWorkbook({
  workbookXml,
  calcs,
  datasource,
  labelErrors = true,
  resolveLooseReferences = false,
}: {
  workbookXml: string;
  calcs: AuthorCalcInput[];
  datasource?: string;
  labelErrors?: boolean;
  resolveLooseReferences?: boolean;
}): Result<AuthorCalculationsResult, ArgsValidationError> {
  const prepared = prepareCalculationBatch({
    workbookXml,
    calcs,
    datasource,
    labelErrors,
    resolveLooseReferences,
  });
  if (prepared.isErr()) {
    return prepared;
  }
  return new Ok({
    workbookXml: prepared.value.editedXml,
    authoredCalcs: prepared.value.authoredCalcs,
  });
}

function prepareCalculationBatch({
  workbookXml,
  calcs,
  datasource,
  labelErrors,
  resolveLooseReferences,
}: {
  workbookXml: string;
  calcs: AuthorCalcInput[];
  datasource?: string;
  labelErrors: boolean;
  resolveLooseReferences: boolean;
}): Result<{ editedXml: string; authoredCalcs: AuthoredCalc[] }, ArgsValidationError> {
  let editedXml = workbookXml;
  const authoredCalcs: AuthoredCalc[] = [];

  for (const [index, calc] of calcs.entries()) {
    const caption = calc.caption.trim();
    const label = labelErrors ? `calc "${caption || `#${index + 1}`}": ` : '';
    if (caption.length === 0) {
      return new ArgsValidationError(`${label}caption empty`).toErr();
    }
    if (calc.formula.trim().length === 0) {
      return new ArgsValidationError(`${label}formula empty`).toErr();
    }
    const role = calc.role ?? 'measure';
    if (!roleSchema.safeParse(role).success) {
      return new ArgsValidationError(`${label}invalid role`).toErr();
    }
    const datatype = calc.datatype ?? 'real';
    if (!datatypeSchema.safeParse(datatype).success) {
      return new ArgsValidationError(`${label}invalid datatype`).toErr();
    }

    const targetResult = selectTargetDatasource(editedXml, datasource);
    if (targetResult.isErr()) {
      const message = labelErrors
        ? `${label}${targetResult.error.message}`
        : targetResult.error.message;
      return new ArgsValidationError(message).toErr();
    }
    const target = targetResult.value;
    let formula = calc.formula;
    if (resolveLooseReferences) {
      const workbookSchema = summarizeSchema(editedXml);
      const looseFormula = resolveLooseFormulaReferences(
        formula,
        {
          datasource: target.name,
          fields: workbookSchema.fields.filter((field) => field.datasource === target.name),
        },
        label,
      );
      if (looseFormula.isErr()) return looseFormula;
      formula = looseFormula.value;
    }
    const resolvedFormula = resolveCaptionReferences(formula, target.xml, editedXml);
    const existingColumn = findColumnByCaption(target.xml, caption);
    if (existingColumn !== undefined) {
      const existingFormula = getAttr(existingColumn, 'formula');
      const existingRole = unescapeXml(getAttr(existingColumn, 'role') ?? '');
      const existingDatatype = unescapeXml(getAttr(existingColumn, 'datatype') ?? '');
      const existingDefaultFormat = unescapeXml(getAttr(existingColumn, 'default-format') ?? '');
      if (
        existingFormula !== undefined &&
        normalizeFormula(unescapeXml(existingFormula)) === normalizeFormula(resolvedFormula) &&
        existingRole === role &&
        calculationDatatypesMatch(existingDatatype, datatype, role) &&
        existingDefaultFormat === (calc.defaultFormat ?? '')
      ) {
        // Idempotent retry: the live workbook already contains this exact
        // deterministic calculation, so keep it and continue with dependent calcs.
        continue;
      }
      return new ArgsValidationError(
        `${label}caption collision — pick a new caption or use the existing field`,
      ).toErr();
    }

    const calcName = nextCalculationName(editedXml, Date.now());
    const columnXml = renderCalculationColumn({
      caption,
      formula: resolvedFormula,
      role,
      datatype,
      calcName,
      defaultFormat: calc.defaultFormat,
    });
    editedXml = spliceColumnIntoDatasource(editedXml, target, columnXml);
    authoredCalcs.push({ calcName, caption, datasource: target.name });
  }

  const validation = validateWorkbookDocumentApply(editedXml, workbookXml);
  if (!validation.ok) {
    return new ArgsValidationError(validation.message).toErr();
  }

  return new Ok({ editedXml, authoredCalcs });
}

function calculationDatatypesMatch(existing: string, requested: Datatype, role: Role): boolean {
  if (existing === requested) return true;
  if (role !== 'measure') return false;

  // Tableau may canonicalize a numeric calculation between real and integer on
  // workbook readback based on the formula's result type. When the normalized
  // formula, role, and default format are unchanged, both representations refer
  // to the same numeric measure and are safe to reuse on an idempotent retry.
  const numericDatatypes = new Set<string>(['integer', 'real']);
  return numericDatatypes.has(existing) && numericDatatypes.has(requested);
}

// An existing column is an idempotent match for a requested calc when its stored definition is
// identical: same normalized formula, same role, a compatible numeric datatype, and no extra
// default format (the validation path never sets one). Mirrors prepareCalculationBatch's check so
// author-calc retries behave the same on both authoring paths.
function existingCalcMatches(
  existingColumn: string,
  resolvedFormula: string,
  calc: Pick<CalcSpec, 'role' | 'datatype'>,
): boolean {
  const existingFormula = getAttr(existingColumn, 'formula');
  if (existingFormula === undefined) {
    return false;
  }
  const existingRole = unescapeXml(getAttr(existingColumn, 'role') ?? '');
  const existingDatatype = unescapeXml(getAttr(existingColumn, 'datatype') ?? '');
  const existingDefaultFormat = unescapeXml(getAttr(existingColumn, 'default-format') ?? '');
  return (
    normalizeFormula(unescapeXml(existingFormula)) === normalizeFormula(resolvedFormula) &&
    existingRole === calc.role &&
    calculationDatatypesMatch(existingDatatype, calc.datatype, calc.role) &&
    existingDefaultFormat === ''
  );
}

function resolveLooseFormulaReferences(
  formula: string,
  schema: ReturnType<typeof summarizeSchema>,
  label: string,
): Result<string, ArgsValidationError> {
  let error: ArgsValidationError | undefined;
  const rewritten = rewriteUnquotedFieldReferences(formula, (whole, token, offset, end) => {
    if (
      formula.slice(end, end + 2) === '.[' ||
      formula.slice(Math.max(0, offset - 2), offset) === '].'
    ) {
      return whole;
    }

    const resolution = resolveLooseFieldReference(token, schema);
    if (resolution.kind === 'resolved') {
      return renderFieldReference(
        resolution.field.caption ?? bareName(resolution.field.columnName),
      );
    }

    if (!error) {
      const candidates = formatFieldCandidates(resolution.candidates);
      const outcome = resolution.kind === 'ambiguous' ? 'is ambiguous' : 'was not found';
      error = new ArgsValidationError(`${label}field reference [${token}] ${outcome}${candidates}`);
    }
    return whole;
  });

  return error ? error.toErr() : new Ok(rewritten);
}

function rewriteUnquotedFieldReferences(
  formula: string,
  replacer: (whole: string, token: string, offset: number, end: number) => string,
): string {
  const fieldReference = /\[(?:[^\]]|\]\])*\]/y;
  let quote: "'" | '"' | undefined;
  let lineComment = false;
  let blockComment = false;
  let cursor = 0;
  let rewritten = '';

  for (let index = 0; index < formula.length; index += 1) {
    const char = formula[index];
    const next = formula[index + 1];
    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote && formula[index - 1] !== '\\') quote = undefined;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char !== '[') continue;

    fieldReference.lastIndex = index;
    const match = fieldReference.exec(formula);
    if (!match) continue;

    const whole = match[0];
    const end = index + whole.length;
    const token = whole.slice(1, -1).replaceAll(']]', ']');
    rewritten += formula.slice(cursor, index);
    rewritten += replacer(whole, token, index, end);
    cursor = end;
    index = end - 1;
  }

  return `${rewritten}${formula.slice(cursor)}`;
}

function renderFieldReference(token: string): string {
  return `[${token.replaceAll(']', ']]')}]`;
}

function formatFieldCandidates(fields: SchemaField[]): string {
  const names = [
    ...new Set(fields.map((field) => field.caption ?? bareName(field.columnName))),
  ].slice(0, 3);
  return names.length > 0 ? ` <one of: ${names.join(', ')}>` : '';
}

export function selectTargetDatasource(
  xml: string,
  requested: string | undefined,
): Result<DatasourceElement, ArgsValidationError> {
  const datasources = findDatasourceElements(xml);
  const candidates = datasources.filter((datasource) => datasource.name !== 'Parameters');
  if (requested !== undefined) {
    const selected = candidates.find((datasource) => datasource.name === requested);
    if (selected) {
      return new Ok(selected);
    }
    return new ArgsValidationError(
      `Datasource "${requested}" was not found. Candidates: ${candidates.map((d) => d.name).join(', ')}`,
    ).toErr();
  }
  if (candidates.length === 1) {
    return new Ok(candidates[0]);
  }
  if (candidates.length === 0) {
    return new ArgsValidationError('No non-Parameters datasource found.').toErr();
  }
  return new ArgsValidationError(
    `Multiple datasources found; specify datasource. Candidates: ${candidates.map((d) => d.name).join(', ')}`,
  ).toErr();
}

export function findDatasourceElements(xml: string): DatasourceElement[] {
  const elements: DatasourceElement[] = [];
  const opaqueRanges = findOpaqueXmlRanges(xml);
  // Worksheet <dependencies> blocks clone <datasource name='...'> elements.
  // Only the top-level <datasources> block holds the real datasource definitions.
  const blockStart = findTokenOutsideOpaque(xml, '<datasources>', 0, xml.length, opaqueRanges);
  const blockEnd =
    blockStart === -1
      ? -1
      : findTokenOutsideOpaque(
          xml,
          '</datasources>',
          blockStart + '<datasources>'.length,
          xml.length,
          opaqueRanges,
        );
  const scanFrom = blockStart === -1 ? 0 : blockStart;
  const scanTo = blockEnd === -1 ? xml.length : blockEnd;
  const openTagRe = /<datasource\b[^>]*(?:\/>|>)/g;
  for (const match of xml.matchAll(openTagRe)) {
    if (
      match.index < scanFrom ||
      match.index >= scanTo ||
      containingRange(match.index, opaqueRanges) !== undefined
    ) {
      continue;
    }
    const openTag = match[0];
    const openStart = match.index;
    const openEnd = openStart + openTag.length;
    const name = getAttr(openTag, 'name');
    if (name === undefined) {
      continue;
    }
    const selfClosing = /\/\s*>$/.test(openTag);
    if (selfClosing) {
      elements.push({
        name: unescapeXml(name),
        openStart,
        openEnd,
        closeStart: openEnd,
        closeEnd: openEnd,
        xml: openTag,
        selfClosing,
      });
      continue;
    }
    const closeStart = findDatasourceClose(xml, openEnd, scanTo, opaqueRanges);
    if (closeStart === -1) {
      continue;
    }
    const closeEnd = closeStart + '</datasource>'.length;
    elements.push({
      name: unescapeXml(name),
      openStart,
      openEnd,
      closeStart,
      closeEnd,
      xml: xml.slice(openStart, closeEnd),
      selfClosing,
    });
  }
  return elements;
}

function findOpaqueXmlRanges(xml: string): XmlRange[] {
  const opaqueSections = [
    { open: '<![CDATA[', close: ']]>' },
    { open: '<!--', close: '-->' },
    { open: '<?', close: '?>' },
  ];
  const ranges: XmlRange[] = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const next = opaqueSections
      .map((section) => ({ ...section, start: xml.indexOf(section.open, cursor) }))
      .filter((section) => section.start !== -1)
      .sort((left, right) => left.start - right.start)[0];
    if (!next) break;

    const closeStart = xml.indexOf(next.close, next.start + next.open.length);
    const end = closeStart === -1 ? xml.length : closeStart + next.close.length;
    ranges.push({ start: next.start, end });
    cursor = end;
  }

  return ranges;
}

function containingRange(offset: number, ranges: XmlRange[]): XmlRange | undefined {
  return ranges.find((range) => range.start <= offset && offset < range.end);
}

function findTokenOutsideOpaque(
  xml: string,
  token: string,
  from: number,
  scanTo: number,
  opaqueRanges: XmlRange[],
): number {
  let cursor = from;
  while (cursor < scanTo) {
    const tokenStart = xml.indexOf(token, cursor);
    if (tokenStart === -1 || tokenStart >= scanTo) return -1;
    const opaqueRange = containingRange(tokenStart, opaqueRanges);
    if (!opaqueRange) return tokenStart;
    cursor = opaqueRange.end;
  }
  return -1;
}

function findDatasourceClose(
  xml: string,
  from: number,
  scanTo: number,
  opaqueRanges: XmlRange[],
): number {
  return findTokenOutsideOpaque(xml, '</datasource>', from, scanTo, opaqueRanges);
}

function normalizeFormula(formula: string): string {
  let normalized = '';
  let index = 0;
  let state: 'code' | 'quoted' | 'field' | 'lineNote' | 'blockNote' = 'code';
  let quote = '';

  while (index < formula.length) {
    const char = formula[index];
    const next = formula[index + 1];

    if (state === 'code') {
      if (/\s/.test(char)) {
        if (normalized.length > 0 && normalized[normalized.length - 1] !== ' ') normalized += ' ';
        while (index + 1 < formula.length && /\s/.test(formula[index + 1])) index += 1;
      } else if (char === '"' || char === "'") {
        state = 'quoted';
        quote = char;
        normalized += char;
      } else if (char === '[') {
        state = 'field';
        normalized += char;
      } else if (char === '/' && next === '/') {
        state = 'lineNote';
        normalized += '//';
        index += 1;
      } else if (char === '/' && next === '*') {
        state = 'blockNote';
        normalized += '/*';
        index += 1;
      } else {
        normalized += char;
      }
    } else if (state === 'quoted') {
      normalized += char;
      if (char === quote) {
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && formula[cursor] === '\\'; cursor -= 1) {
          backslashes += 1;
        }
        if (backslashes % 2 === 1) {
          // Backslash-escaped delimiters remain inside the literal. Tableau also
          // accepts doubled delimiters, handled by the next branch.
        } else if (next === quote) {
          normalized += next;
          index += 1;
        } else {
          state = 'code';
        }
      }
    } else if (state === 'field') {
      normalized += char;
      if (char === ']') {
        if (next === ']') {
          normalized += next;
          index += 1;
        } else {
          state = 'code';
        }
      }
    } else if (state === 'lineNote') {
      normalized += char;
      if (char === '\n' || char === '\r') state = 'code';
    } else {
      normalized += char;
      if (char === '*' && next === '/') {
        normalized += '/';
        index += 1;
        state = 'code';
      }
    }
    index += 1;
  }

  return normalized.trim();
}

function findColumnByCaption(datasourceXml: string, caption: string): string | undefined {
  return findColumnTags(datasourceXml).find(
    (tag) => unescapeXml(getAttr(tag, 'caption') ?? '') === caption,
  );
}

export function hasColumnNameAndCaption(xml: string, name: string, caption: string): boolean {
  return findColumnTags(xml).some(
    (tag) =>
      unescapeXml(getAttr(tag, 'name') ?? '') === name &&
      unescapeXml(getAttr(tag, 'caption') ?? '') === caption,
  );
}

function findColumnTags(xml: string): string[] {
  return [...xml.matchAll(/<column\b[\s\S]*?(?:<\/column>|\/>)/g)].map((match) => match[0]);
}

export { resolveCaptionReferences as resolveCaptionReferencesForTest };

function resolveCaptionReferences(
  formula: string,
  datasourceXml: string,
  workbookXml?: string,
): string {
  const captionToRef = new Map<string, string>();
  for (const tag of findColumnTags(datasourceXml)) {
    const cap = getAttr(tag, 'caption');
    const name = getAttr(tag, 'name');
    if (cap === undefined || name === undefined) continue;
    const capText = unescapeXml(cap);
    const nameText = unescapeXml(name).replace(/^\[|\]$/g, '');
    if (capText !== nameText) {
      captionToRef.set(capText, renderFieldReference(nameText));
    }
  }
  // Parameters live in their own datasource, so caption references must be qualified.
  if (workbookXml !== undefined) {
    const paramsDs = parametersDatasourceBlock(workbookXml);
    if (paramsDs !== undefined) {
      for (const tag of findColumnTags(paramsDs)) {
        const cap = getAttr(tag, 'caption');
        const name = getAttr(tag, 'name');
        if (cap === undefined || name === undefined) continue;
        captionToRef.set(unescapeXml(cap), `[Parameters].${unescapeXml(name)}`);
      }
    }
  }
  if (captionToRef.size === 0) return formula;
  return rewriteUnquotedFieldReferences(formula, (whole, token) => {
    return captionToRef.get(token) ?? whole;
  });
}

function parametersDatasourceBlock(xml: string): string | undefined {
  const open = /<datasource\b[^>]*\bname=(['"])Parameters\1[^>]*>/.exec(xml);
  if (!open || open.index === undefined) return undefined;
  const close = xml.indexOf('</datasource>', open.index);
  return close === -1 ? undefined : xml.slice(open.index, close + '</datasource>'.length);
}

function nextCalculationName(xml: string, epochMillis: number): string {
  const used = new Set(
    [...xml.matchAll(/\bname=(['"])\[Calculation_(\d+)\]\1/g)].map((match) => match[2]),
  );
  let candidate = epochMillis;
  while (used.has(String(candidate))) {
    candidate += 1;
  }
  return `[Calculation_${candidate}]`;
}

function renderCalculationColumn({
  caption,
  datatype,
  formula,
  role,
  calcName,
  defaultFormat,
}: {
  caption: string;
  datatype: Datatype;
  formula: string;
  role: Role;
  calcName: string;
  defaultFormat?: 'p0%';
}): string {
  const type =
    role === 'measure' && (datatype === 'real' || datatype === 'integer')
      ? 'quantitative'
      : 'nominal';
  const formatAttr = defaultFormat ? ` default-format='${defaultFormat}'` : '';
  return `<column caption='${escapeXml(caption)}' datatype='${datatype}'${formatAttr} name='${escapeXml(calcName)}' role='${role}' type='${type}'><calculation class='tableau' formula='${prettyPrintFormula(formula)}' /></column>`;
}

function spliceColumnIntoDatasource(
  xml: string,
  datasource: DatasourceElement,
  columnXml: string,
): string {
  if (datasource.selfClosing) {
    const openTag = xml.slice(datasource.openStart, datasource.openEnd).replace(/\/\s*>$/, '>');
    return `${xml.slice(0, datasource.openStart)}${openTag}${columnXml}</datasource>${xml.slice(
      datasource.openEnd,
    )}`;
  }

  // Insert at datasource end; relation/schema columns inside connections are not field defs.
  return `${xml.slice(0, datasource.closeStart)}${columnXml}${xml.slice(datasource.closeStart)}`;
}

function getAttr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=(['"])(.*?)\\1`));
  return match?.[2];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;')
    .replaceAll('"', '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replace(
      /&#(?:x([0-9a-fA-F]+)|(\d+));/g,
      (entity, hex: string | undefined, decimal: string | undefined) => {
        const codePoint = Number.parseInt(hex ?? decimal ?? '', hex === undefined ? 10 : 16);
        return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      },
    )
    .replaceAll('&amp;', '&');
}
