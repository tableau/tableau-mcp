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
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { applyWorkbookText } from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';

export const roleSchema = z.enum(['measure', 'dimension']);
export const datatypeSchema = z.enum(['real', 'integer', 'string', 'boolean', 'date', 'datetime']);

type DatasourceElement = {
  name: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  xml: string;
  selfClosing: boolean;
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

  // A calc is not something the user looks at, and this helper also runs as an early leg of
  // bind-template, where the apply that follows names the chart it built.
  const loadResult = await applyWorkbookText({
    xml: prepared.value.editedXml,
    focus: { navigate: 'restore' },
    executor,
    signal,
  });
  if (loadResult.isErr()) {
    return new DesktopCommandExecutionError(loadResult.error).toErr();
  }

  const readback = await pollReadback({
    read: () => getWorkbookXml({ executor, signal }),
    settled: (xml) =>
      prepared.value.authoredCalcs.every((calc) =>
        hasColumnNameAndCaption(xml, calc.calcName, calc.caption),
      ),
    signal,
  });
  if (!readback.ok) {
    return new DesktopCommandExecutionError(readback.error).toErr();
  }
  if (!readback.settled) {
    return new XmlModificationError(
      'load completed but did not apply: readback did not contain the new column name and caption',
    ).toErr();
  }

  return new Ok({ workbookXml: readback.value, authoredCalcs: prepared.value.authoredCalcs });
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
    if (hasColumnCaption(target.xml, caption)) {
      return new ArgsValidationError(
        `${label}caption collision — pick a new caption or use the existing field`,
      ).toErr();
    }

    const calcName = nextCalculationName(editedXml, Date.now());
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

function selectTargetDatasource(
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

function findDatasourceElements(xml: string): DatasourceElement[] {
  const elements: DatasourceElement[] = [];
  // Worksheet <dependencies> blocks clone <datasource name='...'> elements.
  // Only the top-level <datasources> block holds the real datasource definitions.
  const blockStart = xml.indexOf('<datasources>');
  const blockEnd = xml.indexOf('</datasources>', blockStart);
  const scanFrom = blockStart === -1 ? 0 : blockStart;
  const scanTo = blockEnd === -1 ? xml.length : blockEnd;
  const openTagRe = /<datasource\b[^>]*(?:\/>|>)/g;
  for (const match of xml.matchAll(openTagRe)) {
    if (match.index < scanFrom || match.index >= scanTo) {
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
    const closeStart = xml.indexOf('</datasource>', openEnd);
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

function hasColumnCaption(datasourceXml: string, caption: string): boolean {
  return findColumnTags(datasourceXml).some(
    (tag) => unescapeXml(getAttr(tag, 'caption') ?? '') === caption,
  );
}

function hasColumnNameAndCaption(xml: string, name: string, caption: string): boolean {
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
  return `<column caption='${escapeXml(caption)}' datatype='${datatype}'${formatAttr} name='${escapeXml(calcName)}' role='${role}' type='${type}'><calculation class='tableau' formula='${escapeXml(formula)}' /></column>`;
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
    .replaceAll('&amp;', '&');
}
