import { Err, Ok, type Result } from 'ts-results-es';

import { decodeXmlEntities, findElement, xmlNamesEqual } from '../../../../desktop/xmlElement.js';
import { getAttr, spliceActionIntoWorkbook } from '../datasource/authorAction.js';
import { readWorkbookActions, type WorkbookAction } from '../datasource/authorActionLifecycle.js';

const ACTION_ELEMENT =
  /<(action|nav-action|edit-group-action|edit-parameter-action)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;
const ACTIONS_BLOCK = /<actions\b[^>]*>[\s\S]*?<\/actions>/;
const DATASOURCES_BLOCK = /<datasources>[\s\S]*?<\/datasources>/;
const DATASOURCE_ENTRY = /<datasource\b[^>]*?(?:\/>|>[\s\S]*?<\/datasource>)/g;
const DEPENDENCY_BLOCK = /<datasource-dependencies\b[\s\S]*?<\/datasource-dependencies>/g;
const DEPENDENCY_COLUMN = /<(column(?:-instance)?)\s[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;
const LATER_FAMILIES = /<nav-action\b|<edit-group-action\b|<edit-parameter-action\b/;

type Keyed = { key: string; xml: string };
type Dependency = Keyed & { columns: Keyed[] };
export type ActionSiblings = { datasources: Keyed[]; dependencies: Dependency[] };
export type CarriedActions = { actions: WorkbookAction[]; siblings: ActionSiblings };
export type ReadActions = { actions: WorkbookAction[]; siblings: ActionSiblings };
export type CarryOutcome = CarriedActions & { drift?: string };

const keyOf = (tag: string, attribute: string): string =>
  decodeXmlEntities(getAttr(/^<[^>]*>/.exec(tag)?.[0] ?? '', attribute) ?? '');

function readSiblings(block: string): ActionSiblings {
  const datasources = [
    ...(DATASOURCES_BLOCK.exec(block)?.[0] ?? '').matchAll(DATASOURCE_ENTRY),
  ].map(([xml]) => ({ key: keyOf(xml, 'name'), xml }));
  const dependencies = [...block.matchAll(DEPENDENCY_BLOCK)].map(([xml]) => ({
    key: keyOf(xml, 'datasource'),
    xml,
    columns: [...xml.matchAll(DEPENDENCY_COLUMN)].map(([column]) => ({
      key: keyOf(column, 'name'),
      xml: column,
    })),
  }));
  return { datasources, dependencies };
}

/** Every workbook action with its original XML text, plus the sibling datasource entries and columns. */
export function readVerbatimWorkbookActions(xml: string): Result<ReadActions, string> {
  const actions = readWorkbookActions(xml);
  if (actions.isErr()) return Err(actions.error.message);
  const block = ACTIONS_BLOCK.exec(xml)?.[0] ?? '';
  const verbatim = new Map<string, string>();
  for (const [element] of block.matchAll(ACTION_ELEMENT)) {
    verbatim.set(keyOf(element, 'name'), element);
  }
  const result: WorkbookAction[] = [];
  for (const action of actions.value) {
    const original = verbatim.get(action.name);
    if (original === undefined) return Err(`cannot read action "${action.name}" from the workbook`);
    result.push({ ...action, xml: original });
  }
  return Ok({ actions: result, siblings: readSiblings(block) });
}

// An action goes with the dashboard when a tag names it as its source dashboard or its target.
function isTiedToDashboard(action: WorkbookAction, dashboardName: string): boolean {
  return [...action.xml.matchAll(/<[\w-]+\b[^>]*>/g)].some(([tag]) => {
    const named = /^<param\b/.test(tag)
      ? getAttr(tag, 'name') === 'target'
        ? getAttr(tag, 'value')
        : undefined
      : getAttr(tag, 'dashboard');
    return named !== undefined && xmlNamesEqual(named, dashboardName);
  });
}

/**
 * What the re-read lost that went with the deleted dashboard, plus drift: anything else the re-read lost
 * was removed by another author after the delete and must not be put back.
 */
export function carriedFrom(
  original: ReadActions,
  afterXml: string,
  dashboardName: string,
): Result<CarryOutcome, string> {
  const after = readVerbatimWorkbookActions(afterXml);
  if (after.isErr()) return Err(after.error);
  const present = new Set(after.value.actions.map((action) => action.name));
  const lost = original.actions.filter((action) => !present.has(action.name));
  const actions = lost.filter((action) => isTiedToDashboard(action, dashboardName));
  const untied = lost.find((action) => !actions.includes(action));
  const hasDatasource = new Set(after.value.siblings.datasources.map((entry) => entry.key));
  const afterDependencies = new Map(
    after.value.siblings.dependencies.map((dependency) => [dependency.key, dependency]),
  );
  const dependencies: Dependency[] = [];
  for (const dependency of original.siblings.dependencies) {
    const kept = afterDependencies.get(dependency.key);
    if (kept === undefined) {
      dependencies.push(dependency);
      continue;
    }
    const keptColumns = new Set(kept.columns.map((column) => column.key));
    const columns = dependency.columns.filter((column) => !keptColumns.has(column.key));
    if (columns.length > 0) dependencies.push({ ...dependency, columns });
  }
  const siblings = {
    datasources: original.siblings.datasources.filter((entry) => !hasDatasource.has(entry.key)),
    dependencies,
  };
  const siblingsLost = siblings.datasources.length > 0 || dependencies.length > 0;
  const gone = 'The workbook changed after the old dashboard was removed:';
  if (untied)
    return Ok({ actions: [], siblings, drift: `${gone} action "${untied.name}" is gone.` });
  if (siblingsLost && actions.length === 0) {
    return Ok({
      actions,
      siblings,
      drift: `${gone} datasource entries or columns used by the actions are gone.`,
    });
  }
  return Ok({ actions, siblings });
}

export function insertCarriedActions(xml: string, carried: CarriedActions): Result<string, string> {
  let result = xml;
  if (carried.actions.length === 0) return Ok(result);
  if (!/<actions\b/.test(result)) {
    // Desktop writes <actions> after <shared-views>, right before <worksheets>.
    const worksheets = /<worksheets\b/.exec(result);
    if (worksheets === null) return Err('cannot place actions: workbook has no <worksheets>');
    result = `${result.slice(0, worksheets.index)}<actions></actions>${result.slice(worksheets.index)}`;
  }
  for (const action of carried.actions) {
    const spliced = spliceActionIntoWorkbook(result, action.xml);
    if (spliced.isErr()) return Err(spliced.error.message);
    result = spliced.value;
  }
  return insertSiblings(result, carried.siblings);
}

// The XSD puts <datasources>/<datasource-dependencies> after the legacy <action>s and before nav/set/parameter actions.
function insertSiblings(xml: string, siblings: ActionSiblings): Result<string, string> {
  if (siblings.datasources.length === 0 && siblings.dependencies.length === 0) return Ok(xml);
  const match = /(<actions\b[^>]*>)([\s\S]*?)(<\/actions>)/.exec(xml);
  if (match === null) return Err('cannot place action datasources: no <actions> block');
  let inner = match[2];
  const existing = readSiblings(inner);
  inner = inner.replace(DATASOURCES_BLOCK, '').replace(DEPENDENCY_BLOCK, '');
  const datasources = [...existing.datasources, ...siblings.datasources];
  const dependencies = existing.dependencies.map((dependency) => {
    const extra = siblings.dependencies.find((candidate) => candidate.key === dependency.key);
    return extra === undefined
      ? dependency.xml
      : dependency.xml.replace(
          '</datasource-dependencies>',
          () => `${extra.columns.map((column) => column.xml).join('')}</datasource-dependencies>`,
        );
  });
  for (const dependency of siblings.dependencies) {
    if (!existing.dependencies.some((candidate) => candidate.key === dependency.key)) {
      dependencies.push(dependency.xml);
    }
  }
  const block =
    (datasources.length > 0
      ? `<datasources>${datasources.map((entry) => entry.xml).join('')}</datasources>`
      : '') + dependencies.join('');
  const offset = LATER_FAMILIES.exec(inner)?.index ?? inner.length;
  const merged = `${inner.slice(0, offset)}${block}${inner.slice(offset)}`;
  return Ok(
    `${xml.slice(0, match.index)}${match[1]}${merged}${match[3]}${xml.slice(match.index + match[0].length)}`,
  );
}

function elementSpan(
  xml: string,
  tag: string,
  name: string,
): { start: number; end: number } | null {
  const match = findElement(xml, tag, name);
  if (match === null) return null;
  const open = /^<[^>]*>/.exec(match.text)?.[0] ?? '';
  return open.endsWith('/>')
    ? { start: match.start, end: match.start + open.length }
    : { start: match.start, end: match.end };
}

/** Move the rebuilt dashboard and its window back before the same next sibling the old ones had. */
export function restoreTabPosition(originalXml: string, rebuiltXml: string, name: string): string {
  return ['dashboard', 'window'].reduce((xml, tag) => {
    const names = [...originalXml.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(([open]) =>
      keyOf(open, 'name'),
    );
    const index = names.indexOf(name);
    const own = elementSpan(xml, tag, name);
    if (index === -1 || own === null) return xml;
    const text = xml.slice(own.start, own.end);
    const without = xml.slice(0, own.start) + xml.slice(own.end);
    for (const next of names.slice(index + 1)) {
      const target = elementSpan(without, tag, next);
      if (target !== null) {
        return `${without.slice(0, target.start)}${text}${without.slice(target.start)}`;
      }
    }
    return xml;
  }, rebuiltXml);
}
