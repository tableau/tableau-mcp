import * as xpath from 'xpath';

import { createCalculationAggregationResolver } from '../../formulaAggregation.js';
import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

type DatasourceScopeKind = 'datasource' | 'datasource-dependencies';

interface DatasourceScope {
  element: Element;
  kind: DatasourceScopeKind;
  ownerName: string;
  formulas: ReadonlyMap<string, string>;
}

function isNoneDerivation(ci: Element): boolean {
  const derivation = ci.getAttribute('derivation');
  if (derivation === 'None') return true;
  if (derivation === null || derivation === '') {
    return /\[?none:/i.test(ci.getAttribute('name') ?? '');
  }
  return false;
}

function xpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `concat(${value
    .split('"')
    .map((part) => `"${part}"`)
    .join(", '\"', ")})`;
}

function directColumns(element: Element): Element[] {
  return xpath.select('./column', element as unknown as Node) as Element[];
}

function columnFormula(column: Element): string | undefined {
  const calculations = xpath.select('./calculation', column as unknown as Node) as Element[];
  if (calculations.length === 0) return undefined;
  return calculations.map((calculation) => calculation.getAttribute('formula') ?? '').join(' ');
}

function formulasFor(element: Element): Map<string, string> {
  const formulas = new Map<string, string>();
  for (const column of directColumns(element)) {
    const name = column.getAttribute('name');
    const formula = columnFormula(column);
    if (name && formula !== undefined) formulas.set(name, formula);
  }
  return formulas;
}

function formulasWithLocalOverrides(
  inherited: ReadonlyMap<string, string> | undefined,
  localElement: Element,
): Map<string, string> {
  const formulas = new Map(inherited ?? []);
  for (const column of directColumns(localElement)) {
    const name = column.getAttribute('name');
    if (!name) continue;
    const formula = columnFormula(column);
    if (formula === undefined) formulas.delete(name);
    else formulas.set(name, formula);
  }
  return formulas;
}

function datasourceScopes(doc: Document): DatasourceScope[] {
  const scopes: DatasourceScope[] = [];
  const definitions = new Map<string, ReadonlyMap<string, string>>();
  const datasources = xpath.select(
    '/workbook/datasources/datasource | /datasource',
    doc as unknown as Node,
  ) as Element[];

  for (const datasource of datasources) {
    const ownerName = datasource.getAttribute('name');
    if (!ownerName) continue;
    const formulas = formulasFor(datasource);
    definitions.set(ownerName, formulas);
    scopes.push({ element: datasource, kind: 'datasource', ownerName, formulas });
  }

  const dependencies = xpath.select(
    '//datasource-dependencies',
    doc as unknown as Node,
  ) as Element[];
  for (const dependency of dependencies) {
    const ownerName = dependency.getAttribute('datasource');
    if (!ownerName) continue;
    scopes.push({
      element: dependency,
      kind: 'datasource-dependencies',
      ownerName,
      formulas: formulasWithLocalOverrides(definitions.get(ownerName), dependency),
    });
  }

  return scopes;
}

function columnInstanceXPath(scope: DatasourceScope, columnName: string): string {
  const ownerAttribute = scope.kind === 'datasource' ? 'name' : 'datasource';
  return `//${scope.kind}[@${ownerAttribute}=${xpathLiteral(scope.ownerName)}]//column-instance[@column=${xpathLiteral(columnName)}]`;
}

export const aggregateCalcDerivationRule: ValidationRule = {
  id: 'aggregate-calc-derivation',
  description:
    'Errors when an aggregate/table-calc calculated field is referenced by a none: (derivation="None") ' +
    'column-instance instead of usr: (derivation="User") — the viz renders blank.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const issuesByInstance = new Map<string, ValidationIssue>();
    for (const scope of datasourceScopes(doc)) {
      const requiresUserDerivation = createCalculationAggregationResolver(scope.formulas);
      const cis = xpath.select(
        './column-instance[@column]',
        scope.element as unknown as Node,
      ) as Element[];
      for (const ci of cis) {
        const colRef = ci.getAttribute('column') ?? '';
        if (!requiresUserDerivation(colRef) || !isNoneDerivation(ci)) continue;

        const ciName = ci.getAttribute('name') ?? '';
        const issueKey = JSON.stringify([scope.ownerName, ciName]);
        const existing = issuesByInstance.get(issueKey);
        if (existing) {
          existing.occurrenceCount = (existing.occurrenceCount ?? 1) + 1;
          continue;
        }

        issuesByInstance.set(issueKey, {
          ruleId: 'aggregate-calc-derivation',
          severity: 'error',
          occurrenceCount: 1,
          message:
            `Aggregate/table-calc calculated field ${colRef} in datasource ${JSON.stringify(scope.ownerName)} is referenced by a ` +
            `none:/derivation="None" column-instance (${ciName || '(unnamed)'}). An aggregate or table-calc calc must use ` +
            'derivation="User" with the usr: prefix; with none: the viz renders blank (Tableau accepts the XML but produces no marks). ' +
            `Change the column-instance to derivation="User" and name it [usr:${colRef.replace(/^\[|\]$/g, '')}:qk].`,
          xpath: columnInstanceXPath(scope, colRef),
          suggestion:
            'Set derivation="User" and use the usr: prefix on the column-instance (e.g. ' +
            `[usr:${colRef.replace(/^\[|\]$/g, '')}:qk]) for this aggregate/table-calc field.`,
        });
      }
    }

    return [...issuesByInstance.values()];
  },
};
